export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface UserProfile {
  sub: string;
  email: string;
  name: string;
  picture: string;
}

export interface ApiError {
  error: string;
  message: string;
}

export interface AuthMeResponse {
  user: UserProfile;
}

export type FundCategory = "saving" | "stock" | "gold" | "crypto";

export interface Fund {
  id: string;
  name: string;
  color: string;
  cat: FundCategory;
}

export interface HoldingLot {
  ticker: string;
  qty: number;
  /** Giá thị trường thủ công dự phòng: VND với cổ phiếu, USD với crypto. */
  manualPrice?: number | null;
  /** Giá mua theo đơn vị tài sản: VND với cổ phiếu, USD với crypto. */
  purchasePrice?: number | null;
  /** Tỷ giá USD/VND khi mua, chỉ dùng cho crypto. */
  purchaseFxVnd?: number | null;
  /** Phí giao dịch quy đổi VND. */
  feeVnd?: number | null;
  purchasedAt?: string;
  note?: string;
  exchange?: string;
  providerId?: string;
}

export interface HoldingDetail {
  type: "hold";
  lots: HoldingLot[];
}

export interface GoldDetail {
  type: "gold";
  lots: GoldLot[];
}

export interface GoldLot {
  chi: number;
  /** Giá thị trường thủ công dự phòng, VND/chỉ. */
  manualPrice?: number | null;
  /** Giá mua, VND/chỉ. */
  purchasePrice?: number | null;
  feeVnd?: number | null;
  purchasedAt?: string;
  note?: string;
}

export type FundDetail = HoldingDetail | GoldDetail | null;

export interface YearData {
  income: number[];
  funds: Record<string, number[]>;
  details: Record<string, FundDetail[]>;
  notes: string[];
}

export interface FundGoal {
  years: Record<string, number>;
  all: number;
}

export type TransactionType = "income" | "expense";

export interface FinanceCategory {
  id: string;
  name: string;
  color: string;
  budget?: number;
}

export interface Transaction {
  id: string;
  date: string;
  type: TransactionType;
  cat: string;
  amount: number;
  note: string;
}

export interface ExpenseLedger {
  cats: FinanceCategory[];
  incomeCats: FinanceCategory[];
  txns: Transaction[];
}

export interface FinancialProfile {
  monthlyIncome: number;
  monthlyBudgets: Record<string, number>;
  fundPlan: Record<string, number>;
  emergencyFundGoal: number;
  openingBalances: Record<string, number>;
  debt: {
    balance: number;
    monthlyPayment: number;
  };
}

export interface OnboardingState {
  status: "pending" | "completed" | "skipped";
  version: number;
}

export interface FxQuote {
  usdVnd: number;
  source: string;
  sourceUrl?: string;
  fetchedAt: string | null;
  legacy?: boolean;
}

export interface GoldQuote {
  symbol: "XAU";
  xauUsdPerTroyOunce: number;
  vndPerChi: number;
  source: string;
  sourceUrl?: string;
  fetchedAt: string;
}

export interface StockQuote {
  symbol: string;
  exchange: string;
  priceVnd: number;
  source: string;
  sourceUrl?: string;
  fetchedAt: string;
}

export interface CryptoQuote {
  symbol: string;
  providerId: string;
  name: string;
  priceUsd: number;
  source: string;
  sourceUrl?: string;
  fetchedAt: string;
}

export interface CryptoMatch {
  id: string;
  symbol: string;
  name: string;
  rank?: number;
}

export interface StoredMarketState {
  fx: FxQuote | null;
  gold: GoldQuote | null;
  stocks: Record<string, StockQuote>;
  crypto: Record<string, CryptoQuote>;
  cryptoSymbols: Record<string, string>;
  matches: Record<string, CryptoMatch[]>;
  errors: MarketQuoteError[];
  updatedAt: string | null;
}

export interface FinanceStore {
  funds: Fund[];
  years: Record<string, YearData>;
  goals: Record<string, FundGoal>;
  prices: Record<string, number>;
  showGoals: boolean;
  expense: ExpenseLedger;
  market: StoredMarketState;
  onboarding: OnboardingState;
  financialProfile: FinancialProfile;
  incomeMigrationVersion?: number;
  futureIncomeResetVersion?: number;
  usdRate?: number;
}

export type StoredFinancePayload = Record<string, unknown>;

export interface MarketAssetRequest {
  type: "gold" | "stock" | "crypto";
  symbol?: string;
  exchange?: string;
  providerId?: string;
}

export interface MarketQuotesRequest {
  assets: MarketAssetRequest[];
  force?: boolean;
}

export interface MarketQuoteError {
  key: string;
  code: string;
  message: string;
}

export interface MarketQuotesResponse {
  fetchedAt: string;
  fx: FxQuote | null;
  gold: GoldQuote | null;
  stocks: StockQuote[];
  crypto: CryptoQuote[];
  matches: Record<string, CryptoMatch[]>;
  errors: MarketQuoteError[];
}

export interface UserDatabaseRecord {
  profile: UserProfile;
  data: StoredFinancePayload;
  createdAt: string;
  updatedAt: string;
}

export interface UserDatabase {
  schemaVersion: 3;
  users: Record<string, UserDatabaseRecord>;
}
