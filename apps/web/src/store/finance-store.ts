import type { FinanceStore, SharedFundView, UserProfile } from "@chi-tieu/shared";
import type { Draft } from "immer";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { api, ApiRequestError, UnauthorizedError } from "@/lib/api";
import type { StatisticsScope } from "@/lib/domain";
import {
  collectMarketAssets,
  createDefaultStore,
  ensureYear,
  mergeSharedFunds,
  privateLedger,
  mergeMarketResponse,
  normalizeStore,
  recalculateMarketFunds,
  sharedFundContent,
} from "@/lib/domain";

export type AuthState = "checking" | "anonymous" | "authenticated" | "error";
export type SaveState = "idle" | "loading" | "saving" | "saved" | "error";

interface FinanceState {
  auth: AuthState;
  authMessage: string;
  user: UserProfile | null;
  ledger: FinanceStore;
  sharedFunds: Record<string, SharedFundView>;
  loaded: boolean;
  selectedYear: number;
  selectedMonth: number;
  statisticsScope: StatisticsScope;
  saveState: SaveState;
  saveMessage: string;
  marketState: "idle" | "loading" | "error";
  marketMessage: string;
  bootstrap(): Promise<void>;
  beginLogin(): void;
  logout(): Promise<void>;
  setPeriod(year: number, month: number): void;
  setStatisticsScope(scope: StatisticsScope): void;
  updateLedger(recipe: (draft: Draft<FinanceStore>) => void, persist?: boolean): void;
  replaceLedger(ledger: FinanceStore, persist?: boolean): void;
  refreshMarket(force?: boolean): Promise<void>;
}

let writeQueue = Promise.resolve();
let writeVersion = 0;

