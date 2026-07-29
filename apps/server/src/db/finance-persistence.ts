import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type {
  Account,
  AccountType,
  CryptoMatch,
  Debt,
  FinanceCategory,
  FinanceStore,
  Fund,
  FundDetail,
  SharedFundContent,
  StoredFinancePayload,
  Transaction,
} from "@chi-tieu/shared";
import {
  blankYearWith,
  createDefaultStore,
  normalizeStore,
} from "@chi-tieu/shared";
import { readGoldCostBasis, writeGoldCostBasis } from "./gold-cost-basis.js";
import * as schema from "./schema.js";

type Executor = any;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function insertFundMonths(
  tx: Executor,
  fundId: string,
  years: Record<string, { funds: number[]; details: FundDetail[] }>,
): Promise<number> {
  let lotCount = 0;
  for (const [yearKey, yearData] of Object.entries(years)) {
    const year = Number(yearKey);
    for (let month = 1; month <= 12; month += 1) {
      const [fundMonth] = await tx.insert(schema.fundMonths).values({
        fundId,
        year,
        month,
        amount: Math.round(Number(yearData.funds[month - 1]) || 0),
      }).returning({ id: schema.fundMonths.id });
      const detail = yearData.details[month - 1];
      if (!fundMonth || !detail) continue;
      const [storedDetail] = await tx.insert(schema.fundMonthDetails).values({
        fundMonthId: fundMonth.id,
        type: detail.type,
      }).returning({ id: schema.fundMonthDetails.id });
      if (!storedDetail) continue;
      if (detail.type === "hold" && detail.lots.length) {
        await tx.insert(schema.holdingLots).values(detail.lots.map((lot, position) => ({
          detailId: storedDetail.id,
          position,
          ticker: lot.ticker,
          quantity: Number(lot.qty) || 0,
          manualPrice: lot.manualPrice ?? null,
          purchasePrice: lot.purchasePrice ?? null,
          purchaseFxVnd: lot.purchaseFxVnd ?? null,
          feeVnd: lot.feeVnd ?? null,
          purchasedAt: lot.purchasedAt || null,
          note: lot.note ?? null,
          exchange: lot.exchange ?? null,
          providerId: lot.providerId ?? null,
        })));
        lotCount += detail.lots.length;
      } else if (detail.type === "gold" && detail.lots.length) {
        await tx.insert(schema.goldLots).values(detail.lots.map((lot, position) => ({
          detailId: storedDetail.id,
          position,
          chi: Number(lot.chi) || 0,
          manualPrice: lot.manualPrice ?? null,
          ...writeGoldCostBasis(lot),
          purchasedAt: lot.purchasedAt || null,
          note: lot.note ?? null,
        })));
        lotCount += detail.lots.length;
      }
    }
  }
  return lotCount;
}

async function insertMarket(tx: Executor, userId: string, store: FinanceStore): Promise<void> {
  if (Object.keys(store.prices).length) {
    await tx.insert(schema.legacyPrices).values(Object.entries(store.prices).map(([symbol, price]) => ({
      userId,
      symbol,
      price: Number(price) || 0,
    })));
  }
  const market = store.market;
  if (market.fx) {
    await tx.insert(schema.marketFxQuotes).values({
      userId,
      usdVnd: market.fx.usdVnd,
      source: market.fx.source,
      sourceUrl: market.fx.sourceUrl ?? null,
      fetchedAt: market.fx.fetchedAt ? new Date(market.fx.fetchedAt) : null,
      legacy: market.fx.legacy ?? false,
    });
  }
  if (market.gold) {
    await tx.insert(schema.marketGoldQuotes).values({
      userId,
      xauUsdPerTroyOunce: market.gold.xauUsdPerTroyOunce,
      vndPerChi: market.gold.vndPerChi,
      source: market.gold.source,
      sourceUrl: market.gold.sourceUrl ?? null,
      fetchedAt: new Date(market.gold.fetchedAt),
    });
  }
  const stocks = Object.values(market.stocks);
  if (stocks.length) {
    await tx.insert(schema.marketStockQuotes).values(stocks.map((quote) => ({
      userId,
      exchange: quote.exchange,
      symbol: quote.symbol,
      priceVnd: quote.priceVnd,
      source: quote.source,
      sourceUrl: quote.sourceUrl ?? null,
      fetchedAt: new Date(quote.fetchedAt),
    })));
  }
  const crypto = Object.values(market.crypto);
  if (crypto.length) {
    await tx.insert(schema.marketCryptoQuotes).values(crypto.map((quote) => ({
      userId,
      providerId: quote.providerId,
      symbol: quote.symbol,
      name: quote.name,
      priceUsd: quote.priceUsd,
      source: quote.source,
      sourceUrl: quote.sourceUrl ?? null,
      fetchedAt: new Date(quote.fetchedAt),
    })));
  }
  if (Object.keys(market.cryptoSymbols).length) {
    await tx.insert(schema.marketCryptoSymbols).values(Object.entries(market.cryptoSymbols).map(([symbol, providerId]) => ({
      userId,
      symbol,
      providerId,
    })));
  }
  const matches = Object.entries(market.matches).flatMap(([lookupKey, values]) =>
    values.map((match, position) => ({
      userId,
      lookupKey,
      position,
      providerId: match.id,
      symbol: match.symbol,
      name: match.name,
      rank: match.rank ?? null,
    })));
  if (matches.length) await tx.insert(schema.marketCryptoMatches).values(matches);
  if (market.errors.length) {
    await tx.insert(schema.marketQuoteErrors).values(market.errors.map((error, position) => ({
      userId,
      position,
      key: error.key,
      code: error.code,
      message: error.message,
    })));
  }
  await tx.insert(schema.marketStates).values({
    userId,
    updatedAt: market.updatedAt ? new Date(market.updatedAt) : null,
  });
}

