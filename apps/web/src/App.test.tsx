import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  FinanceStore,
  StatisticsScope,
  Transaction,
  TransactionQuery,
} from "@chi-tieu/shared";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { AuthGate } from "./components/AuthGate";
import { api } from "./lib/api";
import { createDefaultStore } from "./lib/domain";
import { useFinanceStore } from "./store/finance-store";

vi.mock("react-chartjs-2", () => ({
  Doughnut: () => <div data-testid="donut-chart" />,
  Bar: () => <div data-testid="bar-chart" />,
}));

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function authenticatedFetch(mutationStatus = 200, prepareLedger?: (ledger: ReturnType<typeof createDefaultStore>) => void) {
  const ledger = createDefaultStore();
  prepareLedger?.(ledger);
  let revision = 1;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/auth/me") return jsonResponse({ user: { sub: "1", email: "test@example.com", name: "Người dùng", picture: "" } });
    if (url === "/api/data") return jsonResponse(bootstrapResponse(ledger, revision));
    if (url === "/api/backup/export") return jsonResponse(ledger);
    if (url === "/api/expenses/config") return jsonResponse({
      categories: ledger.expense.cats,
      incomeCategories: ledger.expense.incomeCats,
      accountTypes: ledger.expense.accountTypes,
      accounts: ledger.expense.accounts,
    });
    if (url.startsWith("/api/expenses/summary?")) {
      const params = new URL(url, "http://localhost").searchParams;
      return jsonResponse(expenseSummary(ledger, Number(params.get("year")), Number(params.get("month"))));
    }
    if (url.startsWith("/api/transactions?")) {
      return jsonResponse(transactionPage(ledger, new URL(url, "http://localhost").searchParams));
    }
    if (url === "/api/debts") {
      return jsonResponse({
        summary: { liabilities: 0, receivables: 0, netDebt: 0, overdueCount: 0, dueSoonCount: 0 },
        items: [],
      });
    }
    if (url.startsWith("/api/funds/overview?")) {
      const params = new URL(url, "http://localhost").searchParams;
      return jsonResponse({
        year: Number(params.get("year")),
        month: Number(params.get("month")),
        note: "",
        income: 0,
        yearActiveMonths: 0,
        allTimeActiveMonths: 0,
        showGoals: false,
        debt: ledger.financialProfile.debt,
        debtSummary: { liabilities: 0, receivables: 0, netDebt: 0, overdueCount: 0, dueSoonCount: 0 },
        funds: [],
        marketAssets: [],
        market: ledger.market,
      });
    }
    if (url.startsWith("/api/statistics?")) {
      return jsonResponse(statisticsResponse(ledger, new URL(url, "http://localhost").searchParams));
    }
    if (init?.method && init.method !== "GET") {
      if (mutationStatus !== 200 && url === "/api/transactions") {
        return jsonResponse(
          mutationStatus === 409
            ? { error: "revision_conflict", message: "Dữ liệu đã thay đổi." }
            : { error: "unauthorized" },
          mutationStatus,
        );
      }
      let data: unknown = {};
      if (url === "/api/transactions" && init.method === "POST") {
        const payload = JSON.parse(String(init.body)) as TransactionMutationPayload;
        ledger.expense.txns.push(payload.transaction);
        data = { transaction: payload.transaction, ...transactionMutationSnapshot(ledger, payload.expenseView) };
      } else if (/^\/api\/transactions\/[^/]+$/.test(url) && init.method === "PUT") {
        const payload = JSON.parse(String(init.body)) as TransactionMutationPayload;
        const id = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
        const transaction = { ...payload.transaction, id };
        const index = ledger.expense.txns.findIndex((item) => item.id === id);
        if (index >= 0) ledger.expense.txns[index] = transaction;
        data = { transaction, ...transactionMutationSnapshot(ledger, payload.expenseView) };
      } else if (/^\/api\/transactions\/[^/]+$/.test(url) && init.method === "DELETE") {
        const payload = JSON.parse(String(init.body)) as Pick<TransactionMutationPayload, "expenseView">;
        const deletedId = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
        ledger.expense.txns = ledger.expense.txns.filter((item) => item.id !== deletedId);
        data = { deletedId, ...transactionMutationSnapshot(ledger, payload.expenseView) };
      } else if (/^\/api\/years\/\d+$/.test(url)) {
        data = { year: Number(url.slice(url.lastIndexOf("/") + 1)) };
      }
      revision += 1;
      return jsonResponse({ data, workspaceRevision: revision });
    }
    return new Response(null, { status: 204 });
  });
}

