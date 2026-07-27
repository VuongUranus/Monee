import { describe, expect, it } from "vitest";
import type { MarketQuotesResponse, SharedFundView } from "@chi-tieu/shared";
import {
  collectMarketAssets,
  accountForTransaction,
  accountTypeForAccount,
  createDefaultStore,
  ensureYear,
  evaluateMoneyExpression,
  fmt,
  fmtNumber,
  goldLotCostVnd,
  goldLotPriceVnd,
  holdingCostVnd,
  mergeMarketResponse,
  mergeSharedFunds,
  normalizeStore,
  privateLedger,
  recalculateMarketFunds,
  expenseByAccount,
  savingRate,
  statisticsMonths,
  totalFundsForMonth,
  countsInPersonalReports,
} from "./domain";

describe("nghiệp vụ sổ tài chính", () => {
  it("đánh giá biểu thức tiền an toàn", () => {
    expect(evaluateMoneyExpression("5000000 + 500000")).toBe(5_500_000);
    expect(evaluateMoneyExpression("2*1,250,000")).toBe(2_500_000);
    expect(evaluateMoneyExpression("1,1")).toBe(1.1);
    expect(evaluateMoneyExpression("alert(1)")).toBeNaN();
  });

  it("hiển thị VND bằng dấu phẩy và hậu tố đ", () => {
    expect(fmt(1_000_000)).toBe("1,000,000đ");
    expect(fmtNumber(25_000)).toBe("25,000");
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

  it("bổ sung tài khoản mặc định cho dữ liệu cũ và giữ giao dịch chưa gán", () => {
    const normalized = normalizeStore({
      funds: [{ id: "saving", name: "Tiết kiệm", color: "#123456", cat: "saving" }],
      years: { "2026": { income: new Array(12).fill(0), funds: { saving: new Array(12).fill(0) } } },
      expense: { cats: [], incomeCats: [], txns: [{ id: "old", date: "2026-01-01", type: "expense", cat: "food", amount: 10, note: "Cũ" }] },
    });
    expect(normalized.needsSave).toBe(true);
    expect(normalized.store.expense.accountTypes.map((type) => type.name)).toEqual(["Ngân hàng", "Tiền mặt", "Thẻ tín dụng"]);
    expect(normalized.store.expense.accounts).toContainEqual({ id: "cash", name: "Tiền mặt", typeId: "cash" });
    expect(normalized.store.expense.txns[0]?.accountId).toBeUndefined();
  });

  it("chuyển dư nợ cũ sang khoản vay cần hoàn thiện lịch", () => {
    const normalized = normalizeStore({
      funds: [], years: { "2026": { income: new Array(12).fill(0), funds: {} } },
      expense: { cats: [], incomeCats: [], txns: [] },
      financialProfile: { debt: { balance: 5_000_000, monthlyPayment: 500_000 } },
    });
    expect(normalized.store.debts).toContainEqual(expect.objectContaining({
      id: "legacy-debt", name: "Dư nợ cũ", principal: 5_000_000, paymentAmount: 500_000, termMonths: 0,
    }));
    expect(normalized.store.financialProfile.debt.balance).toBe(0);
  });

  it("tra cứu tài khoản và loại trả về rỗng khi bản ghi đã bị xóa", () => {
    const store = createDefaultStore();
    const cash = store.expense.accounts[0]!;
    expect(accountForTransaction(store, { accountId: cash.id })).toEqual(cash);
    expect(accountTypeForAccount(store, cash)?.name).toBe("Tiền mặt");
    store.expense.accounts = [];
    store.expense.accountTypes = [];
    expect(accountForTransaction(store, { accountId: cash.id })).toBeUndefined();
    expect(accountTypeForAccount(store, cash)).toBeUndefined();
  });

  it("dựng đúng các tháng thống kê theo năm, tháng và khoảng tháng", () => {
    const store = createDefaultStore();
    expect(statisticsMonths(store, { mode: "year", year: 2026 })).toHaveLength(12);
    expect(statisticsMonths(store, { mode: "month", month: "2026-07" })).toEqual([{ year: 2026, month: 6, key: "2026-07" }]);
    expect(statisticsMonths(store, { mode: "range", from: "2025-12", to: "2026-02" }).map((item) => item.key)).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(statisticsMonths(store, { mode: "range", from: "2026-03", to: "2026-02" })).toEqual([]);
  });

  it("tính tỷ lệ tiết kiệm và gom chi tiêu theo tài khoản", () => {
    const store = createDefaultStore();
    store.expense.accounts.push({ id: "bank", name: "VCB", typeId: "bank" });
    store.expense.txns = [
      { id: "cash", date: "2026-01-01", type: "expense", cat: "food", accountId: "cash", amount: 100, note: "" },
      { id: "bank", date: "2026-01-02", type: "expense", cat: "food", accountId: "bank", amount: 200, note: "" },
      { id: "unknown", date: "2026-01-03", type: "expense", cat: "food", amount: 50, note: "" },
      { id: "deleted", date: "2026-01-04", type: "expense", cat: "food", accountId: "gone", amount: 75, note: "" },
      { id: "income", date: "2026-01-05", type: "income", cat: "salary", accountId: "bank", amount: 500, note: "" },
    ];
    expect(savingRate(500, 125)).toBe(0.25);
    expect(savingRate(0, 125)).toBeNull();
    expect(expenseByAccount(store, store.expense.txns).map(({ name, amount }) => ({ name, amount }))).toEqual([
      { name: "VCB", amount: 200 },
      { name: "Tiền mặt", amount: 100 },
      { name: "(đã xóa)", amount: 75 },
      { name: "Chưa xác định", amount: 50 },
    ]);
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
      type: "hold",
      lots: [{
        ticker: "VNM",
        qty: 2,
        manualPrice: 50_000,
        purchasePrice: null,
        purchaseFxVnd: null,
        feeVnd: null,
      }],
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

  it("ghép quỹ được chia sẻ nhưng loại nó khỏi báo cáo cá nhân của thành viên", () => {
    const store = createDefaultStore();
    const shared: SharedFundView = {
      id: "shared-1", revision: 1, role: "viewer",
      owner: { sub: "owner", name: "Chủ quỹ", email: "owner@example.com" },
      contributors: {},
      content: {
        fund: { id: "shared-1", name: "Quỹ chung", color: "#123456", cat: "saving" },
        years: { "2026": { funds: new Array(12).fill(500), details: new Array(12).fill(null) } },
        goal: { years: {}, all: 0 }, fundPlan: 0, openingBalance: 0,
      },
    };
    mergeSharedFunds(store, [shared]);
    expect(totalFundsForMonth(store, 2026, 0)).toBe(500);
    expect(totalFundsForMonth(store, 2026, 0, countsInPersonalReports)).toBe(0);
    expect(privateLedger(store).funds.some((fund) => fund.id === shared.id)).toBe(false);
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
