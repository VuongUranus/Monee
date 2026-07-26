import crypto from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type {
  Account,
  AccountType,
  DeleteMutationResult,
  FinanceCategory,
  FinancePreferences,
  Fund,
  FundMonthDetailResponse,
  PersonalMutationResponse,
  SharedMutationResponse,
  Transaction,
} from "@chi-tieu/shared";
import type { FinanceDatabase } from "./client.js";
import * as schema from "./schema.js";
import type { PersonalMutationCommand, SharedMutationCommand } from "../lib/repository.js";
import { SharedFundError } from "../lib/repository.js";

type Executor = Parameters<Parameters<FinanceDatabase["transaction"]>[0]>[0];

function slugId(name: string): string {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `muc-${Date.now().toString(36)}`;
}

function uniqueId(name: string, ids: string[]): string {
  const base = slugId(name);
  let id = base;
  let suffix = 2;
  while (ids.includes(id)) id = `${base}-${suffix++}`;
  return id;
}

async function privateFund(tx: Executor, userId: string, externalId: string) {
  const [fund] = await tx.select().from(schema.funds).where(and(
    eq(schema.funds.ownerId, userId),
    eq(schema.funds.externalId, externalId),
    eq(schema.funds.shared, false),
  ));
  if (!fund) throw new SharedFundError("fund_not_found", 404, "Không tìm thấy quỹ.");
  return fund;
}

async function ensureLedgerYear(tx: Executor, userId: string, year: number): Promise<boolean> {
  const inserted = await tx.insert(schema.ledgerYears).values({ userId, year }).onConflictDoNothing().returning();
  if (!inserted.length) return false;
  const [settings, funds] = await Promise.all([
    tx.select().from(schema.userSettings).where(eq(schema.userSettings.userId, userId)),
    tx.select().from(schema.funds).where(and(
      eq(schema.funds.ownerId, userId),
      eq(schema.funds.shared, false),
    )),
  ]);
  if (settings[0]?.onboardingStatus === "completed" && funds.length) {
    await tx.insert(schema.fundMonths).values(funds.flatMap((fund) =>
      Array.from({ length: 12 }, (_, index) => ({
        fundId: fund.id,
        year,
        month: index + 1,
        amount: fund.fundPlan,
      })))).onConflictDoNothing();
  }
  return true;
}

async function replaceFundDetail(
  tx: Executor,
  fundMonthId: string,
  detail: import("@chi-tieu/shared").FundDetail,
): Promise<void> {
  await tx.delete(schema.fundMonthDetails).where(eq(schema.fundMonthDetails.fundMonthId, fundMonthId));
  if (!detail) return;
  const [inserted] = await tx.insert(schema.fundMonthDetails).values({
    fundMonthId,
    type: detail.type,
  }).returning();
  if (!inserted) return;
  if (detail.type === "hold" && detail.lots.length) {
    await tx.insert(schema.holdingLots).values(detail.lots.map((lot, position) => ({
      detailId: inserted.id,
      position,
      ticker: lot.ticker,
      quantity: lot.qty,
      manualPrice: lot.manualPrice ?? null,
      purchasePrice: lot.purchasePrice ?? null,
      purchaseFxVnd: lot.purchaseFxVnd ?? null,
      feeVnd: lot.feeVnd ?? null,
      purchasedAt: lot.purchasedAt ?? null,
      note: lot.note ?? null,
      exchange: lot.exchange ?? null,
      providerId: lot.providerId ?? null,
    })));
  } else if (detail.type === "gold" && detail.lots.length) {
    await tx.insert(schema.goldLots).values(detail.lots.map((lot, position) => ({
      detailId: inserted.id,
      position,
      chi: lot.chi,
      manualPrice: lot.manualPrice ?? null,
      purchasePrice: lot.purchasePrice ?? null,
      feeVnd: lot.feeVnd ?? null,
      purchasedAt: lot.purchasedAt ?? null,
      note: lot.note ?? null,
    })));
  }
}

async function financePreferences(tx: Executor, userId: string): Promise<FinancePreferences> {
  const [settings] = await tx.select().from(schema.userSettings).where(eq(schema.userSettings.userId, userId));
  return {
    showGoals: settings?.showGoals ?? false,
    onboarding: {
      status: settings?.onboardingStatus as FinancePreferences["onboarding"]["status"] ?? "pending",
      version: settings?.onboardingVersion ?? 1,
      ...(settings?.onboardingSkippedAt ? { skippedAt: settings.onboardingSkippedAt.toISOString() } : {}),
    },
    financialProfile: {
      monthlyIncome: settings?.monthlyIncome ?? 0,
      emergencyFundGoal: settings?.emergencyFundGoal ?? 0,
      debt: {
        balance: settings?.debtBalance ?? 0,
        monthlyPayment: settings?.debtMonthlyPayment ?? 0,
      },
    },
    incomeMigrationVersion: settings?.incomeMigrationVersion ?? 1,
    futureIncomeResetVersion: settings?.futureIncomeResetVersion ?? 1,
    ...(settings?.legacyUsdRate !== null && settings?.legacyUsdRate !== undefined
      ? { usdRate: settings.legacyUsdRate }
      : {}),
  };
}

