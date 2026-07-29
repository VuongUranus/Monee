import type { GoldCostBasis, GoldLot } from "./index.js";

function nonnegative(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function legacyGoldCostBasis(
  chi: unknown,
  purchasePrice: unknown,
  feeVnd: unknown,
): GoldCostBasis | null {
  const quantity = nonnegative(chi) ?? 0;
  const unitPrice = nonnegative(purchasePrice);
  const fee = nonnegative(feeVnd);
  if ((fee ?? 0) > 0) {
    return {
      type: "total_paid",
      totalVnd: quantity * (unitPrice ?? 0) + fee!,
    };
  }
  if ((unitPrice ?? 0) > 0) return { type: "unit_price", vndPerChi: unitPrice! };
  return null;
}

export function goldCostBasisVnd(lot: Pick<GoldLot, "chi" | "costBasis">): number {
  const basis = lot.costBasis;
  if (!basis) return 0;
  if (basis.type === "total_paid") return Number(basis.totalVnd) || 0;
  return (Number(lot.chi) || 0) * (Number(basis.vndPerChi) || 0);
}