interface TransactionMutationPayload {
  transaction: Transaction;
  expenseView: { year: number; month: number; transactions: TransactionQuery };
}

function transactionMutationSnapshot(
  ledger: ReturnType<typeof createDefaultStore>,
  expenseView: TransactionMutationPayload["expenseView"],
) {
  return {
    summary: expenseSummary(ledger, expenseView.year, expenseView.month),
    transactions: transactionPage(ledger, transactionSearchParams(expenseView.transactions)),
  };
}

function transactionSearchParams(query: TransactionQuery): URLSearchParams {
  const params = new URLSearchParams({
    from: query.from,
    to: query.to,
    page: String(query.page ?? 1),
    pageSize: String(query.pageSize ?? 10),
  });
  if (query.type) params.set("type", query.type);
  if (query.categoryId) params.set("categoryId", query.categoryId);
  if (query.accountId) params.set("accountId", query.accountId);
  if (query.q) params.set("q", query.q);
  return params;
}

function bootstrapResponse(ledger: FinanceStore, workspaceRevision: number) {
  return {
    user: { sub: "1", email: "test@example.com", name: "Người dùng", picture: "" },
    workspaceRevision,
    features: { aiAssistant: false },
    preferences: {
      showGoals: ledger.showGoals,
      onboarding: ledger.onboarding,
      financialProfile: {
        monthlyIncome: ledger.financialProfile.monthlyIncome,
        emergencyFundGoal: ledger.financialProfile.emergencyFundGoal,
        debt: ledger.financialProfile.debt,
      },
      incomeMigrationVersion: ledger.incomeMigrationVersion ?? 1,
      futureIncomeResetVersion: ledger.futureIncomeResetVersion ?? 1,
      ...(ledger.usdRate !== undefined ? { usdRate: ledger.usdRate } : {}),
    },
    availableYears: Object.keys(ledger.years).map(Number),
  };
}

function filteredTransactions(ledger: FinanceStore, params: URLSearchParams): Transaction[] {
  const from = params.get("from") ?? "0000-01-01";
  const to = params.get("to") ?? "9999-12-31";
  const type = params.get("type");
  const categoryId = params.get("categoryId");
  const accountId = params.get("accountId");
  const q = params.get("q")?.toLocaleLowerCase("vi") ?? "";
  return ledger.expense.txns
    .filter((transaction) => transaction.date >= from && transaction.date <= to)
    .filter((transaction) => !type || transaction.type === type)
    .filter((transaction) => !categoryId || transaction.cat === categoryId)
    .filter((transaction) => !accountId || transaction.accountId === accountId)
    .filter((transaction) => !q || transaction.note.toLocaleLowerCase("vi").includes(q))
    .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
}

function transactionPage(ledger: FinanceStore, params: URLSearchParams) {
  const items = filteredTransactions(ledger, params);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.max(1, Number(params.get("pageSize")) || 10);
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    total: items.length,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(items.length / pageSize)),
  };
}

function expenseSummary(ledger: FinanceStore, year: number, month: number) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const transactions = ledger.expense.txns.filter((transaction) => transaction.date.startsWith(prefix));
  const income = transactions.filter((transaction) => transaction.type === "income")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const spent = transactions.filter((transaction) => transaction.type === "expense")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const funds = Object.values(ledger.years[String(year)]?.funds ?? {})
    .reduce((sum, values) => sum + (values[month - 1] ?? 0), 0);
  const byExpenseCategory: Record<string, number> = {};
  const byIncomeCategory: Record<string, number> = {};
  const byAccount: Record<string, number> = {};
  for (const transaction of transactions) {
    const target = transaction.type === "expense" ? byExpenseCategory : byIncomeCategory;
    target[transaction.cat] = (target[transaction.cat] ?? 0) + transaction.amount;
    if (transaction.type === "expense" && transaction.accountId) {
      byAccount[transaction.accountId] = (byAccount[transaction.accountId] ?? 0) + transaction.amount;
    }
  }
  return {
    year,
    month,
    income,
    spent,
    funds,
    balance: income - spent - funds,
    byExpenseCategory,
    byIncomeCategory,
    accountExpenses: ledger.expense.accounts
      .filter((account) => byAccount[account.id])
      .map((account) => ({ id: account.id, name: account.name, color: "#3D5A80", amount: byAccount[account.id]! })),
  };
}

