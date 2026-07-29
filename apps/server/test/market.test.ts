import { describe, expect, it } from "vitest";
import {
  calculateGoldVndPerChi,
  calculateGoldVndPerChiFromTroyOunce,
  createMarketService,
  type FetchLike,
} from "../src/services/market.js";

interface MockRoute {
  matches(url: string, options: RequestInit): boolean;
  status?: number;
  payload: unknown;
}

function mockFetch(routes: MockRoute[], calls: Array<{ url: string; options: RequestInit }>): FetchLike {
  return async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, options });
    const route = routes.find((entry) => entry.matches(url, options));
    if (!route) throw new Error(`Unexpected request: ${url}`);
    return {
      ok: route.status === undefined || route.status < 400,
      status: route.status ?? 200,
      json: async () => route.payload,
    };
  };
}

describe("dịch vụ giá thị trường", () => {
  it("quy đổi XAU/USD sang VND/chỉ", () => {
    expect(calculateGoldVndPerChi(2000, 25000)).toBeCloseTo(6028264.98, 2);
    expect(calculateGoldVndPerChiFromTroyOunce(60_981_087)).toBeCloseTo(7_352_203.03, 2);
  });

  it("lấy và cache giá XAU/VND theo đúng ngày mua", async () => {
    const calls: Array<{ url: string; options: RequestInit }> = [];
    const service = createMarketService({
      now: () => Date.parse("2026-07-29T08:00:00.000Z"),
      fetchImpl: mockFetch([{
        matches: (url) => url === "https://api.frankfurter.dev/v2/rate/XAU/VND?date=2024-07-15",
        payload: { date: "2024-07-15", base: "XAU", quote: "VND", rate: 60_981_087 },
      }], calls),
    });
    const first = await service.getHistoricalGoldQuote("2024-07-15");
    const second = await service.getHistoricalGoldQuote("2024-07-15");
    expect(first).toEqual({
      date: "2024-07-15",
      vndPerTroyOunce: 60_981_087,
      vndPerChi: 7_352_203,
      source: "Frankfurter",
      sourceUrl: "https://frankfurter.dev",
    });
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it.each(["1999-01-04", "2026-07-30", "2026-02-30", "15-07-2024"])(
    "từ chối ngày lịch sử không hợp lệ %s",
    async (date) => {
      const service = createMarketService({
        now: () => Date.parse("2026-07-29T08:00:00.000Z"),
        fetchImpl: mockFetch([], []),
      });
      await expect(service.getHistoricalGoldQuote(date)).rejects.toMatchObject({
        code: "invalid_historical_date",
      });
    },
  );

  it("báo lỗi khi Frankfurter không trả đúng giá của ngày yêu cầu", async () => {
    const service = createMarketService({
      now: () => Date.parse("2026-07-29T08:00:00.000Z"),
      fetchImpl: mockFetch([{
        matches: (url) => url.includes("api.frankfurter.dev"),
        payload: { date: "2024-07-14", rate: 0 },
      }], []),
    });
    await expect(service.getHistoricalGoldQuote("2024-07-15")).rejects.toMatchObject({
      code: "historical_gold_unavailable",
    });
  });

  it("lấy giá vàng, USD/VND và crypto bằng nguồn công khai", async () => {
    const calls: Array<{ url: string; options: RequestInit }> = [];
    const service = createMarketService({
      fetchImpl: mockFetch([
        { matches: (url) => url.includes("open.er-api.com"), payload: { rates: { VND: 25000 } } },
        { matches: (url) => url.includes("gold-api.com"), payload: { price: 2000 } },
        { matches: (url) => url.includes("/v1/search"), payload: { currencies: [{ id: "btc-bitcoin", symbol: "BTC", name: "Bitcoin", rank: 1 }] } },
        { matches: (url) => url.includes("/v1/tickers/btc-bitcoin"), payload: { symbol: "BTC", name: "Bitcoin", quotes: { USD: { price: 60000 } } } },
      ], calls),
    });
    const quotes = await service.getQuotes({ assets: [{ type: "gold" }, { type: "crypto", symbol: "BTC" }] });
    expect(quotes.fx?.usdVnd).toBe(25000);
    expect(quotes.gold?.xauUsdPerTroyOunce).toBe(2000);
    expect(quotes.crypto[0]?.providerId).toBe("btc-bitcoin");
    expect(quotes.errors).toHaveLength(0);
    expect(calls).toHaveLength(4);
  });

  it("lấy và cache giá đóng cửa HOSE trong mười phút", async () => {
    const calls: Array<{ url: string; options: RequestInit }> = [];
    const service = createMarketService({
      fetchImpl: mockFetch([{
        matches: (url) => url.includes("pricehistory.ashx") && url.includes("Symbol=FPT"),
        payload: { Data: { Data: [{ GiaDongCua: "62.9" }] } },
      }], calls),
    });
    const request = { assets: [{ type: "stock" as const, symbol: "FPT", exchange: "HOSE" }] };
    expect((await service.getQuotes(request)).stocks[0]?.priceVnd).toBe(62900);
    expect((await service.getQuotes(request)).stocks[0]?.priceVnd).toBe(62900);
    expect(calls).toHaveLength(1);
  });

  it("báo lỗi rõ ràng cho sàn không được hỗ trợ", async () => {
    const quotes = await createMarketService({ fetchImpl: mockFetch([], []) })
      .getQuotes({ assets: [{ type: "stock", symbol: "ACB", exchange: "HNX" }] });
    expect(quotes.errors[0]?.code).toBe("stock_exchange_unsupported");
  });

  it("báo lỗi khi CafeF không trả giá hợp lệ", async () => {
    const service = createMarketService({
      fetchImpl: mockFetch([{ matches: (url) => url.includes("cafef.vn"), payload: { Data: { Data: [] } } }], []),
    });
    expect((await service.getQuotes({ assets: [{ type: "stock", symbol: "FPT", exchange: "HOSE" }] })).errors[0]?.code).toBe("stock_not_found");
  });

  it("giữ lỗi upstream CafeF", async () => {
    const service = createMarketService({
      fetchImpl: mockFetch([{ matches: (url) => url.includes("cafef.vn"), status: 503, payload: {} }], []),
    });
    expect((await service.getQuotes({ assets: [{ type: "stock", symbol: "FPT", exchange: "HOSE" }] })).errors[0]?.code).toBe("upstream_error");
  });

  it("trả danh sách chọn khi ticker crypto bị trùng", async () => {
    const service = createMarketService({
      fetchImpl: mockFetch([
        { matches: (url) => url.includes("open.er-api.com"), payload: { rates: { VND: 25000 } } },
        { matches: (url) => url.includes("/v1/search"), payload: { currencies: [
          { id: "one-coin", symbol: "ONE", name: "One Coin", rank: 2 },
          { id: "harmony-one", symbol: "ONE", name: "Harmony", rank: 1 },
        ] } },
      ], []),
    });
    const quotes = await service.getQuotes({ assets: [{ type: "crypto", symbol: "ONE" }] });
    expect(quotes.errors[0]?.code).toBe("crypto_ambiguous");
    expect(quotes.matches["crypto:ONE"]).toHaveLength(2);
  });
});
