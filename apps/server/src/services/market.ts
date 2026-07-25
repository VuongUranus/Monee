import type {
  CryptoMatch,
  CryptoQuote,
  FxQuote,
  GoldQuote,
  MarketAssetRequest,
  MarketQuotesRequest,
  MarketQuotesResponse,
  StockQuote,
} from "@chi-tieu/shared";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const QUOTE_TTL_MS = 10 * 60 * 1000;
export const GOLD_GRAMS_PER_TROY_OUNCE = 31.1034768;
export const GRAMS_PER_CHI = 3.75;

interface JsonResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<JsonResponse>;

interface MarketError extends Error {
  code: string;
  status?: number;
  payload?: unknown;
  matches?: CryptoMatch[];
}

function marketError(code: string, message: string, extra: Partial<MarketError> = {}): MarketError {
  const error = new Error(message) as MarketError;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (value == null) return NaN;
  const normalized = String(value).trim().replace(/[,_\s]/g, "");
  return normalized === "" ? NaN : Number(normalized);
}

export function calculateGoldVndPerChi(xauUsdPerTroyOunce: number, usdVnd: number): number {
  return (xauUsdPerTroyOunce * usdVnd * GRAMS_PER_CHI) / GOLD_GRAMS_PER_TROY_OUNCE;
}

function assetKey(asset: MarketAssetRequest): string {
  const symbol = String(asset.symbol || "").trim().toUpperCase();
  if (asset.type === "stock") return `stock:${asset.exchange || "auto"}:${symbol}`;
  if (asset.type === "crypto") return `crypto:${asset.providerId || symbol}`;
  return "gold:XAU";
}

export interface MarketService {
  getQuotes(request?: Partial<MarketQuotesRequest>): Promise<MarketQuotesResponse>;
}

interface MarketServiceOptions {
  fetchImpl?: FetchLike;
  now?: () => number;
}

