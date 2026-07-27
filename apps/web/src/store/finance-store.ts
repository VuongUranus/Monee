import type {
  AssistantConfirmResponse,
  ExpenseConfigResponse,
  ExpenseMonthSummaryResponse,
  ExpenseTransactionView,
  DebtDetailResponse,
  DebtOverviewResponse,
  FinanceBootstrapResponse,
  FinanceStore,
  FundMonthDetailResponse,
  FundOverviewResponse,
  MarketQuotesRequest,
  PersonalMutationResponse,
  PersistedMarketQuotesResponse,
  SharedFundRole,
  SharedFundView,
  SharedMutationResponse,
  StatisticsResponse,
  StatisticsScope,
  TransactionPageResponse,
  Transaction,
  TransactionMutationResult,
  TransactionQuery,
  UserProfile,
} from "@chi-tieu/shared";
import type { Draft } from "immer";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { api, ApiRequestError, UnauthorizedError } from "@/lib/api";
import {
  blankYearWith,
  createDefaultStore,
  ensureYear,
  mergeMarketResponse,
  privateLedger,
} from "@/lib/domain";

export type AuthState = "checking" | "anonymous" | "authenticated" | "error";
export type SaveState = "idle" | "loading" | "saving" | "saved" | "error";
export type ResourceState = "idle" | "loading" | "ready" | "error";
type RefreshPolicy = "route" | "none";

interface MutationOptions<T> {
  refresh?: RefreshPolicy;
  invalidateExpenseConfig?: boolean;
  reconcile?: (state: Draft<FinanceState>, data: T) => void;
}

interface FinanceState {
  auth: AuthState;
  authMessage: string;
  user: UserProfile | null;
  ledger: FinanceStore;
  sharedFunds: Record<string, SharedFundView>;
  bootstrapData: FinanceBootstrapResponse | null;
  expenseConfig: ExpenseConfigResponse | null;
  expenseSummary: ExpenseMonthSummaryResponse | null;
  transactionPage: TransactionPageResponse | null;
  transactionQuery: TransactionQuery | null;
  fundOverview: FundOverviewResponse | null;
  fundDetails: Record<string, FundMonthDetailResponse>;
  statistics: StatisticsResponse | null;
  debtOverview: DebtOverviewResponse | null;
  debtDetails: Record<string, DebtDetailResponse>;
  expensesState: ResourceState;
  fundsState: ResourceState;
  statisticsState: ResourceState;
  debtsState: ResourceState;
  loaded: boolean;
  selectedYear: number;
  selectedMonth: number;
  periodReady: boolean;
  statisticsScope: StatisticsScope;
  saveState: SaveState;
  saveMessage: string;
  workspaceRevision: number;
  marketState: "idle" | "loading" | "error";
  marketMessage: string;
  bootstrap(): Promise<void>;
  loadExpenses(query?: Partial<TransactionQuery>): Promise<void>;
  loadTransactions(query: TransactionQuery): Promise<void>;
  loadDebts(): Promise<void>;
  loadDebtDetail(debtId: string): Promise<DebtDetailResponse | null>;
  loadFunds(fresh?: boolean): Promise<void>;
  loadFundDetail(fundId: string): Promise<FundMonthDetailResponse | null>;
  loadStatistics(scope?: StatisticsScope): Promise<void>;
  beginLogin(): void;
  logout(): Promise<void>;
  setPeriod(year: number, month: number): void;
  setStatisticsScope(scope: StatisticsScope): void;
  updateLedger(recipe: (draft: Draft<FinanceStore>) => void): void;
  mutateLedger<T>(
    recipe: (draft: Draft<FinanceStore>) => void,
    request: (expectedRevision: number) => Promise<PersonalMutationResponse<T>>,
    options?: MutationOptions<T>,
  ): void;
  mutateExpenseConfig<T>(
    recipe: (draft: Draft<FinanceStore>) => void,
    request: (expectedRevision: number) => Promise<PersonalMutationResponse<T>>,
  ): void;
  createTransaction(transaction: Transaction): void;
  applyAssistantConfirmation(response: AssistantConfirmResponse): Promise<void>;
  reloadAfterAssistantConflict(): Promise<void>;
  updateTransaction(transaction: Transaction): void;
  deleteTransaction(id: string): void;
  mutateSharedLedger<T>(
    fundId: string,
    recipe: (draft: Draft<FinanceStore>) => void,
    request: (revision: number) => Promise<SharedMutationResponse<T>>,
    options?: MutationOptions<T>,
  ): Promise<void>;
  shareFund(fundId: string, email: string, role: SharedFundRole): Promise<void>;
  deleteSharedFund(fundId: string): Promise<void>;
  replaceLedger(ledger: FinanceStore, persist?: boolean): void;
  persistMarketQuotes(payload: MarketQuotesRequest): Promise<PersistedMarketQuotesResponse>;
  refreshMarket(force?: boolean): Promise<void>;
}

