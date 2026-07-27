import type {
  AccountCreateRequest,
  Account,
  AccountType,
  AccountPatchRequest,
  AuthMeResponse,
  CategoryCreateRequest,
  CategoryPatchRequest,
  DebtCreateRequest,
  DebtDetailResponse,
  DebtOverviewResponse,
  DebtPatchRequest,
  DeleteMutationResult,
  ExpenseConfigResponse,
  ExpenseMonthSummaryResponse,
  ExpenseTransactionView,
  FinanceBootstrapResponse,
  FinanceCategory,
  FinancePreferences,
  Fund,
  FundCreateRequest,
  FundMonthDetailResponse,
  FundMonthMutationRequest,
  FundOverviewResponse,
  FundPatchRequest,
  MarketQuotesRequest,
  PersonalMutationResponse,
  PersistedMarketQuotesResponse,
  SharedFundContributionsResponse,
  SharedFundMembersResponse,
  SharedMutationResponse,
  StatisticsResponse,
  StatisticsScope,
  StoredFinancePayload,
  SharedFundRole,
  TransactionMutationRequest,
  TransactionPageResponse,
  TransactionQuery,
  TransactionMutationResult,
} from "@chi-tieu/shared";

export class UnauthorizedError extends Error {
  constructor() {
    super("Phiên đăng nhập đã hết hạn.");
    this.name = "UnauthorizedError";
  }
}

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
  }
}

const inFlightGetRequests = new Map<string, Promise<unknown>>();

