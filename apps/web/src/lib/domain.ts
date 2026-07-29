import type {
  CryptoQuote,
  Account,
  AccountType,
  FinanceCategory,
  FinanceStore,
  Fund,
  FundCategory,
  FundGoal,
  SharedFundContent,
  SharedFundView,
  GoldLot,
  HoldingLot,
  MarketAssetRequest,
  MarketQuotesResponse,
  StockQuote,
  Transaction,
  TransactionType,
} from "@chi-tieu/shared";
import {
  blankYearWith,
  cleanMoney,
  createDefaultStore,
  ensureFinancialProfile,
  goldCostBasisVnd,
  monthKey,
  normalizeStore,
} from "@chi-tieu/shared";

export {
  blankYearWith,
  cleanMoney,
  createDefaultStore,
  ensureFinancialProfile,
  monthKey,
  normalizeStore,
};

export const MONTHS = ["Th1", "Th2", "Th3", "Th4", "Th5", "Th6", "Th7", "Th8", "Th9", "Th10", "Th11", "Th12"];
export const MONTHS_FULL = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];
export const FUND_COLORS = ["#3f7d5c", "#3b6ea5", "#c8963e", "#8a5cc4", "#b5533a", "#2f8f83", "#a8632f", "#6b7f2f", "#9c3f6a", "#4a5a8a"];
export const PALETTE = [
  "#E4572E", "#F3A712", "#E6B325", "#8CB369", "#4C9F70", "#2A9D8F",
  "#118AB2", "#3D5A80", "#5E60CE", "#7B2CBF", "#C71F66", "#EF476F",
  "#F15BB5", "#9C6644", "#6D6875", "#1B263B",
];

export type StatisticsScope =
  | { mode: "all" }
  | { mode: "year"; year: number }
  | { mode: "month"; month: string }
  | { mode: "range"; from: string; to: string };

export interface StatisticsMonth {
  year: number;
  month: number;
  key: string;
}

export interface AccountExpenseBreakdown {
  id: string;
  name: string;
  color: string;
  amount: number;
}

export const FUND_CATEGORIES: Record<FundCategory, { label: string; short: string }> = {
  saving: { label: "Tiết kiệm (VND)", short: "Tiết kiệm" },
  gold: { label: "Vàng (chỉ → VND)", short: "Vàng" },
  stock: { label: "Cổ phiếu (mã, số lượng, giá)", short: "Cổ phiếu" },
  crypto: { label: "Crypto (mã, số lượng, giá)", short: "Crypto" },
};

export type MoneyCurrency = "VND" | "USD";

/** Whole-dong display used everywhere VND is shown to the user. */
export const fmtNumber = (value: number): string => Math.round(value || 0).toLocaleString("en-US");
export const fmt = (value: number): string => `${fmtNumber(value)}đ`;

/** Decimal display for foreign-currency unit prices. */
export const fmtUsdNumber = (value: number): string => Number(value || 0).toLocaleString("en-US", {
  maximumFractionDigits: 10,
});

export const formatMoneyInputValue = (value: number, currency: MoneyCurrency): string => {
  if (!(value > 0)) return "";
  return currency === "VND" ? `${fmtNumber(value)}đ` : fmtUsdNumber(value);
};

export const fmtShort = (value: number): string => {
  const number = value || 0;
  if (Math.abs(number) >= 1_000_000) return `${(number / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}tr`;
  if (Math.abs(number) >= 1_000) return `${Math.round(number / 1_000)}k`;
  return String(number);
};

interface FormattedMoneyExpression {
  text: string;
  normalized: string | null;
  hasDecimal: boolean;
}

function stripMoneyAdornment(source: string): string {
  return source.replace(/[₫đ\s]/g, "");
}

function stripLeadingZeroes(value: string): string {
  const trimmed = value.replace(/^0+(?=\d)/, "");
  return trimmed || "0";
}

