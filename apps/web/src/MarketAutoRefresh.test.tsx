import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import type { FundOverviewResponse } from "@chi-tieu/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MARKET_REFRESH_INTERVAL_MS, MarketAutoRefresh } from "./App";
import type { RefreshMarketOptions } from "./store/finance-store";
import { useFinanceStore } from "./store/finance-store";

const initialLoadFunds = useFinanceStore.getState().loadFunds;
const initialRefreshMarket = useFinanceStore.getState().refreshMarket;

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.useRealTimers();
  useFinanceStore.setState({
    auth: "checking",
    loaded: false,
    fundOverview: null,
    loadFunds: initialLoadFunds,
    refreshMarket: initialRefreshMarket,
  });
});

describe("MarketAutoRefresh", () => {
  it("cập nhật ngay, lặp lại sau 10 phút và dọn timer khi unmount", async () => {
    vi.useFakeTimers();
    const loadFunds = vi.fn(async () => {
      useFinanceStore.setState({ fundOverview: { marketAssets: [] } as unknown as FundOverviewResponse });
    });
    const refreshMarket = vi.fn(async (_options?: RefreshMarketOptions) => undefined);
    useFinanceStore.setState({ auth: "authenticated", loaded: true, fundOverview: null, loadFunds, refreshMarket });

    const view = render(<StrictMode><MarketAutoRefresh /></StrictMode>);
    await flushAsyncWork();

    expect(loadFunds).toHaveBeenCalledTimes(1);
    expect(refreshMarket).toHaveBeenCalledTimes(1);
    expect(refreshMarket).toHaveBeenLastCalledWith({ force: true, notifySuccess: false });

    await act(async () => { await vi.advanceTimersByTimeAsync(MARKET_REFRESH_INTERVAL_MS); });
    expect(refreshMarket).toHaveBeenCalledTimes(2);

    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(MARKET_REFRESH_INTERVAL_MS); });
    expect(refreshMarket).toHaveBeenCalledTimes(2);
  });

  it("không chạy chồng lần cập nhật khi lần trước chưa hoàn tất", async () => {
    vi.useFakeTimers();
    let completeFirstRefresh!: () => void;
    const firstRefresh = new Promise<void>((resolve) => { completeFirstRefresh = resolve; });
    const refreshMarket = vi.fn(() => firstRefresh);
    useFinanceStore.setState({
      auth: "authenticated",
      loaded: true,
      fundOverview: { marketAssets: [] } as unknown as FundOverviewResponse,
      refreshMarket,
    });

    render(<MarketAutoRefresh />);
    await flushAsyncWork();
    expect(refreshMarket).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(MARKET_REFRESH_INTERVAL_MS); });
    expect(refreshMarket).toHaveBeenCalledTimes(1);

    completeFirstRefresh();
    await flushAsyncWork();
    await act(async () => { await vi.advanceTimersByTimeAsync(MARKET_REFRESH_INTERVAL_MS); });
    expect(refreshMarket).toHaveBeenCalledTimes(2);
  });
});
