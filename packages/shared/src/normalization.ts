import type {
  Account,
  AccountType,
  Debt,
  FinanceCategory,
  FinanceStore,
  FinancialProfile,
  Fund,
  FundDetail,
  StoredFinancePayload,
  StoredMarketState,
  Transaction,
  YearData,
} from "./index.js";
import { legacyGoldCostBasis } from "./gold.js";

export const DEFAULT_INCOME = 22_500_000;
export const INCOME_RESET_FROM = "2026-08";

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

export const DEFAULT_ACCOUNT_TYPES: AccountType[] = [
  { id: "bank", name: "Ngân hàng" },
  { id: "cash", name: "Tiền mặt" },
  { id: "credit-card", name: "Thẻ tín dụng" },
];

export const DEFAULT_ACCOUNTS: Account[] = [
  { id: "cash", name: "Tiền mặt", typeId: "cash" },
];

export function cleanMoney(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
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
      accountTypes: structuredClone(DEFAULT_ACCOUNT_TYPES),
      accounts: structuredClone(DEFAULT_ACCOUNTS),
      txns: [],
    },
    market: emptyMarket(),
    onboarding: { status: "completed", version: 1 },
    financialProfile: defaultFinancialProfile(),
    debts: [],
    incomeMigrationVersion: 1,
    futureIncomeResetVersion: 1,
  };
  for (const year of [2025, 2026]) store.years[String(year)] = blankYearWith(store.funds);
  ensureFinancialProfile(store);
  return store;
}

function ensureDebts(store: FinanceStore): boolean {
  let changed = false;
  if (!Array.isArray(store.debts)) {
    store.debts = [];
    changed = true;
  }
  for (const [index, debt] of (store.debts as Debt[]).entries()) {
    if (!debt.id) {
      debt.id = `debt-${index + 1}`;
      changed = true;
    }
    if (!["borrowed", "lent", "credit_card", "installment"].includes(debt.kind)) {
      debt.kind = "borrowed";
      changed = true;
    }
    debt.name = String(debt.name || "Khoản vay");
    debt.counterparty = String(debt.counterparty || "");
    debt.principal = cleanMoney(debt.principal);
    debt.annualInterestRate = Math.max(0, Number(debt.annualInterestRate) || 0);
    debt.termMonths = Math.max(0, Math.floor(Number(debt.termMonths) || 0));
    debt.paymentAmount = cleanMoney(debt.paymentAmount);
    if (debt.firstPaymentDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(debt.firstPaymentDate)) {
      delete debt.firstPaymentDate;
      changed = true;
    }
    debt.note = String(debt.note || "");
    debt.status = debt.status === "settled" ? "settled" : "active";
    if (!Array.isArray(debt.payments)) {
      debt.payments = [];
      changed = true;
    }
    debt.payments = debt.payments.map((payment: any, index) => ({
      id: String(payment?.id || `${debt.id}-payment-${index + 1}`),
      installment: Math.max(1, Math.floor(Number(payment?.installment) || index + 1)),
      paidAt: /^\d{4}-\d{2}-\d{2}$/.test(payment?.paidAt) ? payment.paidAt : "",
      amount: cleanMoney(payment?.amount),
      principalAmount: cleanMoney(payment?.principalAmount),
      interestAmount: cleanMoney(payment?.interestAmount),
      ...(typeof payment?.transactionId === "string" && payment.transactionId ? { transactionId: payment.transactionId } : {}),
      note: String(payment?.note || ""),
    })).filter((payment) => payment.paidAt && payment.amount > 0);
  }
  const legacy = store.financialProfile.debt;
  if (store.debts.length === 0 && legacy.balance > 0) {
    store.debts.push({
      id: "legacy-debt",
      kind: "borrowed",
      name: "Dư nợ cũ",
      counterparty: "",
      principal: legacy.balance,
      annualInterestRate: 0,
      termMonths: 0,
      paymentAmount: legacy.monthlyPayment,
      note: "Cần bổ sung kỳ hạn và ngày thanh toán.",
      status: "active",
      payments: [],
    });
    store.financialProfile.debt = { balance: 0, monthlyPayment: 0 };
    changed = true;
  }
  return changed;
}

