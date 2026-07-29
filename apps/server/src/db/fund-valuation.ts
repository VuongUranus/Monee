import type { StoredMarketState } from "@chi-tieu/shared";

export interface InvestmentValuationRow {
  category: string;
  ticker: string | null;
  quantity: unknown;
  holdingManualPrice: unknown;
  exchange: string | null;
  providerId: string | null;
  chi: unknown;
  goldManualPrice: unknown;
}

const number = (value: unknown): number => Number(value) || 0;

/** Định giá một lot theo quote mới nhất, với giá thủ công làm dự phòng. */
export function currentInvestmentValueVnd(
  row: InvestmentValuationRow,
  market: StoredMarketState,
): number {
  if (row.category === "gold") {
    const unitPrice = market.gold?.vndPerChi || number(row.goldManualPrice);
    return number(row.chi) * unitPrice;
  }

  const symbol = row.ticker?.trim().toUpperCase();
  const quantity = number(row.quantity);
  if (!symbol || quantity <= 0) return 0;

  if (row.category === "stock") {
    const quote = row.exchange
      ? market.stocks[`${row.exchange}:${symbol}`]
        ?? Object.values(market.stocks).find((entry) => entry.symbol === symbol)
      : Object.values(market.stocks).find((entry) => entry.symbol === symbol);
    return quantity * (quote?.priceVnd ?? number(row.holdingManualPrice));
  }

  if (row.category === "crypto") {
    const providerId = row.providerId && market.crypto[row.providerId]
      ? row.providerId
      : market.cryptoSymbols[symbol];
    const quote = providerId ? market.crypto[providerId] : undefined;
    const unitPriceUsd = quote?.priceUsd ?? number(row.holdingManualPrice);
    return quantity * unitPriceUsd * (market.fx?.usdVnd ?? 0);
  }

  return 0;
}
