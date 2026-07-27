import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { FundOverviewResponse, SharedFundView } from "@chi-tieu/shared";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankYearWith, createDefaultStore } from "@/lib/domain";
import { api } from "@/lib/api";
import { useFinanceStore } from "@/store/finance-store";
import { FundsPage } from "./FundsPage";

vi.mock("@/components/Charts", () => ({
  DonutChart: () => <div data-testid="donut-chart" />,
}));

describe("FundsPage", () => {
  beforeEach(() => {
    const ledger = createDefaultStore();
    ledger.funds = [{ id: "reserve", name: "Dự phòng", color: "#E4572E", cat: "saving" }];
    ledger.years["2026"] = blankYearWith(ledger.funds);
    ledger.years["2026"]!.funds.reserve![6] = 3_000_000;
    ledger.showGoals = true;

    const overview: FundOverviewResponse = {
      year: 2026,
      month: 7,
      note: "",
      income: 22_500_000,
      yearActiveMonths: 1,
      allTimeActiveMonths: 1,
      showGoals: false,
      debt: ledger.financialProfile.debt,
      funds: [{
        ...ledger.funds[0]!,
        fundPlan: 0,
        openingBalance: 0,
        yearGoal: 0,
        allGoal: 0,
        monthAmount: 2_500_000,
        yearAmounts: [0, 0, 0, 0, 0, 0, 2_500_000, 0, 0, 0, 0, 0],
        yearTotal: 2_500_000,
        allTimeTotal: 2_500_000,
        contributionAmount: 0,
        contributionCount: 0,
      }],
      marketAssets: [],
      market: ledger.market,
    };

    useFinanceStore.setState({
      ledger,
      fundOverview: overview,
      selectedYear: 2026,
      selectedMonth: 6,
      loadFunds: vi.fn(async () => undefined),
    });
  });

  it("hiển thị tổng và mục tiêu từ số tiền vừa nhập thay vì snapshot overview cũ", () => {
    render(<MemoryRouter><FundsPage /></MemoryRouter>);

    const totalRow = screen.getAllByText("Tổng cộng")[0]?.closest("tr");
    expect(totalRow).not.toBeNull();
    expect(within(totalRow!).getAllByText("3,000,000đ")).toHaveLength(2);
    expect(within(totalRow!).queryByText("2,500,000đ")).not.toBeInTheDocument();

    const goalsCard = screen.getByText("Tích lũy toàn bộ").closest("article");
    expect(goalsCard).not.toBeNull();
    expect(within(goalsCard!).getAllByText("3,000,000đ")).toHaveLength(4);
    expect(within(goalsCard!).queryByText("2,500,000đ")).not.toBeInTheDocument();
  });

  it("chỉ tải overview một lần khi đổi kỳ đã tồn tại", async () => {
    const loadFunds = vi.fn(async () => undefined);
    useFinanceStore.setState({
      loadFunds,
      bootstrapData: {
        user: { sub: "test", name: "Test", email: "test@example.com", picture: "" },
        workspaceRevision: 1,
        availableYears: [2026],
        features: { aiAssistant: false },
        preferences: {
          showGoals: true,
          onboarding: { status: "completed", version: 1 },
          financialProfile: { monthlyIncome: 0, emergencyFundGoal: 0, debt: { balance: 0, monthlyPayment: 0 } },
          incomeMigrationVersion: 1,
          futureIncomeResetVersion: 1,
        },
      },
    });
    render(<MemoryRouter><FundsPage /></MemoryRouter>);
    await waitFor(() => expect(loadFunds).toHaveBeenCalledTimes(1));
    loadFunds.mockClear();

    act(() => useFinanceStore.getState().setPeriod(2026, 7));

    await waitFor(() => expect(loadFunds).toHaveBeenCalledTimes(1));
  });

  it("lưu số tiền quỹ mà không refetch overview", async () => {
    const loadFunds = vi.fn(async () => undefined);
    const updateFundMonth = vi.spyOn(api, "updateFundMonth").mockResolvedValue({
      workspaceRevision: 2,
      data: { fundId: "reserve", year: 2026, month: 7, amount: 3_500_000, detail: null },
    });
    useFinanceStore.setState({ loadFunds, workspaceRevision: 1 });
    render(<MemoryRouter><FundsPage /></MemoryRouter>);
    await waitFor(() => expect(loadFunds).toHaveBeenCalledTimes(1));

    const input = screen.getByLabelText("Số tiền Dự phòng");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "3500000" } });
    fireEvent.blur(input);

    await waitFor(() => expect(updateFundMonth).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useFinanceStore.getState().saveState).toBe("saved"));
    expect(loadFunds).toHaveBeenCalledTimes(1);
    expect(useFinanceStore.getState().fundOverview?.funds[0]).toMatchObject({
      monthAmount: 3_500_000,
      yearTotal: 3_500_000,
      allTimeTotal: 3_500_000,
    });
    updateFundMonth.mockRestore();
  });

  it("không gọi API tháng quỹ chung khi số tiền không thay đổi", async () => {
    const ledger = structuredClone(useFinanceStore.getState().ledger);
    ledger.funds[0]!.sharing = {
      sharedFundId: "reserve",
      ownerId: "owner",
      ownerName: "Chủ quỹ",
      role: "editor",
    };
    const sharedFund: SharedFundView = {
      id: "reserve",
      revision: 1,
      role: "editor",
      owner: { sub: "owner", name: "Chủ quỹ", email: "owner@example.com" },
      contributors: {},
      content: {
        fund: { id: "reserve", name: "Dự phòng", color: "#E4572E", cat: "saving" },
        years: { "2026": { funds: [...ledger.years["2026"]!.funds.reserve!], details: new Array(12).fill(null) } },
        goal: { years: {}, all: 0 },
        fundPlan: 0,
        openingBalance: 0,
      },
    };
    const updateSharedFundMonth = vi.spyOn(api, "updateSharedFundMonth").mockResolvedValue({
      revision: 2,
      data: { fundId: "reserve", year: 2026, month: 7, amount: 3_000_000, detail: null },
    });
    useFinanceStore.setState({ ledger, sharedFunds: { reserve: sharedFund }, workspaceRevision: 1 });

    render(<MemoryRouter><FundsPage /></MemoryRouter>);
    const input = screen.getByLabelText("Số tiền Dự phòng");
    fireEvent.focus(input);
    fireEvent.blur(input);

    expect(updateSharedFundMonth).not.toHaveBeenCalled();
    updateSharedFundMonth.mockRestore();
  });
});
