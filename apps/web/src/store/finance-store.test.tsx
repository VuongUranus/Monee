import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantConfirmResponse, FundOverviewResponse, MarketQuotesResponse } from "@chi-tieu/shared";
import * as apiFeedback from "@/lib/api-feedback";
import { api } from "@/lib/api";
import { blankYearWith, createDefaultStore } from "@/lib/domain";
import { useFinanceStore } from "./finance-store";

describe("applyAssistantConfirmation", () => {
  const originalPath = window.location.pathname;

  afterEach(() => {
    window.history.replaceState({}, "", originalPath);
    vi.restoreAllMocks();
  });

  it("tải lại thống kê đúng một lần khi batch AI được xác nhận trên trang Thống kê", async () => {
    const ledger = createDefaultStore();
    ledger.funds = [{ id: "reserve", name: "Dự phòng", color: "#4f8a6b", cat: "saving" }];
    ledger.years["2026"] = blankYearWith(ledger.funds);
    const loadStatistics = vi.fn(async () => undefined);
    window.history.replaceState({}, "", "/statistics");
    useFinanceStore.setState({
      ledger,
      workspaceRevision: 1,
      statistics: null,
      statisticsScope: { mode: "year", year: 2026 },
      loadStatistics,
    });

    const response: AssistantConfirmResponse = {
      kind: "action_batch",
      batchId: "batch-1",
      workspaceRevision: 2,
      alreadyApplied: false,
      results: [
        {
          kind: "create_transaction",
          actionId: "transaction-1",
          transaction: {
            id: "transaction-1",
            date: "2026-07-28",
            type: "expense",
            cat: "food",
            amount: 30_000,
            note: "Ăn sáng",
          },
        },
        {
          kind: "allocate_fund",
          actionId: "fund-1",
          fund: { fundId: "reserve", year: 2026, month: 7, amount: 2_000_000, detail: null },
        },
      ],
    };

    await useFinanceStore.getState().applyAssistantConfirmation(response);

    expect(loadStatistics).toHaveBeenCalledTimes(1);
    expect(useFinanceStore.getState().workspaceRevision).toBe(2);
    expect(useFinanceStore.getState().ledger.years["2026"]!.funds.reserve![6]).toBe(2_000_000);
  });
});

describe("refreshMarket", () => {
  const originalPath = window.location.pathname;
  const initialLoadFunds = useFinanceStore.getState().loadFunds;

  afterEach(() => {
    window.history.replaceState({}, "", originalPath);
    useFinanceStore.setState({ loadFunds: initialLoadFunds });
    vi.restoreAllMocks();
  });

  it("không hiện toast cho cập nhật tự động nhưng vẫn thông báo khi cập nhật thủ công", async () => {
    const quotes: MarketQuotesResponse = {
      fetchedAt: "2026-07-29T00:00:00.000Z",
      fx: null,
      gold: null,
      stocks: [],
      crypto: [],
      matches: {},
      errors: [],
    };
    const loadFunds = vi.fn(async () => undefined);
    const marketQuotes = vi.spyOn(api, "marketQuotes").mockResolvedValue({
      quotes,
      workspaceRevision: 2,
      affectedPeriods: [],
    });
    const pushToast = vi.spyOn(apiFeedback, "pushToast");
    window.history.replaceState({}, "", "/funds");
    useFinanceStore.setState({
      ledger: createDefaultStore(),
      fundOverview: { marketAssets: [{ type: "gold" }] } as unknown as FundOverviewResponse,
      workspaceRevision: 1,
      loadFunds,
    });

    await useFinanceStore.getState().refreshMarket({ force: true, notifySuccess: false });
    expect(marketQuotes).toHaveBeenCalledWith({ assets: [{ type: "gold" }], force: true }, 1);
    expect(pushToast).not.toHaveBeenCalled();

    await useFinanceStore.getState().refreshMarket({ force: true });
    expect(pushToast).toHaveBeenCalledWith("success", "Đã cập nhật giá thị trường.");
  });
});
