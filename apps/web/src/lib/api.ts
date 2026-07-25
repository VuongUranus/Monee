import type {
  AuthMeResponse,
  FinanceWorkspaceResponse,
  MarketQuotesRequest,
  MarketQuotesResponse,
  StoredFinancePayload,
  SharedFundContent,
  SharedFundRole,
  SharedFundView,
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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    throw new ApiRequestError(response.status, body?.error ?? "request_failed", body?.message ?? `Yêu cầu thất bại (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  me: (): Promise<AuthMeResponse> => request("/api/auth/me"),
  loadData: (): Promise<FinanceWorkspaceResponse> => request("/api/data"),
  saveData: (payload: StoredFinancePayload): Promise<void> => request("/api/data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }),
  logout: (): Promise<void> => request("/api/auth/logout", { method: "POST" }),
  createSharedFund: (fundId: string, email: string, role: SharedFundRole): Promise<SharedFundView> => request("/api/shared-funds", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fundId, email, role }),
  }),
  saveSharedFund: (id: string, revision: number, content: SharedFundContent): Promise<SharedFundView> => request(`/api/shared-funds/${encodeURIComponent(id)}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision, content }),
  }),
  setSharedFundMember: (id: string, email: string, role: SharedFundRole): Promise<SharedFundView> => request(`/api/shared-funds/${encodeURIComponent(id)}/members`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }),
  }),
  removeSharedFundMember: (id: string, memberId: string): Promise<void> => request(`/api/shared-funds/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`, { method: "DELETE" }),
  deleteSharedFund: (id: string): Promise<void> => request(`/api/shared-funds/${encodeURIComponent(id)}`, { method: "DELETE" }),
  addSharedFundContribution: (id: string, month: string, amount: number, note: string): Promise<SharedFundView> => request(`/api/shared-funds/${encodeURIComponent(id)}/contributions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, amount, note }),
  }),
  marketQuotes: (payload: MarketQuotesRequest): Promise<MarketQuotesResponse> => request("/api/market/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }),
};
