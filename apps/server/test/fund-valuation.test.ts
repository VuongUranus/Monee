import type { StoredMarketState } from "@chi-tieu/shared";
import { describe, expect, it } from "vitest";
import { currentInvestmentValueVnd, type InvestmentValuationRow } from "../src/db/fund-valuation.js";

const market: StoredMarketState = {
  fx: { usdVnd: 25_000, source: "fixture", fetchedAt: null },
  gold: {
    symbol: "XAU",
    xauUsdPerTroyOunce: 2_500,
    vndPerChi: 6_000_000,
    source: "fixture",
    fetchedAt: new Date(0).toISOString(),
  },
  stocks: {
    "HOSE:VNM": {
      symbol: "VNM",
      exchange: "HOSE",
      priceVnd: 80_000,
      source: "fixture",
      fetchedAt: new Date(0).toISOString(),
    },
  },
  crypto: {
    "btc-bitcoin": {
      symbol: "BTC",
      providerId: "btc-bitcoin",
      name: "Bitcoin",
      priceUsd: 40_000,
      source: "fixture",
      fetchedAt: new Date(0).toISOString(),
    },
  },
  cryptoSymbols: { BTC: "btc-bitcoin" },
  matches: {},
  errors: [],
  updatedAt: new Date(0).toISOString(),
};

function row(patch: Partial<InvestmentValuationRow>): InvestmentValuationRow {
  return {
    category: "stock",
    ticker: null,
    quantity: null,
    holdingManualPrice: null,
    exchange: null,
    providerId: null,
    chi: null,
    goldManualPrice: null,
    ...patch,
  };
}

describe("currentInvestmentValueVnd", () => {
  it("định giá vàng, cổ phiếu và crypto bằng quote mới thay vì giá vốn", () => {
    expect(currentInvestmentValueVnd(row({ category: "gold", chi: 2, goldManualPrice: 3_000_000 }), market))
      .toBe(12_000_000);
    expect(currentInvestmentValueVnd(row({
      category: "stock",
      ticker: "vnm",
      quantity: 10,
      holdingManualPrice: 65_000,
      exchange: "HOSE",
    }), market)).toBe(800_000);
    expect(currentInvestmentValueVnd(row({
      category: "crypto",
      ticker: "btc",
      quantity: 0.01,
      holdingManualPrice: 20_000,
      providerId: "btc-bitcoin",
    }), market)).toBe(10_000_000);
  });

  it("dùng giá thủ công khi chưa có quote tương ứng", () => {
    expect(currentInvestmentValueVnd(row({
      category: "stock",
      ticker: "FPT",
      quantity: 2,
      holdingManualPrice: 120_000,
      exchange: "HOSE",
    }), market)).toBe(240_000);
    expect(currentInvestmentValueVnd(row({
      category: "gold",
      chi: 1.5,
      goldManualPrice: 4_000_000,
    }), { ...market, gold: null })).toBe(6_000_000);
  });
});
