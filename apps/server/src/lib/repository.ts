import type {
  AccountCreateRequest,
  AccountPatchRequest,
  CategoryCreateRequest,
  CategoryPatchRequest,
  DebtCreateRequest,
  DebtDetailResponse,
  DebtOverviewResponse,
  DebtPatchRequest,
  ExpenseConfigResponse,
  ExpenseMonthSummaryResponse,
  ExpenseTransactionView,
  FinanceBootstrapResponse,
  FundCreateRequest,
  FundGoalMutationRequest,
  FundMonthMutationRequest,
  FundPatchRequest,
  MarketQuotesResponse,
  FundMonthDetailResponse,
  FundOverviewResponse,
  SharedFundContributionsResponse,
  SharedFundMembersResponse,
  SharedFundRole,
  StatisticsResponse,
  StatisticsScope,
  StoredFinancePayload,
  TransactionPageResponse,
  TransactionQuery,
  TransactionMutationResult,
  TransactionMutationRequest,
  UserDatabase,
  UserProfile,
} from "@chi-tieu/shared";

export type PersonalMutationCommand =
  | { kind: "preferences"; patch: Omit<import("@chi-tieu/shared").PreferencesMutationRequest, "expectedRevision"> }
  | { kind: "ensureYear"; year: number }
  | { kind: "monthNote"; year: number; month: number; note: string }
  | { kind: "resetMonth"; year: number; month: number }
  | { kind: "createFund"; input: Omit<FundCreateRequest, "expectedRevision"> }
  | { kind: "updateFund"; id: string; patch: Omit<FundPatchRequest, "expectedRevision"> }
  | { kind: "deleteFund"; id: string }
  | { kind: "reorderFunds"; ids: string[] }
  | { kind: "fundMonth"; id: string; year: number; month: number; patch: Omit<FundMonthMutationRequest, "expectedRevision"> }
  | { kind: "fundGoal"; id: string; input: Omit<FundGoalMutationRequest, "expectedRevision"> }
  | { kind: "createTransaction"; transaction: TransactionMutationRequest["transaction"] }
  | { kind: "updateTransaction"; id: string; transaction: TransactionMutationRequest["transaction"] }
  | { kind: "deleteTransaction"; id: string }
  | { kind: "createCategory"; input: Omit<CategoryCreateRequest, "expectedRevision"> }
  | { kind: "updateCategory"; type: "income" | "expense"; id: string; patch: Omit<CategoryPatchRequest, "expectedRevision"> }
  | { kind: "deleteCategory"; type: "income" | "expense"; id: string }
  | { kind: "reorderCategories"; type: "income" | "expense"; ids: string[] }
  | { kind: "createAccountType"; name: string }
  | { kind: "updateAccountType"; id: string; name: string }
  | { kind: "deleteAccountType"; id: string }
  | { kind: "reorderAccountTypes"; ids: string[] }
  | { kind: "createAccount"; input: Omit<AccountCreateRequest, "expectedRevision"> }
  | { kind: "updateAccount"; id: string; patch: Omit<AccountPatchRequest, "expectedRevision"> }
  | { kind: "deleteAccount"; id: string }
  | { kind: "reorderAccounts"; ids: string[] }
  | { kind: "createDebt"; input: Omit<DebtCreateRequest, "expectedRevision">["debt"] }
  | { kind: "updateDebt"; id: string; patch: Omit<DebtPatchRequest, "expectedRevision">["debt"] }
  | { kind: "deleteDebt"; id: string }
  | { kind: "recordDebtPayment"; id: string; paidAt: string; note: string }
  | { kind: "deleteDebtPayment"; id: string; paymentId: string }
  | { kind: "market"; quotes: MarketQuotesResponse };

export type TransactionMutationCommand = Extract<PersonalMutationCommand, {
  kind: "createTransaction" | "updateTransaction" | "deleteTransaction";
}>;

export type AssistantMutationCommand = Extract<PersonalMutationCommand, {
  kind: "createTransaction" | "fundMonth";
}>;