async function recalculateMarketFundMonths(tx: Executor, userId: string): Promise<void> {
  await tx.execute(sql`
    with gold_values as (
      select
        fm.id,
        round(sum(
          gl.chi * coalesce(
            nullif((select mgq.vnd_per_chi from market_gold_quotes mgq where mgq.user_id = ${userId}), 0),
            nullif(gl.manual_price, 0),
            0
          )
        ))::bigint as amount
      from fund_months fm
      join funds f on f.id = fm.fund_id
      join fund_month_details fmd on fmd.fund_month_id = fm.id and fmd.type = 'gold'
      join gold_lots gl on gl.detail_id = fmd.id
      where f.owner_id = ${userId} and f.shared = false and f.category = 'gold'
      group by fm.id
      having sum(
        gl.chi * coalesce(
          nullif((select mgq.vnd_per_chi from market_gold_quotes mgq where mgq.user_id = ${userId}), 0),
          nullif(gl.manual_price, 0),
          0
        )
      ) > 0
    ),
    holding_prices as (
      select
        fm.id as fund_month_id,
        hl.quantity,
        case
          when f.category = 'stock' then coalesce(
            (
              select msq.price_vnd
              from market_stock_quotes msq
              where msq.user_id = ${userId}
                and upper(msq.symbol) = upper(trim(hl.ticker))
              order by
                case when hl.exchange is not null and msq.exchange = hl.exchange then 0 else 1 end,
                msq.fetched_at desc
              limit 1
            ),
            nullif(hl.manual_price, 0),
            (select lp.price from legacy_prices lp where lp.user_id = ${userId} and upper(lp.symbol) = upper(trim(hl.ticker))),
            0
          )
          else coalesce(
            (
              select mcq.price_usd
              from market_crypto_quotes mcq
              where mcq.user_id = ${userId}
                and mcq.provider_id = coalesce(
                  hl.provider_id,
                  (
                    select mcs.provider_id
                    from market_crypto_symbols mcs
                    where mcs.user_id = ${userId} and upper(mcs.symbol) = upper(trim(hl.ticker))
                    limit 1
                  )
                )
              limit 1
            ),
            nullif(hl.manual_price, 0),
            (select lp.price from legacy_prices lp where lp.user_id = ${userId} and upper(lp.symbol) = upper(trim(hl.ticker))),
            0
          ) * coalesce(
            nullif((select mfq.usd_vnd from market_fx_quotes mfq where mfq.user_id = ${userId}), 0),
            nullif((select us.legacy_usd_rate from user_settings us where us.user_id = ${userId}), 0),
            0
          )
        end as price_vnd
      from fund_months fm
      join funds f on f.id = fm.fund_id
      join fund_month_details fmd on fmd.fund_month_id = fm.id and fmd.type = 'hold'
      join holding_lots hl on hl.detail_id = fmd.id
      where f.owner_id = ${userId}
        and f.shared = false
        and f.category in ('stock', 'crypto')
    ),
    holding_values as (
      select
        fund_month_id as id,
        round(sum(case when quantity > 0 then quantity * price_vnd else 0 end))::bigint as amount
      from holding_prices
      group by fund_month_id
      having bool_or(quantity > 0)
        and bool_and(case when quantity > 0 then price_vnd > 0 else true end)
    ),
    asset_values as (
      select id, amount from gold_values
      union all
      select id, amount from holding_values
    )
    update fund_months fm
    set amount = asset_values.amount
    from asset_values
    where fm.id = asset_values.id
  `);
}