let writeQueue = Promise.resolve();
let writeVersion = 0;
let queuedMutationVersion = 0;
let mutationEpoch = 0;
let pendingRouteRefresh = false;
let periodSelectionVersion = 0;
let expensesRequest = 0;
let fundsRequest = 0;
let statisticsRequest = 0;
let debtsRequest = 0;

class CancelledMutationError extends Error {}

function currentPeriod(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function monthBounds(year: number, monthIndex: number): { from: string; to: string } {
  const month = monthIndex + 1;
  return {
    from: `${year}-${String(month).padStart(2, "0")}-01`,
    to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

function sameTransactionQuery(left: TransactionQuery | null, right: TransactionQuery): boolean {
  if (!left) return false;
  return left.from === right.from
    && left.to === right.to
    && left.type === right.type
    && left.categoryId === right.categoryId
    && left.accountId === right.accountId
    && left.q === right.q
    && (left.page ?? 1) === (right.page ?? 1)
    && (left.pageSize ?? 10) === (right.pageSize ?? 10);
}

function detailKey(fundId: string, year: number, month: number): string {
  return `${fundId}:${year}:${month}`;
}

function ledgerFromBootstrap(bootstrap: FinanceBootstrapResponse): FinanceStore {
  const ledger = createDefaultStore();
  ledger.funds = [];
  ledger.years = Object.fromEntries(bootstrap.availableYears.map((year) => [String(year), blankYearWith([])]));
  ledger.goals = {};
  ledger.expense = { cats: [], incomeCats: [], accountTypes: [], accounts: [], txns: [] };
  ledger.showGoals = bootstrap.preferences.showGoals;
  ledger.onboarding = structuredClone(bootstrap.preferences.onboarding);
  ledger.financialProfile = {
    monthlyIncome: bootstrap.preferences.financialProfile.monthlyIncome,
    monthlyBudgets: {},
    fundPlan: {},
    emergencyFundGoal: bootstrap.preferences.financialProfile.emergencyFundGoal,
    openingBalances: {},
    debt: structuredClone(bootstrap.preferences.financialProfile.debt),
  };
  ledger.incomeMigrationVersion = bootstrap.preferences.incomeMigrationVersion;
  ledger.futureIncomeResetVersion = bootstrap.preferences.futureIncomeResetVersion;
  if (bootstrap.preferences.usdRate !== undefined) ledger.usdRate = bootstrap.preferences.usdRate;
  return ledger;
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

  const applyBootstrap = (bootstrap: FinanceBootstrapResponse, resetLedger = false): void => {
    set((state) => {
      state.bootstrapData = bootstrap;
      state.user = bootstrap.user;
      state.workspaceRevision = bootstrap.workspaceRevision;
      if (resetLedger) state.ledger = ledgerFromBootstrap(bootstrap);
      else {
        state.ledger.showGoals = bootstrap.preferences.showGoals;
        state.ledger.onboarding = structuredClone(bootstrap.preferences.onboarding);
        state.ledger.financialProfile.monthlyIncome = bootstrap.preferences.financialProfile.monthlyIncome;
        state.ledger.financialProfile.emergencyFundGoal = bootstrap.preferences.financialProfile.emergencyFundGoal;
        state.ledger.financialProfile.debt = structuredClone(bootstrap.preferences.financialProfile.debt);
        for (const year of bootstrap.availableYears) {
          state.ledger.years[String(year)] ??= blankYearWith(state.ledger.funds);
        }
      }
    });
  };

  const applyExpenseConfig = (config: ExpenseConfigResponse): void => {
    set((state) => {
      state.expenseConfig = config;
      state.ledger.expense.cats = structuredClone(config.categories);
      state.ledger.expense.incomeCats = structuredClone(config.incomeCategories);
      state.ledger.expense.accountTypes = structuredClone(config.accountTypes);
      state.ledger.expense.accounts = structuredClone(config.accounts);
      state.ledger.financialProfile.monthlyBudgets = Object.fromEntries(
        config.categories.map((category) => [category.id, category.budget ?? 0]),
      );
    });
  };

  const applyFundOverview = (overview: FundOverviewResponse): void => {
    set((state) => {
      state.fundOverview = overview;
      const ledger = state.ledger;
      ledger.funds = overview.funds.map((fund) => ({
        id: fund.id,
        name: fund.name,
        color: fund.color,
        cat: fund.cat,
        ...(fund.role && fund.owner ? {
          sharing: {
            sharedFundId: fund.id,
            ownerId: fund.owner.sub,
            ownerName: fund.owner.name || fund.owner.email,
            role: fund.role,
          },
        } : {}),
      }));
      const yearData = ledger.years[String(overview.year)] ?? blankYearWith(ledger.funds);
      ledger.years[String(overview.year)] = yearData;
      yearData.notes[overview.month - 1] = overview.note;
      ledger.goals = {};
      ledger.financialProfile.fundPlan = {};
      ledger.financialProfile.openingBalances = {};
      ledger.financialProfile.debt = structuredClone(overview.debt);
      ledger.showGoals = overview.showGoals;
      ledger.market = structuredClone(overview.market);
      state.sharedFunds = {};
      for (const fund of overview.funds) {
        for (const data of Object.values(ledger.years)) {
          data.funds[fund.id] ??= new Array<number>(12).fill(0);
          data.details[fund.id] ??= new Array(12).fill(null);
        }
        yearData.funds[fund.id] = structuredClone(fund.yearAmounts);
        ledger.goals[fund.id] = { years: { [String(overview.year)]: fund.yearGoal }, all: fund.allGoal };
        ledger.financialProfile.fundPlan[fund.id] = fund.fundPlan;
        ledger.financialProfile.openingBalances[fund.id] = fund.openingBalance;
        if (fund.role && fund.owner && fund.revision) {
          state.sharedFunds[fund.id] = {
            id: fund.id,
            revision: fund.revision,
            content: {
              fund: { id: fund.id, name: fund.name, color: fund.color, cat: fund.cat },
              years: {
                [String(overview.year)]: {
                  funds: structuredClone(fund.yearAmounts),
                  details: structuredClone(yearData.details[fund.id]!),
                },
              },
              goal: structuredClone(ledger.goals[fund.id]!),
              fundPlan: fund.fundPlan,
              openingBalance: fund.openingBalance,
              contributions: {},
            },
            owner: fund.owner,
            role: fund.role,
            contributors: {},
          };
        }
      }
    });
  };

  const clearPersonalCaches = (): void => {
    set((state) => {
      state.expenseConfig = null;
      state.expenseSummary = null;
      state.transactionPage = null;
      state.transactionQuery = null;
      state.fundOverview = null;
      state.fundDetails = {};
      state.statistics = null;
      state.debtOverview = null;
      state.debtDetails = {};
      state.sharedFunds = {};
    });
  };

  const refreshCurrentRoute = async (preserveTransactionQuery = false): Promise<void> => {
    if (location.pathname === "/funds") await get().loadFunds(true);
    else if (location.pathname === "/statistics") await get().loadStatistics();
    else if (location.pathname === "/debts") await get().loadDebts();
    else await get().loadExpenses(preserveTransactionQuery ? get().transactionQuery ?? {} : {});
  };

  const reloadAfterConflict = async (): Promise<void> => {
    const bootstrap = await api.loadData();
    clearPersonalCaches();
    applyBootstrap(bootstrap, true);
    await refreshCurrentRoute();
    set((state) => {
      state.saveState = "saved";
      state.saveMessage = "Đã tải lại dữ liệu mới nhất.";
    });
  };

  const refreshWhenSettled = async (mutationVersion: number): Promise<void> => {
    if (mutationVersion !== queuedMutationVersion || !pendingRouteRefresh) return;
    pendingRouteRefresh = false;
    await refreshCurrentRoute(true);
  };

  const persist = <T>(
    recipe: (draft: Draft<FinanceStore>) => void,
    request: (expectedRevision: number) => Promise<PersonalMutationResponse<T>>,
    options: MutationOptions<T> = {},
  ): void => {
    const version = ++writeVersion;
    const mutationVersion = ++queuedMutationVersion;
    const epoch = mutationEpoch;
    if (options.refresh !== "none") pendingRouteRefresh = true;
    set((state) => {
      recipe(state.ledger);
      state.saveState = "saving";
      state.saveMessage = "Đang lưu dữ liệu…";
    });
    const operation = writeQueue.then(async () => {
      if (epoch !== mutationEpoch) throw new CancelledMutationError();
      try {
        const response = await request(get().workspaceRevision);
        set((state) => {
          state.workspaceRevision = response.workspaceRevision;
          if (state.bootstrapData) state.bootstrapData.workspaceRevision = response.workspaceRevision;
          if (options.invalidateExpenseConfig) state.expenseConfig = null;
          options.reconcile?.(state as Draft<FinanceState>, response.data);
        });
        await refreshWhenSettled(mutationVersion);
      } catch (error) {
        mutationEpoch += 1;
        pendingRouteRefresh = false;
        throw error;
      }
    });
    writeQueue = operation.catch(() => undefined);
    void operation.then(() => {
      if (version === writeVersion) {
        set((state) => {
          state.saveState = "saved";
          state.saveMessage = "Đã lưu thay đổi.";
        });
      }
    }).catch((error: unknown) => {
      if (error instanceof CancelledMutationError) return;
      if (error instanceof UnauthorizedError) {
        markUnauthorized();
        return;
      }
      const conflict = error instanceof ApiRequestError
        && (error.code === "revision_conflict" || error.code === "shared_fund_conflict");
      set((state) => {
        state.saveState = "error";
        state.saveMessage = conflict
          ? "Dữ liệu đã thay đổi. Đang tải lại…"
          : "Chưa lưu được. Đang tải lại dữ liệu…";
      });
      if (get().auth === "authenticated") void reloadAfterConflict();
    });
  };

  const currentExpenseView = (): ExpenseTransactionView => {
    const { selectedYear: year, selectedMonth, transactionQuery } = get();
    return {
      year,
      month: selectedMonth + 1,
      transactions: structuredClone(transactionQuery ?? {
        ...monthBounds(year, selectedMonth),
        page: 1,
        pageSize: 10,
      }),
    };
  };

  const applyTransactionSnapshot = (
    state: Draft<FinanceState>,
    expenseView: ExpenseTransactionView,
    snapshot: TransactionMutationResult,
  ): void => {
    const isCurrentPeriod = state.selectedYear === expenseView.year
      && state.selectedMonth + 1 === expenseView.month;
    if (isCurrentPeriod) state.expenseSummary = structuredClone(snapshot.summary);
    if (!sameTransactionQuery(state.transactionQuery, expenseView.transactions)) return;
    state.transactionPage = structuredClone(snapshot.transactions);
    state.transactionQuery = structuredClone(expenseView.transactions);
    state.ledger.expense.txns = structuredClone(snapshot.transactions.items);
    state.expensesState = "ready";
  };

  const persistTransaction = (
    recipe: (draft: Draft<FinanceStore>) => void,
    request: (view: ExpenseTransactionView, expectedRevision: number) => Promise<PersonalMutationResponse<TransactionMutationResult>>,
    updateCurrentPage?: (page: Draft<TransactionPageResponse>) => void,
  ): void => {
    const expenseView = currentExpenseView();
    if (updateCurrentPage) {
      set((state) => {
        if (sameTransactionQuery(state.transactionQuery, expenseView.transactions) && state.transactionPage) {
          updateCurrentPage(state.transactionPage);
        }
      });
    }
    persist(recipe, (expectedRevision) => request(expenseView, expectedRevision), {
      refresh: "none",
      reconcile: (state, snapshot) => applyTransactionSnapshot(state, expenseView, snapshot),
    });
  };

  return {
    auth: "checking",
    authMessage: "",
    user: null,
    ledger: createDefaultStore(),
    sharedFunds: {},
    bootstrapData: null,
    expenseConfig: null,
    expenseSummary: null,
    transactionPage: null,
    transactionQuery: null,
    fundOverview: null,
    fundDetails: {},
    statistics: null,
    debtOverview: null,
    debtDetails: {},
    expensesState: "idle",
    fundsState: "idle",
    statisticsState: "idle",
    debtsState: "idle",
    loaded: false,
    selectedYear: currentPeriod().year,
    selectedMonth: currentPeriod().month,
    periodReady: true,
    statisticsScope: { mode: "year", year: currentPeriod().year },
    saveState: "loading",
    saveMessage: "Đang tải dữ liệu…",
    workspaceRevision: 1,
    marketState: "idle",
    marketMessage: "Giá thị trường chưa cập nhật.",

    async bootstrap() {
      set((state) => {
        state.auth = "checking";
        state.authMessage = "";
      });
      try {
        let bootstrap = await api.loadData();
        const period = currentPeriod();
        if (!bootstrap.availableYears.includes(period.year)) {
          const ensured = await api.ensureYear(period.year, bootstrap.workspaceRevision);
          bootstrap = {
            ...bootstrap,
            workspaceRevision: ensured.workspaceRevision,
            availableYears: [...bootstrap.availableYears, period.year].sort((left, right) => left - right),
          };
        }
        applyBootstrap(bootstrap, true);
        set((state) => {
          state.auth = "authenticated";
          state.loaded = true;
          state.selectedYear = period.year;
          state.selectedMonth = period.month;
          state.periodReady = true;
          state.statisticsScope = { mode: "year", year: period.year };
          state.saveState = "saved";
          state.saveMessage = "Đã tải dữ liệu.";
        });
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
            state.authMessage = "Không thể kết nối. Hãy kiểm tra mạng rồi thử lại.";
            state.loaded = false;
            state.saveState = "error";
            state.saveMessage = "Không tải được dữ liệu.";
          });
        }
      }
    },

    async loadExpenses(query = {}) {
      const requestId = ++expensesRequest;
      const { selectedYear: year, selectedMonth } = get();
      const month = selectedMonth + 1;
      const bounds = monthBounds(year, selectedMonth);
      const nextQuery: TransactionQuery = {
        ...bounds,
        page: 1,
        pageSize: 10,
        ...query,
      };
      set((state) => { state.expensesState = "loading"; });
      try {
        const configPromise = get().expenseConfig ? Promise.resolve(get().expenseConfig!) : api.loadExpenseConfig();
        const [config, summary, transactions] = await Promise.all([
          configPromise,
          api.loadExpenseSummary(year, month),
          api.loadTransactions(nextQuery),
        ]);
        if (requestId !== expensesRequest) return;
        applyExpenseConfig(config);
        set((state) => {
          state.expenseSummary = summary;
          state.transactionPage = transactions;
          state.transactionQuery = nextQuery;
          state.ledger.expense.txns = structuredClone(transactions.items);
          state.expensesState = "ready";
        });
      } catch (error) {
        if (error instanceof UnauthorizedError) markUnauthorized();
        if (requestId === expensesRequest) set((state) => { state.expensesState = "error"; });
      }
    },

    async loadTransactions(query) {
      const requestId = ++expensesRequest;
      set((state) => { state.expensesState = "loading"; });
      try {
        const transactions = await api.loadTransactions(query);
        if (requestId !== expensesRequest) return;
        set((state) => {
          state.transactionPage = transactions;
          state.transactionQuery = query;
          state.ledger.expense.txns = structuredClone(transactions.items);
          state.expensesState = "ready";
        });
      } catch (error) {
        if (error instanceof UnauthorizedError) markUnauthorized();
        if (requestId === expensesRequest) set((state) => { state.expensesState = "error"; });
      }
    },

    async loadDebts() {
      const requestId = ++debtsRequest;
      set((state) => { state.debtsState = "loading"; });
      try {
        const configPromise = get().expenseConfig ? Promise.resolve(get().expenseConfig!) : api.loadExpenseConfig();
        const [overview, config] = await Promise.all([api.loadDebts(), configPromise]);
        if (requestId !== debtsRequest) return;
        applyExpenseConfig(config);
        set((state) => {
          state.debtOverview = overview;
          state.debtDetails = {};
          state.debtsState = "ready";
        });
      } catch (error) {
        if (error instanceof UnauthorizedError) markUnauthorized();
        if (requestId === debtsRequest) set((state) => { state.debtsState = "error"; });
      }
    },

    async loadDebtDetail(debtId) {
      const cached = get().debtDetails[debtId];
      if (cached) return cached;
      try {
        const detail = await api.loadDebtDetail(debtId);
        set((state) => { state.debtDetails[debtId] = detail; });
        return detail;
      } catch (error) {
        if (error instanceof UnauthorizedError) markUnauthorized();
        return null;
      }
    },

    async loadFunds(fresh = false) {
      const requestId = ++fundsRequest;
      const { selectedYear: year, selectedMonth } = get();
      set((state) => { state.fundsState = "loading"; });
      try {
        const overview = await api.loadFundOverview(year, selectedMonth + 1, fresh);
        if (requestId !== fundsRequest) return;
        applyFundOverview(overview);
        set((state) => {
          state.fundsState = "ready";
          state.marketState = overview.market.errors.length ? "error" : "idle";
          state.marketMessage = overview.market.updatedAt
            ? `Giá thị trường cập nhật ${new Date(overview.market.updatedAt).toLocaleString("vi-VN")}.`
            : "Giá thị trường chưa cập nhật.";
        });
      } catch (error) {
        if (error instanceof UnauthorizedError) markUnauthorized();
        if (requestId === fundsRequest) set((state) => { state.fundsState = "error"; });
      }
    },

    async loadFundDetail(fundId) {
      const { selectedYear: year, selectedMonth } = get();
      const month = selectedMonth + 1;
      const key = detailKey(fundId, year, month);
      const cached = get().fundDetails[key];
      if (cached) return cached;
      try {
        const detail = await api.loadFundMonthDetail(fundId, year, month);
        set((state) => {
          state.fundDetails[key] = detail;
          ensureYear(state.ledger, year);
          state.ledger.years[String(year)]!.funds[fundId]![selectedMonth] = detail.amount;
          state.ledger.years[String(year)]!.details[fundId]![selectedMonth] = structuredClone(detail.detail);
        });
        return detail;
      } catch {
        return null;
      }
    },

    async loadStatistics(scope = get().statisticsScope) {
      const requestId = ++statisticsRequest;
      set((state) => {
        state.statisticsScope = scope;
        state.statisticsState = "loading";
      });
      try {
        const statistics = await api.loadStatistics(scope);
        if (requestId !== statisticsRequest) return;
        set((state) => {
          state.statistics = statistics;
          state.statisticsState = "ready";
        });
      } catch (error) {
        if (error instanceof UnauthorizedError) markUnauthorized();
        if (requestId === statisticsRequest) set((state) => { state.statisticsState = "error"; });
      }
    },

    beginLogin() {
      const current = location.pathname;
      const returnTo = ["/funds", "/expenses", "/statistics", "/debts"].includes(current) ? current : "/expenses";
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
          state.bootstrapData = null;
        });
      }
    },

    setPeriod(year, month) {
      const selectedMonth = Math.max(0, Math.min(11, month));
      const shouldCreate = !get().bootstrapData?.availableYears.includes(year);
      const selectionVersion = ++periodSelectionVersion;
      const commitPeriod = (ready: boolean): void => set((state) => {
        state.selectedYear = year;
        state.selectedMonth = selectedMonth;
        state.periodReady = ready;
        state.ledger.years[String(year)] ??= blankYearWith(state.ledger.funds);
        if (state.statisticsScope.mode === "year") state.statisticsScope = { mode: "year", year };
      });
      if (!shouldCreate) {
        commitPeriod(true);
        return;
      }

      commitPeriod(false);

      set((state) => {
        state.saveState = "saving";
        state.saveMessage = `Đang tạo năm ${year}…`;
      });
      const operation = writeQueue.then(() => api.ensureYear(year, get().workspaceRevision));
      writeQueue = operation.then(() => undefined, () => undefined);
      void operation.then((response) => {
        set((state) => {
          state.workspaceRevision = response.workspaceRevision;
          if (state.bootstrapData) {
            state.bootstrapData.workspaceRevision = response.workspaceRevision;
            if (!state.bootstrapData.availableYears.includes(year)) {
              state.bootstrapData.availableYears.push(year);
              state.bootstrapData.availableYears.sort((left, right) => left - right);
            }
          }
          state.ledger.years[String(year)] ??= blankYearWith(state.ledger.funds);
          state.saveState = "saved";
          state.saveMessage = "Đã lưu thay đổi.";
        });
        if (selectionVersion === periodSelectionVersion) {
          set((state) => { state.periodReady = true; });
        }
      }).catch((error: unknown) => {
        if (error instanceof UnauthorizedError) {
          markUnauthorized();
          return;
        }
        set((state) => {
          state.saveState = "error";
          state.saveMessage = "Không thể tạo năm mới. Đang tải lại dữ liệu…";
        });
        if (get().auth === "authenticated") void reloadAfterConflict();
      });
    },

    setStatisticsScope(scope) {
      set((state) => { state.statisticsScope = scope; });
    },

    updateLedger(recipe) {
      writeVersion += 1;
      set((state) => { recipe(state.ledger); });
    },

    mutateLedger(recipe, request, options) {
      persist(recipe, request, options);
    },

    mutateExpenseConfig(recipe, request) {
      persist(recipe, request, { invalidateExpenseConfig: true });
    },

    createTransaction(transaction) {
      persistTransaction((draft) => {
        draft.expense.txns.push(transaction);
      }, (expenseView, expectedRevision) => api.createTransaction(transaction, expenseView, expectedRevision));
    },

    async applyAssistantConfirmation(response) {
      const transactionQueryBefore = get().transactionQuery;
      const transactionResults = response.results.filter((result) => result.kind === "create_transaction");
      const fundResults = response.results.filter((result) => result.kind === "allocate_fund");
      set((state) => {
        state.workspaceRevision = response.workspaceRevision;
        if (state.bootstrapData) state.bootstrapData.workspaceRevision = response.workspaceRevision;
        state.statistics = null;
        if (transactionResults.length) {
          state.expenseSummary = null;
          state.transactionPage = null;
          state.transactionQuery = null;
        }
        if (fundResults.length) {
          state.fundOverview = null;
          state.fundDetails = {};
          for (const result of fundResults) {
            const year = state.ledger.years[String(result.fund.year)];
            if (year?.funds[result.fund.fundId]) {
              year.funds[result.fund.fundId]![result.fund.month - 1] = result.fund.amount;
            }
          }
        }
        state.saveState = "saved";
        state.saveMessage = response.alreadyApplied ? "Nhóm thao tác đã được ghi trước đó." : "Đã lưu từ trợ lý.";
      });
      if (transactionResults.length && location.pathname === "/expenses") {
        await get().loadExpenses(transactionQueryBefore ?? {});
      } else if (fundResults.length && location.pathname === "/funds") {
        await get().loadFunds(true);
      }
    },

    async reloadAfterAssistantConflict() {
      await reloadAfterConflict();
    },

    updateTransaction(transaction) {
      persistTransaction((draft) => {
        const index = draft.expense.txns.findIndex((item) => item.id === transaction.id);
        if (index >= 0) draft.expense.txns[index] = transaction;
      }, (expenseView, expectedRevision) => api.updateTransaction(transaction.id, transaction, expenseView, expectedRevision), (page) => {
        const index = page.items.findIndex((item) => item.id === transaction.id);
        if (index >= 0) page.items[index] = transaction;
      });
    },

    deleteTransaction(id) {
      persistTransaction((draft) => {
        draft.expense.txns = draft.expense.txns.filter((item) => item.id !== id);
      }, (expenseView, expectedRevision) => api.deleteTransaction(id, expenseView, expectedRevision));
    },

    async mutateSharedLedger(fundId, recipe, request, options = {}) {
      const version = ++writeVersion;
      const mutationVersion = ++queuedMutationVersion;
      if (options.refresh !== "none") pendingRouteRefresh = true;
      set((state) => {
        recipe(state.ledger);
        state.saveState = "saving";
        state.saveMessage = "Đang lưu quỹ chung…";
      });
      const operation = writeQueue.then(async () => {
        const shared = get().sharedFunds[fundId];
        if (!shared) throw new Error("Không tìm thấy quỹ chung.");
        const result = await request(shared.revision);
        set((state) => {
          if (state.sharedFunds[fundId]) state.sharedFunds[fundId]!.revision = result.revision;
          const overviewFund = state.fundOverview?.funds.find((fund) => fund.id === fundId);
          if (overviewFund) overviewFund.revision = result.revision;
          options.reconcile?.(state as Draft<FinanceState>, result.data);
        });
        await refreshWhenSettled(mutationVersion);
      });
      writeQueue = operation.then(() => undefined, () => undefined);
      void operation.then(() => {
        if (version === writeVersion) {
          set((state) => {
            state.saveState = "saved";
            state.saveMessage = "Đã lưu thay đổi.";
          });
        }
      });
      try {
        await operation;
      } catch (error) {
        if (error instanceof UnauthorizedError) markUnauthorized();
        else {
          pendingRouteRefresh = false;
          set((state) => {
            state.saveState = "error";
            state.saveMessage = "Quỹ chung đã thay đổi. Đang tải lại dữ liệu…";
          });
          await get().loadFunds(true);
        }
        throw error;
      }
    },

    async shareFund(fundId, email, role) {
      const mutationVersion = ++queuedMutationVersion;
      ++writeVersion;
      pendingRouteRefresh = true;
      const operation = writeQueue.then(() => api.createSharedFund(fundId, email, role, get().workspaceRevision));
      writeQueue = operation.then(() => undefined, () => undefined);
      try {
        const result = await operation;
        set((state) => {
          state.workspaceRevision = result.workspaceRevision;
          if (state.bootstrapData) state.bootstrapData.workspaceRevision = result.workspaceRevision;
        });
        await refreshWhenSettled(mutationVersion);
      } catch (error) {
        pendingRouteRefresh = false;
        throw error;
      }
    },

    async deleteSharedFund(fundId) {
      const shared = get().sharedFunds[fundId];
      if (!shared) throw new Error("Không tìm thấy quỹ chung.");
      const mutationVersion = ++queuedMutationVersion;
      ++writeVersion;
      pendingRouteRefresh = true;
      const operation = writeQueue.then(() => {
        const latest = get().sharedFunds[fundId];
        if (!latest) throw new Error("Không tìm thấy quỹ chung.");
        return api.deleteSharedFund(fundId, latest.revision);
      });
      writeQueue = operation.then(() => undefined, () => undefined);
      try {
        await operation;
        await refreshWhenSettled(mutationVersion);
      } catch (error) {
        pendingRouteRefresh = false;
        throw error;
      }
    },

    replaceLedger(ledger, shouldPersist = true) {
      if (!shouldPersist) {
        set((state) => { state.ledger = ledger; });
        return;
      }
      const payload = privateLedger(ledger) as unknown as Record<string, unknown>;
      set((state) => {
        state.ledger = structuredClone(ledger);
        state.saveState = "saving";
        state.saveMessage = "Đang nhập dữ liệu…";
      });
      const operation = writeQueue.then(() => api.importData(payload, get().workspaceRevision));
      writeQueue = operation.then(() => undefined, () => undefined);
      void operation.then(async (bootstrap) => {
        clearPersonalCaches();
        applyBootstrap(bootstrap, true);
        await refreshCurrentRoute();
        set((state) => {
          state.saveState = "saved";
          state.saveMessage = "Đã nhập dữ liệu.";
        });
      }).catch(async () => {
        set((state) => {
          state.saveState = "error";
          state.saveMessage = "Không nhập được dữ liệu.";
        });
        await reloadAfterConflict();
      });
    },

    async persistMarketQuotes(payload) {
      const mutationVersion = ++queuedMutationVersion;
      ++writeVersion;
      pendingRouteRefresh = true;
      try {
        const operation = writeQueue.then(() => api.marketQuotes(payload, get().workspaceRevision));
        writeQueue = operation.then(() => undefined, () => undefined);
        const result = await operation;
        set((state) => {
          state.workspaceRevision = result.workspaceRevision;
          if (state.bootstrapData) state.bootstrapData.workspaceRevision = result.workspaceRevision;
          mergeMarketResponse(state.ledger, result.quotes);
        });
        await refreshWhenSettled(mutationVersion);
        return result;
      } catch (error) {
        pendingRouteRefresh = false;
        if (error instanceof UnauthorizedError) markUnauthorized();
        else if (error instanceof ApiRequestError && error.code === "revision_conflict") {
          await reloadAfterConflict();
        }
        throw error;
      }
    },

    async refreshMarket(force = false) {
      const assets = get().fundOverview?.marketAssets ?? collectAssetsFromLoadedDetails(get().ledger);
      if (!assets.length) {
        set((state) => { state.marketMessage = "Chưa có mã tài sản để cập nhật."; });
        return;
      }
      set((state) => {
        state.marketState = "loading";
        state.marketMessage = force ? "Đang làm mới giá thị trường…" : "Đang cập nhật giá thị trường…";
      });
      try {
        const result = await get().persistMarketQuotes({ assets, force });
        set((state) => {
          state.marketState = result.quotes.errors.length ? "error" : "idle";
          state.marketMessage = result.quotes.errors.length
            ? "Chưa cập nhật được một số giá thị trường."
            : `Giá thị trường cập nhật ${new Date(result.quotes.fetchedAt).toLocaleString("vi-VN")}.`;
        });
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          return;
        }
        if (error instanceof ApiRequestError && error.code === "revision_conflict") {
          return;
        }
        set((state) => {
          state.marketState = "error";
          state.marketMessage = "Không cập nhật được giá thị trường.";
        });
      }
    },
  };
}));

function collectAssetsFromLoadedDetails(store: FinanceStore): import("@chi-tieu/shared").MarketAssetRequest[] {
  const assets: import("@chi-tieu/shared").MarketAssetRequest[] = [];
  const keys = new Set<string>();
  const add = (asset: import("@chi-tieu/shared").MarketAssetRequest): void => {
    const key = JSON.stringify(asset);
    if (!keys.has(key)) {
      keys.add(key);
      assets.push(asset);
    }
  };
  for (const fund of store.funds) {
    if (fund.cat === "gold") add({ type: "gold" });
    if (fund.cat !== "stock" && fund.cat !== "crypto") continue;
    for (const year of Object.values(store.years)) {
      for (const detail of year.details[fund.id] ?? []) {
        if (detail?.type !== "hold") continue;
        for (const lot of detail.lots) {
          const symbol = lot.ticker.trim().toUpperCase();
          if (!symbol) continue;
          if (fund.cat === "stock") {
            add({ type: "stock", symbol, ...(lot.exchange ? { exchange: lot.exchange } : {}) });
          } else {
            add({ type: "crypto", symbol, ...(lot.providerId ? { providerId: lot.providerId } : {}) });
          }
        }
      }
    }
  }
  return assets;
}
