import type {
  AuthMeResponse,
  MarketQuotesRequest,
  MarketQuotesResponse,
  StoredFinancePayload,
} from "@chi-tieu/shared";

export class UnauthorizedError extends Error {
  constructor() {
    super("Phiên đăng nhập đã hết hạn.");
    this.name = "UnauthorizedError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`Yêu cầu thất bại (${response.status}).`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  me: (): Promise<AuthMeResponse> => request("/api/auth/me"),
  loadData: (): Promise<StoredFinancePayload> => request("/api/data"),
  saveData: (payload: StoredFinancePayload): Promise<void> => request("/api/data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }),
  logout: (): Promise<void> => request("/api/auth/logout", { method: "POST" }),
  marketQuotes: (payload: MarketQuotesRequest): Promise<MarketQuotesResponse> => request("/api/market/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }),
};