function statisticsResponse(ledger: FinanceStore, params: URLSearchParams) {
  const mode = params.get("mode") ?? "all";
  const scope: StatisticsScope = mode === "year"
    ? { mode, year: Number(params.get("year")) }
    : mode === "month"
      ? { mode, month: params.get("month")! }
      : mode === "range"
        ? { mode, from: params.get("from")!, to: params.get("to")! }
        : { mode: "all" };
  const availableYears = Object.keys(ledger.years).map(Number);
  const periods = availableYears.flatMap((year) =>
    Array.from({ length: 12 }, (_, month) => ({ year, month, key: `${year}-${String(month + 1).padStart(2, "0")}` })))
    .filter((period) => scope.mode === "all"
      || (scope.mode === "year" && period.year === scope.year)
      || (scope.mode === "month" && period.key === scope.month)
      || (scope.mode === "range" && period.key >= scope.from && period.key <= scope.to));
  const rows = periods.map((period) => {
    const summary = expenseSummary(ledger, period.year, period.month + 1);
    return {
      ...period,
      income: summary.income,
      spent: summary.spent,
      funds: summary.funds,
      balance: summary.balance,
      byFund: Object.fromEntries(ledger.funds.map((fund) => [
        fund.id,
        ledger.years[String(period.year)]?.funds[fund.id]?.[period.month] ?? 0,
      ])),
    };
  });
  const totals = rows.reduce((result, row) => ({
    income: result.income + row.income,
    spent: result.spent + row.spent,
    funds: result.funds + row.funds,
    balance: result.balance + row.balance,
  }), { income: 0, spent: 0, funds: 0, balance: 0 });
  return {
    scope,
    availableYears,
    funds: ledger.funds.map(({ id, name, color }) => ({ id, name, color })),
    rows,
    totals,
    expenseBreakdown: [],
    incomeBreakdown: [],
    accountExpenses: [],
  };
}

beforeEach(() => {
  useFinanceStore.setState({
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
    debtOverview: null,
    debtDetails: {},
    statistics: null,
    expensesState: "idle",
    fundsState: "idle",
    debtsState: "idle",
    statisticsState: "idle",
    workspaceRevision: 1,
    loaded: false,
    selectedYear: 2026,
    selectedMonth: 6,
    statisticsScope: { mode: "year", year: 2026 },
    saveState: "loading",
    saveMessage: "Đang tải dữ liệu…",
  });
  vi.restoreAllMocks();
});

