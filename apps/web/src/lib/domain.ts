import type {
  CryptoQuote,
  FinanceCategory,
  FinanceStore,
  FinancialProfile,
  Fund,
  FundCategory,
  FundDetail,
  FundGoal,
  GoldLot,
  HoldingLot,
  MarketAssetRequest,
  MarketQuotesResponse,
  StockQuote,
  StoredFinancePayload,
  StoredMarketState,
  Transaction,
  TransactionType,
  YearData,
} from "@chi-tieu/shared";

export const MONTHS = ["Th1", "Th2", "Th3", "Th4", "Th5", "Th6", "Th7", "Th8", "Th9", "Th10", "Th11", "Th12"];
export const MONTHS_FULL = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];
export const DEFAULT_INCOME = 22_500_000;
export const INCOME_RESET_FROM = "2026-08";
export const FUND_COLORS = ["#3f7d5c", "#3b6ea5", "#c8963e", "#8a5cc4", "#b5533a", "#2f8f83", "#a8632f", "#6b7f2f", "#9c3f6a", "#4a5a8a"];
export const PALETTE = [
  "#E4572E", "#F3A712", "#E6B325", "#8CB369", "#4C9F70", "#2A9D8F",
  "#118AB2", "#3D5A80", "#5E60CE", "#7B2CBF", "#C71F66", "#EF476F",
  "#F15BB5", "#9C6644", "#6D6875", "#1B263B",
];

export const FUND_CATEGORIES: Record<FundCategory, { label: string; short: string }> = {
  saving: { label: "Tiết kiệm (VND)", short: "Tiết kiệm" },
  gold: { label: "Vàng (chỉ → VND)", short: "Vàng" },
  stock: { label: "Cổ phiếu (mã, số lượng, giá)", short: "Cổ phiếu" },
  crypto: { label: "Crypto (mã, số lượng, giá)", short: "Crypto" },
};

export const DEFAULT_FUNDS: Fund[] = [
  { id: "dp", name: "Quỹ dự phòng", color: "#3f7d5c", cat: "saving" },
  { id: "dt", name: "Quỹ đầu tư", color: "#3b6ea5", cat: "stock" },
  { id: "vang", name: "Quỹ mua vàng", color: "#c8963e", cat: "gold" },
  { id: "cr", name: "Crypto", color: "#8a5cc4", cat: "crypto" },
];

export const DEFAULT_EXPENSE_CATEGORIES: FinanceCategory[] = [
  { id: "food", name: "Ăn uống", color: "#E4572E", budget: 5_000_000 },
  { id: "living", name: "Sinh hoạt", color: "#F3A712", budget: 3_000_000 },
  { id: "trans", name: "Đi lại", color: "#118AB2", budget: 1_500_000 },
  { id: "fun", name: "Giải trí", color: "#7B2CBF", budget: 1_500_000 },
  { id: "other", name: "Khác", color: "#4C9F70", budget: 0 },
];

export const DEFAULT_INCOME_CATEGORIES: FinanceCategory[] = [
  { id: "salary", name: "Lương", color: "#4C9F70" },
  { id: "bonus", name: "Thưởng", color: "#E6B325" },
  { id: "side-income", name: "Thu nhập phụ", color: "#118AB2" },
  { id: "refund", name: "Hoàn tiền", color: "#8A5CC4" },
  { id: "income-other", name: "Khác", color: "#9C6644" },
];

export const fmt = (value: number): string => `${Math.round(value || 0).toLocaleString("vi-VN")} ₫`;
export const fmtNumber = (value: number): string => Math.round(value || 0).toLocaleString("vi-VN");
export const fmtShort = (value: number): string => {
  const number = value || 0;
  if (Math.abs(number) >= 1_000_000) return `${(number / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}tr`;
  if (Math.abs(number) >= 1_000) return `${Math.round(number / 1_000)}k`;
  return String(number);
};

