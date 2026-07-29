import {
  legacyGoldCostBasis,
  type GoldCostBasis,
  type GoldLot,
} from "@chi-tieu/shared";

interface StoredGoldCost {
  chi: unknown;
  purchasePrice: unknown;
  feeVnd: unknown;
  costBasisType: unknown;
  costBasisValueVnd: unknown;
  costBasisQuoteDate: unknown;
  costBasisSource: unknown;
}

function storedNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function readGoldCostBasis(row: StoredGoldCost): GoldCostBasis | null {
  const value = storedNumber(row.costBasisValueVnd);
  if (row.costBasisType === "unit_price" && value !== null) {
    return { type: "unit_price", vndPerChi: value };
  }
  if (row.costBasisType === "total_paid" && value !== null) {
    return { type: "total_paid", totalVnd: value };
  }
  if (
    row.costBasisType === "historical"
    && value !== null
    && row.costBasisQuoteDate
    && row.costBasisSource
  ) {
    return {
      type: "historical",
      vndPerChi: value,
      quoteDate: String(row.costBasisQuoteDate),
      source: String(row.costBasisSource),
    };
  }
  return legacyGoldCostBasis(row.chi, row.purchasePrice, row.feeVnd);
}

export function writeGoldCostBasis(lot: GoldLot) {
  const basis = lot.costBasis ?? null;
  if (!basis) {
    return {
      purchasePrice: null,
      feeVnd: null,
      costBasisType: null,
      costBasisValueVnd: null,
      costBasisQuoteDate: null,
      costBasisSource: null,
    };
  }
  if (basis.type === "total_paid") {
    return {
      // Dual-write the legacy fee column so the previous application version
      // still computes the same total capital during a rollback.
      purchasePrice: null,
      feeVnd: basis.totalVnd,
      costBasisType: basis.type,
      costBasisValueVnd: basis.totalVnd,
      costBasisQuoteDate: null,
      costBasisSource: null,
    };
  }
  return {
    // Unit and historical prices remain readable as legacy purchase prices.
    purchasePrice: basis.vndPerChi,
    feeVnd: null,
    costBasisType: basis.type,
    costBasisValueVnd: basis.vndPerChi,
    costBasisQuoteDate: basis.type === "historical" ? basis.quoteDate : null,
    costBasisSource: basis.type === "historical" ? basis.source : null,
  };
}
