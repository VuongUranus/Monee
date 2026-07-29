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
  /** Metadata only present in the assembled client workspace. */
  sharing?: FundSharing;
}

export type SharedFundRole = "viewer" | "editor";

export interface FundSharing {
  sharedFundId: string;
  ownerId: string;
  ownerName: string;
  role: "owner" | SharedFundRole;
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

export type GoldCostBasis =
  | { type: "unit_price"; vndPerChi: number }
  | { type: "total_paid"; totalVnd: number }
  | { type: "historical"; vndPerChi: number; quoteDate: string; source: string };

export interface GoldLot {
  chi: number;
  /** Giá thị trường thủ công dự phòng, VND/chỉ. */
  manualPrice?: number | null;
  /** Cách tính vốn của giao dịch vàng. */
  costBasis?: GoldCostBasis | null;
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

export interface AccountType {
  id: string;
  name: string;
}

export interface Account {
  id: string;
  name: string;
  /** Undefined when its former type was deleted. */
  typeId?: string;
}

export interface Transaction {
  id: string;
  date: string;
  type: TransactionType;
  cat: string;
  /** Optional so historical entries remain valid without an assigned account. */
  accountId?: string;
  amount: number;
  note: string;
}

export type DebtKind = "borrowed" | "lent" | "credit_card" | "installment";
export type DebtStatus = "active" | "settled";

/** A payment is always an installment in the debt's fixed monthly schedule. */
export interface DebtPayment {
  id: string;
  installment: number;
  paidAt: string;
  amount: number;
  principalAmount: number;
  interestAmount: number;
  /** Automatically generated income/expense transaction, when configured. */
  transactionId?: string;
  note: string;
}

/**
 * `termMonths = 0` and no `firstPaymentDate` identify a legacy balance that
 * needs its schedule completed by the user before payments can be recorded.
 */
export interface Debt {
  id: string;
  kind: DebtKind;
  name: string;
  counterparty: string;
  principal: number;
  annualInterestRate: number;
  termMonths: number;
  paymentAmount: number;
  firstPaymentDate?: string;
  paymentCategoryId?: string;
  paymentAccountId?: string;
  note: string;
  status: DebtStatus;
  payments: DebtPayment[];
}

export interface DebtScheduleItem {
  installment: number;
  dueDate: string;
  amount: number;
  principalAmount: number;
  interestAmount: number;
  payment?: DebtPayment;
}

export interface DebtSummary {
  liabilities: number;
  receivables: number;
  netDebt: number;
  overdueCount: number;
  dueSoonCount: number;
}

export interface DebtOverviewItem extends Omit<Debt, "payments"> {
  remainingBalance: number;
  expectedInterest: number;
  nextPayment?: DebtScheduleItem;
  overdue: boolean;
  dueSoon: boolean;
  needsSetup: boolean;
}

export interface DebtOverviewResponse {
  summary: DebtSummary;
  items: DebtOverviewItem[];
}

export interface DebtDetailResponse extends DebtOverviewItem {
  payments: DebtPayment[];
  schedule: DebtScheduleItem[];
}

export interface ExpenseLedger {
  cats: FinanceCategory[];
  incomeCats: FinanceCategory[];
  accountTypes: AccountType[];
  accounts: Account[];
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
  skippedAt?: string;
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

export interface HistoricalGoldQuote {
  date: string;
  vndPerTroyOunce: number;
  vndPerChi: number;
  source: string;
  sourceUrl: string;
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
  debts: Debt[];
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

export interface PersistedMarketQuotesResponse {
  quotes: MarketQuotesResponse;
  workspaceRevision: number;
  affectedPeriods: string[];
}

export interface UserDatabaseRecord {
  profile: UserProfile;
  data: StoredFinancePayload;
  createdAt: string;
  updatedAt: string;
}

export interface SharedFundContent {
  fund: Fund;
  years: Record<string, { funds: number[]; details: FundDetail[] }>;
  goal: FundGoal;
  fundPlan: number;
  openingBalance: number;
  /** Khoản tiền từng thành viên đã đóng theo tháng YYYY-MM. */
  contributions?: Record<string, SharedFundContribution[]>;
}

export interface SharedFundContribution {
  id: string;
  memberId: string;
  amount: number;
  note: string;
  createdAt: string;
}

export interface SharedFundMember {
  userId: string;
  role: SharedFundRole;
  addedAt: string;
}

export interface SharedFundRecord {
  id: string;
  ownerId: string;
  revision: number;
  content: SharedFundContent;
  members: Record<string, SharedFundMember>;
  createdAt: string;
  updatedAt: string;
}

export interface SharedFundView {
  id: string;
  revision: number;
  content: SharedFundContent;
  owner: Pick<UserProfile, "sub" | "name" | "email">;
  role: "owner" | SharedFundRole;
  contributors: Record<string, Pick<UserProfile, "sub" | "name" | "email">>;
  members?: Array<{ user: Pick<UserProfile, "sub" | "name" | "email">; role: SharedFundRole }>;
}

export interface FinancePreferences {
  showGoals: boolean;
  onboarding: OnboardingState;
  financialProfile: Pick<
    FinancialProfile,
    "monthlyIncome" | "emergencyFundGoal" | "debt"
  >;
  incomeMigrationVersion: number;
  futureIncomeResetVersion: number;
  usdRate?: number;
}

export interface FinanceBootstrapResponse {
  user: UserProfile;
  workspaceRevision: number;
  preferences: FinancePreferences;
  availableYears: number[];
  features: {
    aiAssistant: boolean;
  };
}

export interface PersonalMutationResponse<T> {
  data: T;
  workspaceRevision: number;
}

export interface SharedMutationResponse<T> {
  data: T;
  revision: number;
}

export interface DeleteMutationResult {
  deletedId: string;
}

export interface ExpenseConfigResponse {
  categories: FinanceCategory[];
  incomeCategories: FinanceCategory[];
  accountTypes: AccountType[];
  accounts: Account[];
}

export interface ExpenseBreakdownEntry {
  id: string;
  name: string;
  color: string;
  amount: number;
}

export interface ExpenseMonthSummaryResponse {
  year: number;
  month: number;
  income: number;
  spent: number;
  funds: number;
  balance: number;
  byExpenseCategory: Record<string, number>;
  byIncomeCategory: Record<string, number>;
  accountExpenses: ExpenseBreakdownEntry[];
}

export interface TransactionQuery {
  from: string;
  to: string;
  type?: TransactionType;
  categoryId?: string;
  accountId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface TransactionPageResponse {
  items: Transaction[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface AssistantHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AssistantContext {
  route: "expenses" | "funds" | "statistics" | "debts";
  selectedYear: number;
  /** Calendar month, 1..12. */
  selectedMonth: number;
}

export interface AssistantEvidence {
  source: "profile" | "transactions" | "statistics" | "funds" | "debts";
  label: string;
}

interface AssistantProposalActionBase {
  actionId: string;
}

export interface AssistantTransactionProposalAction extends AssistantProposalActionBase {
  kind: "create_transaction";
  transaction: Transaction;
  categoryName: string;
  accountName?: string;
}

export interface AssistantFundProposalAction extends AssistantProposalActionBase {
  kind: "allocate_fund";
  fundId: string;
  fundName: string;
  year: number;
  month: number;
  operation: "increment" | "set";
  amount: number;
  previousAmount: number;
  nextAmount: number;
}

export type AssistantProposalAction =
  | AssistantTransactionProposalAction
  | AssistantFundProposalAction;

export interface AssistantProposalBatch {
  kind: "action_batch";
  batchId: string;
  expectedRevision: number;
  actions: AssistantProposalAction[];
  confirmationToken: string;
  expiresAt: string;
}

export interface AssistantMessageRequest {
  message: string;
  history: AssistantHistoryTurn[];
  context: AssistantContext;
}

export interface AssistantMessageResponse {
  reply: string;
  evidence: AssistantEvidence[];
  proposal?: AssistantProposalBatch;
}

export type AssistantConfirmedAction =
  | {
    kind: "create_transaction";
    actionId: string;
    transaction: Transaction;
  }
  | {
    kind: "allocate_fund";
    actionId: string;
    fund: FundMonthDetailResponse;
  };

export interface AssistantConfirmResponse {
  kind: "action_batch";
  batchId: string;
  results: AssistantConfirmedAction[];
  workspaceRevision: number;
  alreadyApplied: boolean;
}

/** Current expense screen data that must be returned after a transaction mutation. */
export interface ExpenseTransactionView {
  year: number;
  month: number;
  transactions: TransactionQuery;
}

/** Server-authoritative expense data returned by an optimized transaction mutation. */
export interface TransactionMutationSnapshot {
  summary: ExpenseMonthSummaryResponse;
  transactions: TransactionPageResponse;
}

export interface TransactionMutationResult extends TransactionMutationSnapshot {
  transaction?: Transaction;
  deletedId?: string;
}

export interface FundOverviewItem extends Fund {
  revision?: number;
  role?: "owner" | SharedFundRole;
  owner?: Pick<UserProfile, "sub" | "name" | "email">;
  fundPlan: number;
  openingBalance: number;
  yearGoal: number;
  allGoal: number;
  monthAmount: number;
  yearAmounts: number[];
  yearTotal: number;
  allTimeTotal: number;
  /** Giá trị theo quote thị trường mới nhất của các giao dịch trong tháng đang xem. */
  monthCurrentValue: number;
  /** Giá trị theo quote thị trường mới nhất của các giao dịch trong năm đang xem. */
  yearCurrentValue: number;
  /** Giá trị theo quote thị trường mới nhất của toàn bộ giao dịch. */
  allTimeCurrentValue: number;
  contributionAmount: number;
  contributionCount: number;
}

export interface FundOverviewResponse {
  year: number;
  month: number;
  note: string;
  income: number;
  yearActiveMonths: number;
  allTimeActiveMonths: number;
  showGoals: boolean;
  debt: FinancialProfile["debt"];
  debtSummary?: DebtSummary;
  funds: FundOverviewItem[];
  marketAssets: MarketAssetRequest[];
  market: StoredMarketState;
}

export interface FundMonthDetailResponse {
  fundId: string;
  year: number;
  month: number;
  amount: number;
  detail: FundDetail;
}

export interface SharedFundMembersResponse {
  fundId: string;
  revision: number;
  members: Array<{ user: Pick<UserProfile, "sub" | "name" | "email">; role: SharedFundRole }>;
}

export interface SharedFundContributionsResponse {
  fundId: string;
  revision: number;
  period: string;
  contributors: Record<string, Pick<UserProfile, "sub" | "name" | "email">>;
  items: SharedFundContribution[];
}

export type StatisticsScope =
  | { mode: "all" }
  | { mode: "year"; year: number }
  | { mode: "month"; month: string }
  | { mode: "range"; from: string; to: string };

export interface StatisticsMonthRow {
  year: number;
  month: number;
  key: string;
  income: number;
  spent: number;
  funds: number;
  balance: number;
  byFund: Record<string, number>;
}

export interface StatisticsResponse {
  scope: StatisticsScope;
  availableYears: number[];
  funds: Array<Pick<Fund, "id" | "name" | "color">>;
  rows: StatisticsMonthRow[];
  totals: {
    income: number;
    spent: number;
    funds: number;
    balance: number;
  };
  expenseBreakdown: ExpenseBreakdownEntry[];
  incomeBreakdown: ExpenseBreakdownEntry[];
  accountExpenses: ExpenseBreakdownEntry[];
}

export interface ExpectedRevisionRequest {
  expectedRevision: number;
}

export interface PreferencesMutationRequest extends ExpectedRevisionRequest {
  showGoals?: boolean;
  financialProfile?: {
    monthlyIncome?: number;
    emergencyFundGoal?: number;
    debtBalance?: number;
    debtMonthlyPayment?: number;
  };
  onboarding?: OnboardingState;
}

export interface FundCreateRequest extends ExpectedRevisionRequest {
  name: string;
  color: string;
  category: FundCategory;
}

export interface FundPatchRequest extends ExpectedRevisionRequest {
  name?: string;
  color?: string;
  category?: FundCategory;
  fundPlan?: number;
  openingBalance?: number;
}

export interface FundMonthMutationRequest extends ExpectedRevisionRequest {
  amount: number;
  detail?: FundDetail;
}

export interface FundGoalMutationRequest extends ExpectedRevisionRequest {
  year: number | null;
  amount: number;
}

export interface TransactionMutationRequest extends ExpectedRevisionRequest {
  transaction: Omit<Transaction, "id"> & { id?: string };
  expenseView?: ExpenseTransactionView;
}

export interface TransactionDeleteRequest extends ExpectedRevisionRequest {
  expenseView?: ExpenseTransactionView;
}

export interface CategoryCreateRequest extends ExpectedRevisionRequest {
  type: TransactionType;
  name: string;
  color: string;
  budget?: number;
}

export interface CategoryPatchRequest extends ExpectedRevisionRequest {
  name?: string;
  color?: string;
  budget?: number;
}

export interface AccountCreateRequest extends ExpectedRevisionRequest {
  name: string;
  typeId?: string;
}

export interface AccountPatchRequest extends ExpectedRevisionRequest {
  name?: string;
  typeId?: string | null;
}

export interface DebtCreateRequest extends ExpectedRevisionRequest {
  debt: Omit<Debt, "id" | "payments" | "status">;
}

export interface DebtPatchRequest extends ExpectedRevisionRequest {
  debt: Partial<Omit<Debt, "id" | "payments" | "status">>;
}

export interface DebtPaymentCreateRequest extends ExpectedRevisionRequest {
  paidAt: string;
  note?: string;
}

export interface ReorderMutationRequest extends ExpectedRevisionRequest {
  ids: string[];
}

export interface SharedFundRevisionRequest {
  revision: number;
}

export interface SharedFundCreateRequest extends ExpectedRevisionRequest {
  fundId: string;
  email: string;
  role: SharedFundRole;
}

export interface SharedFundMemberMutationRequest extends SharedFundRevisionRequest {
  email: string;
  role: SharedFundRole;
}

export interface SharedFundContributionRequest extends SharedFundRevisionRequest {
  month: string;
  amount: number;
  note: string;
}

export interface UserDatabase {
  schemaVersion: 3 | 4;
  users: Record<string, UserDatabaseRecord>;
  sharedFunds?: Record<string, SharedFundRecord>;
}

export * from "./normalization.js";
export * from "./market-state.js";
export * from "./gold.js";
export * from "./debt.js";