describe("App", () => {
  it("hiện tiến trình và ẩn nút đăng nhập khi đang bootstrap", () => {
    render(<AuthGate />);
    expect(screen.getByRole("progressbar", { name: "Đang tải dữ liệu của bạn" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Đăng nhập với Google" })).not.toBeInTheDocument();
  });

  it("hiện cổng đăng nhập khi API trả 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unauthorized" }, 401)));
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("button", { name: "Đăng nhập với Google" })).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("hiện thông báo lỗi và nút đăng nhập khi bootstrap thất bại", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "server_error" }, 500)));
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    expect(await screen.findByText("Không thể kết nối. Hãy kiểm tra mạng rồi thử lại.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Đăng nhập với Google" })).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("tải sổ và render route React từ URL trực tiếp", async () => {
    const fetchMock = authenticatedFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter initialEntries={["/statistics"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Thống kê tài chính" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: /Diễn biến tích lũy/ }, { timeout: 5_000 })).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/data", expect.anything()));
  });

  it("đổi được phạm vi thống kê sang tháng và khoảng tháng", async () => {
    vi.stubGlobal("fetch", authenticatedFetch());
    render(<MemoryRouter initialEntries={["/statistics"]}><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Thống kê tài chính" });

    fireEvent.click(await screen.findByRole("combobox", { name: "Phạm vi" }, { timeout: 5_000 }));
    fireEvent.click(screen.getByRole("option", { name: "Tháng cụ thể" }));
    expect(screen.getByRole("combobox", { name: "Tháng thống kê" })).toBeVisible();

    fireEvent.click(screen.getByRole("combobox", { name: "Phạm vi" }));
    fireEvent.click(screen.getByRole("option", { name: "Khoảng tháng" }));
    expect(screen.getByRole("combobox", { name: "Từ tháng" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Đến tháng" })).toBeVisible();
  });

  it("chuyển biểu đồ chi tiêu bằng tab trên trang chi tiêu", async () => {
    vi.stubGlobal("fetch", authenticatedFetch(200, (ledger) => {
      ledger.expense.txns.push({ id: "cash-expense", date: "2026-07-01", type: "expense", cat: "food", accountId: "cash", amount: 250_000, note: "Trưa" });
    }));
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    const accountTab = await screen.findByRole("tab", { name: "Theo tài khoản" }, { timeout: 5_000 });
    expect(screen.queryByRole("heading", { name: "Chi tiêu theo tài khoản" })).not.toBeInTheDocument();
    fireEvent.click(accountTab);
    expect(await screen.findByRole("heading", { name: "Chi tiêu theo tài khoản" }, { timeout: 5_000 })).toBeVisible();
    expect(screen.getAllByText("Tiền mặt").length).toBeGreaterThan(0);
  });

  it("cảnh báo khi danh mục dùng từ 80% ngân sách", async () => {
    vi.stubGlobal("fetch", authenticatedFetch(200, (ledger) => {
      ledger.expense.txns.push({ id: "near-budget", date: "2026-07-01", type: "expense", cat: "food", amount: 4_000_000, note: "Gần hạn mức" });
    }));
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    expect(await screen.findByText("Sắp chạm hạn mức 80%.")).toBeVisible();
    expect(screen.getAllByText(/Ăn uống/).length).toBeGreaterThan(0);
  });

  it("mở được trang vay nợ và biểu mẫu tạo khoản", async () => {
    vi.stubGlobal("fetch", authenticatedFetch());
    render(<MemoryRouter initialEntries={["/debts"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Quản lý vay & nợ" })).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: "+ Thêm khoản vay/nợ" }));
    expect(screen.getByRole("dialog", { name: "Thêm khoản vay/nợ" })).toBeVisible();
  });

  it("phân trang lịch sử thu chi theo 10 giao dịch", async () => {
    vi.stubGlobal("fetch", authenticatedFetch(200, (ledger) => {
      for (let index = 1; index <= 11; index += 1) {
        ledger.expense.txns.push({ id: `history-${index}`, date: `2026-07-${String(index).padStart(2, "0")}`, type: "expense", cat: "food", amount: index, note: `Lịch sử ${index}` });
      }
    }));
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("navigation", { name: "Phân trang lịch sử" })).toBeVisible();
    expect(screen.getByText("Lịch sử 11")).toBeVisible();
    expect(screen.queryByText("Lịch sử 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sau →" }));
    expect(await screen.findByText("Lịch sử 1")).toBeVisible();
    await waitFor(() => expect(screen.queryByText("Lịch sử 11")).not.toBeInTheDocument());
  });

  it("cho chọn thêm năm trong picker và đóng khi click ra ngoài", async () => {
    const fetchMock = authenticatedFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Theo dõi chi tiêu" });

    fireEvent.click(screen.getByRole("button", { name: "Tháng 7, 2026" }));
    const yearSelect = screen.getByRole("combobox", { name: "Năm" });
    fireEvent.click(yearSelect);
    expect(screen.getAllByRole("option").length).toBeGreaterThan(2);

    fireEvent.click(screen.getByRole("option", { name: "2030" }));
    expect(screen.getByRole("button", { name: "Tháng 7, 2030" })).toBeVisible();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Đã lưu"));

    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Chọn tháng và năm" })).not.toBeInTheDocument());
  });

  it("thêm giao dịch optimistic rồi gọi CRUD transaction với revision", async () => {
    const fetchMock = authenticatedFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Theo dõi chi tiêu" });
    await waitFor(() => {
      const transactionReads = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/transactions?"));
      expect(transactionReads).toHaveLength(1);
    });
    const requestsBeforeMutation = fetchMock.mock.calls.length;

    const amount = screen.getByRole("textbox", { name: "Số tiền" });
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: "250000" } });
    fireEvent.blur(amount);
    fireEvent.change(screen.getByRole("textbox", { name: "Ghi chú" }), { target: { value: "Bữa trưa RTL" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Thêm khoản" }));

    expect(await screen.findByText("Bữa trưa RTL")).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/transactions", expect.objectContaining({ method: "POST" })));
    expect(screen.getByRole("status")).toHaveTextContent("Đã lưu");
    const postMutationReads = fetchMock.mock.calls.slice(requestsBeforeMutation)
      .filter(([url]) => /\/api\/(expenses\/config|expenses\/summary|transactions\?)/.test(String(url)));
    expect(postMutationReads).toHaveLength(0);
  });

  it("kích hoạt nút thêm ngay khi nhập tiền và cho phép xóa số tiền", async () => {
    vi.stubGlobal("fetch", authenticatedFetch());
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Theo dõi chi tiêu" });

    const amount = screen.getByRole("textbox", { name: "Số tiền" });
    const addButton = screen.getByRole("button", { name: "+ Thêm khoản" });
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: "250000" } });
    expect(addButton).toBeEnabled();

    fireEvent.change(amount, { target: { value: "" } });
    expect(amount).toHaveValue("");
    expect(addButton).toBeDisabled();
  });

  it("hiển thị giao dịch vừa sửa trước khi máy chủ phản hồi", async () => {
    vi.stubGlobal("fetch", authenticatedFetch(200, (ledger) => {
      ledger.expense.txns.push({
        id: "instant-edit",
        date: "2026-07-20",
        type: "expense",
        cat: "food",
        amount: 100_000,
        note: "Giao dịch cũ",
      });
    }));
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    await screen.findByText("Giao dịch cũ");

    let resolveUpdate!: (response: Awaited<ReturnType<typeof api.updateTransaction>>) => void;
    const pendingUpdate = new Promise<Awaited<ReturnType<typeof api.updateTransaction>>>((resolve) => {
      resolveUpdate = resolve;
    });
    const updateSpy = vi.spyOn(api, "updateTransaction").mockReturnValue(pendingUpdate);

    fireEvent.click(screen.getByLabelText("Sửa giao dịch"));
    fireEvent.change(screen.getByRole("textbox", { name: "Ghi chú đang sửa" }), { target: { value: "Đã sửa ngay" } });
    fireEvent.click(screen.getByLabelText("Lưu giao dịch"));
    expect(screen.getByText("Đã sửa ngay")).toBeVisible();

    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    resolveUpdate({
      workspaceRevision: 2,
      data: {
        summary: useFinanceStore.getState().expenseSummary!,
        transactions: useFinanceStore.getState().transactionPage!,
      },
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Đã lưu"));
  });

  it("dùng snapshot mutation khi sửa và xóa giao dịch mà không tải lại Chi tiêu", async () => {
    const fetchMock = authenticatedFetch(200, (ledger) => {
      ledger.expense.txns.push({
        id: "snapshot-edit",
        date: "2026-07-20",
        type: "expense",
        cat: "food",
        amount: 100_000,
        note: "Giao dịch cũ",
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    await screen.findByText("Giao dịch cũ");
    await waitFor(() => {
      const transactionReads = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/transactions?"));
      expect(transactionReads).toHaveLength(1);
    });

    const requestsBeforeUpdate = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByLabelText("Sửa giao dịch"));
    fireEvent.change(screen.getByRole("textbox", { name: "Ghi chú đang sửa" }), { target: { value: "Giao dịch đã sửa" } });
    fireEvent.click(screen.getByLabelText("Lưu giao dịch"));
    expect(await screen.findByText("Giao dịch đã sửa")).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/transactions/snapshot-edit", expect.objectContaining({ method: "PUT" })));
    const updateReads = fetchMock.mock.calls.slice(requestsBeforeUpdate)
      .filter(([url]) => /\/api\/(expenses\/config|expenses\/summary|transactions\?)/.test(String(url)));
    expect(updateReads).toHaveLength(0);

    const requestsBeforeDelete = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByLabelText("Xóa giao dịch"));
    await waitFor(() => expect(screen.queryByText("Giao dịch đã sửa")).not.toBeInTheDocument());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/transactions/snapshot-edit", expect.objectContaining({ method: "DELETE" })));
    const deleteReads = fetchMock.mock.calls.slice(requestsBeforeDelete)
      .filter(([url]) => /\/api\/(expenses\/config|expenses\/summary|transactions\?)/.test(String(url)));
    expect(deleteReads).toHaveLength(0);
  });

  it("quay về auth gate khi hàng đợi lưu nhận 401", async () => {
    vi.stubGlobal("fetch", authenticatedFetch(401));
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Theo dõi chi tiêu" });
    const amount = screen.getByRole("textbox", { name: "Số tiền" });
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: "1000" } });
    fireEvent.blur(amount);
    fireEvent.click(screen.getByRole("button", { name: "+ Thêm khoản" }));
    expect(await screen.findByRole("button", { name: "Đăng nhập với Google" })).toBeVisible();
    expect(screen.getByText("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")).toBeVisible();
  });

  it("xóa cache optimistic và tải lại route hiện tại khi revision trả 409", async () => {
    const fetchMock = authenticatedFetch(409);
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Theo dõi chi tiêu" });

    const amount = screen.getByRole("textbox", { name: "Số tiền" });
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: "99000" } });
    fireEvent.blur(amount);
    fireEvent.change(screen.getByRole("textbox", { name: "Ghi chú" }), { target: { value: "Sẽ rollback" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Thêm khoản" }));

    await waitFor(() => {
      const bootstrapCalls = fetchMock.mock.calls.filter(([url]) => String(url) === "/api/data");
      expect(bootstrapCalls).toHaveLength(2);
    });
    await waitFor(() => expect(screen.queryByText("Sẽ rollback")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Đã tải lại dữ liệu mới nhất");
  });
});