async function replaceMarket(tx: Executor, userId: string, store: FinanceStore): Promise<void> {
  await tx.delete(schema.legacyPrices).where(eq(schema.legacyPrices.userId, userId));
  await tx.delete(schema.marketFxQuotes).where(eq(schema.marketFxQuotes.userId, userId));
  await tx.delete(schema.marketGoldQuotes).where(eq(schema.marketGoldQuotes.userId, userId));
  await tx.delete(schema.marketStockQuotes).where(eq(schema.marketStockQuotes.userId, userId));
  await tx.delete(schema.marketCryptoQuotes).where(eq(schema.marketCryptoQuotes.userId, userId));
  await tx.delete(schema.marketCryptoSymbols).where(eq(schema.marketCryptoSymbols.userId, userId));
  await tx.delete(schema.marketCryptoMatches).where(eq(schema.marketCryptoMatches.userId, userId));
  await tx.delete(schema.marketQuoteErrors).where(eq(schema.marketQuoteErrors.userId, userId));
  await tx.delete(schema.marketStates).where(eq(schema.marketStates.userId, userId));
  await insertMarket(tx, userId, store);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function settingsSnapshot(store: FinanceStore): unknown {
  return {
    showGoals: store.showGoals,
    monthlyIncome: store.financialProfile.monthlyIncome,
    emergencyFundGoal: store.financialProfile.emergencyFundGoal,
    debtBalance: store.financialProfile.debt.balance,
    debtMonthlyPayment: store.financialProfile.debt.monthlyPayment,
    onboarding: store.onboarding,
    incomeMigrationVersion: store.incomeMigrationVersion ?? 1,
    futureIncomeResetVersion: store.futureIncomeResetVersion ?? 1,
    legacyUsdRate: store.usdRate ?? null,
  };
}

function fundMetadataSnapshot(store: FinanceStore): unknown {
  return store.funds.map((fund) => ({
    ...fund,
    fundPlan: store.financialProfile.fundPlan[fund.id] ?? 0,
    openingBalance: store.financialProfile.openingBalances[fund.id] ?? 0,
    allGoal: store.goals[fund.id]?.all ?? 0,
    goalConfigured: Boolean(store.goals[fund.id]),
  }));
}

function fundPeriodsSnapshot(store: FinanceStore): unknown {
  return Object.fromEntries(Object.entries(store.years).map(([year, value]) => [year, {
    funds: Object.fromEntries(store.funds.map((fund) => [fund.id, value.funds[fund.id] ?? new Array<number>(12).fill(0)])),
    details: Object.fromEntries(store.funds.map((fund) => [fund.id, value.details[fund.id] ?? new Array<FundDetail>(12).fill(null)])),
  }]));
}

function categoryEntries(store: FinanceStore): Array<FinanceCategory & { type: Transaction["type"]; position: number }> {
  return ([
    ["expense", store.expense.cats],
    ["income", store.expense.incomeCats],
  ] as const).flatMap(([type, categories]) =>
    categories.map((category, position) => ({ ...category, type, position })));
}

async function replaceFundMonthDetails(
  tx: Executor,
  changes: Array<{ fundMonthId: string; detail: FundDetail }>,
): Promise<void> {
  if (!changes.length) return;
  const fundMonthIds = changes.map((change) => change.fundMonthId);
  await tx.delete(schema.fundMonthDetails).where(inArray(schema.fundMonthDetails.fundMonthId, fundMonthIds));
  const withDetails = changes.filter((change): change is { fundMonthId: string; detail: Exclude<FundDetail, null> } =>
    change.detail !== null);
  if (!withDetails.length) return;
  const inserted = await tx.insert(schema.fundMonthDetails).values(withDetails.map((change) => ({
    fundMonthId: change.fundMonthId,
    type: change.detail.type,
  }))).returning();
  const detailIdByMonth = new Map<string, string>(inserted.map((detail: typeof schema.fundMonthDetails.$inferSelect) =>
    [detail.fundMonthId, detail.id]));
  const holdingRows: Array<typeof schema.holdingLots.$inferInsert> = [];
  const goldRows: Array<typeof schema.goldLots.$inferInsert> = [];
  for (const change of withDetails) {
    const detailId = detailIdByMonth.get(change.fundMonthId);
    if (!detailId) continue;
    if (change.detail.type === "hold") {
      change.detail.lots.forEach((lot, position) => holdingRows.push({
        detailId,
        position,
        ticker: lot.ticker,
        quantity: Number(lot.qty) || 0,
        manualPrice: lot.manualPrice ?? null,
        purchasePrice: lot.purchasePrice ?? null,
        purchaseFxVnd: lot.purchaseFxVnd ?? null,
        feeVnd: lot.feeVnd ?? null,
        purchasedAt: lot.purchasedAt || null,
        note: lot.note ?? null,
        exchange: lot.exchange ?? null,
        providerId: lot.providerId ?? null,
      }));
    } else {
      change.detail.lots.forEach((lot, position) => goldRows.push({
        detailId,
        position,
        chi: Number(lot.chi) || 0,
        manualPrice: lot.manualPrice ?? null,
        ...writeGoldCostBasis(lot),
        purchasedAt: lot.purchasedAt || null,
        note: lot.note ?? null,
      }));
    }
  }
  if (holdingRows.length) await tx.insert(schema.holdingLots).values(holdingRows);
  if (goldRows.length) await tx.insert(schema.goldLots).values(goldRows);
}

export async function persistPersonalStoreChanges(
  tx: Executor,
  userId: string,
  before: FinanceStore,
  after: FinanceStore,
): Promise<void> {
  if (!sameValue(settingsSnapshot(before), settingsSnapshot(after))) {
    const skippedAt = after.onboarding.skippedAt ? new Date(after.onboarding.skippedAt) : null;
    await tx.insert(schema.userSettings).values({
      userId,
      showGoals: after.showGoals,
      monthlyIncome: after.financialProfile.monthlyIncome,
      emergencyFundGoal: after.financialProfile.emergencyFundGoal,
      debtBalance: after.financialProfile.debt.balance,
      debtMonthlyPayment: after.financialProfile.debt.monthlyPayment,
      onboardingStatus: after.onboarding.status,
      onboardingVersion: after.onboarding.version,
      onboardingSkippedAt: skippedAt,
      incomeMigrationVersion: after.incomeMigrationVersion ?? 1,
      futureIncomeResetVersion: after.futureIncomeResetVersion ?? 1,
      legacyUsdRate: after.usdRate ?? null,
    }).onConflictDoUpdate({
      target: schema.userSettings.userId,
      set: {
        showGoals: after.showGoals,
        monthlyIncome: after.financialProfile.monthlyIncome,
        emergencyFundGoal: after.financialProfile.emergencyFundGoal,
        debtBalance: after.financialProfile.debt.balance,
        debtMonthlyPayment: after.financialProfile.debt.monthlyPayment,
        onboardingStatus: after.onboarding.status,
        onboardingVersion: after.onboarding.version,
        onboardingSkippedAt: skippedAt,
        incomeMigrationVersion: after.incomeMigrationVersion ?? 1,
        futureIncomeResetVersion: after.futureIncomeResetVersion ?? 1,
        legacyUsdRate: after.usdRate ?? null,
      },
    });
  }

  if (!sameValue(before.years, after.years)) {
    const beforeYears = new Set(Object.keys(before.years).map(Number));
    const afterYears = Object.keys(after.years).map(Number).filter(Number.isInteger);
    const removedYears = [...beforeYears].filter((year) => !afterYears.includes(year));
    if (removedYears.length) {
      await tx.delete(schema.ledgerYears).where(and(
        eq(schema.ledgerYears.userId, userId),
        inArray(schema.ledgerYears.year, removedYears),
      ));
    }
    if (afterYears.length) {
      await tx.insert(schema.ledgerYears).values(afterYears.map((year) => ({ userId, year })))
        .onConflictDoNothing();
    }
    const changedMonths = afterYears.flatMap((year) => {
      const previous = before.years[String(year)];
      const next = after.years[String(year)]!;
      return Array.from({ length: 12 }, (_, index) => ({
        userId,
        year,
        month: index + 1,
        income: next.income[index] ?? 0,
        note: next.notes[index] ?? "",
        changed: !previous
          || previous.income[index] !== next.income[index]
          || previous.notes[index] !== next.notes[index],
      })).filter((month) => month.changed);
    });
    if (changedMonths.length) {
      await tx.insert(schema.ledgerMonths).values(changedMonths.map(({ changed: _changed, ...month }) => month))
        .onConflictDoUpdate({
          target: [schema.ledgerMonths.userId, schema.ledgerMonths.year, schema.ledgerMonths.month],
          set: {
            income: sql`excluded.income`,
            note: sql`excluded.note`,
          },
        });
    }
  }

  const metadataChanged = !sameValue(fundMetadataSnapshot(before), fundMetadataSnapshot(after));
  const goalsChanged = !sameValue(before.goals, after.goals);
  const periodsChanged = !sameValue(fundPeriodsSnapshot(before), fundPeriodsSnapshot(after));
  const orderChanged = !sameValue(before.funds.map((fund) => fund.id), after.funds.map((fund) => fund.id));
  if (metadataChanged || goalsChanged || periodsChanged || orderChanged) {
    const originalFundRows = await tx.select().from(schema.funds)
      .where(and(eq(schema.funds.ownerId, userId), eq(schema.funds.shared, false)));
    const beforeIds = new Set(before.funds.map((fund) => fund.id));
    const afterIds = new Set(after.funds.map((fund) => fund.id));
    const removedIds = [...beforeIds].filter((id) => !afterIds.has(id));
    const removedInternalIds = originalFundRows
      .filter((fund: typeof schema.funds.$inferSelect) => removedIds.includes(fund.externalId))
      .map((fund: typeof schema.funds.$inferSelect) => fund.id);
    if (removedInternalIds.length) {
      await tx.delete(schema.funds).where(inArray(schema.funds.id, removedInternalIds));
    }

    let fundRows = originalFundRows.filter((fund: typeof schema.funds.$inferSelect) => !removedInternalIds.includes(fund.id));
    if (metadataChanged || orderChanged) {
      const upserted = await tx.insert(schema.funds).values(after.funds.map((fund) => ({
        externalId: fund.id,
        ownerId: userId,
        shared: false,
        name: fund.name,
        color: fund.color,
        category: fund.cat,
        fundPlan: after.financialProfile.fundPlan[fund.id] ?? 0,
        openingBalance: after.financialProfile.openingBalances[fund.id] ?? 0,
        allGoal: after.goals[fund.id]?.all ?? 0,
        goalConfigured: Boolean(after.goals[fund.id]),
        updatedAt: new Date(),
      }))).onConflictDoUpdate({
        target: [schema.funds.ownerId, schema.funds.externalId],
        set: {
          name: sql`excluded.name`,
          color: sql`excluded.color`,
          category: sql`excluded.category`,
          fundPlan: sql`excluded.fund_plan`,
          openingBalance: sql`excluded.opening_balance`,
          allGoal: sql`excluded.all_goal`,
          goalConfigured: sql`excluded.goal_configured`,
          updatedAt: sql`excluded.updated_at`,
        },
      }).returning();
      const upsertedIds = new Set(upserted.map((fund: typeof schema.funds.$inferSelect) => fund.externalId));
      fundRows = [
        ...fundRows.filter((fund: typeof schema.funds.$inferSelect) => !upsertedIds.has(fund.externalId)),
        ...upserted,
      ];
    }
    const fundByExternalId = new Map<string, typeof schema.funds.$inferSelect>(
      fundRows.map((fund: typeof schema.funds.$inferSelect) => [fund.externalId, fund]),
    );

    if (orderChanged) {
      const currentPositions = await tx.select().from(schema.fundPositions)
        .where(eq(schema.fundPositions.userId, userId)).orderBy(asc(schema.fundPositions.position));
      const privateInternalIds = new Set(fundRows.map((fund: typeof schema.funds.$inferSelect) => fund.id));
      const sharedPositions = currentPositions.filter((position: typeof schema.fundPositions.$inferSelect) =>
        !privateInternalIds.has(position.fundId));
      if (currentPositions.length) {
        await tx.update(schema.fundPositions)
          .set({ position: sql`${schema.fundPositions.position} + 1000000` })
          .where(eq(schema.fundPositions.userId, userId));
      }
      const nextPositions = [
        ...after.funds.flatMap((fund, position) => {
          const row = fundByExternalId.get(fund.id);
          return row ? [{ fundId: row.id, userId, position }] : [];
        }),
        ...sharedPositions.map((position: typeof schema.fundPositions.$inferSelect, index: number) => ({
          fundId: position.fundId,
          userId,
          position: after.funds.length + index,
        })),
      ];
      if (nextPositions.length) {
        await tx.insert(schema.fundPositions).values(nextPositions).onConflictDoUpdate({
          target: [schema.fundPositions.fundId, schema.fundPositions.userId],
          set: { position: sql`excluded.position` },
        });
      }
    }

    if (goalsChanged || metadataChanged) {
      const changedGoalIds = after.funds.filter((fund) =>
        !sameValue(before.goals[fund.id], after.goals[fund.id])).map((fund) => fund.id);
      const changedGoalInternalIds = changedGoalIds.flatMap((id) => {
        const row = fundByExternalId.get(id);
        return row ? [row.id] : [];
      });
      if (changedGoalInternalIds.length) {
        await tx.delete(schema.fundYearGoals).where(inArray(schema.fundYearGoals.fundId, changedGoalInternalIds));
        const goalRows = changedGoalIds.flatMap((id) => {
          const row = fundByExternalId.get(id);
          return row ? Object.entries(after.goals[id]?.years ?? {}).map(([year, amount]) => ({
            fundId: row.id,
            year: Number(year),
            amount,
          })) : [];
        });
        if (goalRows.length) await tx.insert(schema.fundYearGoals).values(goalRows);
      }
    }

    if (periodsChanged || orderChanged) {
      const privateInternalIds = fundRows.map((fund: typeof schema.funds.$inferSelect) => fund.id);
      const currentMonths = privateInternalIds.length
        ? await tx.select().from(schema.fundMonths).where(inArray(schema.fundMonths.fundId, privateInternalIds))
        : [];
      const currentByKey = new Map<string, typeof schema.fundMonths.$inferSelect>(
        currentMonths.map((month: typeof schema.fundMonths.$inferSelect) =>
          [`${month.fundId}:${month.year}:${month.month}`, month]),
      );
      const desiredKeys = new Set<string>();
      const changedRows: Array<typeof schema.fundMonths.$inferInsert> = [];
      const detailChangedKeys = new Set<string>();
      for (const fund of after.funds) {
        const row = fundByExternalId.get(fund.id);
        if (!row) continue;
        for (const [yearKey, year] of Object.entries(after.years)) {
          const previousYear = before.years[yearKey];
          for (let index = 0; index < 12; index += 1) {
            const key = `${row.id}:${yearKey}:${index + 1}`;
            desiredKeys.add(key);
            const amount = Math.round(year.funds[fund.id]?.[index] ?? 0);
            const detail = year.details[fund.id]?.[index] ?? null;
            const previousAmount = previousYear?.funds[fund.id]?.[index] ?? 0;
            const previousDetail = previousYear?.details[fund.id]?.[index] ?? null;
            const current = currentByKey.get(key);
            if (!current || current.amount !== amount || previousAmount !== amount || !sameValue(previousDetail, detail)) {
              changedRows.push({ fundId: row.id, year: Number(yearKey), month: index + 1, amount });
            }
            if (!sameValue(previousDetail, detail)) detailChangedKeys.add(key);
          }
        }
      }
      const obsoleteIds = currentMonths
        .filter((month: typeof schema.fundMonths.$inferSelect) =>
          !desiredKeys.has(`${month.fundId}:${month.year}:${month.month}`))
        .map((month: typeof schema.fundMonths.$inferSelect) => month.id);
      if (obsoleteIds.length) await tx.delete(schema.fundMonths).where(inArray(schema.fundMonths.id, obsoleteIds));
      if (changedRows.length) {
        const storedMonths = await tx.insert(schema.fundMonths).values(changedRows).onConflictDoUpdate({
          target: [schema.fundMonths.fundId, schema.fundMonths.year, schema.fundMonths.month],
          set: { amount: sql`excluded.amount` },
        }).returning();
        const detailChanges = storedMonths.flatMap((month: typeof schema.fundMonths.$inferSelect) => {
          const key = `${month.fundId}:${month.year}:${month.month}`;
          if (!detailChangedKeys.has(key)) return [];
          const fund = fundRows.find((candidate: typeof schema.funds.$inferSelect) => candidate.id === month.fundId);
          const detail = fund
            ? after.years[String(month.year)]?.details[fund.externalId]?.[month.month - 1] ?? null
            : null;
          return [{ fundMonthId: month.id, detail }];
        });
        await replaceFundMonthDetails(tx, detailChanges);
      }
    }
  }

  const beforeCategories = categoryEntries(before);
  const afterCategories = categoryEntries(after);
  if (!sameValue(beforeCategories, afterCategories)) {
    const beforeKeys = new Set(beforeCategories.map((category) => `${category.type}:${category.id}`));
    const afterKeys = new Set(afterCategories.map((category) => `${category.type}:${category.id}`));
    for (const key of [...beforeKeys].filter((candidate) => !afterKeys.has(candidate))) {
      const separator = key.indexOf(":");
      await tx.update(schema.financeCategories).set({ deletedAt: new Date() }).where(and(
        eq(schema.financeCategories.userId, userId),
        eq(schema.financeCategories.type, key.slice(0, separator)),
        eq(schema.financeCategories.externalId, key.slice(separator + 1)),
      ));
    }
    if (afterCategories.length) {
      await tx.insert(schema.financeCategories).values(afterCategories.map((category) => ({
        userId,
        externalId: category.id,
        type: category.type,
        name: category.name,
        color: category.color,
        budget: category.budget ?? 0,
        position: category.position,
        deletedAt: null,
      }))).onConflictDoUpdate({
        target: [schema.financeCategories.userId, schema.financeCategories.type, schema.financeCategories.externalId],
        set: {
          name: sql`excluded.name`,
          color: sql`excluded.color`,
          budget: sql`excluded.budget`,
          position: sql`excluded.position`,
          deletedAt: null,
        },
      });
    }
  }

  if (!sameValue(before.expense.accountTypes, after.expense.accountTypes)) {
    const beforeIds = new Set(before.expense.accountTypes.map((type) => type.id));
    const afterIds = new Set(after.expense.accountTypes.map((type) => type.id));
    const removedIds = [...beforeIds].filter((id) => !afterIds.has(id));
    if (removedIds.length) {
      await tx.update(schema.accountTypes).set({ deletedAt: new Date() }).where(and(
        eq(schema.accountTypes.userId, userId),
        inArray(schema.accountTypes.externalId, removedIds),
      ));
    }
    if (after.expense.accountTypes.length) {
      await tx.insert(schema.accountTypes).values(after.expense.accountTypes.map((type, position) => ({
        userId,
        externalId: type.id,
        name: type.name,
        position,
        deletedAt: null,
      }))).onConflictDoUpdate({
        target: [schema.accountTypes.userId, schema.accountTypes.externalId],
        set: {
          name: sql`excluded.name`,
          position: sql`excluded.position`,
          deletedAt: null,
        },
      });
    }
  }

  if (!sameValue(before.expense.accounts, after.expense.accounts)) {
    const beforeIds = new Set(before.expense.accounts.map((account) => account.id));
    const afterIds = new Set(after.expense.accounts.map((account) => account.id));
    const removedIds = [...beforeIds].filter((id) => !afterIds.has(id));
    if (removedIds.length) {
      await tx.update(schema.accounts).set({ deletedAt: new Date() }).where(and(
        eq(schema.accounts.userId, userId),
        inArray(schema.accounts.externalId, removedIds),
      ));
    }
    const typeRows = await tx.select().from(schema.accountTypes).where(eq(schema.accountTypes.userId, userId));
    const typeIdByExternal = new Map(typeRows.map((type: typeof schema.accountTypes.$inferSelect) => [type.externalId, type.id]));
    if (after.expense.accounts.length) {
      await tx.insert(schema.accounts).values(after.expense.accounts.map((account, position) => ({
        userId,
        externalId: account.id,
        name: account.name,
        typeId: account.typeId ? typeIdByExternal.get(account.typeId) ?? null : null,
        position,
        deletedAt: null,
      }))).onConflictDoUpdate({
        target: [schema.accounts.userId, schema.accounts.externalId],
        set: {
          name: sql`excluded.name`,
          typeId: sql`excluded.type_id`,
          position: sql`excluded.position`,
          deletedAt: null,
        },
      });
    }
  }

  if (!sameValue(before.expense.txns, after.expense.txns)) {
    const beforeIds = new Set(before.expense.txns.map((transaction) => transaction.id));
    const afterIds = new Set(after.expense.txns.map((transaction) => transaction.id));
    const removedIds = [...beforeIds].filter((id) => !afterIds.has(id));
    if (removedIds.length) {
      await tx.delete(schema.transactions).where(and(
        eq(schema.transactions.userId, userId),
        inArray(schema.transactions.externalId, removedIds),
      ));
    }
    let categoryRows = await tx.select().from(schema.financeCategories).where(eq(schema.financeCategories.userId, userId));
    const categoryByKey = new Map(categoryRows.map((category: typeof schema.financeCategories.$inferSelect) =>
      [`${category.type}:${category.externalId}`, category]));
    const missingCategories = [...new Set(after.expense.txns
      .filter((transaction) => !categoryByKey.has(`${transaction.type}:${transaction.cat}`))
      .map((transaction) => `${transaction.type}:${transaction.cat}`))];
    if (missingCategories.length) {
      await tx.insert(schema.financeCategories).values(missingCategories.map((key, position) => {
        const separator = key.indexOf(":");
        return {
          userId,
          type: key.slice(0, separator),
          externalId: key.slice(separator + 1),
          name: "(đã xóa)",
          color: "#b8ad92",
          budget: 0,
          position: afterCategories.length + position,
          deletedAt: new Date(),
        };
      })).onConflictDoNothing();
      categoryRows = await tx.select().from(schema.financeCategories).where(eq(schema.financeCategories.userId, userId));
    }
    let accountRows = await tx.select().from(schema.accounts).where(eq(schema.accounts.userId, userId));
    const accountByExternal = new Map(accountRows.map((account: typeof schema.accounts.$inferSelect) => [account.externalId, account]));
    const missingAccounts = [...new Set(after.expense.txns
      .flatMap((transaction) => transaction.accountId ? [transaction.accountId] : [])
      .filter((accountId) => !accountByExternal.has(accountId)))];
    if (missingAccounts.length) {
      await tx.insert(schema.accounts).values(missingAccounts.map((externalId, position) => ({
        userId,
        externalId,
        name: "(đã xóa)",
        position: after.expense.accounts.length + position,
        deletedAt: new Date(),
      }))).onConflictDoNothing();
      accountRows = await tx.select().from(schema.accounts).where(eq(schema.accounts.userId, userId));
    }
    const resolvedCategoryByKey = new Map(categoryRows.map((category: typeof schema.financeCategories.$inferSelect) =>
      [`${category.type}:${category.externalId}`, category.id]));
    const resolvedAccountByExternal = new Map(accountRows.map((account: typeof schema.accounts.$inferSelect) =>
      [account.externalId, account.id]));
    const changedTransactions = after.expense.txns.filter((transaction) => {
      const previous = before.expense.txns.find((candidate) => candidate.id === transaction.id);
      return !sameValue(previous, transaction);
    });
    if (changedTransactions.length) {
      await tx.insert(schema.transactions).values(changedTransactions.map((transaction) => ({
        externalId: transaction.id,
        userId,
        categoryId: resolvedCategoryByKey.get(`${transaction.type}:${transaction.cat}`)!,
        accountId: transaction.accountId ? resolvedAccountByExternal.get(transaction.accountId) ?? null : null,
        date: transaction.date,
        type: transaction.type,
        amount: Math.round(transaction.amount),
        note: transaction.note,
        updatedAt: new Date(),
      }))).onConflictDoUpdate({
        target: [schema.transactions.userId, schema.transactions.externalId],
        set: {
          categoryId: sql`excluded.category_id`,
          accountId: sql`excluded.account_id`,
          date: sql`excluded.date`,
          type: sql`excluded.type`,
          amount: sql`excluded.amount`,
          note: sql`excluded.note`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    }
  }

  if (!sameValue({ prices: before.prices, market: before.market }, { prices: after.prices, market: after.market })) {
    await replaceMarket(tx, userId, after);
  }
}

export async function persistSharedFundChanges(
  tx: Executor,
  fund: typeof schema.funds.$inferSelect,
  before: SharedFundContent,
  after: SharedFundContent,
  nextRevision: number,
  updatedAt: Date,
): Promise<void> {
  const metadataBefore = {
    fund: before.fund,
    fundPlan: before.fundPlan,
    openingBalance: before.openingBalance,
    allGoal: before.goal.all,
  };
  const metadataAfter = {
    fund: after.fund,
    fundPlan: after.fundPlan,
    openingBalance: after.openingBalance,
    allGoal: after.goal.all,
  };
  await tx.update(schema.funds).set({
    ...(sameValue(metadataBefore, metadataAfter) ? {} : {
      name: after.fund.name,
      color: after.fund.color,
      category: after.fund.cat,
      fundPlan: after.fundPlan,
      openingBalance: after.openingBalance,
      allGoal: after.goal.all,
      goalConfigured: true,
    }),
    revision: nextRevision,
    updatedAt,
  }).where(eq(schema.funds.id, fund.id));

  if (!sameValue(before.goal.years, after.goal.years)) {
    await tx.delete(schema.fundYearGoals).where(eq(schema.fundYearGoals.fundId, fund.id));
    const goalRows = Object.entries(after.goal.years).map(([year, amount]) => ({
      fundId: fund.id,
      year: Number(year),
      amount,
    }));
    if (goalRows.length) await tx.insert(schema.fundYearGoals).values(goalRows);
  }

  if (!sameValue(before.years, after.years)) {
    const currentMonths = await tx.select().from(schema.fundMonths).where(eq(schema.fundMonths.fundId, fund.id));
    const currentByKey = new Map<string, typeof schema.fundMonths.$inferSelect>(
      currentMonths.map((month: typeof schema.fundMonths.$inferSelect) =>
        [`${month.year}:${month.month}`, month]),
    );
    const desiredKeys = new Set<string>();
    const changedRows: Array<typeof schema.fundMonths.$inferInsert> = [];
    const detailChangedKeys = new Set<string>();
    for (const [yearKey, year] of Object.entries(after.years)) {
      const previousYear = before.years[yearKey];
      for (let index = 0; index < 12; index += 1) {
        const key = `${yearKey}:${index + 1}`;
        desiredKeys.add(key);
        const amount = Math.round(year.funds[index] ?? 0);
        const detail = year.details[index] ?? null;
        const previousAmount = previousYear?.funds[index] ?? 0;
        const previousDetail = previousYear?.details[index] ?? null;
        const current = currentByKey.get(key);
        if (!current || current.amount !== amount || previousAmount !== amount || !sameValue(previousDetail, detail)) {
          changedRows.push({ fundId: fund.id, year: Number(yearKey), month: index + 1, amount });
        }
        if (!sameValue(previousDetail, detail)) detailChangedKeys.add(key);
      }
    }
    const obsoleteIds = currentMonths
      .filter((month: typeof schema.fundMonths.$inferSelect) =>
        !desiredKeys.has(`${month.year}:${month.month}`))
      .map((month: typeof schema.fundMonths.$inferSelect) => month.id);
    if (obsoleteIds.length) await tx.delete(schema.fundMonths).where(inArray(schema.fundMonths.id, obsoleteIds));
    if (changedRows.length) {
      const storedMonths = await tx.insert(schema.fundMonths).values(changedRows).onConflictDoUpdate({
        target: [schema.fundMonths.fundId, schema.fundMonths.year, schema.fundMonths.month],
        set: { amount: sql`excluded.amount` },
      }).returning();
      await replaceFundMonthDetails(tx, storedMonths.flatMap((month: typeof schema.fundMonths.$inferSelect) => {
        const key = `${month.year}:${month.month}`;
        return detailChangedKeys.has(key)
          ? [{ fundMonthId: month.id, detail: after.years[String(month.year)]?.details[month.month - 1] ?? null }]
          : [];
      }));
    }
  }
}

export interface WriteStoreResult {
  store: FinanceStore;
  transactionCount: number;
  lotCount: number;
  fundCount: number;
}

export async function replacePersonalStore(
  tx: Executor,
  userId: string,
  payload: StoredFinancePayload,
): Promise<WriteStoreResult> {
  const { store } = normalizeStore(payload);

  const existingDebtIds = (await tx.select({ id: schema.debts.id }).from(schema.debts)
    .where(eq(schema.debts.userId, userId))).map((row: { id: string }) => row.id);
  if (existingDebtIds.length) await tx.delete(schema.debtPayments).where(inArray(schema.debtPayments.debtId, existingDebtIds));
  await tx.delete(schema.debts).where(eq(schema.debts.userId, userId));
  await tx.delete(schema.transactions).where(eq(schema.transactions.userId, userId));
  await tx.delete(schema.accounts).where(eq(schema.accounts.userId, userId));
  await tx.delete(schema.accountTypes).where(eq(schema.accountTypes.userId, userId));
  await tx.delete(schema.financeCategories).where(eq(schema.financeCategories.userId, userId));
  await tx.delete(schema.ledgerMonths).where(eq(schema.ledgerMonths.userId, userId));
  await tx.delete(schema.ledgerYears).where(eq(schema.ledgerYears.userId, userId));
  await tx.delete(schema.legacyPrices).where(eq(schema.legacyPrices.userId, userId));
  await tx.delete(schema.marketFxQuotes).where(eq(schema.marketFxQuotes.userId, userId));
  await tx.delete(schema.marketGoldQuotes).where(eq(schema.marketGoldQuotes.userId, userId));
  await tx.delete(schema.marketStockQuotes).where(eq(schema.marketStockQuotes.userId, userId));
  await tx.delete(schema.marketCryptoQuotes).where(eq(schema.marketCryptoQuotes.userId, userId));
  await tx.delete(schema.marketCryptoSymbols).where(eq(schema.marketCryptoSymbols.userId, userId));
  await tx.delete(schema.marketCryptoMatches).where(eq(schema.marketCryptoMatches.userId, userId));
  await tx.delete(schema.marketQuoteErrors).where(eq(schema.marketQuoteErrors.userId, userId));
  await tx.delete(schema.marketStates).where(eq(schema.marketStates.userId, userId));
  await tx.delete(schema.funds).where(and(eq(schema.funds.ownerId, userId), eq(schema.funds.shared, false)));
  const sharedPositions = await tx.select().from(schema.fundPositions)
    .where(eq(schema.fundPositions.userId, userId))
    .orderBy(asc(schema.fundPositions.position));
  if (sharedPositions.length) {
    await tx.update(schema.fundPositions)
      .set({ position: sql`${schema.fundPositions.position} + 1000000` })
      .where(eq(schema.fundPositions.userId, userId));
  }

  const skippedAt = store.onboarding.skippedAt ? new Date(store.onboarding.skippedAt) : null;
  await tx.insert(schema.userSettings).values({
    userId,
    showGoals: store.showGoals,
    monthlyIncome: store.financialProfile.monthlyIncome,
    emergencyFundGoal: store.financialProfile.emergencyFundGoal,
    debtBalance: store.financialProfile.debt.balance,
    debtMonthlyPayment: store.financialProfile.debt.monthlyPayment,
    onboardingStatus: store.onboarding.status,
    onboardingVersion: store.onboarding.version,
    onboardingSkippedAt: skippedAt,
    incomeMigrationVersion: store.incomeMigrationVersion ?? 1,
    futureIncomeResetVersion: store.futureIncomeResetVersion ?? 1,
    legacyUsdRate: store.usdRate ?? null,
  }).onConflictDoUpdate({
    target: schema.userSettings.userId,
    set: {
      showGoals: store.showGoals,
      monthlyIncome: store.financialProfile.monthlyIncome,
      emergencyFundGoal: store.financialProfile.emergencyFundGoal,
      debtBalance: store.financialProfile.debt.balance,
      debtMonthlyPayment: store.financialProfile.debt.monthlyPayment,
      onboardingStatus: store.onboarding.status,
      onboardingVersion: store.onboarding.version,
      onboardingSkippedAt: skippedAt,
      incomeMigrationVersion: store.incomeMigrationVersion ?? 1,
      futureIncomeResetVersion: store.futureIncomeResetVersion ?? 1,
      legacyUsdRate: store.usdRate ?? null,
    },
  });

  const years = Object.keys(store.years).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  if (years.length) {
    await tx.insert(schema.ledgerYears).values(years.map((year) => ({ userId, year })));
    await tx.insert(schema.ledgerMonths).values(years.flatMap((year) =>
      Array.from({ length: 12 }, (_, month) => ({
        userId,
        year,
        month: month + 1,
        income: store.years[String(year)]?.income[month] ?? 0,
        note: store.years[String(year)]?.notes[month] ?? "",
      }))));
  }

  const categoryRows: Array<typeof schema.financeCategories.$inferInsert> = [];
  for (const [type, categories] of [["expense", store.expense.cats], ["income", store.expense.incomeCats]] as const) {
    categories.forEach((category, position) => categoryRows.push({
      userId,
      externalId: category.id,
      type,
      name: category.name,
      color: category.color,
      budget: category.budget ?? 0,
      position,
    }));
  }
  const knownCategories = new Set(categoryRows.map((row) => `${row.type}:${row.externalId}`));
  for (const transaction of store.expense.txns) {
    const key = `${transaction.type}:${transaction.cat}`;
    if (!knownCategories.has(key)) {
      knownCategories.add(key);
      categoryRows.push({
        userId,
        externalId: transaction.cat,
        type: transaction.type,
        name: "(đã xóa)",
        color: "#b8ad92",
        budget: 0,
        position: categoryRows.length,
        deletedAt: new Date(),
      });
    }
  }
  const insertedCategories = categoryRows.length
    ? await tx.insert(schema.financeCategories).values(categoryRows).returning()
    : [];
  const categoryIds = new Map(insertedCategories.map((row: typeof schema.financeCategories.$inferSelect) => [`${row.type}:${row.externalId}`, row.id]));

  const typeRows = store.expense.accountTypes.map((type, position) => ({
    userId,
    externalId: type.id,
    name: type.name,
    position,
  }));
  const insertedTypes = typeRows.length ? await tx.insert(schema.accountTypes).values(typeRows).returning() : [];
  const typeIds = new Map<string, string>(insertedTypes.map((row: typeof schema.accountTypes.$inferSelect) => [row.externalId, row.id]));

  const accountRows: Array<typeof schema.accounts.$inferInsert> = store.expense.accounts.map((account, position) => ({
    userId,
    externalId: account.id,
    name: account.name,
    typeId: account.typeId ? typeIds.get(account.typeId) ?? null : null,
    position,
  }));
  const knownAccounts = new Set(accountRows.map((row) => row.externalId));
  for (const transaction of store.expense.txns) {
    if (transaction.accountId && !knownAccounts.has(transaction.accountId)) {
      knownAccounts.add(transaction.accountId);
      accountRows.push({
        userId,
        externalId: transaction.accountId,
        name: "(đã xóa)",
        position: accountRows.length,
        deletedAt: new Date(),
      });
    }
  }
  const insertedAccounts = accountRows.length ? await tx.insert(schema.accounts).values(accountRows).returning() : [];
  const accountIds = new Map<string, string>(insertedAccounts.map((row: typeof schema.accounts.$inferSelect) => [row.externalId, row.id]));

  const insertedTransactions = store.expense.txns.length
    ? await tx.insert(schema.transactions).values(store.expense.txns.map((transaction) => ({
      externalId: transaction.id,
      userId,
      categoryId: categoryIds.get(`${transaction.type}:${transaction.cat}`)!,
      accountId: transaction.accountId ? accountIds.get(transaction.accountId) ?? null : null,
      date: transaction.date,
      type: transaction.type,
      amount: Math.round(transaction.amount),
      note: transaction.note,
    }))).returning({ id: schema.transactions.id, externalId: schema.transactions.externalId })
    : [];
  const transactionIds = new Map(insertedTransactions.map((row: { id: string; externalId: string }) => [row.externalId, row.id]));

  const insertedDebts = store.debts.length
    ? await tx.insert(schema.debts).values(store.debts.map((debt) => ({
      externalId: debt.id,
      userId,
      kind: debt.kind,
      name: debt.name,
      counterparty: debt.counterparty,
      principal: debt.principal,
      annualInterestRate: debt.annualInterestRate,
      termMonths: debt.termMonths,
      paymentAmount: debt.paymentAmount,
      firstPaymentDate: debt.firstPaymentDate ?? null,
      paymentCategoryId: debt.paymentCategoryId
        ? categoryIds.get(`${debt.kind === "lent" ? "income" : "expense"}:${debt.paymentCategoryId}`) ?? null
        : null,
      paymentAccountId: debt.paymentAccountId ? accountIds.get(debt.paymentAccountId) ?? null : null,
      note: debt.note,
      status: debt.status,
    }))).returning({ id: schema.debts.id, externalId: schema.debts.externalId })
    : [];
  const debtIds = new Map(insertedDebts.map((row: { id: string; externalId: string }) => [row.externalId, row.id]));
  const paymentRows = store.debts.flatMap((debt) => debt.payments.map((payment) => ({ debt, payment })));
  if (paymentRows.length) {
    await tx.insert(schema.debtPayments).values(paymentRows.map(({ debt, payment }) => ({
      externalId: payment.id,
      debtId: debtIds.get(debt.id)!,
      installment: payment.installment,
      paidAt: payment.paidAt,
      amount: payment.amount,
      principalAmount: payment.principalAmount,
      interestAmount: payment.interestAmount,
      transactionId: payment.transactionId ? transactionIds.get(payment.transactionId) ?? null : null,
      note: payment.note,
    })));
  }

  let lotCount = 0;
  for (let position = 0; position < store.funds.length; position += 1) {
    const fund = store.funds[position]!;
    const [row] = await tx.insert(schema.funds).values({
      externalId: fund.id,
      ownerId: userId,
      shared: false,
      name: fund.name,
      color: fund.color,
      category: fund.cat,
      fundPlan: store.financialProfile.fundPlan[fund.id] ?? 0,
      openingBalance: store.financialProfile.openingBalances[fund.id] ?? 0,
      allGoal: store.goals[fund.id]?.all ?? 0,
      goalConfigured: Boolean(store.goals[fund.id]),
    }).returning({ id: schema.funds.id });
    if (!row) continue;
    await tx.insert(schema.fundPositions).values({ fundId: row.id, userId, position });
    const goal = store.goals[fund.id];
    if (goal && Object.keys(goal.years).length) {
      await tx.insert(schema.fundYearGoals).values(Object.entries(goal.years).map(([year, amount]) => ({
        fundId: row.id,
        year: Number(year),
        amount,
      })));
    }
    const fundYears = Object.fromEntries(Object.entries(store.years).map(([year, value]) => [year, {
      funds: value.funds[fund.id] ?? new Array<number>(12).fill(0),
      details: value.details[fund.id] ?? new Array<FundDetail>(12).fill(null),
    }]));
    lotCount += await insertFundMonths(tx, row.id, fundYears);
  }
  for (let index = 0; index < sharedPositions.length; index += 1) {
    const sharedPosition = sharedPositions[index]!;
    await tx.update(schema.fundPositions)
      .set({ position: store.funds.length + index })
      .where(and(
        eq(schema.fundPositions.fundId, sharedPosition.fundId),
        eq(schema.fundPositions.userId, userId),
      ));
  }

  await insertMarket(tx, userId, store);
  return { store, transactionCount: store.expense.txns.length, lotCount, fundCount: store.funds.length };
}

export async function insertSharedFund(
  tx: Executor,
  record: {
    externalId: string;
    ownerId: string;
    revision: number;
    content: SharedFundContent;
    createdAt: Date;
    updatedAt: Date;
  },
): Promise<{ id: string; lotCount: number }> {
  const [fund] = await tx.insert(schema.funds).values({
    externalId: record.externalId,
    ownerId: record.ownerId,
    shared: true,
    name: record.content.fund.name,
    color: record.content.fund.color,
    category: record.content.fund.cat,
    fundPlan: record.content.fundPlan,
    openingBalance: record.content.openingBalance,
    allGoal: record.content.goal.all,
    goalConfigured: true,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }).returning({ id: schema.funds.id });
  if (!fund) throw new Error("Không thể tạo quỹ chung.");
  const ownerPositions = await tx.select({ position: schema.fundPositions.position }).from(schema.fundPositions)
    .where(eq(schema.fundPositions.userId, record.ownerId)).orderBy(asc(schema.fundPositions.position));
  await tx.insert(schema.fundPositions).values({
    fundId: fund.id,
    userId: record.ownerId,
    position: (ownerPositions.at(-1)?.position ?? -1) + 1,
  });
  if (Object.keys(record.content.goal.years).length) {
    await tx.insert(schema.fundYearGoals).values(Object.entries(record.content.goal.years).map(([year, amount]) => ({
      fundId: fund.id,
      year: Number(year),
      amount,
    })));
  }
  const lotCount = await insertFundMonths(tx, fund.id, record.content.years);
  const contributions = Object.entries(record.content.contributions ?? {}).flatMap(([period, entries]) => {
    const [year, month] = period.split("-").map(Number);
    return entries.map((entry) => ({
      externalId: entry.id,
      fundId: fund.id,
      memberId: entry.memberId,
      year,
      month,
      amount: entry.amount,
      note: entry.note,
      createdAt: new Date(entry.createdAt),
    }));
  });
  if (contributions.length) await tx.insert(schema.fundContributions).values(contributions);
  return { id: fund.id, lotCount };
}

async function assembleFundDetails(db: Executor, internalIds: string[]): Promise<Map<string, FundDetail>> {
  const result = new Map<string, FundDetail>();
  if (!internalIds.length) return result;
  const details = await db.select().from(schema.fundMonthDetails).where(inArray(schema.fundMonthDetails.fundMonthId, internalIds));
  if (!details.length) return result;
  const detailIds = details.map((detail: typeof schema.fundMonthDetails.$inferSelect) => detail.id);
  const [holds, gold] = await Promise.all([
    db.select().from(schema.holdingLots).where(inArray(schema.holdingLots.detailId, detailIds)).orderBy(asc(schema.holdingLots.position)),
    db.select().from(schema.goldLots).where(inArray(schema.goldLots.detailId, detailIds)).orderBy(asc(schema.goldLots.position)),
  ]);
  for (const detail of details as Array<typeof schema.fundMonthDetails.$inferSelect>) {
    if (detail.type === "hold") {
      result.set(detail.fundMonthId, {
        type: "hold",
        lots: holds.filter((lot: typeof schema.holdingLots.$inferSelect) => lot.detailId === detail.id).map((lot: typeof schema.holdingLots.$inferSelect) => ({
          ticker: lot.ticker,
          qty: lot.quantity,
          manualPrice: lot.manualPrice,
          purchasePrice: lot.purchasePrice,
          purchaseFxVnd: lot.purchaseFxVnd,
          feeVnd: lot.feeVnd,
          ...(lot.purchasedAt ? { purchasedAt: lot.purchasedAt } : {}),
          ...(lot.note !== null ? { note: lot.note } : {}),
          ...(lot.exchange !== null ? { exchange: lot.exchange } : {}),
          ...(lot.providerId !== null ? { providerId: lot.providerId } : {}),
        })),
      });
    } else {
      result.set(detail.fundMonthId, {
        type: "gold",
        lots: gold.filter((lot: typeof schema.goldLots.$inferSelect) => lot.detailId === detail.id).map((lot: typeof schema.goldLots.$inferSelect) => ({
          chi: lot.chi,
          manualPrice: lot.manualPrice,
          costBasis: readGoldCostBasis(lot),
          ...(lot.purchasedAt ? { purchasedAt: lot.purchasedAt } : {}),
          ...(lot.note !== null ? { note: lot.note } : {}),
        })),
      });
    }
  }
  return result;
}

export async function assembleSharedFundContent(db: Executor, fund: typeof schema.funds.$inferSelect): Promise<SharedFundContent> {
  const months = await db.select().from(schema.fundMonths).where(eq(schema.fundMonths.fundId, fund.id));
  const [details, goals, contributions] = await Promise.all([
    assembleFundDetails(db, months.map((month: typeof schema.fundMonths.$inferSelect) => month.id)),
    db.select().from(schema.fundYearGoals).where(eq(schema.fundYearGoals.fundId, fund.id)),
    db.select().from(schema.fundContributions)
      .where(eq(schema.fundContributions.fundId, fund.id)).orderBy(asc(schema.fundContributions.createdAt)),
  ]);
  const years: SharedFundContent["years"] = {};
  for (const month of months as Array<typeof schema.fundMonths.$inferSelect>) {
    const key = String(month.year);
    years[key] ??= { funds: new Array<number>(12).fill(0), details: new Array<FundDetail>(12).fill(null) };
    years[key]!.funds[month.month - 1] = month.amount;
    years[key]!.details[month.month - 1] = details.get(month.id) ?? null;
  }
  return {
    fund: { id: fund.externalId, name: fund.name, color: fund.color, cat: fund.category as Fund["cat"] },
    years,
    goal: {
      years: Object.fromEntries(goals.map((goal: typeof schema.fundYearGoals.$inferSelect) => [String(goal.year), goal.amount])),
      all: fund.allGoal,
    },
    fundPlan: fund.fundPlan,
    openingBalance: fund.openingBalance,
    contributions: Object.fromEntries([...new Set(contributions.map((entry: typeof schema.fundContributions.$inferSelect) =>
      `${entry.year}-${String(entry.month).padStart(2, "0")}`))].map((period) => [period, contributions
        .filter((entry: typeof schema.fundContributions.$inferSelect) => period === `${entry.year}-${String(entry.month).padStart(2, "0")}`)
        .map((entry: typeof schema.fundContributions.$inferSelect) => ({
          id: entry.externalId,
          memberId: entry.memberId,
          amount: entry.amount,
          note: entry.note,
          createdAt: iso(entry.createdAt)!,
        }))])),
  };
}

export async function assemblePersonalStore(db: Executor, userId: string): Promise<FinanceStore> {
  const store = createDefaultStore();
  store.funds = [];
  store.years = {};
  store.goals = {};
  store.prices = {};
  store.expense = { cats: [], incomeCats: [], accountTypes: [], accounts: [], txns: [] };

  const [
    settingRows,
    years,
    monthNotes,
    positions,
    privateFundRows,
    categoryRows,
    typeRows,
    accountRows,
    transactionRows,
    debtRows,
    debtPaymentRows,
    prices,
    fxRows,
    goldRows,
    stocks,
    crypto,
    symbols,
    matches,
    errors,
    marketStateRows,
  ] = await Promise.all([
    db.select().from(schema.userSettings).where(eq(schema.userSettings.userId, userId)),
    db.select().from(schema.ledgerYears).where(eq(schema.ledgerYears.userId, userId)).orderBy(asc(schema.ledgerYears.year)),
    db.select().from(schema.ledgerMonths).where(eq(schema.ledgerMonths.userId, userId)),
    db.select().from(schema.fundPositions).where(eq(schema.fundPositions.userId, userId)),
    db.select().from(schema.funds).where(and(eq(schema.funds.ownerId, userId), eq(schema.funds.shared, false))),
    db.select().from(schema.financeCategories).where(eq(schema.financeCategories.userId, userId))
      .orderBy(asc(schema.financeCategories.position)),
    db.select().from(schema.accountTypes).where(eq(schema.accountTypes.userId, userId)).orderBy(asc(schema.accountTypes.position)),
    db.select().from(schema.accounts).where(eq(schema.accounts.userId, userId)).orderBy(asc(schema.accounts.position)),
    db.select().from(schema.transactions).where(eq(schema.transactions.userId, userId)),
    db.select().from(schema.debts).where(eq(schema.debts.userId, userId)).orderBy(asc(schema.debts.createdAt)),
    db.select().from(schema.debtPayments)
      .innerJoin(schema.debts, eq(schema.debtPayments.debtId, schema.debts.id))
      .where(eq(schema.debts.userId, userId))
      .orderBy(asc(schema.debtPayments.installment)),
    db.select().from(schema.legacyPrices).where(eq(schema.legacyPrices.userId, userId)),
    db.select().from(schema.marketFxQuotes).where(eq(schema.marketFxQuotes.userId, userId)),
    db.select().from(schema.marketGoldQuotes).where(eq(schema.marketGoldQuotes.userId, userId)),
    db.select().from(schema.marketStockQuotes).where(eq(schema.marketStockQuotes.userId, userId)),
    db.select().from(schema.marketCryptoQuotes).where(eq(schema.marketCryptoQuotes.userId, userId)),
    db.select().from(schema.marketCryptoSymbols).where(eq(schema.marketCryptoSymbols.userId, userId)),
    db.select().from(schema.marketCryptoMatches).where(eq(schema.marketCryptoMatches.userId, userId))
      .orderBy(asc(schema.marketCryptoMatches.position)),
    db.select().from(schema.marketQuoteErrors).where(eq(schema.marketQuoteErrors.userId, userId))
      .orderBy(asc(schema.marketQuoteErrors.position)),
    db.select().from(schema.marketStates).where(eq(schema.marketStates.userId, userId)),
  ]);

  const [settings] = settingRows;
  if (settings) {
    store.showGoals = settings.showGoals;
    store.onboarding = {
      status: settings.onboardingStatus as FinanceStore["onboarding"]["status"],
      version: settings.onboardingVersion,
      ...(settings.onboardingSkippedAt ? { skippedAt: iso(settings.onboardingSkippedAt)! } : {}),
    };
    store.financialProfile = {
      monthlyIncome: settings.monthlyIncome,
      monthlyBudgets: {},
      fundPlan: {},
      emergencyFundGoal: settings.emergencyFundGoal,
      openingBalances: {},
      debt: { balance: settings.debtBalance, monthlyPayment: settings.debtMonthlyPayment },
    };
    store.incomeMigrationVersion = settings.incomeMigrationVersion;
    store.futureIncomeResetVersion = settings.futureIncomeResetVersion;
    if (settings.legacyUsdRate !== null) store.usdRate = settings.legacyUsdRate;
  }

  for (const year of years as Array<typeof schema.ledgerYears.$inferSelect>) {
    store.years[String(year.year)] = blankYearWith([]);
    for (const month of monthNotes as Array<typeof schema.ledgerMonths.$inferSelect>) {
      if (month.year === year.year) {
        store.years[String(year.year)]!.income[month.month - 1] = month.income;
        store.years[String(year.year)]!.notes[month.month - 1] = month.note;
      }
    }
  }

  const privateFunds = [...privateFundRows];
  privateFunds.sort((a: typeof schema.funds.$inferSelect, b: typeof schema.funds.$inferSelect) =>
    (positions.find((item: typeof schema.fundPositions.$inferSelect) => item.fundId === a.id)?.position ?? 0)
    - (positions.find((item: typeof schema.fundPositions.$inferSelect) => item.fundId === b.id)?.position ?? 0));
  store.funds = privateFunds.map((fund: typeof schema.funds.$inferSelect) => ({
    id: fund.externalId,
    name: fund.name,
    color: fund.color,
    cat: fund.category as Fund["cat"],
  }));
  const privateIds = privateFunds.map((fund: typeof schema.funds.$inferSelect) => fund.id);
  const [months, goals] = privateIds.length
    ? await Promise.all([
      db.select().from(schema.fundMonths).where(inArray(schema.fundMonths.fundId, privateIds)),
      db.select().from(schema.fundYearGoals).where(inArray(schema.fundYearGoals.fundId, privateIds)),
    ])
    : [[], []];
  const details = await assembleFundDetails(db, months.map((month: typeof schema.fundMonths.$inferSelect) => month.id));
  for (const fund of privateFunds as Array<typeof schema.funds.$inferSelect>) {
    store.financialProfile.fundPlan[fund.externalId] = fund.fundPlan;
    store.financialProfile.openingBalances[fund.externalId] = fund.openingBalance;
    if (fund.goalConfigured) {
      store.goals[fund.externalId] = {
        all: fund.allGoal,
        years: Object.fromEntries(goals.filter((goal: typeof schema.fundYearGoals.$inferSelect) => goal.fundId === fund.id)
          .map((goal: typeof schema.fundYearGoals.$inferSelect) => [String(goal.year), goal.amount])),
      };
    }
    for (const yearData of Object.values(store.years)) {
      yearData.funds[fund.externalId] = new Array<number>(12).fill(0);
      yearData.details[fund.externalId] = new Array<FundDetail>(12).fill(null);
    }
    for (const month of months as Array<typeof schema.fundMonths.$inferSelect>) {
      if (month.fundId !== fund.id) continue;
      const yearData = store.years[String(month.year)];
      if (!yearData) continue;
      yearData.funds[fund.externalId]![month.month - 1] = month.amount;
      yearData.details[fund.externalId]![month.month - 1] = details.get(month.id) ?? null;
    }
  }

  const activeCategories = categoryRows.filter((row: typeof schema.financeCategories.$inferSelect) => row.deletedAt === null);
  const category = (row: typeof schema.financeCategories.$inferSelect): FinanceCategory => ({
    id: row.externalId,
    name: row.name,
    color: row.color,
    ...(row.type === "expense" ? { budget: row.budget } : {}),
  });
  store.expense.cats = activeCategories.filter((row: typeof schema.financeCategories.$inferSelect) => row.type === "expense").map(category);
  store.expense.incomeCats = activeCategories.filter((row: typeof schema.financeCategories.$inferSelect) => row.type === "income").map(category);
  store.financialProfile.monthlyBudgets = Object.fromEntries(store.expense.cats.map((item) => [item.id, item.budget ?? 0]));

  const activeTypes = typeRows.filter((row: typeof schema.accountTypes.$inferSelect) => row.deletedAt === null);
  store.expense.accountTypes = activeTypes.map((row: typeof schema.accountTypes.$inferSelect): AccountType => ({ id: row.externalId, name: row.name }));
  const activeAccounts = accountRows.filter((row: typeof schema.accounts.$inferSelect) => row.deletedAt === null);
  store.expense.accounts = activeAccounts.map((row: typeof schema.accounts.$inferSelect): Account => ({
    id: row.externalId,
    name: row.name,
    ...(row.typeId ? { typeId: typeRows.find((type: typeof schema.accountTypes.$inferSelect) => type.id === row.typeId)?.externalId } : {}),
  }));
  store.expense.txns = transactionRows.map((row: typeof schema.transactions.$inferSelect): Transaction => ({
    id: row.externalId,
    date: row.date,
    type: row.type as Transaction["type"],
    cat: categoryRows.find((item: typeof schema.financeCategories.$inferSelect) => item.id === row.categoryId)?.externalId ?? "",
    ...(row.accountId ? { accountId: accountRows.find((item: typeof schema.accounts.$inferSelect) => item.id === row.accountId)?.externalId } : {}),
    amount: row.amount,
    note: row.note,
  }));
  const transactionExternalById = new Map<string, string>(transactionRows.map((row: typeof schema.transactions.$inferSelect) => [row.id, row.externalId]));
  const paymentRowsByDebt = new Map<string, Array<typeof schema.debtPayments.$inferSelect>>();
  for (const entry of debtPaymentRows as Array<{ debt_payments: typeof schema.debtPayments.$inferSelect }>) {
    const rows = paymentRowsByDebt.get(entry.debt_payments.debtId) ?? [];
    rows.push(entry.debt_payments);
    paymentRowsByDebt.set(entry.debt_payments.debtId, rows);
  }
  store.debts = (debtRows as Array<typeof schema.debts.$inferSelect>).map((debt): Debt => ({
    id: debt.externalId,
    kind: debt.kind as Debt["kind"],
    name: debt.name,
    counterparty: debt.counterparty,
    principal: debt.principal,
    annualInterestRate: debt.annualInterestRate,
    termMonths: debt.termMonths,
    paymentAmount: debt.paymentAmount,
    ...(debt.firstPaymentDate ? { firstPaymentDate: debt.firstPaymentDate } : {}),
    ...(debt.paymentCategoryId ? {
      paymentCategoryId: categoryRows.find((category: typeof schema.financeCategories.$inferSelect) => category.id === debt.paymentCategoryId)?.externalId,
    } : {}),
    ...(debt.paymentAccountId ? {
      paymentAccountId: accountRows.find((account: typeof schema.accounts.$inferSelect) => account.id === debt.paymentAccountId)?.externalId,
    } : {}),
    note: debt.note,
    status: debt.status as Debt["status"],
    payments: (paymentRowsByDebt.get(debt.id) ?? []).map((payment) => {
      const transactionId = payment.transactionId ? transactionExternalById.get(payment.transactionId) : undefined;
      return {
        id: payment.externalId,
        installment: payment.installment,
        paidAt: payment.paidAt,
        amount: payment.amount,
        principalAmount: payment.principalAmount,
        interestAmount: payment.interestAmount,
        ...(transactionId ? { transactionId } : {}),
        note: payment.note,
      };
    }),
  }));

  store.prices = Object.fromEntries(prices.map((row: typeof schema.legacyPrices.$inferSelect) => [row.symbol, row.price]));
  const [fx] = fxRows;
  const [gold] = goldRows;
  const [marketState] = marketStateRows;
  store.market = {
    fx: fx ? {
      usdVnd: fx.usdVnd,
      source: fx.source,
      ...(fx.sourceUrl ? { sourceUrl: fx.sourceUrl } : {}),
      fetchedAt: iso(fx.fetchedAt),
      ...(fx.legacy ? { legacy: true } : {}),
    } : null,
    gold: gold ? {
      symbol: "XAU",
      xauUsdPerTroyOunce: gold.xauUsdPerTroyOunce,
      vndPerChi: gold.vndPerChi,
      source: gold.source,
      ...(gold.sourceUrl ? { sourceUrl: gold.sourceUrl } : {}),
      fetchedAt: iso(gold.fetchedAt)!,
    } : null,
    stocks: Object.fromEntries(stocks.map((row: typeof schema.marketStockQuotes.$inferSelect) => [`${row.exchange}:${row.symbol}`, {
      symbol: row.symbol,
      exchange: row.exchange,
      priceVnd: row.priceVnd,
      source: row.source,
      ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
      fetchedAt: iso(row.fetchedAt)!,
    }])),
    crypto: Object.fromEntries(crypto.map((row: typeof schema.marketCryptoQuotes.$inferSelect) => [row.providerId, {
      symbol: row.symbol,
      providerId: row.providerId,
      name: row.name,
      priceUsd: row.priceUsd,
      source: row.source,
      ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
      fetchedAt: iso(row.fetchedAt)!,
    }])),
    cryptoSymbols: Object.fromEntries(symbols.map((row: typeof schema.marketCryptoSymbols.$inferSelect) => [row.symbol, row.providerId])),
    matches: Object.fromEntries([...new Set(matches.map((row: typeof schema.marketCryptoMatches.$inferSelect) => row.lookupKey))].map((key) =>
      [key, matches.filter((row: typeof schema.marketCryptoMatches.$inferSelect) => row.lookupKey === key).map((row: typeof schema.marketCryptoMatches.$inferSelect): CryptoMatch => ({
        id: row.providerId,
        symbol: row.symbol,
        name: row.name,
        ...(row.rank !== null ? { rank: row.rank } : {}),
      }))])),
    errors: errors.map((row: typeof schema.marketQuoteErrors.$inferSelect) => ({ key: row.key, code: row.code, message: row.message })),
    updatedAt: iso(marketState?.updatedAt),
  };
  return store;
}

export function storeAsPayload(store: FinanceStore): StoredFinancePayload {
  return store as unknown as StoredFinancePayload;
}