export function createMarketService({
  fetchImpl = globalThis.fetch as FetchLike,
  now = () => Date.now(),
}: MarketServiceOptions = {}): MarketService {
  if (typeof fetchImpl !== "function") throw new Error("Node.js 20+ is required to fetch market data.");

  const cache = new Map<string, { value: unknown; cachedAt: number }>();

  async function requestJson(url: string, options: RequestInit = {}): Promise<Record<string, any>> {
    const response = await fetchImpl(url, options);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw marketError("upstream_error", `Nguồn dữ liệu trả về HTTP ${response.status}.`, { status: response.status, payload });
    }
    return record(payload);
  }

  async function cached<T>(key: string, ttl: number, force: boolean, loader: () => Promise<T>): Promise<T> {
    const entry = cache.get(key);
    if (!force && entry && now() - entry.cachedAt < ttl) return entry.value as T;
    const value = await loader();
    cache.set(key, { value, cachedAt: now() });
    return value;
  }

  async function getUsdVnd(force: boolean): Promise<FxQuote> {
    return cached("fx:USDVND", DAY_MS, force, async () => {
      const payload = await requestJson("https://open.er-api.com/v6/latest/USD");
      const usdVnd = toNumber(payload?.rates?.VND);
      if (!(usdVnd > 0)) throw marketError("invalid_fx", "Nguồn tỷ giá không trả về USD/VND hợp lệ.");
      return {
        usdVnd,
        source: "ExchangeRate-API",
        sourceUrl: "https://www.exchangerate-api.com",
        fetchedAt: new Date(now()).toISOString(),
      };
    });
  }

  async function getGold(force: boolean, usdVnd: number): Promise<GoldQuote> {
    return cached("gold:XAU", QUOTE_TTL_MS, force, async () => {
      const payload = await requestJson("https://api.gold-api.com/price/XAU");
      const xauUsdPerTroyOunce = toNumber(payload?.price);
      if (!(xauUsdPerTroyOunce > 0)) throw marketError("invalid_gold", "Nguồn vàng không trả về giá XAU hợp lệ.");
      return {
        symbol: "XAU",
        xauUsdPerTroyOunce,
        vndPerChi: calculateGoldVndPerChi(xauUsdPerTroyOunce, usdVnd),
        source: "Gold API",
        sourceUrl: "https://gold-api.com",
        fetchedAt: new Date(now()).toISOString(),
      };
    });
  }

  function lastPriceFromRows(rows: unknown): number {
    const candidates = Array.isArray(rows) ? rows : [];
    for (const row of candidates) {
      for (const field of ["GiaDongCua", "ClosePrice", "closePrice", "Close", "close", "LastPrice", "lastPrice", "MatchedPrice", "matchedPrice"]) {
        const price = toNumber(record(row)[field]);
        if (price > 0) return price;
      }
    }
    return NaN;
  }

  async function fetchStock(symbol: string, exchange: string): Promise<StockQuote> {
    if (exchange !== "HOSE") {
      throw marketError("stock_exchange_unsupported", `Nguồn giá không cần key hiện chỉ hỗ trợ HOSE; chưa thể tự động cập nhật ${exchange}.`);
    }
    const params = new URLSearchParams({ Symbol: symbol, PageIndex: "1", PageSize: "1" });
    const payload = await requestJson(`https://cafef.vn/du-lieu/ajax/pagenew/datahistory/pricehistory.ashx?${params}`);
    const rows = payload?.Data?.Data || [];
    const priceVnd = lastPriceFromRows(rows) * 1000;
    if (!(priceVnd > 0)) throw marketError("stock_not_found", `Không tìm thấy giá cho ${symbol} trên ${exchange}.`);
    return {
      symbol,
      exchange,
      priceVnd,
      source: "CafeF",
      sourceUrl: "https://cafef.vn/du-lieu/",
      fetchedAt: new Date(now()).toISOString(),
    };
  }

  async function getStock(asset: MarketAssetRequest, force: boolean): Promise<StockQuote> {
    const symbol = String(asset.symbol || "").trim().toUpperCase();
    if (!symbol) throw marketError("missing_symbol", "Thiếu mã cổ phiếu.");
    const exchanges = asset.exchange ? [String(asset.exchange).toUpperCase()] : ["HOSE"];
    for (const exchange of exchanges) {
      const key = `stock:${exchange}:${symbol}`;
      try {
        return await cached(key, QUOTE_TTL_MS, force, () => fetchStock(symbol, exchange));
      } catch (caught) {
        const error = caught as MarketError;
        if (error.code === "stock_exchange_unsupported") throw error;
        if (asset.exchange) throw error;
      }
    }
    throw marketError("stock_not_found", `Không tìm thấy mã ${symbol} trên HOSE.`);
  }

  async function resolveCrypto(symbol: string): Promise<CryptoMatch> {
    const payload = await requestJson(`https://api.coinpaprika.com/v1/search?${new URLSearchParams({ q: symbol, c: "currencies", limit: "10" })}`);
    const candidates = (payload?.currencies || payload?.coins || [])
      .filter((coin: Record<string, any>) => String(coin.symbol || "").toUpperCase() === symbol && coin.id)
      .sort((a: Record<string, any>, b: Record<string, any>) => (toNumber(a.rank) || Number.MAX_SAFE_INTEGER) - (toNumber(b.rank) || Number.MAX_SAFE_INTEGER))
      .map((coin: Record<string, any>) => ({
        id: String(coin.id),
        symbol: String(coin.symbol),
        name: String(coin.name),
        rank: Number(coin.rank) || undefined,
      }));
    if (candidates.length === 0) throw marketError("crypto_not_found", `Không tìm thấy crypto có mã ${symbol}.`);
    if (candidates.length > 1) {
      throw marketError("crypto_ambiguous", `Mã ${symbol} có nhiều crypto trùng tên. Hãy chọn một crypto.`, { matches: candidates });
    }
    return candidates[0]!;
  }

  async function getCrypto(asset: MarketAssetRequest, force: boolean): Promise<CryptoQuote> {
    const symbol = String(asset.symbol || "").trim().toUpperCase();
    if (!symbol && !asset.providerId) throw marketError("missing_symbol", "Thiếu mã crypto.");
    const resolved = asset.providerId
      ? { id: String(asset.providerId), symbol }
      : await resolveCrypto(symbol);
    return cached(`crypto:${resolved.id}`, QUOTE_TTL_MS, force, async () => {
      const payload = await requestJson(`https://api.coinpaprika.com/v1/tickers/${encodeURIComponent(resolved.id)}`);
      const priceUsd = toNumber(payload?.quotes?.USD?.price);
      if (!(priceUsd > 0)) throw marketError("invalid_crypto", `Không tìm được giá USD cho ${resolved.id}.`);
      return {
        symbol: String(payload?.symbol || resolved.symbol || symbol).toUpperCase(),
        providerId: resolved.id,
        name: String(payload?.name || ("name" in resolved ? resolved.name : "") || resolved.id),
        priceUsd,
        source: "CoinPaprika",
        sourceUrl: "https://docs.coinpaprika.com",
        fetchedAt: new Date(now()).toISOString(),
      };
    });
  }

  async function getQuotes(request: Partial<MarketQuotesRequest> = {}): Promise<MarketQuotesResponse> {
    const assets = Array.isArray(request.assets) ? request.assets : [];
    const force = request.force === true;
    const unique = new Map<string, MarketAssetRequest>();
    assets.forEach((asset) => {
      if (asset && ["gold", "stock", "crypto"].includes(asset.type)) unique.set(assetKey(asset), asset);
    });

    const needsFx = [...unique.values()].some((asset) => asset.type === "gold" || asset.type === "crypto");
    const result: MarketQuotesResponse = {
      fetchedAt: new Date(now()).toISOString(),
      fx: null,
      gold: null,
      stocks: [],
      crypto: [],
      matches: {},
      errors: [],
    };

    if (needsFx) {
      try {
        result.fx = await getUsdVnd(force);
      } catch (caught) {
        const error = caught as MarketError;
        result.errors.push({ key: "fx:USDVND", code: error.code || "fx_failed", message: error.message });
      }
    }

    for (const [key, asset] of unique) {
      try {
        if (asset.type === "gold") {
          if (!result.fx) throw marketError("fx_required", "Không thể quy đổi vàng khi thiếu tỷ giá USD/VND.");
          result.gold = await getGold(force, result.fx.usdVnd);
        } else if (asset.type === "stock") {
          result.stocks.push(await getStock(asset, force));
        } else if (asset.type === "crypto") {
          if (!result.fx) throw marketError("fx_required", "Không thể quy đổi crypto khi thiếu tỷ giá USD/VND.");
          result.crypto.push(await getCrypto(asset, force));
        }
      } catch (caught) {
        const error = caught as MarketError;
        if (error.code === "crypto_ambiguous" && error.matches) result.matches[key] = error.matches;
        result.errors.push({ key, code: error.code || "quote_failed", message: error.message });
      }
    }
    return result;
  }

  return { getQuotes };
}