export function evaluateMoneyExpression(source: string): number {
  const normalized = source.replace(/[₫\s._]/g, "").replace(/,/g, ".");
  if (!normalized.trim() || !/^[\d+\-*/().]+$/.test(normalized)) return Number.NaN;
  try {
    const result = Function(`"use strict"; return (${normalized})`)() as unknown;
    return typeof result === "number" && Number.isFinite(result) ? Math.round(result) : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

export function cleanMoney(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function transactionMonthKey(transaction: Transaction): string {
  return (transaction.date || "").slice(0, 7);
}

export function blankYearWith(funds: Fund[]): YearData {
  const year: YearData = {
    income: new Array<number>(12).fill(0),
    funds: {},
    details: {},
    notes: new Array<string>(12).fill(""),
  };
  for (const fund of funds) {
    year.funds[fund.id] = new Array<number>(12).fill(0);
    year.details[fund.id] = new Array<FundDetail>(12).fill(null);
  }
  return year;
}

function defaultFinancialProfile(): FinancialProfile {
  return {
    monthlyIncome: DEFAULT_INCOME,
    monthlyBudgets: {},
    fundPlan: {},
    emergencyFundGoal: 0,
    openingBalances: {},
    debt: { balance: 0, monthlyPayment: 0 },
  };
}

function emptyMarket(): StoredMarketState {
  return {
    fx: null,
    gold: null,
    stocks: {},
    crypto: {},
    cryptoSymbols: {},
    matches: {},
    errors: [],
    updatedAt: null,
  };
}

export function createDefaultStore(): FinanceStore {
  const store: FinanceStore = {
    funds: structuredClone(DEFAULT_FUNDS),
    years: {},
    goals: {},
    prices: {},
    showGoals: false,
    expense: {
      cats: structuredClone(DEFAULT_EXPENSE_CATEGORIES),
      incomeCats: structuredClone(DEFAULT_INCOME_CATEGORIES),
      txns: [],
    },
    market: emptyMarket(),
    onboarding: { status: "completed", version: 1 },
    financialProfile: defaultFinancialProfile(),
  };
  for (const year of [2025, 2026]) store.years[String(year)] = blankYearWith(store.funds);
  ensureFinancialProfile(store);
  return store;
}

function ensureYearData(value: any, funds: Fund[]): YearData {
  const year = value && typeof value === "object" ? value as YearData : blankYearWith(funds);
  if (!Array.isArray(year.notes)) year.notes = new Array<string>(12).fill("");
  if (!Array.isArray(year.income)) year.income = new Array<number>(12).fill(0);
  if (!year.funds || typeof year.funds !== "object") year.funds = {};
  if (!year.details || typeof year.details !== "object") year.details = {};
  while (year.notes.length < 12) year.notes.push("");
  while (year.income.length < 12) year.income.push(0);
  for (const fund of funds) {
    if (!Array.isArray(year.funds[fund.id])) year.funds[fund.id] = new Array<number>(12).fill(0);
    if (!Array.isArray(year.details[fund.id])) year.details[fund.id] = new Array<FundDetail>(12).fill(null);
    while (year.funds[fund.id]!.length < 12) year.funds[fund.id]!.push(0);
    while (year.details[fund.id]!.length < 12) year.details[fund.id]!.push(null);
  }
  return year;
}

function ensureExpense(store: any): void {
  if (!store.expense || typeof store.expense !== "object") store.expense = {};
  if (!Array.isArray(store.expense.cats) || store.expense.cats.length === 0) {
    store.expense.cats = structuredClone(DEFAULT_EXPENSE_CATEGORIES);
  }
  for (const category of store.expense.cats) category.budget = cleanMoney(category.budget);
  if (!Array.isArray(store.expense.txns)) store.expense.txns = [];
  if (!Array.isArray(store.expense.incomeCats) || store.expense.incomeCats.length === 0) {
    store.expense.incomeCats = structuredClone(DEFAULT_INCOME_CATEGORIES);
  }
  const fallback = store.expense.incomeCats.find((category: FinanceCategory) => category.id === "income-other")
    ?? store.expense.incomeCats[0];
  for (const transaction of store.expense.txns as Transaction[]) {
    if (transaction.type === "income" && !store.expense.incomeCats.some((category: FinanceCategory) => category.id === transaction.cat)) {
      transaction.cat = fallback?.id ?? "income-other";
    }
  }
}

function ensureMarket(store: any): void {
  if (!store.market || typeof store.market !== "object") store.market = emptyMarket();
  store.market.fx ??= null;
  store.market.gold ??= null;
  if (!store.market.stocks || typeof store.market.stocks !== "object") store.market.stocks = {};
  if (!store.market.crypto || typeof store.market.crypto !== "object") store.market.crypto = {};
  if (!store.market.cryptoSymbols || typeof store.market.cryptoSymbols !== "object") store.market.cryptoSymbols = {};
  if (!store.market.matches || typeof store.market.matches !== "object") store.market.matches = {};
  if (!Array.isArray(store.market.errors)) store.market.errors = [];
  store.market.updatedAt ??= store.market.lastUpdated ?? null;
  if (!store.market.fx && cleanMoney(store.usdRate) > 0) {
    store.market.fx = { usdVnd: cleanMoney(store.usdRate), source: "Giá cũ", fetchedAt: null, legacy: true };
  }
}

export function ensureFinancialProfile(store: FinanceStore): FinancialProfile {
  const profile = store.financialProfile && typeof store.financialProfile === "object"
    ? store.financialProfile
    : defaultFinancialProfile();
  profile.monthlyIncome = cleanMoney(profile.monthlyIncome) || DEFAULT_INCOME;
  profile.monthlyBudgets ||= {};
  profile.fundPlan ||= {};
  profile.openingBalances ||= {};
  profile.debt ||= { balance: 0, monthlyPayment: 0 };
  profile.emergencyFundGoal = cleanMoney(profile.emergencyFundGoal);
  profile.debt.balance = cleanMoney(profile.debt.balance);
  profile.debt.monthlyPayment = cleanMoney(profile.debt.monthlyPayment);
  for (const fund of store.funds) {
    profile.fundPlan[fund.id] = cleanMoney(profile.fundPlan[fund.id]);
    profile.openingBalances[fund.id] = cleanMoney(profile.openingBalances[fund.id]);
  }
  for (const category of store.expense.cats) {
    profile.monthlyBudgets[category.id] = cleanMoney(profile.monthlyBudgets[category.id] ?? category.budget);
  }
  store.financialProfile = profile;
  if (!store.onboarding || !["pending", "completed", "skipped"].includes(store.onboarding.status)) {
    store.onboarding = { status: "completed", version: 1 };
  }
  return profile;
}

function migrateAssetDetails(store: FinanceStore): boolean {
  let changed = false;
  for (const fund of store.funds) {
    const category = fundCategory(fund);
    if (category === "saving") continue;
    for (const data of Object.values(store.years)) {
      const details = data.details[fund.id] ?? [];
      for (let month = 0; month < details.length; month += 1) {
        const detail = details[month] as any;
        if (!detail || typeof detail !== "object") continue;
        if (category === "gold" && detail.type === "gold" && !Array.isArray(detail.lots)) {
          const legacyPrice = Number(detail.price) || 0;
          const legacyChi = Number(detail.chi) || 0;
          details[month] = {
            type: "gold",
            lots: legacyChi > 0 || legacyPrice > 0 ? [{ chi: legacyChi, manualPrice: legacyPrice || null }] : [],
          };
          changed = true;
          continue;
        }
        if ((category === "stock" || category === "crypto") && detail.type === "hold" && Array.isArray(detail.lots)) {
          for (const lot of detail.lots as any[]) {
            if (lot && typeof lot === "object" && lot.manualPrice === undefined && lot.cur !== undefined) {
              lot.manualPrice = lot.cur;
              delete lot.cur;
              changed = true;
            }
          }
        }
      }
    }
  }
  return changed;
}

function migrateLegacy(raw: any): FinanceStore {
  const store = createDefaultStore();
  store.years = {};
  store.onboarding = raw && Object.keys(raw).length === 0
    ? { status: "pending", version: 1 }
    : raw?.onboarding ?? { status: "completed", version: 1 };
  if (raw?.financialProfile) store.financialProfile = raw.financialProfile;
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!/^\d{4}$/.test(key)) continue;
    const legacy = value as any;
    store.years[key] = ensureYearData({ income: legacy.income, funds: legacy.funds }, store.funds);
  }
  if (Object.keys(store.years).length === 0) {
    for (const year of [2025, 2026]) store.years[String(year)] = blankYearWith(store.funds);
  }
  return store;
}

function migrateFixedIncome(store: FinanceStore): boolean {
  if ((store.incomeMigrationVersion ?? 0) >= 1) return false;
  const salary = store.expense.incomeCats.find((category) => category.id === "salary") ?? store.expense.incomeCats[0];
  for (const [year, yearData] of Object.entries(store.years)) {
    for (let month = 0; month < 12; month += 1) {
      const key = monthKey(Number(year), month);
      if (key >= INCOME_RESET_FROM) continue;
      const amount = cleanMoney(yearData.income[month]);
      if (amount <= 0) continue;
      const id = `legacy-salary-${year}-${String(month + 1).padStart(2, "0")}`;
      if (!store.expense.txns.some((transaction) => transaction.id === id)) {
        store.expense.txns.push({
          id,
          date: `${key}-01`,
          type: "income",
          cat: salary?.id ?? "salary",
          amount,
          note: "Lương (đã chuyển từ thu nhập cố định)",
        });
      }
    }
    yearData.income = new Array<number>(12).fill(0);
  }
  store.incomeMigrationVersion = 1;
  return true;
}

function resetFutureLegacySalary(store: FinanceStore): boolean {
  if ((store.futureIncomeResetVersion ?? 0) >= 1) return false;
  store.expense.txns = store.expense.txns.filter((transaction) =>
    !(transaction.id.startsWith("legacy-salary-") && transaction.date.slice(0, 7) >= INCOME_RESET_FROM));
  for (const [year, yearData] of Object.entries(store.years)) {
    for (let month = 0; month < 12; month += 1) {
      if (monthKey(Number(year), month) >= INCOME_RESET_FROM) yearData.income[month] = 0;
    }
  }
  store.futureIncomeResetVersion = 1;
  return true;
}

export function normalizeStore(payload: StoredFinancePayload): { store: FinanceStore; needsSave: boolean } {
  const raw = structuredClone(payload) as any;
  const store = raw?.years ? raw as FinanceStore : migrateLegacy(raw ?? {});
  if (!store.years || Object.keys(store.years).length === 0) throw new Error("Dữ liệu không có năm hợp lệ.");
  if (!Array.isArray(store.funds) || store.funds.length === 0) store.funds = structuredClone(DEFAULT_FUNDS);
  const defaults = Object.fromEntries(DEFAULT_FUNDS.map((fund) => [fund.id, fund.cat]));
  for (const fund of store.funds) {
    if (!(fund.cat in FUND_CATEGORIES)) fund.cat = defaults[fund.id] ?? "saving";
  }
  for (const [year, value] of Object.entries(store.years)) store.years[year] = ensureYearData(value, store.funds);
  store.goals ||= {};
  store.prices ||= {};
  store.showGoals = Boolean(store.showGoals);
  ensureExpense(store);
  ensureMarket(store);
  ensureFinancialProfile(store);
  const needsSave = migrateAssetDetails(store) || migrateFixedIncome(store) || resetFutureLegacySalary(store);
  return { store, needsSave };
}

export function years(store: FinanceStore): number[] {
  return Object.keys(store.years).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
}

export function ensureYear(store: FinanceStore, year: number): boolean {
  const key = String(year);
  if (store.years[key]) return false;
  store.years[key] = blankYearWith(store.funds);
  if (store.onboarding.status === "completed") {
    for (let month = 0; month < 12; month += 1) {
      for (const fund of store.funds) {
        store.years[key].funds[fund.id]![month] = store.financialProfile.fundPlan[fund.id] ?? 0;
      }
    }
  }
  return true;
}

export function getGoal(store: FinanceStore, fundId: string): FundGoal {
  const existing = store.goals[fundId] as any;
  if (!existing || typeof existing !== "object") {
    store.goals[fundId] = { years: {}, all: 0 };
  } else if (!existing.years) {
    store.goals[fundId] = {
      years: existing.year > 0 ? { "2026": existing.year } : {},
      all: cleanMoney(existing.all),
    };
  }
  return store.goals[fundId]!;
}

export function fundCategory(fund: Fund): FundCategory {
  return fund.cat in FUND_CATEGORIES ? fund.cat : "saving";
}

export function categoriesForType(store: FinanceStore, type: TransactionType): FinanceCategory[] {
  return type === "income" ? store.expense.incomeCats : store.expense.cats;
}

export function categoryForTransaction(store: FinanceStore, transaction: Pick<Transaction, "type" | "cat">): FinanceCategory | undefined {
  return categoriesForType(store, transaction.type).find((category) => category.id === transaction.cat);
}

export function monthTransactions(store: FinanceStore, year: number, month: number): Transaction[] {
  const key = monthKey(year, month);
  return store.expense.txns.filter((transaction) => transactionMonthKey(transaction) === key);
}

export function totalIncomeForMonth(store: FinanceStore, year: number, month: number): number {
  return monthTransactions(store, year, month)
    .filter((transaction) => transaction.type === "income")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

export function totalFundsForMonth(store: FinanceStore, year: number, month: number): number {
  const data = store.years[String(year)];
  if (!data) return 0;
  return store.funds.reduce((sum, fund) => sum + (data.funds[fund.id]?.[month] ?? 0), 0);
}

export function yearToDateFund(store: FinanceStore, year: number, fundId: string): number {
  return (store.years[String(year)]?.funds[fundId] ?? []).reduce((sum, value) => sum + (value || 0), 0);
}

export function allTimeFund(store: FinanceStore, fundId: string): number {
  return years(store).reduce((sum, year) => sum + yearToDateFund(store, year, fundId), 0);
}

export function slugId(name: string): string {
  const slug = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || `muc-${Date.now().toString(36)}`;
}

export function reorderById<T extends { id: string }>(items: T[], id: string, targetId: string): void {
  const sourceIndex = items.findIndex((item) => item.id === id);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
  const [item] = items.splice(sourceIndex, 1);
  if (item) items.splice(targetIndex, 0, item);
}

function legacyLotPrice(store: FinanceStore, lot: HoldingLot, category: FundCategory): number {
  const shared = store.prices[lot.ticker.trim().toUpperCase()];
  const unit = lot.manualPrice !== null && lot.manualPrice !== undefined && lot.manualPrice !== 0 ? lot.manualPrice : shared;
  const price = Number(unit) || 0;
  if (category === "crypto") return price * (store.market.fx?.usdVnd ?? store.usdRate ?? 0);
  return price;
}

export function goldLotPriceVnd(store: FinanceStore, lot: GoldLot): number {
  return store.market.gold?.vndPerChi || Number(lot.manualPrice) || 0;
}

export function holdingCostVnd(lot: HoldingLot, category: "stock" | "crypto"): number {
  const quantity = Number(lot.qty) || 0;
  const purchasePrice = Number(lot.purchasePrice) || 0;
  const unit = category === "crypto" ? purchasePrice * (Number(lot.purchaseFxVnd) || 0) : purchasePrice;
  return quantity * unit + (Number(lot.feeVnd) || 0);
}

export function goldLotCostVnd(lot: GoldLot): number {
  return (Number(lot.chi) || 0) * (Number(lot.purchasePrice) || 0) + (Number(lot.feeVnd) || 0);
}

export function stockQuote(store: FinanceStore, lot: HoldingLot): StockQuote | undefined {
  const symbol = lot.ticker.trim().toUpperCase();
  if (lot.exchange && store.market.stocks[`${lot.exchange}:${symbol}`]) return store.market.stocks[`${lot.exchange}:${symbol}`];
  return Object.values(store.market.stocks).find((quote) => quote.symbol === symbol);
}

export function cryptoQuote(store: FinanceStore, lot: HoldingLot): CryptoQuote | undefined {
  if (lot.providerId && store.market.crypto[lot.providerId]) return store.market.crypto[lot.providerId];
  const providerId = store.market.cryptoSymbols[lot.ticker.trim().toUpperCase()];
  return providerId ? store.market.crypto[providerId] : undefined;
}

export function currentLotPriceVnd(store: FinanceStore, lot: HoldingLot, category: FundCategory): number {
  if (category === "stock") return stockQuote(store, lot)?.priceVnd ?? legacyLotPrice(store, lot, category);
  const quote = cryptoQuote(store, lot);
  if (quote && (store.market.fx?.usdVnd ?? 0) > 0) return quote.priceUsd * store.market.fx!.usdVnd;
  return legacyLotPrice(store, lot, category);
}

export function collectMarketAssets(store: FinanceStore): MarketAssetRequest[] {
  const result: MarketAssetRequest[] = [];
  const seen = new Set<string>();
  const add = (asset: MarketAssetRequest): void => {
    const key = JSON.stringify(asset);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(asset);
    }
  };
  for (const fund of store.funds) {
    const category = fundCategory(fund);
    if (category === "gold") add({ type: "gold" });
    if (category !== "stock" && category !== "crypto") continue;
    for (const year of years(store)) {
      for (const detail of store.years[String(year)]?.details[fund.id] ?? []) {
        if (detail?.type !== "hold") continue;
        for (const lot of detail.lots) {
          const symbol = lot.ticker.trim().toUpperCase();
          if (!symbol) continue;
          if (category === "stock") {
            add({ type: "stock", symbol, ...(lot.exchange ? { exchange: lot.exchange } : {}) });
          } else {
            add({ type: "crypto", symbol, ...(lot.providerId ? { providerId: lot.providerId } : {}) });
          }
        }
      }
    }
  }
  return result;
}

export function mergeMarketResponse(store: FinanceStore, response: MarketQuotesResponse): void {
  if (response.fx) store.market.fx = response.fx;
  if (response.gold) store.market.gold = response.gold;
  for (const quote of response.stocks) store.market.stocks[`${quote.exchange}:${quote.symbol}`] = quote;
  for (const quote of response.crypto) {
    store.market.crypto[quote.providerId] = quote;
    store.market.cryptoSymbols[quote.symbol] = quote.providerId;
  }
  Object.assign(store.market.matches, response.matches);
  store.market.errors = response.errors;
  store.market.updatedAt = response.fetchedAt;

  for (const fund of store.funds) {
    const category = fundCategory(fund);
    if (category !== "stock" && category !== "crypto") continue;
    for (const year of years(store)) {
      for (const detail of store.years[String(year)]?.details[fund.id] ?? []) {
        if (detail?.type !== "hold") continue;
        for (const lot of detail.lots) {
          if (category === "stock") {
            const quote = stockQuote(store, lot);
            if (quote) lot.exchange = quote.exchange;
          } else {
            const quote = cryptoQuote(store, lot);
            if (quote) lot.providerId = quote.providerId;
          }
        }
      }
    }
  }
}

export function recalculateMarketFunds(store: FinanceStore): void {
  for (const fund of store.funds) {
    const category = fundCategory(fund);
    if (category === "saving") continue;
    for (const year of years(store)) {
      const data = store.years[String(year)]!;
      for (let month = 0; month < 12; month += 1) {
        const detail = data.details[fund.id]?.[month];
        if (!detail) continue;
        if (category === "gold" && detail.type === "gold") {
          const value = detail.lots.reduce((sum, lot) => sum + lot.chi * goldLotPriceVnd(store, lot), 0);
          if (value > 0) data.funds[fund.id]![month] = Math.round(value);
        } else if ((category === "stock" || category === "crypto") && detail.type === "hold") {
          let value = 0;
          let complete = true;
          let hasQuantity = false;
          for (const lot of detail.lots) {
            if (!(lot.qty > 0)) continue;
            hasQuantity = true;
            const price = currentLotPriceVnd(store, lot, category);
            if (!(price > 0)) complete = false;
            else value += lot.qty * price;
          }
          if (hasQuantity && complete) data.funds[fund.id]![month] = Math.round(value);
        }
      }
    }
  }
}

export function downloadBackup(store: FinanceStore): { filename: string; content: string } {
  return {
    filename: `quy-tai-chinh-${new Date().toISOString().slice(0, 10)}.json`,
    content: JSON.stringify(store, null, 2),
  };
}
