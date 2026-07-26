import type {
  FinanceStore,
  FundCategory,
  GoldLot,
  HoldingLot,
  MarketQuotesResponse,
} from "./index.js";

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

function legacyLotPrice(store: FinanceStore, lot: HoldingLot, category: FundCategory): number {
  const shared = store.prices[lot.ticker.trim().toUpperCase()];
  const unit = lot.manualPrice !== null && lot.manualPrice !== undefined && lot.manualPrice !== 0 ? lot.manualPrice : shared;
  const price = Number(unit) || 0;
  return category === "crypto" ? price * (store.market.fx?.usdVnd ?? store.usdRate ?? 0) : price;
}

function currentLotPriceVnd(store: FinanceStore, lot: HoldingLot, category: FundCategory): number {
  if (category === "stock") return stockQuote(store, lot)?.priceVnd ?? legacyLotPrice(store, lot, category);
  const quote = cryptoQuote(store, lot);
  if (quote && (store.market.fx?.usdVnd ?? 0) > 0) return quote.priceUsd * store.market.fx!.usdVnd;
  return legacyLotPrice(store, lot, category);
}

function goldLotPriceVnd(store: FinanceStore, lot: GoldLot): number {
  return store.market.gold?.vndPerChi || Number(lot.manualPrice) || 0;
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
          const value = detail.lots.reduce((sum, lot) => sum + lot.chi * goldLotPriceVnd(store, lot), 0);
          if (value > 0) data.funds[fund.id]![month] = Math.round(value);
        } else if ((category === "stock" || category === "crypto") && detail.type === "hold") {
          let value = 0;
          let complete = true;
          let hasQuantity = false;
          for (const lot of detail.lots) {
            if (!(lot.qty > 0)) continue;
            hasQuantity = true;
            const price = currentLotPriceVnd(store, lot, category);
            if (!(price > 0)) complete = false;
            else value += lot.qty * price;
          }
          if (hasQuantity && complete) data.funds[fund.id]![month] = Math.round(value);
        }
      }
    }
  }
}