async function runCommand(
  tx: Executor,
  userId: string,
  command: PersonalMutationCommand,
): Promise<unknown> {
  switch (command.kind) {
    case "preferences": {
      const [current] = await tx.select().from(schema.userSettings).where(eq(schema.userSettings.userId, userId));
      const profile = command.patch.financialProfile;
      const onboarding = command.patch.onboarding;
      await tx.insert(schema.userSettings).values({
        userId,
        showGoals: command.patch.showGoals ?? current?.showGoals ?? false,
        monthlyIncome: profile?.monthlyIncome ?? current?.monthlyIncome ?? 0,
        emergencyFundGoal: profile?.emergencyFundGoal ?? current?.emergencyFundGoal ?? 0,
        debtBalance: profile?.debtBalance ?? current?.debtBalance ?? 0,
        debtMonthlyPayment: profile?.debtMonthlyPayment ?? current?.debtMonthlyPayment ?? 0,
        onboardingStatus: onboarding?.status ?? current?.onboardingStatus ?? "pending",
        onboardingVersion: onboarding?.version ?? current?.onboardingVersion ?? 1,
        onboardingSkippedAt: onboarding?.skippedAt
          ? new Date(onboarding.skippedAt)
          : current?.onboardingSkippedAt ?? null,
        incomeMigrationVersion: current?.incomeMigrationVersion ?? 1,
        futureIncomeResetVersion: current?.futureIncomeResetVersion ?? 1,
        legacyUsdRate: current?.legacyUsdRate ?? null,
      }).onConflictDoUpdate({
        target: schema.userSettings.userId,
        set: {
          showGoals: command.patch.showGoals ?? current?.showGoals ?? false,
          monthlyIncome: profile?.monthlyIncome ?? current?.monthlyIncome ?? 0,
          emergencyFundGoal: profile?.emergencyFundGoal ?? current?.emergencyFundGoal ?? 0,
          debtBalance: profile?.debtBalance ?? current?.debtBalance ?? 0,
          debtMonthlyPayment: profile?.debtMonthlyPayment ?? current?.debtMonthlyPayment ?? 0,
          onboardingStatus: onboarding?.status ?? current?.onboardingStatus ?? "pending",
          onboardingVersion: onboarding?.version ?? current?.onboardingVersion ?? 1,
          onboardingSkippedAt: onboarding?.skippedAt
            ? new Date(onboarding.skippedAt)
            : current?.onboardingSkippedAt ?? null,
        },
      });
      return financePreferences(tx, userId);
    }
    case "ensureYear":
      await ensureLedgerYear(tx, userId, command.year);
      return { year: command.year };
    case "monthNote": {
      await ensureLedgerYear(tx, userId, command.year);
      await tx.insert(schema.ledgerMonths).values({
        userId,
        year: command.year,
        month: command.month,
        note: command.note,
      }).onConflictDoUpdate({
        target: [schema.ledgerMonths.userId, schema.ledgerMonths.year, schema.ledgerMonths.month],
        set: { note: command.note },
      });
      return { year: command.year, month: command.month, note: command.note };
    }
    case "resetMonth": {
      const funds = await tx.select({ id: schema.funds.id }).from(schema.funds).where(and(
        eq(schema.funds.ownerId, userId),
        eq(schema.funds.shared, false),
      ));
      const ids = funds.map((fund) => fund.id);
      if (ids.length) {
        const periods = await tx.select({ id: schema.fundMonths.id }).from(schema.fundMonths).where(and(
          inArray(schema.fundMonths.fundId, ids),
          eq(schema.fundMonths.year, command.year),
          eq(schema.fundMonths.month, command.month),
        ));
        if (periods.length) {
          await tx.delete(schema.fundMonthDetails).where(inArray(
            schema.fundMonthDetails.fundMonthId,
            periods.map((period) => period.id),
          ));
          await tx.update(schema.fundMonths).set({ amount: 0 }).where(inArray(
            schema.fundMonths.id,
            periods.map((period) => period.id),
          ));
        }
      }
      await tx.insert(schema.ledgerMonths).values({
        userId,
        year: command.year,
        month: command.month,
        note: "",
      }).onConflictDoUpdate({
        target: [schema.ledgerMonths.userId, schema.ledgerMonths.year, schema.ledgerMonths.month],
        set: { note: "" },
      });
      return { year: command.year, month: command.month };
    }
    case "createFund": {
      const existing = await tx.select({
        id: schema.funds.externalId,
      }).from(schema.funds).where(eq(schema.funds.ownerId, userId));
      const externalId = uniqueId(command.input.name, existing.map((entry) => entry.id));
      const [fund] = await tx.insert(schema.funds).values({
        externalId,
        ownerId: userId,
        name: command.input.name,
        color: command.input.color,
        category: command.input.category,
      }).returning();
      const positions = await tx.select().from(schema.fundPositions)
        .where(eq(schema.fundPositions.userId, userId))
        .orderBy(asc(schema.fundPositions.position));
      await tx.insert(schema.fundPositions).values({
        fundId: fund!.id,
        userId,
        position: (positions.at(-1)?.position ?? -1) + 1,
      });
      return {
        id: externalId,
        name: command.input.name,
        color: command.input.color,
        cat: command.input.category,
      } satisfies Fund;
    }
    case "updateFund": {
      const fund = await privateFund(tx, userId, command.id);
      const [updated] = await tx.update(schema.funds).set({
        ...(command.patch.name !== undefined ? { name: command.patch.name } : {}),
        ...(command.patch.color !== undefined ? { color: command.patch.color } : {}),
        ...(command.patch.category !== undefined ? { category: command.patch.category } : {}),
        ...(command.patch.fundPlan !== undefined ? { fundPlan: command.patch.fundPlan } : {}),
        ...(command.patch.openingBalance !== undefined ? { openingBalance: command.patch.openingBalance } : {}),
        updatedAt: new Date(),
      }).where(eq(schema.funds.id, fund.id)).returning();
      return {
        id: updated!.externalId,
        name: updated!.name,
        color: updated!.color,
        cat: updated!.category,
      };
    }
    case "deleteFund": {
      const fund = await privateFund(tx, userId, command.id);
      const privateFunds = await tx.select({ id: schema.funds.id }).from(schema.funds).where(and(
        eq(schema.funds.ownerId, userId),
        eq(schema.funds.shared, false),
      ));
      if (privateFunds.length <= 1) {
        throw new SharedFundError("last_fund", 400, "Không thể xóa quỹ cuối cùng.");
      }
      await tx.delete(schema.funds).where(eq(schema.funds.id, fund.id));
      return { deletedId: command.id } satisfies DeleteMutationResult;
    }
    case "reorderFunds": {
      const funds = await tx.select().from(schema.funds).where(and(
        eq(schema.funds.ownerId, userId),
        eq(schema.funds.shared, false),
      ));
      if (funds.length !== command.ids.length || command.ids.some((id) => !funds.some((fund) => fund.externalId === id))) {
        throw new SharedFundError("invalid_order", 400, "Thứ tự quỹ không hợp lệ.");
      }
      const currentPositions = await tx.select().from(schema.fundPositions)
        .where(eq(schema.fundPositions.userId, userId))
        .orderBy(asc(schema.fundPositions.position));
      const privateInternalIds = new Set(funds.map((fund) => fund.id));
      const sharedFundIds = currentPositions
        .filter((position) => !privateInternalIds.has(position.fundId))
        .map((position) => position.fundId);
      await tx.delete(schema.fundPositions).where(eq(schema.fundPositions.userId, userId));
      await tx.insert(schema.fundPositions).values([
        ...command.ids.map((id, position) => ({
          fundId: funds.find((fund) => fund.externalId === id)!.id,
          userId,
          position,
        })),
        ...sharedFundIds.map((fundId, index) => ({
          fundId,
          userId,
          position: command.ids.length + index,
        })),
      ]);
      return { ids: command.ids };
    }
    case "fundMonth": {
      const fund = await privateFund(tx, userId, command.id);
      await ensureLedgerYear(tx, userId, command.year);
      const [period] = await tx.insert(schema.fundMonths).values({
        fundId: fund.id,
        year: command.year,
        month: command.month,
        amount: command.patch.amount,
      }).onConflictDoUpdate({
        target: [schema.fundMonths.fundId, schema.fundMonths.year, schema.fundMonths.month],
        set: { amount: command.patch.amount },
      }).returning();
      if (command.patch.detail !== undefined) {
        await replaceFundDetail(tx, period!.id, command.patch.detail);
      }
      return {
        fundId: command.id,
        year: command.year,
        month: command.month,
        amount: command.patch.amount,
        detail: command.patch.detail ?? null,
      } satisfies FundMonthDetailResponse;
    }
    case "fundGoal": {
      const fund = await privateFund(tx, userId, command.id);
      if (command.input.year === null) {
        await tx.update(schema.funds).set({
          allGoal: command.input.amount,
          goalConfigured: true,
          updatedAt: new Date(),
        }).where(eq(schema.funds.id, fund.id));
      } else if (command.input.amount > 0) {
        await tx.insert(schema.fundYearGoals).values({
          fundId: fund.id,
          year: command.input.year,
          amount: command.input.amount,
        }).onConflictDoUpdate({
          target: [schema.fundYearGoals.fundId, schema.fundYearGoals.year],
          set: { amount: command.input.amount },
        });
        await tx.update(schema.funds).set({ goalConfigured: true }).where(eq(schema.funds.id, fund.id));
      } else {
        await tx.delete(schema.fundYearGoals).where(and(
          eq(schema.fundYearGoals.fundId, fund.id),
          eq(schema.fundYearGoals.year, command.input.year),
        ));
      }
      return { fundId: command.id, year: command.input.year, amount: command.input.amount };
    }
    case "createTransaction":
    case "updateTransaction": {
      const input = command.transaction;
      const [category] = await tx.select().from(schema.financeCategories).where(and(
        eq(schema.financeCategories.userId, userId),
        eq(schema.financeCategories.externalId, input.cat),
        eq(schema.financeCategories.type, input.type),
      ));
      if (!category) throw new SharedFundError("category_not_found", 404, "Không tìm thấy danh mục.");
      let accountId: string | null = null;
      if (input.accountId) {
        const [account] = await tx.select().from(schema.accounts).where(and(
          eq(schema.accounts.userId, userId),
          eq(schema.accounts.externalId, input.accountId),
        ));
        if (!account) throw new SharedFundError("account_not_found", 404, "Không tìm thấy tài khoản.");
        accountId = account.id;
      }
      const externalId = command.kind === "createTransaction"
        ? input.id || crypto.randomUUID()
        : command.id;
      const values = {
        categoryId: category.id,
        accountId,
        date: input.date,
        type: input.type,
        amount: input.amount,
        note: input.note,
        updatedAt: new Date(),
      };
      if (command.kind === "createTransaction") {
        await tx.insert(schema.transactions).values({
          externalId,
          userId,
          ...values,
        });
      } else {
        const updated = await tx.update(schema.transactions).set(values).where(and(
          eq(schema.transactions.userId, userId),
          eq(schema.transactions.externalId, command.id),
        )).returning();
        if (!updated.length) throw new SharedFundError("transaction_not_found", 404, "Không tìm thấy giao dịch.");
      }
      return {
        id: externalId,
        date: input.date,
        type: input.type,
        cat: input.cat,
        ...(input.accountId ? { accountId: input.accountId } : {}),
        amount: input.amount,
        note: input.note,
      } satisfies Transaction;
    }
    case "deleteTransaction": {
      const deleted = await tx.delete(schema.transactions).where(and(
        eq(schema.transactions.userId, userId),
        eq(schema.transactions.externalId, command.id),
      )).returning();
      if (!deleted.length) throw new SharedFundError("transaction_not_found", 404, "Không tìm thấy giao dịch.");
      return { deletedId: command.id } satisfies DeleteMutationResult;
    }
    case "createCategory": {
      const rows = await tx.select().from(schema.financeCategories).where(and(
        eq(schema.financeCategories.userId, userId),
        eq(schema.financeCategories.type, command.input.type),
      )).orderBy(asc(schema.financeCategories.position));
      const id = uniqueId(command.input.name, rows.map((row) => row.externalId));
      await tx.insert(schema.financeCategories).values({
        externalId: id,
        userId,
        type: command.input.type,
        name: command.input.name,
        color: command.input.color,
        budget: command.input.budget ?? 0,
        position: (rows.at(-1)?.position ?? -1) + 1,
      });
      return {
        id,
        name: command.input.name,
        color: command.input.color,
        ...(command.input.type === "expense" ? { budget: command.input.budget ?? 0 } : {}),
      } satisfies FinanceCategory;
    }
    case "updateCategory": {
      const [row] = await tx.update(schema.financeCategories).set({
        ...(command.patch.name !== undefined ? { name: command.patch.name } : {}),
        ...(command.patch.color !== undefined ? { color: command.patch.color } : {}),
        ...(command.patch.budget !== undefined ? { budget: command.patch.budget } : {}),
      }).where(and(
        eq(schema.financeCategories.userId, userId),
        eq(schema.financeCategories.type, command.type),
        eq(schema.financeCategories.externalId, command.id),
        sql`${schema.financeCategories.deletedAt} is null`,
      )).returning();
      if (!row) throw new SharedFundError("category_not_found", 404, "Không tìm thấy danh mục.");
      return categoryResult(row);
    }
    case "deleteCategory": {
      const active = await tx.select({ id: schema.financeCategories.id }).from(schema.financeCategories).where(and(
        eq(schema.financeCategories.userId, userId),
        eq(schema.financeCategories.type, command.type),
        sql`${schema.financeCategories.deletedAt} is null`,
      ));
      if (active.length <= 1) {
        throw new SharedFundError("last_category", 400, "Không thể xóa danh mục cuối cùng.");
      }
      const [row] = await tx.update(schema.financeCategories).set({ deletedAt: new Date() }).where(and(
        eq(schema.financeCategories.userId, userId),
        eq(schema.financeCategories.type, command.type),
        eq(schema.financeCategories.externalId, command.id),
        sql`${schema.financeCategories.deletedAt} is null`,
      )).returning();
      if (!row) throw new SharedFundError("category_not_found", 404, "Không tìm thấy danh mục.");
      return { deletedId: command.id } satisfies DeleteMutationResult;
    }
    case "reorderCategories": {
      const rows = await tx.select().from(schema.financeCategories).where(and(
        eq(schema.financeCategories.userId, userId),
        eq(schema.financeCategories.type, command.type),
        sql`${schema.financeCategories.deletedAt} is null`,
      ));
      if (rows.length !== command.ids.length || command.ids.some((id) => !rows.some((row) => row.externalId === id))) {
        throw new SharedFundError("invalid_order", 400, "Thứ tự danh mục không hợp lệ.");
      }
      await Promise.all(command.ids.map((id, position) => tx.update(schema.financeCategories)
        .set({ position }).where(and(
          eq(schema.financeCategories.userId, userId),
          eq(schema.financeCategories.type, command.type),
          eq(schema.financeCategories.externalId, id),
        ))));
      return { ids: command.ids };
    }
    case "createAccountType": {
      const rows = await tx.select().from(schema.accountTypes)
        .where(eq(schema.accountTypes.userId, userId)).orderBy(asc(schema.accountTypes.position));
      const id = uniqueId(command.name, rows.map((row) => row.externalId));
      await tx.insert(schema.accountTypes).values({
        externalId: id,
        userId,
        name: command.name,
        position: (rows.at(-1)?.position ?? -1) + 1,
      });
      return { id, name: command.name } satisfies AccountType;
    }
    case "updateAccountType": {
      const [row] = await tx.update(schema.accountTypes).set({ name: command.name }).where(and(
        eq(schema.accountTypes.userId, userId),
        eq(schema.accountTypes.externalId, command.id),
        sql`${schema.accountTypes.deletedAt} is null`,
      )).returning();
      if (!row) throw new SharedFundError("account_type_not_found", 404, "Không tìm thấy loại tài khoản.");
      return { id: row.externalId, name: row.name } satisfies AccountType;
    }
    case "deleteAccountType": {
      const [row] = await tx.update(schema.accountTypes).set({ deletedAt: new Date() }).where(and(
        eq(schema.accountTypes.userId, userId),
        eq(schema.accountTypes.externalId, command.id),
        sql`${schema.accountTypes.deletedAt} is null`,
      )).returning();
      if (!row) throw new SharedFundError("account_type_not_found", 404, "Không tìm thấy loại tài khoản.");
      return { deletedId: command.id } satisfies DeleteMutationResult;
    }
    case "reorderAccountTypes": {
      const rows = await tx.select().from(schema.accountTypes).where(and(
        eq(schema.accountTypes.userId, userId),
        sql`${schema.accountTypes.deletedAt} is null`,
      ));
      if (rows.length !== command.ids.length || command.ids.some((id) => !rows.some((row) => row.externalId === id))) {
        throw new SharedFundError("invalid_order", 400, "Thứ tự loại tài khoản không hợp lệ.");
      }
      await Promise.all(command.ids.map((id, position) => tx.update(schema.accountTypes).set({ position }).where(and(
        eq(schema.accountTypes.userId, userId),
        eq(schema.accountTypes.externalId, id),
      ))));
      return { ids: command.ids };
    }
    case "createAccount": {
      const rows = await tx.select().from(schema.accounts)
        .where(eq(schema.accounts.userId, userId)).orderBy(asc(schema.accounts.position));
      const id = uniqueId(command.input.name, rows.map((row) => row.externalId));
      const typeId = await resolveAccountTypeId(tx, userId, command.input.typeId);
      await tx.insert(schema.accounts).values({
        externalId: id,
        userId,
        name: command.input.name,
        typeId,
        position: (rows.at(-1)?.position ?? -1) + 1,
      });
      return {
        id,
        name: command.input.name,
        ...(command.input.typeId ? { typeId: command.input.typeId } : {}),
      } satisfies Account;
    }
    case "updateAccount": {
      const typeId = command.patch.typeId === undefined
        ? undefined
        : await resolveAccountTypeId(tx, userId, command.patch.typeId ?? undefined);
      const [row] = await tx.update(schema.accounts).set({
        ...(command.patch.name !== undefined ? { name: command.patch.name } : {}),
        ...(typeId !== undefined ? { typeId } : {}),
      }).where(and(
        eq(schema.accounts.userId, userId),
        eq(schema.accounts.externalId, command.id),
        sql`${schema.accounts.deletedAt} is null`,
      )).returning();
      if (!row) throw new SharedFundError("account_not_found", 404, "Không tìm thấy tài khoản.");
      return {
        id: row.externalId,
        name: row.name,
        ...(command.patch.typeId ? { typeId: command.patch.typeId } : {}),
      } satisfies Account;
    }
    case "deleteAccount": {
      const [row] = await tx.update(schema.accounts).set({ deletedAt: new Date() }).where(and(
        eq(schema.accounts.userId, userId),
        eq(schema.accounts.externalId, command.id),
        sql`${schema.accounts.deletedAt} is null`,
      )).returning();
      if (!row) throw new SharedFundError("account_not_found", 404, "Không tìm thấy tài khoản.");
      return { deletedId: command.id } satisfies DeleteMutationResult;
    }
    case "reorderAccounts": {
      const rows = await tx.select().from(schema.accounts).where(and(
        eq(schema.accounts.userId, userId),
        sql`${schema.accounts.deletedAt} is null`,
      ));
      if (rows.length !== command.ids.length || command.ids.some((id) => !rows.some((row) => row.externalId === id))) {
        throw new SharedFundError("invalid_order", 400, "Thứ tự tài khoản không hợp lệ.");
      }
      await Promise.all(command.ids.map((id, position) => tx.update(schema.accounts).set({ position }).where(and(
        eq(schema.accounts.userId, userId),
        eq(schema.accounts.externalId, id),
      ))));
      return { ids: command.ids };
    }
    case "market": {
      const { quotes } = command;
      if (quotes.fx) {
        await tx.insert(schema.marketFxQuotes).values({
          userId,
          usdVnd: quotes.fx.usdVnd,
          source: quotes.fx.source,
          sourceUrl: quotes.fx.sourceUrl ?? null,
          fetchedAt: quotes.fx.fetchedAt ? new Date(quotes.fx.fetchedAt) : null,
          legacy: quotes.fx.legacy ?? false,
        }).onConflictDoUpdate({
          target: schema.marketFxQuotes.userId,
          set: {
            usdVnd: quotes.fx.usdVnd,
            source: quotes.fx.source,
            sourceUrl: quotes.fx.sourceUrl ?? null,
            fetchedAt: quotes.fx.fetchedAt ? new Date(quotes.fx.fetchedAt) : null,
            legacy: quotes.fx.legacy ?? false,
          },
        });
      }
      if (quotes.gold) {
        await tx.insert(schema.marketGoldQuotes).values({
          userId,
          xauUsdPerTroyOunce: quotes.gold.xauUsdPerTroyOunce,
          vndPerChi: quotes.gold.vndPerChi,
          source: quotes.gold.source,
          sourceUrl: quotes.gold.sourceUrl ?? null,
          fetchedAt: new Date(quotes.gold.fetchedAt),
        }).onConflictDoUpdate({
          target: schema.marketGoldQuotes.userId,
          set: {
            xauUsdPerTroyOunce: quotes.gold.xauUsdPerTroyOunce,
            vndPerChi: quotes.gold.vndPerChi,
            source: quotes.gold.source,
            sourceUrl: quotes.gold.sourceUrl ?? null,
            fetchedAt: new Date(quotes.gold.fetchedAt),
          },
        });
      }
      if (quotes.stocks.length) {
        await tx.insert(schema.marketStockQuotes).values(quotes.stocks.map((quote) => ({
          userId,
          exchange: quote.exchange,
          symbol: quote.symbol,
          priceVnd: quote.priceVnd,
          source: quote.source,
          sourceUrl: quote.sourceUrl ?? null,
          fetchedAt: new Date(quote.fetchedAt),
        }))).onConflictDoUpdate({
          target: [
            schema.marketStockQuotes.userId,
            schema.marketStockQuotes.exchange,
            schema.marketStockQuotes.symbol,
          ],
          set: {
            priceVnd: sql`excluded.price_vnd`,
            source: sql`excluded.source`,
            sourceUrl: sql`excluded.source_url`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
      }
      if (quotes.crypto.length) {
        await tx.insert(schema.marketCryptoQuotes).values(quotes.crypto.map((quote) => ({
          userId,
          providerId: quote.providerId,
          symbol: quote.symbol,
          name: quote.name,
          priceUsd: quote.priceUsd,
          source: quote.source,
          sourceUrl: quote.sourceUrl ?? null,
          fetchedAt: new Date(quote.fetchedAt),
        }))).onConflictDoUpdate({
          target: [schema.marketCryptoQuotes.userId, schema.marketCryptoQuotes.providerId],
          set: {
            symbol: sql`excluded.symbol`,
            name: sql`excluded.name`,
            priceUsd: sql`excluded.price_usd`,
            source: sql`excluded.source`,
            sourceUrl: sql`excluded.source_url`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
        await tx.insert(schema.marketCryptoSymbols).values(quotes.crypto.map((quote) => ({
          userId,
          symbol: quote.symbol,
          providerId: quote.providerId,
        }))).onConflictDoUpdate({
          target: [schema.marketCryptoSymbols.userId, schema.marketCryptoSymbols.symbol],
          set: { providerId: sql`excluded.provider_id` },
        });
      }
      await tx.delete(schema.marketCryptoMatches).where(eq(schema.marketCryptoMatches.userId, userId));
      const matches = Object.entries(quotes.matches).flatMap(([lookupKey, entries]) =>
        entries.map((entry, position) => ({
          userId,
          lookupKey,
          position,
          providerId: entry.id,
          symbol: entry.symbol,
          name: entry.name,
          rank: entry.rank ?? null,
        })));
      if (matches.length) await tx.insert(schema.marketCryptoMatches).values(matches);
      await tx.delete(schema.marketQuoteErrors).where(eq(schema.marketQuoteErrors.userId, userId));
      if (quotes.errors.length) {
        await tx.insert(schema.marketQuoteErrors).values(quotes.errors.map((error, position) => ({
          userId,
          position,
          key: error.key,
          code: error.code,
          message: error.message,
        })));
      }
      await tx.insert(schema.marketStates).values({
        userId,
        updatedAt: new Date(quotes.fetchedAt),
      }).onConflictDoUpdate({
        target: schema.marketStates.userId,
        set: { updatedAt: new Date(quotes.fetchedAt) },
      });
      await recalculateMarketFundMonths(tx, userId);
      const affected = await tx.select({
        year: schema.fundMonths.year,
        month: schema.fundMonths.month,
      }).from(schema.fundMonths)
        .innerJoin(schema.funds, eq(schema.fundMonths.fundId, schema.funds.id))
        .where(and(
          eq(schema.funds.ownerId, userId),
          eq(schema.funds.shared, false),
          inArray(schema.funds.category, ["gold", "stock", "crypto"]),
        ))
        .groupBy(schema.fundMonths.year, schema.fundMonths.month);
      return {
        quotes,
        affectedPeriods: affected.map((entry) =>
          `${entry.year}-${String(entry.month).padStart(2, "0")}`),
      };
    }
  }
}

function categoryResult(row: typeof schema.financeCategories.$inferSelect): FinanceCategory {
  return {
    id: row.externalId,
    name: row.name,
    color: row.color,
    ...(row.type === "expense" ? { budget: row.budget } : {}),
  };
}

async function resolveAccountTypeId(
  tx: Executor,
  userId: string,
  externalId: string | undefined,
): Promise<string | null> {
  if (!externalId) return null;
  const [type] = await tx.select().from(schema.accountTypes).where(and(
    eq(schema.accountTypes.userId, userId),
    eq(schema.accountTypes.externalId, externalId),
    sql`${schema.accountTypes.deletedAt} is null`,
  ));
  if (!type) throw new SharedFundError("account_type_not_found", 404, "Không tìm thấy loại tài khoản.");
  return type.id;
}

export async function mutatePersonalResource<T>(
  db: FinanceDatabase,
  userId: string,
  expectedRevision: number,
  command: PersonalMutationCommand,
): Promise<PersonalMutationResponse<T>> {
  return db.transaction(async (tx) => {
    const lockResult: any = await tx.execute(sql`
      select workspace_revision from users where id = ${userId} for update
    `);
    const current = Number((lockResult.rows?.[0] ?? lockResult[0])?.workspace_revision);
    if (!current) throw new Error("Không tìm thấy dữ liệu tài khoản.");
    if (current !== expectedRevision) {
      throw new SharedFundError("revision_conflict", 409, "Dữ liệu đã được cập nhật ở nơi khác. Hãy tải lại.");
    }
    const data = await runCommand(tx, userId, command) as T;
    const workspaceRevision = current + 1;
    await tx.update(schema.users).set({
      workspaceRevision,
      updatedAt: new Date(),
    }).where(eq(schema.users.id, userId));
    return { data, workspaceRevision };
  });
}

export async function mutateSharedResource<T>(
  db: FinanceDatabase,
  userId: string,
  externalFundId: string,
  expectedRevision: number,
  command: SharedMutationCommand,
): Promise<SharedMutationResponse<T>> {
  return db.transaction(async (tx) => {
    const lockResult: any = await tx.execute(sql`
      select f.id, f.owner_id, f.revision,
             case when f.owner_id = ${userId} then 'owner' else fm.role end as role
      from funds f
      left join fund_members fm on fm.fund_id = f.id and fm.user_id = ${userId}
      where f.external_id = ${externalFundId}
        and f.shared = true
        and (f.owner_id = ${userId} or fm.user_id = ${userId})
      for update of f
    `);
    const locked = lockResult.rows?.[0] ?? lockResult[0];
    if (!locked) throw new SharedFundError("fund_not_found", 404, "Không tìm thấy quỹ chung.");
    const internalFundId = String(locked.id);
    const ownerId = String(locked.owner_id);
    if (Number(locked.revision) !== expectedRevision) {
      throw new SharedFundError("shared_fund_conflict", 409, "Quỹ đã được người khác cập nhật. Hãy tải lại.");
    }
    const role = String(locked.role) as "owner" | "editor" | "viewer";
    const ownerOnly = command.kind === "setMember" || command.kind === "removeMember" || command.kind === "delete";
    if (ownerOnly && role !== "owner") {
      throw new SharedFundError("forbidden", 403, "Chỉ chủ quỹ được thực hiện thao tác này.");
    }
    if (!ownerOnly && role === "viewer") {
      throw new SharedFundError("forbidden", 403, "Bạn chỉ có quyền xem quỹ này.");
    }

    let data: unknown;
    switch (command.kind) {
      case "metadata": {
        const [updated] = await tx.update(schema.funds).set({
          ...(command.patch.name !== undefined ? { name: command.patch.name } : {}),
          ...(command.patch.color !== undefined ? { color: command.patch.color } : {}),
          ...(command.patch.category !== undefined ? { category: command.patch.category } : {}),
          ...(command.patch.fundPlan !== undefined ? { fundPlan: command.patch.fundPlan } : {}),
          ...(command.patch.openingBalance !== undefined ? { openingBalance: command.patch.openingBalance } : {}),
          updatedAt: new Date(),
        }).where(eq(schema.funds.id, internalFundId)).returning();
        data = {
          id: externalFundId,
          name: updated!.name,
          color: updated!.color,
          cat: updated!.category,
          fundPlan: updated!.fundPlan,
          openingBalance: updated!.openingBalance,
        };
        break;
      }
      case "month": {
        const [period] = await tx.insert(schema.fundMonths).values({
          fundId: internalFundId,
          year: command.year,
          month: command.month,
          amount: command.amount,
        }).onConflictDoUpdate({
          target: [schema.fundMonths.fundId, schema.fundMonths.year, schema.fundMonths.month],
          set: { amount: command.amount },
        }).returning();
        if (command.detail !== undefined) await replaceFundDetail(tx, period!.id, command.detail);
        data = {
          fundId: externalFundId,
          year: command.year,
          month: command.month,
          amount: command.amount,
          detail: command.detail ?? null,
        } satisfies FundMonthDetailResponse;
        break;
      }
      case "goal": {
        if (command.year === null) {
          await tx.update(schema.funds).set({
            allGoal: command.amount,
            goalConfigured: true,
          }).where(eq(schema.funds.id, internalFundId));
        } else if (command.amount > 0) {
          await tx.insert(schema.fundYearGoals).values({
            fundId: internalFundId,
            year: command.year,
            amount: command.amount,
          }).onConflictDoUpdate({
            target: [schema.fundYearGoals.fundId, schema.fundYearGoals.year],
            set: { amount: command.amount },
          });
          await tx.update(schema.funds).set({ goalConfigured: true }).where(eq(schema.funds.id, internalFundId));
        } else {
          await tx.delete(schema.fundYearGoals).where(and(
            eq(schema.fundYearGoals.fundId, internalFundId),
            eq(schema.fundYearGoals.year, command.year),
          ));
        }
        data = { fundId: externalFundId, year: command.year, amount: command.amount };
        break;
      }
      case "setMember": {
        const [target] = await tx.select().from(schema.users)
          .where(sql`lower(${schema.users.email}) = lower(${command.email.trim()})`);
        if (!target) throw new SharedFundError("member_not_found", 404, "Email này chưa từng đăng nhập ứng dụng.");
        if (target.id === ownerId) throw new SharedFundError("cannot_share_self", 400, "Không thể thêm chính bạn.");
        await tx.insert(schema.fundMembers).values({
          fundId: internalFundId,
          userId: target.id,
          role: command.role,
          addedAt: new Date(),
        }).onConflictDoUpdate({
          target: [schema.fundMembers.fundId, schema.fundMembers.userId],
          set: { role: command.role, addedAt: new Date() },
        });
        const [position] = await tx.select().from(schema.fundPositions).where(and(
          eq(schema.fundPositions.fundId, internalFundId),
          eq(schema.fundPositions.userId, target.id),
        ));
        if (!position) {
          const positions = await tx.select().from(schema.fundPositions)
            .where(eq(schema.fundPositions.userId, target.id)).orderBy(asc(schema.fundPositions.position));
          await tx.insert(schema.fundPositions).values({
            fundId: internalFundId,
            userId: target.id,
            position: (positions.at(-1)?.position ?? -1) + 1,
          });
        }
        data = {
          fundId: externalFundId,
          member: {
            user: { sub: target.id, email: target.email, name: target.name },
            role: command.role,
          },
        };
        break;
      }
      case "removeMember": {
        await tx.delete(schema.fundMembers).where(and(
          eq(schema.fundMembers.fundId, internalFundId),
          eq(schema.fundMembers.userId, command.memberId),
        ));
        await tx.delete(schema.fundPositions).where(and(
          eq(schema.fundPositions.fundId, internalFundId),
          eq(schema.fundPositions.userId, command.memberId),
        ));
        data = { deletedId: command.memberId };
        break;
      }
      case "contribution": {
        const externalId = `contribution-${crypto.randomUUID()}`;
        const createdAt = new Date();
        await tx.insert(schema.fundContributions).values({
          externalId,
          fundId: internalFundId,
          memberId: userId,
          year: command.year,
          month: command.month,
          amount: Math.round(command.amount),
          note: command.note.trim(),
          createdAt,
        });
        data = {
          id: externalId,
          memberId: userId,
          amount: Math.round(command.amount),
          note: command.note.trim(),
          createdAt: createdAt.toISOString(),
        };
        break;
      }
      case "delete":
        await tx.delete(schema.funds).where(eq(schema.funds.id, internalFundId));
        data = { deletedId: externalFundId };
        break;
    }

    const revision = expectedRevision + 1;
    if (command.kind !== "delete") {
      await tx.update(schema.funds).set({ revision, updatedAt: new Date() })
        .where(eq(schema.funds.id, internalFundId));
    }
    return { data: data as T, revision };
  });
}