function groupThousands(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function normalizeMoneyNumber(raw: string, preferGrouping: boolean): { display: string; normalized: string; hasDecimal: boolean } | null {
  let integer = "";
  let fraction = "";
  let hasDecimal = false;

  if (raw.includes(".")) {
    const segments = raw.split(".");
    const beforeDecimal = segments[0] ?? "";
    const afterDecimal = segments[1] ?? "";
    const rest = segments.slice(2);
    const validInteger = /^\d*$/.test(beforeDecimal) || /^\d{1,3}(?:,\d{3})*$/.test(beforeDecimal);
    if (rest.length || !validInteger || !/^\d*$/.test(afterDecimal)) return null;
    integer = beforeDecimal.includes(",") ? beforeDecimal.replaceAll(",", "") : beforeDecimal;
    fraction = afterDecimal;
    hasDecimal = true;
  } else if (raw.includes(",")) {
    const isGrouped = /^\d{1,3}(?:,\d{3})+$/.test(raw);
    const isTrustedGrouping = preferGrouping && /^\d{0,3}(?:,\d*)+$/.test(raw);
    if (isGrouped || isTrustedGrouping) {
      integer = raw.replaceAll(",", "");
    } else {
      const segments = raw.split(",");
      const beforeDecimal = segments[0] ?? "";
      const afterDecimal = segments[1] ?? "";
      const rest = segments.slice(2);
      if (rest.length || !/^\d*$/.test(beforeDecimal) || !/^\d*$/.test(afterDecimal)) return null;
      integer = beforeDecimal;
      fraction = afterDecimal;
      hasDecimal = true;
    }
  } else {
    if (!/^\d+$/.test(raw)) return null;
    integer = raw;
  }

  integer = stripLeadingZeroes(integer || "0");
  return {
    display: `${groupThousands(integer)}${hasDecimal ? `.${fraction}` : ""}`,
    normalized: `${integer}${hasDecimal ? `.${fraction}` : ""}`,
    hasDecimal,
  };
}

function formatMoneyExpression(source: string, currency: MoneyCurrency, preferGrouping = false): FormattedMoneyExpression {
  const body = stripMoneyAdornment(source);
  if (!body) return { text: "", normalized: "", hasDecimal: false };

  const tokenPattern = /(?:\d[\d.,]*|[.,]\d*)/g;
  const tokens = [...body.matchAll(tokenPattern)];
  if (!tokens.length) return { text: source, normalized: null, hasDecimal: false };

  let cursor = 0;
  let display = "";
  let normalized = "";
  let hasDecimal = false;
  for (const token of tokens) {
    const start = token.index ?? 0;
    const operators = body.slice(cursor, start);
    if (!/^[+\-*/()]*$/.test(operators)) return { text: source, normalized: null, hasDecimal: false };
    const number = normalizeMoneyNumber(token[0], preferGrouping);
    if (!number) return { text: source, normalized: null, hasDecimal: false };
    display += operators + number.display;
    normalized += operators + number.normalized;
    hasDecimal ||= number.hasDecimal;
    cursor = start + token[0].length;
  }

  const remainder = body.slice(cursor);
  if (!/^[+\-*/()]*$/.test(remainder)) return { text: source, normalized: null, hasDecimal: false };
  display += remainder;
  normalized += remainder;
  return {
    text: currency === "VND" ? `${display}đ` : display,
    normalized,
    hasDecimal,
  };
}

/**
 * Formats each numeric operand while preserving arithmetic operators. The
 * optional grouping hint is used only for a one-character edit to an already
 * formatted value (for example 1,000 + 2 -> 10,002), where a comma is not a
 * newly typed decimal separator.
 */
export function formatMoneyInputText(source: string, currency: MoneyCurrency, preferGrouping = false): string {
  return formatMoneyExpression(source, currency, preferGrouping).text;
}

export function moneyExpressionHasDecimal(source: string): boolean {
  return formatMoneyExpression(source, "USD").hasDecimal;
}

export function evaluateMoneyExpression(source: string): number {
  const normalized = formatMoneyExpression(source, "USD").normalized;
  if (!normalized || !/^[\d+\-*/().]+$/.test(normalized)) return Number.NaN;
  try {
    const result = Function(`"use strict"; return (${normalized})`)() as unknown;
    return typeof result === "number" && Number.isFinite(result) ? result : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

export function transactionMonthKey(transaction: Transaction): string {
  return (transaction.date || "").slice(0, 7);
}

/** Assemble private ledger data and isolated shared-fund records for the UI only. */
export function mergeSharedFunds(store: FinanceStore, sharedFunds: SharedFundView[]): FinanceStore {
  for (const shared of sharedFunds) {
    const { content } = shared;
    const fund = { ...structuredClone(content.fund), id: shared.id, sharing: {
      sharedFundId: shared.id,
      ownerId: shared.owner.sub,
      ownerName: shared.owner.name || shared.owner.email,
      role: shared.role,
    } };
    if (!store.funds.some((item) => item.id === shared.id)) store.funds.push(fund);
    for (const data of Object.values(store.years)) {
      data.funds[shared.id] ??= new Array(12).fill(0);
      data.details[shared.id] ??= new Array(12).fill(null);
    }
    for (const year of Object.keys(content.years)) ensureYear(store, Number(year));
    for (const [year, values] of Object.entries(content.years)) {
      const target = store.years[year]!;
      target.funds[shared.id] = structuredClone(values.funds);
      target.details[shared.id] = structuredClone(values.details);
    }
    store.goals[shared.id] = structuredClone(content.goal);
    store.financialProfile.fundPlan[shared.id] = content.fundPlan;
    store.financialProfile.openingBalances[shared.id] = content.openingBalance;
  }
  return store;
}

export function sharedFundContent(store: FinanceStore, fundId: string): SharedFundContent {
  const fund = store.funds.find((item) => item.id === fundId);
  if (!fund) throw new Error("Không tìm thấy quỹ chung.");
  const years: SharedFundContent["years"] = {};
  for (const [year, values] of Object.entries(store.years)) {
    years[year] = {
      funds: structuredClone(values.funds[fundId] ?? new Array(12).fill(0)),
      details: structuredClone(values.details[fundId] ?? new Array(12).fill(null)),
    };
  }
  const plainFund = structuredClone(fund);
  delete plainFund.sharing;
  return {
    fund: plainFund,
    years,
    goal: structuredClone(store.goals[fundId] ?? { years: {}, all: 0 }),
    fundPlan: store.financialProfile.fundPlan[fundId] ?? 0,
    openingBalance: store.financialProfile.openingBalances[fundId] ?? 0,
  };
}

/** Remove shared records from a UI ledger before writing the user's private data. */
export function privateLedger(store: FinanceStore): FinanceStore {
  const result = structuredClone(store);
  const sharedIds = result.funds.filter((fund) => fund.sharing).map((fund) => fund.id);
  result.funds = result.funds.filter((fund) => !fund.sharing).map(({ sharing: _sharing, ...fund }) => fund);
  for (const data of Object.values(result.years)) {
    for (const id of sharedIds) {
      delete data.funds[id];
      delete data.details[id];
    }
  }
  for (const id of sharedIds) {
    delete result.goals[id];
    delete result.financialProfile.fundPlan[id];
    delete result.financialProfile.openingBalances[id];
  }
  return result;
}

export function countsInPersonalReports(fund: Fund): boolean {
  return !fund.sharing || fund.sharing.role === "owner";
}

export function years(store: FinanceStore): number[] {
  return Object.keys(store.years).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
}

export function statisticsAvailableYears(store: FinanceStore): number[] {
  const result = new Set(years(store));
  for (const transaction of store.expense.txns) {
    const year = Number(transaction.date.slice(0, 4));
    if (Number.isInteger(year) && year > 0) result.add(year);
  }
  return [...result].sort((a, b) => a - b);
}

export function statisticsMonths(store: FinanceStore, scope: StatisticsScope): StatisticsMonth[] {
  if (scope.mode === "month") {
    const parsed = parseStatisticsMonth(scope.month);
    return parsed ? [parsed] : [];
  }
  if (scope.mode === "range") {
    const from = parseStatisticsMonth(scope.from);
    const to = parseStatisticsMonth(scope.to);
    if (!from || !to || from.key > to.key) return [];
    return monthsBetween(from, to);
  }
  const selectedYears = scope.mode === "year" ? [scope.year] : statisticsAvailableYears(store);
  return selectedYears.flatMap((year) => Array.from({ length: 12 }, (_, month) => ({ year, month, key: monthKey(year, month) })));
}

export function statisticsScopeLabel(scope: StatisticsScope): string {
  if (scope.mode === "all") return "Toàn bộ các năm";
  if (scope.mode === "year") return `Năm ${scope.year}`;
  const from = parseStatisticsMonth(scope.mode === "month" ? scope.month : scope.from);
  const to = parseStatisticsMonth(scope.mode === "range" ? scope.to : scope.month);
  if (!from || !to) return "Khoảng thời gian không hợp lệ";
  const fromLabel = `${MONTHS_FULL[from.month]} / ${from.year}`;
  if (from.key === to.key) return fromLabel;
  return `Từ ${fromLabel} đến ${MONTHS_FULL[to.month]} / ${to.year}`;
}

export function savingRate(income: number, funds: number): number | null {
  return income > 0 ? funds / income : null;
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

export function accountForTransaction(store: FinanceStore, transaction: Pick<Transaction, "accountId">): Account | undefined {
  return store.expense.accounts.find((account) => account.id === transaction.accountId);
}

export function expenseByAccount(store: FinanceStore, transactions: Transaction[]): AccountExpenseBreakdown[] {
  const amounts = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type !== "expense") continue;
    const id = transaction.accountId
      ? accountForTransaction(store, transaction) ? `account:${transaction.accountId}` : "deleted"
      : "unassigned";
    amounts.set(id, (amounts.get(id) ?? 0) + transaction.amount);
  }
  return [...amounts].map(([id, amount], index) => {
    const accountId = id.startsWith("account:") ? id.slice("account:".length) : "";
    const account = accountId ? store.expense.accounts.find((item) => item.id === accountId) : undefined;
    return {
      id,
      name: account?.name ?? (id === "unassigned" ? "Chưa xác định" : "(đã xóa)"),
      color: PALETTE[index % PALETTE.length]!,
      amount,
    };
  }).sort((a, b) => b.amount - a.amount);
}

export function accountTypeForAccount(store: FinanceStore, account: Pick<Account, "typeId">): AccountType | undefined {
  return store.expense.accountTypes.find((type) => type.id === account.typeId);
}

export function monthTransactions(store: FinanceStore, year: number, month: number): Transaction[] {
  const key = monthKey(year, month);
  return store.expense.txns.filter((transaction) => transactionMonthKey(transaction) === key);
}

function parseStatisticsMonth(value: string): StatisticsMonth | null {
  const match = /^(\d{4,})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  return Number.isInteger(year) && year > 0 ? { year, month, key: value } : null;
}

function monthsBetween(from: StatisticsMonth, to: StatisticsMonth): StatisticsMonth[] {
  const result: StatisticsMonth[] = [];
  for (let year = from.year, month = from.month; year < to.year || (year === to.year && month <= to.month);) {
    result.push({ year, month, key: monthKey(year, month) });
    month += 1;
    if (month === 12) {
      year += 1;
      month = 0;
    }
  }
  return result;
}

export function totalIncomeForMonth(store: FinanceStore, year: number, month: number): number {
  return monthTransactions(store, year, month)
    .filter((transaction) => transaction.type === "income")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

export function totalFundsForMonth(store: FinanceStore, year: number, month: number, includeFund: (fund: Fund) => boolean = () => true): number {
  const data = store.years[String(year)];
  if (!data) return 0;
  return store.funds.filter(includeFund).reduce((sum, fund) => sum + (data.funds[fund.id]?.[month] ?? 0), 0);
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
  return goldCostBasisVnd(lot);
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