export type SharedMutationCommand =
  | {
    kind: "metadata";
    patch: {
      name?: string;
      color?: string;
      category?: import("@chi-tieu/shared").FundCategory;
      fundPlan?: number;
      openingBalance?: number;
    };
  }
  | { kind: "month"; year: number; month: number; amount: number; detail?: import("@chi-tieu/shared").FundDetail }
  | { kind: "goal"; year: number | null; amount: number }
  | { kind: "setMember"; email: string; role: SharedFundRole }
  | { kind: "removeMember"; memberId: string }
  | { kind: "contribution"; year: number; month: number; amount: number; note: string }
  | { kind: "delete" };

export interface UserDataRepository {
  provisionUser(profile: UserProfile): Promise<UserProfile>;
  getBootstrap(userId: string): Promise<FinanceBootstrapResponse>;
  getExpenseConfig(userId: string): Promise<ExpenseConfigResponse>;
  getExpenseSummary(userId: string, year: number, month: number): Promise<ExpenseMonthSummaryResponse>;
  getTransactions(userId: string, query: TransactionQuery): Promise<TransactionPageResponse>;
  getTransactionById(userId: string, transactionId: string): Promise<import("@chi-tieu/shared").Transaction | null>;
  getDebtOverview(userId: string): Promise<DebtOverviewResponse>;
  getDebtDetail(userId: string, debtId: string): Promise<DebtDetailResponse>;
  getFundOverview(userId: string, year: number, month: number): Promise<FundOverviewResponse>;
  getFundMonthDetail(userId: string, fundId: string, year: number, month: number): Promise<FundMonthDetailResponse>;
  getSharedFundMembers(userId: string, fundId: string): Promise<SharedFundMembersResponse>;
  getSharedFundContributions(
    userId: string,
    fundId: string,
    year: number,
    month: number,
  ): Promise<SharedFundContributionsResponse>;
  getStatistics(userId: string, scope: StatisticsScope): Promise<StatisticsResponse>;
  mutateTransaction(
    userId: string,
    expectedRevision: number,
    command: TransactionMutationCommand,
    expenseView: ExpenseTransactionView,
  ): Promise<import("@chi-tieu/shared").PersonalMutationResponse<TransactionMutationResult>>;
  mutatePersonalResource<T = unknown>(
    userId: string,
    expectedRevision: number,
    command: PersonalMutationCommand,
  ): Promise<import("@chi-tieu/shared").PersonalMutationResponse<T>>;
  mutatePersonalResources<T = unknown>(
    userId: string,
    expectedRevision: number,
    commands: AssistantMutationCommand[],
  ): Promise<import("@chi-tieu/shared").PersonalMutationResponse<T[]>>;
  mutateSharedResource<T = unknown>(
    userId: string,
    fundId: string,
    revision: number,
    command: SharedMutationCommand,
  ): Promise<import("@chi-tieu/shared").SharedMutationResponse<T>>;
  getUserData(userId: string): Promise<StoredFinancePayload>;
  createSharedFund(
    ownerId: string,
    fundId: string,
    email: string,
    role: SharedFundRole,
    expectedRevision: number,
  ): Promise<{ id: string; revision: number }>;
  unshareFund(
    ownerId: string,
    fundId: string,
    expectedRevision: number,
  ): Promise<import("@chi-tieu/shared").PersonalMutationResponse<{ id: string }>>;
  replaceUserData(userId: string, expectedRevision: number, data: StoredFinancePayload): Promise<number>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isUserDatabase(value: unknown): value is UserDatabase {
  return isObject(value)
    && (value.schemaVersion === 3 || value.schemaVersion === 4)
    && isObject(value.users);
}

export class SharedFundError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) {
    super(message);
  }
}

export function cleanUserProfile(profile: UserProfile): UserProfile {
  return {
    sub: String(profile.sub),
    email: String(profile.email),
    name: String(profile.name || profile.email),
    picture: typeof profile.picture === "string" ? profile.picture : "",
  };
}