function currentPeriod(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

export const useFinanceStore = create<FinanceState>()(immer((set, get) => {
  const markUnauthorized = (): void => {
    set((state) => {
      state.auth = "anonymous";
      state.authMessage = "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
      state.user = null;
      state.loaded = false;
    });
  };

  const persist = (ledger: FinanceStore): void => {
    const version = ++writeVersion;
    const snapshot = structuredClone(ledger);
    set((state) => {
      state.saveState = "saving";
      state.saveMessage = "Đang lưu dữ liệu…";
    });
    const operation = writeQueue.then(async () => {
      await api.saveData(privateLedger(snapshot) as unknown as Record<string, unknown>);
      const currentShared = get().sharedFunds;
      for (const fund of snapshot.funds.filter((item) => item.sharing && item.sharing.role !== "viewer")) {
        const source = currentShared[fund.id];
        if (!source) continue;
        const content = sharedFundContent(snapshot, fund.id);
        if (JSON.stringify(content) === JSON.stringify(source.content)) continue;
        const saved = await api.saveSharedFund(fund.id, source.revision, content);
        set((state) => { state.sharedFunds[fund.id] = saved; });
      }
    });
    writeQueue = operation.catch(() => undefined);
    void operation.then(() => {
      if (version === writeVersion) {
        set((state) => {
          state.saveState = "saved";
          state.saveMessage = "Đã lưu vào data.json.";
        });
      }
    }).catch((error: unknown) => {
      if (error instanceof UnauthorizedError) {
        markUnauthorized();
        return;
      }
      if (error instanceof ApiRequestError && error.code === "shared_fund_conflict") {
        set((state) => { state.saveState = "error"; state.saveMessage = "Quỹ chung đã thay đổi. Đang tải lại dữ liệu…"; });
        void get().bootstrap();
        return;
      }
      if (version === writeVersion) {
        set((state) => {
          state.saveState = "error";
          state.saveMessage = "Chưa lưu được. Hãy kiểm tra server.";
        });
      }
    });
  };

  return {
    auth: "checking",
    authMessage: "",
    user: null,
    ledger: createDefaultStore(),
    sharedFunds: {},
    loaded: false,
    selectedYear: currentPeriod().year,
    selectedMonth: currentPeriod().month,
    statisticsScope: { mode: "year", year: currentPeriod().year },
    saveState: "loading",
    saveMessage: "Đang tải dữ liệu…",
    marketState: "idle",
    marketMessage: "Giá thị trường chưa cập nhật.",

    async bootstrap() {
      set((state) => {
        state.auth = "checking";
        state.authMessage = "";
      });
      try {
        const { user } = await api.me();
        const workspace = await api.loadData();
        // Keeps older local/mock API responses usable while the server migrates to workspace responses.
        const payload = "data" in (workspace as any) ? workspace.data : workspace as unknown as Record<string, unknown>;
        const sharedFunds = "sharedFunds" in (workspace as any) ? workspace.sharedFunds : [];
        const normalized = normalizeStore(payload);
        mergeSharedFunds(normalized.store, sharedFunds);
        const period = currentPeriod();
        const createdYear = ensureYear(normalized.store, period.year);
        set((state) => {
          state.user = user;
          state.auth = "authenticated";
          state.ledger = normalized.store;
          state.sharedFunds = Object.fromEntries(sharedFunds.map((fund: SharedFundView) => [fund.id, fund]));
          state.loaded = true;
          state.selectedYear = period.year;
          state.selectedMonth = period.month;
          state.statisticsScope = { mode: "year", year: period.year };
          state.saveState = "saved";
          state.saveMessage = "Đã tải data.json.";
        });
        if (normalized.needsSave || createdYear) persist(normalized.store);
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          set((state) => {
            state.auth = "anonymous";
            state.authMessage = "";
            state.user = null;
            state.loaded = false;
          });
        } else {
          set((state) => {
            state.auth = "error";
            state.authMessage = "Không thể kết nối tới server. Hãy kiểm tra server rồi thử lại.";
            state.loaded = false;
            state.saveState = "error";
            state.saveMessage = "Không tải được database.";
          });
        }
      }
    },

    beginLogin() {
      const current = location.pathname;
      const returnTo = ["/funds", "/expenses", "/statistics"].includes(current) ? current : "/expenses";
      location.assign(`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`);
    },

    async logout() {
      try {
        await api.logout();
      } finally {
        set((state) => {
          state.auth = "anonymous";
          state.authMessage = "Bạn đã đăng xuất.";
          state.user = null;
          state.loaded = false;
          state.ledger = createDefaultStore();
          state.sharedFunds = {};
        });
      }
    },

    setPeriod(year, month) {
      let created = false;
      set((state) => {
        created = ensureYear(state.ledger, year);
        state.selectedYear = year;
        state.selectedMonth = Math.max(0, Math.min(11, month));
        if (state.statisticsScope.mode === "year") state.statisticsScope = { mode: "year", year };
      });
      if (created) persist(get().ledger);
    },

    setStatisticsScope(scope) {
      set((state) => {
        state.statisticsScope = scope;
      });
    },

    updateLedger(recipe, shouldPersist = true) {
      set((state) => {
        recipe(state.ledger);
      });
      if (shouldPersist) persist(get().ledger);
    },

    replaceLedger(ledger, shouldPersist = true) {
      set((state) => {
        state.ledger = ledger;
      });
      if (shouldPersist) persist(get().ledger);
    },

    async refreshMarket(force = false) {
      const assets = collectMarketAssets(get().ledger);
      if (assets.length === 0) {
        set((state) => {
          state.marketMessage = "Chưa có mã tài sản để cập nhật.";
        });
        return;
      }
      set((state) => {
        state.marketState = "loading";
        state.marketMessage = force ? "Đang làm mới giá thị trường…" : "Đang cập nhật giá thị trường…";
      });
      try {
        const response = await api.marketQuotes({ assets, force });
        set((state) => {
          mergeMarketResponse(state.ledger, response);
          recalculateMarketFunds(state.ledger);
          state.marketState = response.errors.length ? "error" : "idle";
          state.marketMessage = response.errors.length
            ? "Chưa cập nhật được một số giá thị trường."
            : `Giá thị trường cập nhật ${new Date(response.fetchedAt).toLocaleString("vi-VN")}.`;
        });
        persist(get().ledger);
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          markUnauthorized();
          return;
        }
        set((state) => {
          state.marketState = "error";
          state.marketMessage = "Không cập nhật được giá thị trường.";
          state.ledger.market.errors = [{ key: "market", code: "request_failed", message: "Không thể lấy giá thị trường từ server." }];
        });
      }
    },
  };
}));
