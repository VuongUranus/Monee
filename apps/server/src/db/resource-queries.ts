import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type {
  Account,
  AccountType,
  ExpenseConfigResponse,
  ExpenseMonthSummaryResponse,
  FinanceBootstrapResponse,
  FinanceCategory,
  FundDetail,
  FundMonthDetailResponse,
  FundOverviewItem,
  FundOverviewResponse,
  MarketAssetRequest,
  SharedFundContributionsResponse,
  SharedFundMembersResponse,
  StatisticsResponse,
  StatisticsScope,
  StoredMarketState,
  Transaction,
  TransactionPageResponse,
  TransactionQuery,
} from "@chi-tieu/shared";
import type { FinanceDatabase } from "./client.js";
import * as schema from "./schema.js";
import { readDebtSummary } from "./debt-queries.js";

type Executor = FinanceDatabase;

const asNumber = (value: unknown): number => Number(value) || 0;
const iso = (value: Date | null): string | null => value ? value.toISOString() : null;

function category(row: typeof schema.financeCategories.$inferSelect): FinanceCategory {
  return {
    id: row.externalId,
    name: row.name,
    color: row.color,
    ...(row.type === "expense" ? { budget: row.budget } : {}),
  };
}

export async function readBootstrap(db: Executor, userId: string): Promise<FinanceBootstrapResponse> {
  const [userRows, settingRows, yearRows, transactionYears, fundYears] = await Promise.all([
    db.select().from(schema.users).where(eq(schema.users.id, userId)),
    db.select().from(schema.userSettings).where(eq(schema.userSettings.userId, userId)),
    db.select({ year: schema.ledgerYears.year }).from(schema.ledgerYears)
      .where(eq(schema.ledgerYears.userId, userId)),
    db.select({ year: sql<number>`extract(year from ${schema.transactions.date})::int` })
      .from(schema.transactions).where(eq(schema.transactions.userId, userId))
      .groupBy(sql`extract(year from ${schema.transactions.date})`),
    db.select({ year: schema.fundMonths.year }).from(schema.fundMonths)
      .innerJoin(schema.funds, eq(schema.fundMonths.fundId, schema.funds.id))
      .leftJoin(schema.fundMembers, and(
        eq(schema.fundMembers.fundId, schema.funds.id),
        eq(schema.fundMembers.userId, userId),
      ))
      .where(or(
        eq(schema.funds.ownerId, userId),
        and(eq(schema.funds.shared, true), eq(schema.fundMembers.userId, userId)),
      ))
      .groupBy(schema.fundMonths.year),
  ]);
  const [user] = userRows;
  if (!user) throw new Error("Không tìm thấy dữ liệu tài khoản.");
  const [settings] = settingRows;
  const availableYears = [...new Set([
    ...yearRows.map((row) => row.year),
    ...transactionYears.map((row) => asNumber(row.year)),
    ...fundYears.map((row) => row.year),
  ])].filter(Number.isInteger).sort((a, b) => a - b);
  return {
    user: { sub: user.id, email: user.email, name: user.name, picture: user.picture },
    workspaceRevision: user.workspaceRevision,
    preferences: {
      showGoals: settings?.showGoals ?? false,
      onboarding: {
        status: settings?.onboardingStatus as "pending" | "completed" | "skipped" ?? "pending",
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
    },
    availableYears,
  };
}

export async function readExpenseConfig(db: Executor, userId: string): Promise<ExpenseConfigResponse> {
  const [categoryRows, typeRows, accountRows] = await Promise.all([
    db.select().from(schema.financeCategories).where(and(
      eq(schema.financeCategories.userId, userId),
      sql`${schema.financeCategories.deletedAt} is null`,
    )).orderBy(asc(schema.financeCategories.position)),
    db.select().from(schema.accountTypes).where(and(
      eq(schema.accountTypes.userId, userId),
      sql`${schema.accountTypes.deletedAt} is null`,
    )).orderBy(asc(schema.accountTypes.position)),
    db.select().from(schema.accounts).where(and(
      eq(schema.accounts.userId, userId),
      sql`${schema.accounts.deletedAt} is null`,
    )).orderBy(asc(schema.accounts.position)),
  ]);
  const activeTypeById = new Map(typeRows.map((row) => [row.id, row.externalId]));
  return {
    categories: categoryRows.filter((row) => row.type === "expense").map(category),
    incomeCategories: categoryRows.filter((row) => row.type === "income").map(category),
    accountTypes: typeRows.map((row): AccountType => ({ id: row.externalId, name: row.name })),
    accounts: accountRows.map((row): Account => ({
      id: row.externalId,
      name: row.name,
      ...(row.typeId && activeTypeById.has(row.typeId) ? { typeId: activeTypeById.get(row.typeId)! } : {}),
    })),
  };
}

export async function readExpenseSummary(
  db: Executor,
  userId: string,
  year: number,
  month: number,
): Promise<ExpenseMonthSummaryResponse> {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const next = new Date(Date.UTC(year, month, 1));
  const to = new Date(next.getTime() - 86_400_000).toISOString().slice(0, 10);
  const [categoryTotals, accountTotals, fundTotals] = await Promise.all([
    db.select({
      type: schema.transactions.type,
      categoryId: schema.financeCategories.externalId,
      amount: sql<number>`coalesce(sum(${schema.transactions.amount}), 0)`,
    }).from(schema.transactions)
      .innerJoin(schema.financeCategories, eq(schema.transactions.categoryId, schema.financeCategories.id))
      .where(and(
        eq(schema.transactions.userId, userId),
        gte(schema.transactions.date, from),
        lte(schema.transactions.date, to),
      ))
      .groupBy(schema.transactions.type, schema.financeCategories.externalId),
    db.select({
      accountId: schema.accounts.externalId,
      accountName: schema.accounts.name,
      deletedAt: schema.accounts.deletedAt,
      amount: sql<number>`coalesce(sum(${schema.transactions.amount}), 0)`,
    }).from(schema.transactions)
      .leftJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
      .where(and(
        eq(schema.transactions.userId, userId),
        eq(schema.transactions.type, "expense"),
        gte(schema.transactions.date, from),
        lte(schema.transactions.date, to),
      ))
      .groupBy(schema.accounts.externalId, schema.accounts.name, schema.accounts.deletedAt),
    db.select({ amount: sql<number>`coalesce(sum(${schema.fundMonths.amount}), 0)` })
      .from(schema.fundMonths)
      .innerJoin(schema.funds, eq(schema.fundMonths.fundId, schema.funds.id))
      .where(and(
        eq(schema.funds.ownerId, userId),
        eq(schema.fundMonths.year, year),
        eq(schema.fundMonths.month, month),
      )),
  ]);
  const byExpenseCategory: Record<string, number> = {};
  const byIncomeCategory: Record<string, number> = {};
  let income = 0;
  let spent = 0;
  for (const row of categoryTotals) {
    const amount = asNumber(row.amount);
    if (row.type === "income") {
      income += amount;
      byIncomeCategory[row.categoryId] = amount;
    } else {
      spent += amount;
      byExpenseCategory[row.categoryId] = amount;
    }
  }
  const funds = asNumber(fundTotals[0]?.amount);
  return {
    year,
    month,
    income,
    spent,
    funds,
    balance: income - spent - funds,
    byExpenseCategory,
    byIncomeCategory,
    accountExpenses: accountTotals.map((row, index) => ({
      id: row.accountId ? `account:${row.accountId}` : "unassigned",
      name: row.accountId ? row.deletedAt ? "(đã xóa)" : row.accountName ?? "(đã xóa)" : "Chưa xác định",
      color: ["#E4572E", "#F3A712", "#8CB369", "#118AB2", "#5E60CE"][index % 5]!,
      amount: asNumber(row.amount),
    })).sort((a, b) => b.amount - a.amount),
  };
}

export async function readTransactions(
  db: Executor,
  userId: string,
  query: TransactionQuery,
): Promise<TransactionPageResponse> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 10));
  const conditions = [
    eq(schema.transactions.userId, userId),
    gte(schema.transactions.date, query.from),
    lte(schema.transactions.date, query.to),
  ];
  if (query.type) conditions.push(eq(schema.transactions.type, query.type));
  if (query.categoryId) conditions.push(eq(schema.financeCategories.externalId, query.categoryId));
  if (query.accountId) conditions.push(eq(schema.accounts.externalId, query.accountId));
  if (query.q?.trim()) conditions.push(ilike(schema.transactions.note, `%${query.q.trim()}%`));
  const where = and(...conditions);
  const [rows, totals] = await Promise.all([
    db.select({
      transaction: schema.transactions,
      categoryExternalId: schema.financeCategories.externalId,
      accountExternalId: schema.accounts.externalId,
    }).from(schema.transactions)
      .innerJoin(schema.financeCategories, eq(schema.transactions.categoryId, schema.financeCategories.id))
      .leftJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
      .where(where)
      .orderBy(desc(schema.transactions.date), desc(schema.transactions.externalId))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(schema.transactions)
      .innerJoin(schema.financeCategories, eq(schema.transactions.categoryId, schema.financeCategories.id))
      .leftJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
      .where(where),
  ]);
  const total = asNumber(totals[0]?.value);
  return {
    items: rows.map(({ transaction: row, categoryExternalId, accountExternalId }): Transaction => ({
      id: row.externalId,
      date: row.date,
      type: row.type as Transaction["type"],
      cat: categoryExternalId,
      ...(accountExternalId ? { accountId: accountExternalId } : {}),
      amount: row.amount,
      note: row.note,
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

interface AccessibleFundRow {
  id: string;
  externalId: string;
  ownerId: string;
  shared: boolean;
  name: string;
  color: string;
  category: string;
  fundPlan: number;
  openingBalance: number;
  allGoal: number;
  revision: number;
  role: "owner" | "viewer" | "editor";
  ownerName: string;
  ownerEmail: string;
  position: number;
}

async function accessibleFunds(db: Executor, userId: string): Promise<AccessibleFundRow[]> {
  const result: any = await db.execute(sql`
    select f.id, f.external_id, f.owner_id, f.shared, f.name, f.color, f.category,
           f.fund_plan, f.opening_balance, f.all_goal, f.revision,
           case when f.owner_id = ${userId} then 'owner' else fm.role end as role,
           u.name as owner_name, u.email as owner_email,
           coalesce(fp.position, 2147483647) as position
    from funds f
    join users u on u.id = f.owner_id
    left join fund_members fm on fm.fund_id = f.id and fm.user_id = ${userId}
    left join fund_positions fp on fp.fund_id = f.id and fp.user_id = ${userId}
    where f.owner_id = ${userId} or (f.shared = true and fm.user_id = ${userId})
    order by coalesce(fp.position, 2147483647), f.created_at
  `);
  return (result.rows ?? result).map((row: any) => ({
    id: String(row.id),
    externalId: String(row.external_id),
    ownerId: String(row.owner_id),
    shared: Boolean(row.shared),
    name: String(row.name),
    color: String(row.color),
    category: String(row.category),
    fundPlan: asNumber(row.fund_plan),
    openingBalance: asNumber(row.opening_balance),
    allGoal: asNumber(row.all_goal),
    revision: asNumber(row.revision),
    role: row.role,
    ownerName: String(row.owner_name),
    ownerEmail: String(row.owner_email),
    position: asNumber(row.position),
  }));
}

async function readMarket(db: Executor, userId: string): Promise<StoredMarketState> {
  const [prices, fxRows, goldRows, stocks, crypto, symbols, matches, errors, states] = await Promise.all([
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
  const market: StoredMarketState = {
    fx: null,
    gold: null,
    stocks: {},
    crypto: {},
    cryptoSymbols: {},
    matches: {},
    errors: [],
    updatedAt: null,
  };
  const [fx] = fxRows;
  const [gold] = goldRows;
  const [state] = states;
  market.fx = fx ? {
    usdVnd: fx.usdVnd,
    source: fx.source,
    ...(fx.sourceUrl ? { sourceUrl: fx.sourceUrl } : {}),
    fetchedAt: iso(fx.fetchedAt),
    ...(fx.legacy ? { legacy: true } : {}),
  } : null;
  market.gold = gold ? {
    symbol: "XAU",
    xauUsdPerTroyOunce: gold.xauUsdPerTroyOunce,
    vndPerChi: gold.vndPerChi,
    source: gold.source,
    ...(gold.sourceUrl ? { sourceUrl: gold.sourceUrl } : {}),
    fetchedAt: gold.fetchedAt.toISOString(),
  } : null;
  market.stocks = Object.fromEntries(stocks.map((row) => [`${row.exchange}:${row.symbol}`, {
    symbol: row.symbol,
    exchange: row.exchange,
    priceVnd: row.priceVnd,
    source: row.source,
    ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
    fetchedAt: row.fetchedAt.toISOString(),
  }]));
  market.crypto = Object.fromEntries(crypto.map((row) => [row.providerId, {
    symbol: row.symbol,
    providerId: row.providerId,
    name: row.name,
    priceUsd: row.priceUsd,
    source: row.source,
    ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
    fetchedAt: row.fetchedAt.toISOString(),
  }]));
  market.cryptoSymbols = Object.fromEntries(symbols.map((row) => [row.symbol, row.providerId]));
  market.matches = Object.fromEntries([...new Set(matches.map((row) => row.lookupKey))].map((key) => [
    key,
    matches.filter((row) => row.lookupKey === key).map((row) => ({
      id: row.providerId,
      symbol: row.symbol,
      name: row.name,
      ...(row.rank !== null ? { rank: row.rank } : {}),
    })),
  ]));
  market.errors = errors.map((row) => ({ key: row.key, code: row.code, message: row.message }));
  market.updatedAt = state?.updatedAt?.toISOString() ?? null;
  // Legacy prices remain part of backup compatibility, but fund overview consumes normalized market rows.
  void prices;
  return market;
}

export async function readFundOverview(
  db: Executor,
  userId: string,
  year: number,
  month: number,
): Promise<FundOverviewResponse> {
  const fundRows = await accessibleFunds(db, userId);
  const ids = fundRows.map((fund) => fund.id);
  const [yearMonths, allTimeTotals, periodTotals, goals, contributions, notes, settings, incomeRows, assetRows, market, debtSummary] = await Promise.all([
    ids.length ? db.select({
      fundId: schema.fundMonths.fundId,
      month: schema.fundMonths.month,
      amount: schema.fundMonths.amount,
    }).from(schema.fundMonths).where(and(
      inArray(schema.fundMonths.fundId, ids),
      eq(schema.fundMonths.year, year),
    )) : [],
    ids.length ? db.select({
      fundId: schema.fundMonths.fundId,
      amount: sql<number>`coalesce(sum(${schema.fundMonths.amount}), 0)`,
    }).from(schema.fundMonths)
      .where(inArray(schema.fundMonths.fundId, ids))
      .groupBy(schema.fundMonths.fundId) : [],
    ids.length ? db.select({
      year: schema.fundMonths.year,
      month: schema.fundMonths.month,
      amount: sql<number>`coalesce(sum(${schema.fundMonths.amount}), 0)`,
    }).from(schema.fundMonths)
      .where(inArray(schema.fundMonths.fundId, ids))
      .groupBy(schema.fundMonths.year, schema.fundMonths.month) : [],
    ids.length ? db.select().from(schema.fundYearGoals).where(and(
      inArray(schema.fundYearGoals.fundId, ids),
      eq(schema.fundYearGoals.year, year),
    )) : [],
    ids.length ? db.select().from(schema.fundContributions).where(and(
      inArray(schema.fundContributions.fundId, ids),
      eq(schema.fundContributions.year, year),
      eq(schema.fundContributions.month, month),
    )) : [],
    db.select().from(schema.ledgerMonths).where(and(
      eq(schema.ledgerMonths.userId, userId),
      eq(schema.ledgerMonths.year, year),
      eq(schema.ledgerMonths.month, month),
    )),
    db.select().from(schema.userSettings).where(eq(schema.userSettings.userId, userId)),
    db.select({ amount: sql<number>`coalesce(sum(${schema.transactions.amount}), 0)` })
      .from(schema.transactions).where(and(
        eq(schema.transactions.userId, userId),
        eq(schema.transactions.type, "income"),
        gte(schema.transactions.date, `${year}-${String(month).padStart(2, "0")}-01`),
        lte(
          schema.transactions.date,
          new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
        ),
      )),
    ids.length ? db.selectDistinct({
      category: schema.funds.category,
      ticker: schema.holdingLots.ticker,
      exchange: schema.holdingLots.exchange,
      providerId: schema.holdingLots.providerId,
    }).from(schema.funds)
      .leftJoin(schema.fundMonths, eq(schema.fundMonths.fundId, schema.funds.id))
      .leftJoin(schema.fundMonthDetails, eq(schema.fundMonthDetails.fundMonthId, schema.fundMonths.id))
      .leftJoin(schema.holdingLots, eq(schema.holdingLots.detailId, schema.fundMonthDetails.id))
      .where(inArray(schema.funds.id, ids)) : [],
    readMarket(db, userId),
    readDebtSummary(db, userId),
  ]);
  const [note] = notes;
  const [setting] = settings;
  const yearAmountsByFund = new Map<string, number[]>();
  for (const entry of yearMonths) {
    const amounts = yearAmountsByFund.get(entry.fundId) ?? new Array<number>(12).fill(0);
    amounts[entry.month - 1] = asNumber(entry.amount);
    yearAmountsByFund.set(entry.fundId, amounts);
  }
  const allTimeTotalByFund = new Map(allTimeTotals.map((entry) => [entry.fundId, asNumber(entry.amount)]));
  const activeYearMonths = periodTotals.filter((entry) => entry.year === year && asNumber(entry.amount) > 0).length;
  const activeAllTimeMonths = periodTotals.filter((entry) => asNumber(entry.amount) > 0).length;
  const marketAssetMap = new Map<string, MarketAssetRequest>();
  for (const row of assetRows) {
    if (row.category === "gold") {
      marketAssetMap.set("gold", { type: "gold" });
      continue;
    }
    const symbol = row.ticker?.trim().toUpperCase();
    if (!symbol || (row.category !== "stock" && row.category !== "crypto")) continue;
    const asset = row.category === "stock"
      ? { type: "stock" as const, symbol, ...(row.exchange ? { exchange: row.exchange } : {}) }
      : { type: "crypto" as const, symbol, ...(row.providerId ? { providerId: row.providerId } : {}) };
    marketAssetMap.set(JSON.stringify(asset), asset);
  }
  const marketAssets = [...marketAssetMap.values()];
  return {
    year,
    month,
    note: note?.note ?? "",
    income: asNumber(incomeRows[0]?.amount),
    yearActiveMonths: activeYearMonths,
    allTimeActiveMonths: activeAllTimeMonths,
    showGoals: setting?.showGoals ?? false,
    debt: {
      balance: setting?.debtBalance ?? 0,
      monthlyPayment: setting?.debtMonthlyPayment ?? 0,
    },
    debtSummary,
    funds: fundRows.map((fund): FundOverviewItem => {
      const yearAmounts = yearAmountsByFund.get(fund.id) ?? new Array<number>(12).fill(0);
      const periodContributions = contributions.filter((entry) => entry.fundId === fund.id);
      return {
        id: fund.externalId,
        name: fund.name,
        color: fund.color,
        cat: fund.category as FundOverviewItem["cat"],
        ...(fund.shared ? {
          revision: fund.revision,
          role: fund.role,
          owner: { sub: fund.ownerId, name: fund.ownerName, email: fund.ownerEmail },
        } : {}),
        fundPlan: fund.fundPlan,
        openingBalance: fund.openingBalance,
        yearGoal: goals.find((goal) => goal.fundId === fund.id)?.amount ?? 0,
        allGoal: fund.allGoal,
        monthAmount: yearAmounts[month - 1] ?? 0,
        yearAmounts,
        yearTotal: yearAmounts.reduce((sum, amount) => sum + amount, 0),
        allTimeTotal: allTimeTotalByFund.get(fund.id) ?? 0,
        contributionAmount: periodContributions.reduce((sum, entry) => sum + entry.amount, 0),
        contributionCount: periodContributions.length,
      };
    }),
    marketAssets,
    market,
  };
}

export async function readFundMonthDetail(
  db: Executor,
  userId: string,
  externalId: string,
  year: number,
  month: number,
): Promise<FundMonthDetailResponse> {
  const funds = await accessibleFunds(db, userId);
  const fund = funds.find((entry) => entry.externalId === externalId);
  if (!fund) throw new Error("fund_not_found");
  const result: any = await db.execute(sql`
    select fm.amount, d.id as detail_id, d.type,
           h.position as hold_position, h.ticker, h.quantity, h.manual_price as hold_manual_price,
           h.purchase_price as hold_purchase_price, h.purchase_fx_vnd, h.fee_vnd as hold_fee_vnd,
           h.purchased_at as hold_purchased_at, h.note as hold_note, h.exchange, h.provider_id,
           g.position as gold_position, g.chi, g.manual_price as gold_manual_price,
           g.purchase_price as gold_purchase_price, g.fee_vnd as gold_fee_vnd,
           g.purchased_at as gold_purchased_at, g.note as gold_note
    from fund_months fm
    left join fund_month_details d on d.fund_month_id = fm.id
    left join holding_lots h on h.detail_id = d.id
    left join gold_lots g on g.detail_id = d.id
    where fm.fund_id = ${fund.id} and fm.year = ${year} and fm.month = ${month}
    order by coalesce(h.position, g.position, 0)
  `);
  const rows: any[] = result.rows ?? result;
  let detail: FundDetail = null;
  const first = rows[0];
  if (first?.type === "hold") {
    detail = {
      type: "hold",
      lots: rows.filter((row) => row.ticker !== null).map((row) => ({
        ticker: String(row.ticker),
        qty: asNumber(row.quantity),
        manualPrice: row.hold_manual_price === null ? null : asNumber(row.hold_manual_price),
        purchasePrice: row.hold_purchase_price === null ? null : asNumber(row.hold_purchase_price),
        purchaseFxVnd: row.purchase_fx_vnd === null ? null : asNumber(row.purchase_fx_vnd),
        feeVnd: row.hold_fee_vnd === null ? null : asNumber(row.hold_fee_vnd),
        ...(row.hold_purchased_at ? { purchasedAt: String(row.hold_purchased_at) } : {}),
        ...(row.hold_note !== null ? { note: String(row.hold_note) } : {}),
        ...(row.exchange !== null ? { exchange: String(row.exchange) } : {}),
        ...(row.provider_id !== null ? { providerId: String(row.provider_id) } : {}),
      })),
    };
  } else if (first?.type === "gold") {
    detail = {
      type: "gold",
      lots: rows.filter((row) => row.chi !== null).map((row) => ({
        chi: asNumber(row.chi),
        manualPrice: row.gold_manual_price === null ? null : asNumber(row.gold_manual_price),
        purchasePrice: row.gold_purchase_price === null ? null : asNumber(row.gold_purchase_price),
        feeVnd: row.gold_fee_vnd === null ? null : asNumber(row.gold_fee_vnd),
        ...(row.gold_purchased_at ? { purchasedAt: String(row.gold_purchased_at) } : {}),
        ...(row.gold_note !== null ? { note: String(row.gold_note) } : {}),
      })),
    };
  }
  return { fundId: externalId, year, month, amount: asNumber(first?.amount), detail };
}

export async function readSharedFundMembers(
  db: Executor,
  userId: string,
  externalId: string,
): Promise<SharedFundMembersResponse> {
  const funds = await accessibleFunds(db, userId);
  const fund = funds.find((entry) => entry.externalId === externalId && entry.shared);
  if (!fund) throw new Error("fund_not_found");
  if (fund.role !== "owner") throw new Error("forbidden");
  const rows = await db.select({ member: schema.fundMembers, user: schema.users })
    .from(schema.fundMembers)
    .innerJoin(schema.users, eq(schema.fundMembers.userId, schema.users.id))
    .where(eq(schema.fundMembers.fundId, fund.id))
    .orderBy(asc(schema.fundMembers.addedAt));
  return {
    fundId: externalId,
    revision: fund.revision,
    members: rows.map(({ member, user }) => ({
      user: { sub: user.id, name: user.name, email: user.email },
      role: member.role as "viewer" | "editor",
    })),
  };
}

export async function readSharedFundContributions(
  db: Executor,
  userId: string,
  externalId: string,
  year: number,
  month: number,
): Promise<SharedFundContributionsResponse> {
  const funds = await accessibleFunds(db, userId);
  const fund = funds.find((entry) => entry.externalId === externalId && entry.shared);
  if (!fund) throw new Error("fund_not_found");
  const rows = await db.select({ contribution: schema.fundContributions, user: schema.users })
    .from(schema.fundContributions)
    .innerJoin(schema.users, eq(schema.fundContributions.memberId, schema.users.id))
    .where(and(
      eq(schema.fundContributions.fundId, fund.id),
      eq(schema.fundContributions.year, year),
      eq(schema.fundContributions.month, month),
    ))
    .orderBy(asc(schema.fundContributions.createdAt));
  return {
    fundId: externalId,
    revision: fund.revision,
    period: `${year}-${String(month).padStart(2, "0")}`,
    contributors: Object.fromEntries(rows.map(({ user }) => [user.id, {
      sub: user.id,
      name: user.name,
      email: user.email,
    }])),
    items: rows.map(({ contribution }) => ({
      id: contribution.externalId,
      memberId: contribution.memberId,
      amount: contribution.amount,
      note: contribution.note,
      createdAt: contribution.createdAt.toISOString(),
    })),
  };
}

function scopeBounds(scope: StatisticsScope, availableYears: number[]): { from: string; to: string; months: string[] } {
  let from: string;
  let to: string;
  if (scope.mode === "month") {
    from = scope.month;
    to = scope.month;
  } else if (scope.mode === "range") {
    from = scope.from;
    to = scope.to;
  } else if (scope.mode === "year") {
    from = `${scope.year}-01`;
    to = `${scope.year}-12`;
  } else {
    const first = availableYears[0] ?? new Date().getFullYear();
    const last = availableYears.at(-1) ?? first;
    from = `${first}-01`;
    to = `${last}-12`;
  }
  const months: string[] = [];
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  for (let year = fromYear!, month = fromMonth!; year < toYear! || (year === toYear && month <= toMonth!);) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }
  return { from: `${from}-01`, to: new Date(Date.UTC(toYear!, toMonth!, 0)).toISOString().slice(0, 10), months };
}

export async function readStatistics(
  db: Executor,
  userId: string,
  scope: StatisticsScope,
): Promise<StatisticsResponse> {
  const bootstrap = await readBootstrap(db, userId);
  const bounds = scopeBounds(scope, bootstrap.availableYears);
  const [fundRows, transactionRows, fundMonthRows, categoryRows, accountRows] = await Promise.all([
    db.select().from(schema.funds).where(eq(schema.funds.ownerId, userId))
      .orderBy(asc(schema.funds.createdAt)),
    db.select({
      key: sql<string>`to_char(${schema.transactions.date}, 'YYYY-MM')`,
      type: schema.transactions.type,
      categoryId: schema.financeCategories.externalId,
      categoryName: schema.financeCategories.name,
      categoryColor: schema.financeCategories.color,
      accountId: schema.accounts.externalId,
      accountName: schema.accounts.name,
      accountDeletedAt: schema.accounts.deletedAt,
      amount: sql<number>`coalesce(sum(${schema.transactions.amount}), 0)`,
    }).from(schema.transactions)
      .innerJoin(schema.financeCategories, eq(schema.transactions.categoryId, schema.financeCategories.id))
      .leftJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
      .where(and(
        eq(schema.transactions.userId, userId),
        gte(schema.transactions.date, bounds.from),
        lte(schema.transactions.date, bounds.to),
      ))
      .groupBy(
        sql`to_char(${schema.transactions.date}, 'YYYY-MM')`,
        schema.transactions.type,
        schema.financeCategories.externalId,
        schema.financeCategories.name,
        schema.financeCategories.color,
        schema.accounts.externalId,
        schema.accounts.name,
        schema.accounts.deletedAt,
      ),
    db.select({
      year: schema.fundMonths.year,
      month: schema.fundMonths.month,
      fundId: schema.funds.externalId,
      amount: sql<number>`coalesce(sum(${schema.fundMonths.amount}), 0)`,
    }).from(schema.fundMonths)
      .innerJoin(schema.funds, eq(schema.fundMonths.fundId, schema.funds.id))
      .where(and(
        eq(schema.funds.ownerId, userId),
        gte(schema.fundMonths.year, Number(bounds.from.slice(0, 4))),
        lte(schema.fundMonths.year, Number(bounds.to.slice(0, 4))),
      ))
      .groupBy(schema.fundMonths.year, schema.fundMonths.month, schema.funds.externalId),
    db.select().from(schema.financeCategories).where(eq(schema.financeCategories.userId, userId)),
    db.select().from(schema.accounts).where(eq(schema.accounts.userId, userId)),
  ]);
  const rows = bounds.months.map((key) => {
    const [year, month] = key.split("-").map(Number) as [number, number];
    const transactions = transactionRows.filter((row) => row.key === key);
    const income = transactions.filter((row) => row.type === "income")
      .reduce((sum, row) => sum + asNumber(row.amount), 0);
    const spent = transactions.filter((row) => row.type === "expense")
      .reduce((sum, row) => sum + asNumber(row.amount), 0);
    const periodFunds = fundMonthRows.filter((row) => row.year === year && row.month === month);
    const funds = periodFunds.reduce((sum, row) => sum + asNumber(row.amount), 0);
    return {
      year,
      month: month - 1,
      key,
      income,
      spent,
      funds,
      balance: income - spent - funds,
      byFund: Object.fromEntries(fundRows.map((fund) => [
        fund.externalId,
        asNumber(periodFunds.find((row) => row.fundId === fund.externalId)?.amount),
      ])),
    };
  });
  const breakdown = (type: "income" | "expense") => categoryRows.map((entry) => ({
    id: entry.externalId,
    name: entry.deletedAt ? "(đã xóa)" : entry.name,
    color: entry.color,
    amount: transactionRows.filter((row) => row.type === type && row.categoryId === entry.externalId)
      .reduce((sum, row) => sum + asNumber(row.amount), 0),
  })).filter((entry) => entry.amount > 0).sort((a, b) => b.amount - a.amount);
  const accountIds = [...new Set(transactionRows.filter((row) => row.type === "expense")
    .map((row) => row.accountId ?? ""))];
  const accountExpenses = accountIds.map((id, index) => {
    const account = id ? accountRows.find((entry) => entry.externalId === id) : undefined;
    return {
      id: id ? `account:${id}` : "unassigned",
      name: id ? account?.deletedAt ? "(đã xóa)" : account?.name ?? "(đã xóa)" : "Chưa xác định",
      color: ["#E4572E", "#F3A712", "#8CB369", "#118AB2", "#5E60CE"][index % 5]!,
      amount: transactionRows.filter((row) => row.type === "expense" && (row.accountId ?? "") === id)
        .reduce((sum, row) => sum + asNumber(row.amount), 0),
    };
  }).sort((a, b) => b.amount - a.amount);
  return {
    scope,
    availableYears: bootstrap.availableYears,
    funds: fundRows.map((fund) => ({ id: fund.externalId, name: fund.name, color: fund.color })),
    rows,
    totals: rows.reduce((total, row) => ({
      income: total.income + row.income,
      spent: total.spent + row.spent,
      funds: total.funds + row.funds,
      balance: total.balance + row.balance,
    }), { income: 0, spent: 0, funds: 0, balance: 0 }),
    expenseBreakdown: breakdown("expense"),
    incomeBreakdown: breakdown("income"),
    accountExpenses,
  };
}
