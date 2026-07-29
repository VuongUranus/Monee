import type {
  FinanceStore,
  HoldingLot,
  MarketQuotesResponse,
} from "./index.js";
import { goldCostBasisVnd } from "./gold.js";

function stockQuote(store: FinanceStore, lot: HoldingLot) {
  const symbol = lot.ticker.trim().toUpperCase();
  if (lot.exchange && store.market.stocks[`${lot.exchange}:${symbol}`]) return store.market.stocks[`${lot.exchange}:${symbol}`];
  return Object.values(store.market.stocks).find((quote) => quote.symbol === symbol);
}

function cryptoQuote(store: FinanceStore, lot: HoldingLot) {
  if (lot.providerId && store.market.crypto[lot.providerId]) return store.market.crypto[lot.providerId];
  const providerId = store.market.cryptoSymbols[lot.ticker.trim().toUpperCase()];
  return providerId ? store.market.crypto[providerId] : undefined;
}

function holdingCostVnd(lot: HoldingLot, category: "stock" | "crypto"): number {
  const quantity = Number(lot.qty) || 0;
  const purchasePrice = Number(lot.purchasePrice) || 0;
  const unit = category === "crypto" ? purchasePrice * (Number(lot.purchaseFxVnd) || 0) : purchasePrice;
  return quantity * unit + (Number(lot.feeVnd) || 0);
}

export function applyMarketResponse(store: FinanceStore, response: MarketQuotesResponse): void {
  if (response.fx) store.market.fx = response.fx;
  if (response.gold) store.market.gold = response.gold;
  for (const quote of response.stocks) store.market.stocks[`${quote.exchange}:${quote.symbol}`] = quote;
  for (const quote of response.crypto) {
    store.market.crypto[quote.providerId] = quote;
    store.market.cryptoSymbols[quote.symbol] = quote.providerId;
  }
  Object.assign(store.market.matches, response.matches);
  store.market.errors = response.errors;
  store.market.updatedAt = response.fetchedAt;

  for (const fund of store.funds) {
    if (fund.cat !== "stock" && fund.cat !== "crypto") continue;
    for (const data of Object.values(store.years)) {
      for (const detail of data.details[fund.id] ?? []) {
        if (detail?.type !== "hold") continue;
        for (const lot of detail.lots) {
          if (fund.cat === "stock") {
            const quote = stockQuote(store, lot);
            if (quote) lot.exchange = quote.exchange;
          } else {
            const quote = cryptoQuote(store, lot);
            if (quote) lot.providerId = quote.providerId;
          }
        }
      }
    }
  }
}

export function recalculateMarketFundAmounts(store: FinanceStore): void {
  for (const fund of store.funds) {
    const category = fund.cat;
    if (category === "saving") continue;
    for (const data of Object.values(store.years)) {
      for (let month = 0; month < 12; month += 1) {
        const detail = data.details[fund.id]?.[month];
        if (!detail) continue;
        if (category === "gold" && detail.type === "gold") {
          const hasGold = detail.lots.some((lot) => lot.chi > 0);
          const complete = detail.lots.every((lot) => lot.chi <= 0 || goldCostBasisVnd(lot) > 0);
          if (hasGold && complete) {
            data.funds[fund.id]![month] = Math.round(detail.lots.reduce((sum, lot) => sum + goldCostBasisVnd(lot), 0));
          }
        } else if ((category === "stock" || category === "crypto") && detail.type === "hold") {
          let cost = 0;
          let complete = true;
          let hasQuantity = false;
          for (const lot of detail.lots) {
            if (!(lot.qty > 0)) continue;
            hasQuantity = true;
            if (!(Number(lot.purchasePrice) > 0) || (category === "crypto" && !(Number(lot.purchaseFxVnd) > 0))) {
              complete = false;
            }
            cost += holdingCostVnd(lot, category);
          }
          if (hasQuantity && complete) data.funds[fund.id]![month] = Math.round(cost);
        }
      }
    }
  }
}