async function performRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    throw new ApiRequestError(response.status, body?.error ?? "request_failed", body?.message ?? `Yêu cầu thất bại (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/**
 * React Strict Mode deliberately replays effects in development. Route effects can
 * also overlap with period-change actions, so coalesce identical reads while the
 * first request is still pending. Mutations are intentionally never coalesced.
 */
function request<T>(url: string, init?: RequestInit, fresh = false): Promise<T> {
  const method = init?.method?.toUpperCase() ?? "GET";
  if (method !== "GET") return performRequest<T>(url, init);

  // A read issued after a mutation must not reuse a request that started before
  // that mutation completed, because its response can contain stale data.
  if (fresh) return performRequest<T>(url, init);

  const existing = inFlightGetRequests.get(url);
  if (existing) return existing as Promise<T>;

  const operation = performRequest<T>(url, init);
  inFlightGetRequests.set(url, operation);
  const clear = (): void => {
    if (inFlightGetRequests.get(url) === operation) inFlightGetRequests.delete(url);
  };
  void operation.then(clear, clear);
  return operation;
}

export const api = {
  me: (): Promise<AuthMeResponse> => request("/api/auth/me"),
  loadData: (): Promise<FinanceBootstrapResponse> => request("/api/data"),
  exportBackup: (): Promise<StoredFinancePayload> => request("/api/backup/export"),
  loadExpenseConfig: (): Promise<ExpenseConfigResponse> => request("/api/expenses/config"),
  loadExpenseSummary: (year: number, month: number): Promise<ExpenseMonthSummaryResponse> =>
    request(`/api/expenses/summary?year=${year}&month=${month}`),
  loadTransactions: (query: TransactionQuery): Promise<TransactionPageResponse> => {
    const search = new URLSearchParams({
      from: query.from,
      to: query.to,
      page: String(query.page ?? 1),
      pageSize: String(query.pageSize ?? 10),
    });
    if (query.type) search.set("type", query.type);
    if (query.categoryId) search.set("categoryId", query.categoryId);
    if (query.accountId) search.set("accountId", query.accountId);
    if (query.q) search.set("q", query.q);
    return request(`/api/transactions?${search}`);
  },
  loadDebts: (): Promise<DebtOverviewResponse> => request("/api/debts"),
  loadDebtDetail: (id: string): Promise<DebtDetailResponse> => request(`/api/debts/${encodeURIComponent(id)}`),
  loadFundOverview: (year: number, month: number, fresh = false): Promise<FundOverviewResponse> =>
    request(`/api/funds/overview?year=${year}&month=${month}`, undefined, fresh),
  loadFundMonthDetail: (id: string, year: number, month: number): Promise<FundMonthDetailResponse> =>
    request(`/api/funds/${encodeURIComponent(id)}/months/${year}/${month}`),
  loadSharedFundMembers: (id: string): Promise<SharedFundMembersResponse> =>
    request(`/api/shared-funds/${encodeURIComponent(id)}/members`),
  loadSharedFundContributions: (id: string, year: number, month: number): Promise<SharedFundContributionsResponse> =>
    request(`/api/shared-funds/${encodeURIComponent(id)}/contributions?year=${year}&month=${month}`),
  loadStatistics: (scope: StatisticsScope): Promise<StatisticsResponse> => {
    const search = new URLSearchParams();
    search.set("mode", scope.mode);
    if (scope.mode === "year") search.set("year", String(scope.year));
    if (scope.mode === "month") search.set("month", scope.month);
    if (scope.mode === "range") {
      search.set("from", scope.from);
      search.set("to", scope.to);
    }
    return request(`/api/statistics?${search}`);
  },
  importData: (payload: StoredFinancePayload, expectedRevision: number): Promise<FinanceBootstrapResponse> => request("/api/data/import", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: payload, expectedRevision }),
  }),
  updatePreferences: (expectedRevision: number, patch: Record<string, unknown>): Promise<PersonalMutationResponse<FinancePreferences>> => request("/api/preferences", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, ...patch }),
  }),
  ensureYear: (year: number, expectedRevision: number): Promise<PersonalMutationResponse<{ year: number }>> => request(`/api/years/${year}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision }),
  }),
  updateMonthNote: (year: number, month: number, note: string, expectedRevision: number): Promise<PersonalMutationResponse<{ year: number; month: number; note: string }>> => request(`/api/years/${year}/months/${month}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, note }),
  }),
  resetMonth: (year: number, month: number, expectedRevision: number): Promise<PersonalMutationResponse<{ year: number; month: number }>> => request(`/api/years/${year}/months/${month}/reset`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision }),
  }),
  createFund: (input: Omit<FundCreateRequest, "expectedRevision">, expectedRevision: number): Promise<PersonalMutationResponse<Fund>> => request("/api/funds", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, ...input }),
  }),
  updateFund: (id: string, patch: Omit<FundPatchRequest, "expectedRevision">, expectedRevision: number): Promise<PersonalMutationResponse<Fund>> => request(`/api/funds/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, ...patch }),
  }),
  deleteFund: (id: string, expectedRevision: number): Promise<PersonalMutationResponse<DeleteMutationResult>> => request(`/api/funds/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision }),
  }),
  reorderFunds: (ids: string[], expectedRevision: number): Promise<PersonalMutationResponse<{ ids: string[] }>> => request("/api/funds/order", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, ids }),
  }),
  updateFundMonth: (id: string, year: number, month: number, patch: Omit<FundMonthMutationRequest, "expectedRevision">, expectedRevision: number): Promise<PersonalMutationResponse<FundMonthDetailResponse>> => request(`/api/funds/${encodeURIComponent(id)}/months/${year}/${month}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, ...patch }),
  }),
  updateFundGoal: (id: string, year: number | null, amount: number, expectedRevision: number): Promise<PersonalMutationResponse<{ fundId: string; year: number | null; amount: number }>> => request(`/api/funds/${encodeURIComponent(id)}/goals`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, year, amount }),
  }),
  createTransaction: (
    transaction: TransactionMutationRequest["transaction"],
    expenseView: ExpenseTransactionView,
    expectedRevision: number,
  ): Promise<PersonalMutationResponse<TransactionMutationResult>> => request("/api/transactions", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, transaction, expenseView }),
  }),
  updateTransaction: (
    id: string,
    transaction: TransactionMutationRequest["transaction"],
    expenseView: ExpenseTransactionView,
    expectedRevision: number,
  ): Promise<PersonalMutationResponse<TransactionMutationResult>> => request(`/api/transactions/${encodeURIComponent(id)}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, transaction, expenseView }),
  }),
  deleteTransaction: (
    id: string,
    expenseView: ExpenseTransactionView,
    expectedRevision: number,
  ): Promise<PersonalMutationResponse<TransactionMutationResult>> => request(`/api/transactions/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, expenseView }),
  }),
  createDebt: (debt: Omit<DebtCreateRequest, "expectedRevision">["debt"], expectedRevision: number): Promise<PersonalMutationResponse<{ id: string }>> => request("/api/debts", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, debt }),
  }),
  updateDebt: (id: string, debt: Omit<DebtPatchRequest, "expectedRevision">["debt"], expectedRevision: number): Promise<PersonalMutationResponse<{ id: string }>> => request(`/api/debts/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, debt }),
  }),
  deleteDebt: (id: string, expectedRevision: number): Promise<PersonalMutationResponse<DeleteMutationResult>> => request(`/api/debts/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision }),
  }),
  recordDebtPayment: (id: string, paidAt: string, note: string, expectedRevision: number): Promise<PersonalMutationResponse<{ debtId: string; paymentId: string; transactionId: string }>> => request(`/api/debts/${encodeURIComponent(id)}/payments`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, paidAt, note }),
  }),
  deleteDebtPayment: (id: string, paymentId: string, expectedRevision: number): Promise<PersonalMutationResponse<DeleteMutationResult>> => request(`/api/debts/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision }),
  }),
  createCategory: (input: Omit<CategoryCreateRequest, "expectedRevision">, expectedRevision: number): Promise<PersonalMutationResponse<FinanceCategory>> => request("/api/categories", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, ...input }),
  }),
  updateCategory: (type: string, id: string, patch: Omit<CategoryPatchRequest, "expectedRevision">, expectedRevision: number): Promise<PersonalMutationResponse<FinanceCategory>> => request(`/api/categories/${type}/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, ...patch }),
  }),
  deleteCategory: (type: string, id: string, expectedRevision: number): Promise<PersonalMutationResponse<DeleteMutationResult>> => request(`/api/categories/${type}/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision }),
  }),
  reorderCategories: (type: string, ids: string[], expectedRevision: number): Promise<PersonalMutationResponse<{ ids: string[] }>> => request(`/api/categories/${type}/order`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, ids }),
  }),
  createAccountType: (name: string, expectedRevision: number): Promise<PersonalMutationResponse<AccountType>> => request("/api/account-types", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, name }),
  }),
  updateAccountType: (id: string, name: string, expectedRevision: number): Promise<PersonalMutationResponse<AccountType>> => request(`/api/account-types/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, name }),
  }),
  deleteAccountType: (id: string, expectedRevision: number): Promise<PersonalMutationResponse<DeleteMutationResult>> => request(`/api/account-types/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision }),
  }),
  reorderAccountTypes: (ids: string[], expectedRevision: number): Promise<PersonalMutationResponse<{ ids: string[] }>> => request("/api/account-types/order", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, ids }),
  }),
  createAccount: (input: Omit<AccountCreateRequest, "expectedRevision">, expectedRevision: number): Promise<PersonalMutationResponse<Account>> => request("/api/accounts", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, ...input }),
  }),
  updateAccount: (id: string, patch: Omit<AccountPatchRequest, "expectedRevision">, expectedRevision: number): Promise<PersonalMutationResponse<Account>> => request(`/api/accounts/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, ...patch }),
  }),
  deleteAccount: (id: string, expectedRevision: number): Promise<PersonalMutationResponse<DeleteMutationResult>> => request(`/api/accounts/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision }),
  }),
  reorderAccounts: (ids: string[], expectedRevision: number): Promise<PersonalMutationResponse<{ ids: string[] }>> => request("/api/accounts/order", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision, ids }),
  }),
  logout: (): Promise<void> => request("/api/auth/logout", { method: "POST" }),
  createSharedFund: (fundId: string, email: string, role: SharedFundRole, expectedRevision: number): Promise<PersonalMutationResponse<{ id: string; revision: number }>> => request("/api/shared-funds", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fundId, email, role, expectedRevision }),
  }),
  updateSharedFund: (id: string, revision: number, patch: Record<string, unknown>): Promise<SharedMutationResponse<unknown>> => request(`/api/shared-funds/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision, ...patch }),
  }),
  updateSharedFundMonth: (id: string, year: number, month: number, revision: number, patch: { amount: number; detail?: unknown }): Promise<SharedMutationResponse<FundMonthDetailResponse>> => request(`/api/shared-funds/${encodeURIComponent(id)}/months/${year}/${month}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision, ...patch }),
  }),
  updateSharedFundGoal: (id: string, revision: number, year: number | null, amount: number): Promise<SharedMutationResponse<{ fundId: string; year: number | null; amount: number }>> => request(`/api/shared-funds/${encodeURIComponent(id)}/goals`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision, year, amount }),
  }),
  setSharedFundMember: (id: string, email: string, role: SharedFundRole, revision: number): Promise<SharedMutationResponse<unknown>> => request(`/api/shared-funds/${encodeURIComponent(id)}/members`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role, revision }),
  }),
  removeSharedFundMember: (id: string, memberId: string, revision: number): Promise<SharedMutationResponse<DeleteMutationResult>> => request(`/api/shared-funds/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision }),
  }),
  deleteSharedFund: (id: string, revision: number): Promise<SharedMutationResponse<DeleteMutationResult>> => request(`/api/shared-funds/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision }),
  }),
  addSharedFundContribution: (id: string, month: string, amount: number, note: string, revision: number): Promise<SharedMutationResponse<unknown>> => request(`/api/shared-funds/${encodeURIComponent(id)}/contributions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, amount, note, revision }),
  }),
  marketQuotes: (payload: MarketQuotesRequest, expectedRevision: number): Promise<PersistedMarketQuotesResponse> => request("/api/market/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, expectedRevision }),
  }),
};
