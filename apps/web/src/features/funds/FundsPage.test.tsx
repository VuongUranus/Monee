import { render, screen, within } from "@testing-library/react";
import type { FundOverviewResponse } from "@chi-tieu/shared";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankYearWith, createDefaultStore } from "@/lib/domain";
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
    expect(within(totalRow!).getAllByText("3.000.000 ₫")).toHaveLength(2);
    expect(within(totalRow!).queryByText("2.500.000 ₫")).not.toBeInTheDocument();

    const goalsCard = screen.getByText("Tích lũy toàn bộ").closest("article");
    expect(goalsCard).not.toBeNull();
    expect(within(goalsCard!).getAllByText("3.000.000 ₫")).toHaveLength(4);
    expect(within(goalsCard!).queryByText("2.500.000 ₫")).not.toBeInTheDocument();
  });
});
