import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createDefaultStore } from "./lib/domain";
import { useFinanceStore } from "./store/finance-store";

vi.mock("react-chartjs-2", () => ({
  Doughnut: () => <div data-testid="donut-chart" />,
  Bar: () => <div data-testid="bar-chart" />,
}));

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function authenticatedFetch(putStatus = 204, prepareLedger?: (ledger: ReturnType<typeof createDefaultStore>) => void) {
  const ledger = createDefaultStore();
  prepareLedger?.(ledger);
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/auth/me") return jsonResponse({ user: { sub: "1", email: "test@example.com", name: "Người dùng", picture: "" } });
    if (url === "/api/data" && init?.method === "PUT") {
      return putStatus === 204 ? new Response(null, { status: 204 }) : jsonResponse({ error: "unauthorized" }, putStatus);
    }
    if (url === "/api/data") return jsonResponse(ledger);
    return new Response(null, { status: 204 });
  });
}

beforeEach(() => {
  useFinanceStore.setState({
    auth: "checking",
    authMessage: "",
    user: null,
    ledger: createDefaultStore(),
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
  it("hiện cổng đăng nhập khi API trả 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unauthorized" }, 401)));
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("button", { name: "Đăng nhập với Google" })).toBeVisible();
  });

  it("tải sổ và render route React từ URL trực tiếp", async () => {
    const fetchMock = authenticatedFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter initialEntries={["/statistics"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Thống kê tài chính" })).toBeVisible();
    expect(screen.getByRole("heading", { name: /Diễn biến tích lũy/ })).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/data", expect.anything()));
  });

  it("đổi được phạm vi thống kê sang tháng và khoảng tháng", async () => {
    vi.stubGlobal("fetch", authenticatedFetch());
    render(<MemoryRouter initialEntries={["/statistics"]}><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Thống kê tài chính" });

    fireEvent.click(screen.getByRole("combobox", { name: "Phạm vi" }));
    fireEvent.click(screen.getByRole("option", { name: "Tháng cụ thể" }));
    expect(screen.getByRole("combobox", { name: "Tháng thống kê" })).toBeVisible();

    fireEvent.click(screen.getByRole("combobox", { name: "Phạm vi" }));
    fireEvent.click(screen.getByRole("option", { name: "Khoảng tháng" }));
    expect(screen.getByRole("combobox", { name: "Từ tháng" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Đến tháng" })).toBeVisible();
  });

  it("hiển thị chi tiêu theo tài khoản trên trang chi tiêu", async () => {
    vi.stubGlobal("fetch", authenticatedFetch(204, (ledger) => {
      ledger.expense.txns.push({ id: "cash-expense", date: "2026-07-01", type: "expense", cat: "food", accountId: "cash", amount: 250_000, note: "Trưa" });
    }));
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Chi tiêu theo tài khoản" })).toBeVisible();
    expect(screen.getAllByText("Tiền mặt").length).toBeGreaterThan(0);
  });

  it("phân trang lịch sử thu chi theo 10 giao dịch", async () => {
    vi.stubGlobal("fetch", authenticatedFetch(204, (ledger) => {
      for (let index = 1; index <= 11; index += 1) {
        ledger.expense.txns.push({ id: `history-${index}`, date: `2026-07-${String(index).padStart(2, "0")}`, type: "expense", cat: "food", amount: index, note: `Lịch sử ${index}` });
      }
    }));
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("navigation", { name: "Phân trang lịch sử" })).toBeVisible();
    expect(screen.getByText("Lịch sử 11")).toBeVisible();
    expect(screen.queryByText("Lịch sử 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sau →" }));
    expect(screen.getByText("Lịch sử 1")).toBeVisible();
    expect(screen.queryByText("Lịch sử 11")).not.toBeInTheDocument();
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

    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Chọn tháng và năm" })).not.toBeInTheDocument());
  });

  it("thêm giao dịch ngay trên UI rồi xếp snapshot vào PUT /api/data", async () => {
    const fetchMock = authenticatedFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Theo dõi chi tiêu" });

    const amount = screen.getByRole("textbox", { name: "Số tiền" });
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: "250000" } });
    fireEvent.blur(amount);
    fireEvent.change(screen.getByRole("textbox", { name: "Ghi chú" }), { target: { value: "Bữa trưa RTL" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Thêm khoản" }));

    expect(await screen.findByText("Bữa trưa RTL")).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/data", expect.objectContaining({ method: "PUT" })));
    expect(screen.getByRole("status")).toHaveTextContent("Đã lưu");
  });

  it("quay về auth gate khi hàng đợi lưu nhận 401", async () => {
    vi.stubGlobal("fetch", authenticatedFetch(401));
    render(<MemoryRouter initialEntries={["/expenses"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("button", { name: "Đăng nhập với Google" })).toBeVisible();
    expect(screen.getByText("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")).toBeVisible();
  });
});