function ensureYearData(value: any, funds: Fund[]): YearData {
  const year = value && typeof value === "object" ? value as YearData : blankYearWith(funds);
  if (!Array.isArray(year.notes)) year.notes = new Array<string>(12).fill("");
  if (!Array.isArray(year.income)) year.income = new Array<number>(12).fill(0);
  if (!year.funds || typeof year.funds !== "object") year.funds = {};
  if (!year.details || typeof year.details !== "object") year.details = {};
  while (year.notes.length < 12) year.notes.push("");
  while (year.income.length < 12) year.income.push(0);
  year.notes = year.notes.slice(0, 12).map((note) => String(note ?? ""));
  year.income = year.income.slice(0, 12).map(cleanMoney);
  for (const fund of funds) {
    if (!Array.isArray(year.funds[fund.id])) year.funds[fund.id] = new Array<number>(12).fill(0);
    if (!Array.isArray(year.details[fund.id])) year.details[fund.id] = new Array<FundDetail>(12).fill(null);
    while (year.funds[fund.id]!.length < 12) year.funds[fund.id]!.push(0);
    while (year.details[fund.id]!.length < 12) year.details[fund.id]!.push(null);
    year.funds[fund.id] = year.funds[fund.id]!.slice(0, 12).map(cleanMoney);
    year.details[fund.id] = year.details[fund.id]!.slice(0, 12);
  }
  return year;
}

function ensureExpense(store: any): boolean {
  let changed = false;
  if (!store.expense || typeof store.expense !== "object") store.expense = {};
  if (!Array.isArray(store.expense.cats) || store.expense.cats.length === 0) {
    store.expense.cats = structuredClone(DEFAULT_EXPENSE_CATEGORIES);
    changed = true;
  }
  for (const category of store.expense.cats) category.budget = cleanMoney(category.budget);
  if (!Array.isArray(store.expense.txns)) store.expense.txns = [];
  if (!Array.isArray(store.expense.incomeCats) || store.expense.incomeCats.length === 0) {
    store.expense.incomeCats = structuredClone(DEFAULT_INCOME_CATEGORIES);
    changed = true;
  }
  if (!Array.isArray(store.expense.accountTypes)) {
    store.expense.accountTypes = structuredClone(DEFAULT_ACCOUNT_TYPES);
    changed = true;
  }
  if (!Array.isArray(store.expense.accounts)) {
    store.expense.accounts = structuredClone(DEFAULT_ACCOUNTS);
    changed = true;
  }
  const fallback = store.expense.incomeCats.find((category: FinanceCategory) => category.id === "income-other")
    ?? store.expense.incomeCats[0];
  for (const transaction of store.expense.txns as Transaction[]) {
    transaction.amount = cleanMoney(transaction.amount);
    transaction.note = String(transaction.note ?? "");
    if (transaction.type === "income" && !store.expense.incomeCats.some((category: FinanceCategory) => category.id === transaction.cat)) {
      transaction.cat = fallback?.id ?? "income-other";
    }
  }
  return changed;
}

