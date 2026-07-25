import { describe, expect, it } from "vitest";
import type { MarketQuotesResponse } from "@chi-tieu/shared";
import {
  collectMarketAssets,
  createDefaultStore,
  ensureYear,
  evaluateMoneyExpression,
  goldLotCostVnd,
  goldLotPriceVnd,
  holdingCostVnd,
  mergeMarketResponse,
  normalizeStore,
  recalculateMarketFunds,
  totalFundsForMonth,
} from "./domain";

describe("nghiệp vụ sổ tài chính", () => {
  it("đánh giá biểu thức tiền an toàn", () => {
    expect(evaluateMoneyExpression("5000000 + 500000")).toBe(5_500_000);
    expect(evaluateMoneyExpression("2*1.250.000")).toBe(2_500_000);
    expect(evaluateMoneyExpression("alert(1)")).toBeNaN();
  });

  it("chuẩn hóa dữ liệu hiện hành và tạo đủ mảng 12 tháng", () => {
    const normalized = normalizeStore({
      funds: [{ id: "saving", name: "Tiết kiệm", color: "#123456", cat: "saving" }],
      years: { "2026": { income: [0], funds: { saving: [100] } } },
      expense: { cats: [], incomeCats: [], txns: [] },
    });
    expect(normalized.store.years["2026"]?.funds.saving).toHaveLength(12);
    expect(normalized.store.expense.cats.length).toBeGreaterThan(0);
  });

  it("nhập được backup v2 và giữ migration thu nhập", () => {
    const normalized = normalizeStore({
      "2025": { income: [1_000_000], funds: { dp: [500_000] } },
    });
    expect(normalized.store.expense.txns).toContainEqual(expect.objectContaining({
      id: "legacy-salary-2025-01",
      amount: 1_000_000,
      type: "income",
    }));
    expect(normalized.needsSave).toBe(true);
  });

  it("chuyển backup tài sản cũ sang giao dịch đầy đủ mà không mất giá thủ công", () => {
    const normalized = normalizeStore({
      funds: [
        { id: "stock", name: "Cổ phiếu", color: "#123456", cat: "stock" },
        { id: "gold", name: "Vàng", color: "#654321", cat: "gold" },
      ],
      years: {
        "2026": {
          income: new Array(12).fill(0),
          notes: new Array(12).fill(""),
          funds: { stock: new Array(12).fill(0), gold: new Array(12).fill(0) },
          details: {
            stock: [{ type: "hold", lots: [{ ticker: "VNM", qty: 2, cur: 50_000 }] }],
            gold: [{ type: "gold", chi: 1.5, price: 7_000_000 }],
          },
        },
      },
      expense: { cats: [], incomeCats: [], txns: [] },
    });
    expect(normalized.needsSave).toBe(true);
    expect(normalized.store.years["2026"]!.details.stock![0]).toEqual({
      type: "hold", lots: [{ ticker: "VNM", qty: 2, manualPrice: 50_000 }],
    });
    expect(normalized.store.years["2026"]!.details.gold![0]).toEqual({
      type: "gold", lots: [{ chi: 1.5, manualPrice: 7_000_000 }],
    });
  });

  it("tạo năm mới theo kế hoạch quỹ mà không ảnh hưởng năm cũ", () => {
    const store = createDefaultStore();
    store.financialProfile.fundPlan.dp = 1_000_000;
    expect(ensureYear(store, 2030)).toBe(true);
    expect(store.years["2030"]?.funds.dp).toEqual(new Array(12).fill(1_000_000));
    expect(ensureYear(store, 2030)).toBe(false);
  });

  it("thu thập, trộn và quy đổi dữ liệu thị trường", () => {
    const store = createDefaultStore();
    store.years["2026"]!.details.cr![0] = { type: "hold", lots: [{ ticker: "BTC", qty: 0.1, providerId: "btc-bitcoin" }] };
    expect(collectMarketAssets(store)).toContainEqual({ type: "crypto", symbol: "BTC", providerId: "btc-bitcoin" });
    const response: MarketQuotesResponse = {
      fetchedAt: "2026-07-25T00:00:00.000Z",
      fx: { usdVnd: 25_000, source: "test", fetchedAt: "2026-07-25T00:00:00.000Z" },
      gold: null,
      stocks: [],
      crypto: [{ symbol: "BTC", providerId: "btc-bitcoin", name: "Bitcoin", priceUsd: 60_000, source: "test", fetchedAt: "2026-07-25T00:00:00.000Z" }],
      matches: {},
      errors: [],
    };
    mergeMarketResponse(store, response);
    recalculateMarketFunds(store);
    expect(totalFundsForMonth(store, 2026, 0)).toBe(150_000_000);
  });

  it("tính vốn và giá trị hiện tại theo giá tự động hoặc giá thủ công", () => {
    const store = createDefaultStore();
    store.market.fx = { usdVnd: 25_000, source: "test", fetchedAt: "2026-07-25T00:00:00.000Z" };
    store.market.gold = { symbol: "XAU", xauUsdPerTroyOunce: 3_000, vndPerChi: 7_500_000, source: "test", fetchedAt: "2026-07-25T00:00:00.000Z" };
    const crypto = { ticker: "BTC", qty: 0.2, manualPrice: 60_000, purchasePrice: 50_000, purchaseFxVnd: 24_000, feeVnd: 100_000 };
    const gold = { chi: 2, manualPrice: 7_000_000, purchasePrice: 6_000_000, feeVnd: 50_000 };
    expect(holdingCostVnd(crypto, "crypto")).toBe(240_100_000);
    expect(goldLotCostVnd(gold)).toBe(12_050_000);
    expect(goldLotPriceVnd(store, gold)).toBe(7_500_000);
  });
});
