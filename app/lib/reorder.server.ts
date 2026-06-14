import { getStoreSettings } from "./settings.server";
import { computeVelocity, type VariantVelocity } from "./velocity.server";

// A single row of the reorder list: a selling variant with its days-of-stock
// math, reorder flag, and suggested order quantity.
export interface ReorderRow extends VariantVelocity {
  daysOfStockLeft: number | null; // null = no velocity (can't run out)
  reorderThresholdDays: number; // leadTime + safety buffer
  flagged: boolean; // days left <= threshold → reorder now
  suggestedReorderQty: number; // units to order to hit the coverage target
}

export interface ReorderList {
  windowDays: number;
  safetyBufferDays: number;
  reorderCoverageDays: number;
  computedAt: Date;
  rows: ReorderRow[]; // selling variants, sorted by urgency (soonest-out first)
  flaggedCount: number;
}

// Build the reorder list (Surface 1). Pure, explainable math on top of the
// velocity engine — no forecasting:
//
//   days of stock left   = inventory on hand ÷ units/day
//   reorder threshold    = lead time + safety buffer
//   flag for reorder     = selling AND days-left ≤ threshold
//   suggested order qty   = (units/day × coverage days) − inventory on hand
//
// Only variants that are actually selling (velocity > 0) appear here — an item
// with zero sales can't "stock out", and dead/slow stock is Surface 2's job.
export async function computeReorderList(shop: string): Promise<ReorderList> {
  const settings = await getStoreSettings(shop);
  const { safetyBufferDays, reorderCoverageDays } = settings;
  const velocity = await computeVelocity(shop);

  const rows: ReorderRow[] = velocity.variants
    .filter((v) => v.unitsPerDay > 0)
    .map((v) => {
      const daysOfStockLeft = v.inventoryQuantity / v.unitsPerDay;
      const reorderThresholdDays = v.leadTimeDays + safetyBufferDays;
      const flagged = daysOfStockLeft <= reorderThresholdDays;

      // Order enough to cover the target horizon, net of what's on hand.
      const targetUnits = v.unitsPerDay * reorderCoverageDays;
      const suggestedReorderQty = Math.max(
        0,
        Math.ceil(targetUnits - v.inventoryQuantity),
      );

      return {
        ...v,
        daysOfStockLeft,
        reorderThresholdDays,
        flagged,
        suggestedReorderQty,
      };
    })
    // Most urgent first: fewest days of stock left at the top.
    .sort((a, b) => (a.daysOfStockLeft ?? Infinity) - (b.daysOfStockLeft ?? Infinity));

  return {
    windowDays: velocity.windowDays,
    safetyBufferDays,
    reorderCoverageDays,
    computedAt: velocity.computedAt,
    rows,
    flaggedCount: rows.filter((r) => r.flagged).length,
  };
}