function legacyMarket(raw: any): StoredMarketState {
  const market = raw?.market && typeof raw.market === "object" ? raw.market : {};
  const result = emptyMarket() as any;
  result.fx = market.fx ?? raw?.fx ?? null;
  result.gold = market.gold ?? raw?.gold ?? null;
  result.stocks = { ...(raw?.stocks ?? {}), ...(market.stocks ?? {}) };
  result.crypto = { ...(raw?.crypto ?? {}), ...(market.crypto ?? {}) };
  result.cryptoSymbols = { ...(raw?.cryptoSymbols ?? {}), ...(market.cryptoSymbols ?? {}) };
  result.matches = { ...(raw?.matches ?? {}), ...(market.matches ?? {}) };
  result.errors = Array.isArray(market.errors) ? market.errors : Array.isArray(raw?.errors) ? raw.errors : [];
  result.updatedAt = market.updatedAt ?? market.lastUpdated ?? raw?.lastUpdated ?? null;
  if (!result.fx && cleanMoney(raw?.usdRate) > 0) {
    result.fx = { usdVnd: cleanMoney(raw.usdRate), source: "Giá cũ", fetchedAt: null, legacy: true };
  }
  return result;
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
    for (const data of Object.values(store.years)) {
      const details = data.details[fund.id] ?? [];
      for (let month = 0; month < details.length; month += 1) {
        const detail = details[month] as any;
        if (!detail || typeof detail !== "object") continue;
        if (fund.cat === "gold" && detail.type === "gold" && !Array.isArray(detail.lots)) {
          const legacyPrice = Number(detail.price) || 0;
          const legacyChi = Number(detail.chi) || 0;
          details[month] = {
            type: "gold",
            lots: legacyChi > 0 || legacyPrice > 0 ? [{ chi: legacyChi, manualPrice: legacyPrice || null }] : [],
          };
          changed = true;
        } else if ((fund.cat === "stock" || fund.cat === "crypto") && detail.type === "hold" && Array.isArray(detail.lots)) {
          for (const lot of detail.lots as any[]) {
            if (lot && typeof lot === "object" && lot.manualPrice === undefined && lot.cur !== undefined) {
              lot.manualPrice = lot.cur;
              delete lot.cur;
              changed = true;
            }
            lot.manualPrice ??= null;
            lot.purchasePrice ??= null;
            lot.purchaseFxVnd ??= null;
            lot.feeVnd ??= null;
          }
        } else if (fund.cat === "gold" && detail.type === "gold" && Array.isArray(detail.lots)) {
          for (const lot of detail.lots as any[]) {
            lot.manualPrice ??= null;
            if (lot.costBasis === undefined) {
              lot.costBasis = legacyGoldCostBasis(lot.chi, lot.purchasePrice, lot.feeVnd);
              changed = true;
            }
            if ("purchasePrice" in lot) {
              delete lot.purchasePrice;
              changed = true;
            }
            if ("feeVnd" in lot) {
              delete lot.feeVnd;
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
  store.incomeMigrationVersion = Number(raw?.incomeMigrationVersion) || 0;
  store.futureIncomeResetVersion = Number(raw?.futureIncomeResetVersion) || 0;
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
  if (!Array.isArray(store.funds)) store.funds = structuredClone(DEFAULT_FUNDS);
  const defaults = Object.fromEntries(DEFAULT_FUNDS.map((fund) => [fund.id, fund.cat]));
  for (const fund of store.funds) {
    if (!["saving", "stock", "gold", "crypto"].includes(fund.cat)) fund.cat = defaults[fund.id] ?? "saving";
  }
  for (const [year, value] of Object.entries(store.years)) store.years[year] = ensureYearData(value, store.funds);
  store.goals ||= {};
  store.prices ||= {};
  store.showGoals = Boolean(store.showGoals);
  store.market = legacyMarket(raw);
  const expenseMigration = ensureExpense(store);
  ensureFinancialProfile(store);
  const debtMigration = ensureDebts(store);
  const assetMigration = migrateAssetDetails(store);
  const incomeMigration = migrateFixedIncome(store);
  const futureIncomeMigration = resetFutureLegacySalary(store);
  const canonical: FinanceStore = {
    funds: structuredClone(store.funds),
    years: structuredClone(store.years),
    goals: structuredClone(store.goals),
    prices: structuredClone(store.prices),
    showGoals: store.showGoals,
    expense: structuredClone(store.expense),
    market: structuredClone(store.market),
    onboarding: structuredClone(store.onboarding),
    financialProfile: structuredClone(store.financialProfile),
    debts: structuredClone(store.debts),
    ...(store.incomeMigrationVersion !== undefined ? { incomeMigrationVersion: store.incomeMigrationVersion } : {}),
    ...(store.futureIncomeResetVersion !== undefined ? { futureIncomeResetVersion: store.futureIncomeResetVersion } : {}),
    ...(store.usdRate !== undefined ? { usdRate: store.usdRate } : {}),
  };
  return {
    store: canonical,
    needsSave: expenseMigration || debtMigration || assetMigration || incomeMigration || futureIncomeMigration || raw.market !== store.market,
  };
}
