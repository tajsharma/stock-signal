import prisma from "../db.server";
import { getStoreSettings } from "./settings.server";
import { computeVelocity, type VariantVelocity } from "./velocity.server";

const MS_PER_DAY = 86_400_000;

// A "declining" sale needs at least this fractional drop vs. the prior window
// to count as a real trend rather than noise. Tunable.
const DECLINE_RATIO = 0.7;

// Stock-weighting gate: a low-revenue item is only worth re-evaluating if it's
// also slow to clear — i.e. you're holding at least this many months of supply
// (or it's dead stock with no velocity at all). This stops a cheap-but-fast
// seller from being mistaken for tied-up cash. Tunable.
const MIN_MONTHS_OF_SUPPLY = 2;

export type SalesTrend = "declining" | "steady" | "dormant";

// One row of the re-evaluate list: a slow/dead variant that's tying up cash.
export interface ReevaluateRow extends VariantVelocity {
  daysActive: number; // age via first-sale date (falls back to createdAt)
  cashTiedUp: number; // inventory on hand × price — the money sitting still
  monthsOfSupply: number | null; // null = no velocity (effectively infinite)
  trend: SalesTrend;
  flagged: boolean; // in the bottom slice by revenue velocity
}

export interface ReevaluateList {
  windowDays: number;
  bottomPercent: number;
  minActiveDays: number;
  minMonthsOfSupply: number; // stock-weighting gate applied to flags
  computedAt: Date;
  evaluableCount: number; // variants old enough to judge
  excludedNewCount: number; // skipped by the new-product guard
  rows: ReevaluateRow[]; // flagged items, worst cash-drain first
  flaggedCount: number;
}

// Build the re-evaluate list (Surface 2): the slow/dead inventory worth
// rethinking. Deliberately advisory — it flags, it never changes anything.
//
//   revenue velocity  = units/day × price  (NEVER raw units — a low-unit,
//                       high-price item must not be wrongly flagged)
//   flag              = in the bottom `bottomPercent` of the catalog by
//                       revenue velocity (self-calibrates per store)
//   new-product guard = only judge items active ≥ minActiveDays, using
//                       first-sale date as the activity proxy
//   stock weight      = cash tied up (inventory × price) orders the list, so
//                       a slow seller with lots of stock ranks worst
export async function computeReevaluateList(
  shop: string,
): Promise<ReevaluateList> {
  const settings = await getStoreSettings(shop);
  const { reevaluateBottomPercent, minActiveDays } = settings;
  const velocity = await computeVelocity(shop);
  const window = velocity.windowDays;
  const now = velocity.computedAt;

  // Units sold in the window immediately before the current one, for the trend
  // comparison (e.g. days 30–60 ago when the window is 30).
  const priorStart = new Date(now.getTime() - 2 * window * MS_PER_DAY);
  const priorEnd = new Date(now.getTime() - window * MS_PER_DAY);
  const priorSales = await prisma.orderLine.groupBy({
    by: ["variantId"],
    where: {
      shop,
      variantId: { not: null },
      processedAt: { gte: priorStart, lt: priorEnd },
    },
    _sum: { quantity: true },
  });
  const priorByVariant = new Map<string, number>();
  for (const row of priorSales) {
    if (row.variantId) priorByVariant.set(row.variantId, row._sum.quantity ?? 0);
  }

  // Enrich every variant with age, cash, supply, and trend.
  const enriched = velocity.variants.map((v) => {
    // "Active since" = the earliest signal we have. First-sale date is the
    // reliable proxy; productCreatedAt is the fallback for never-sold items.
    const activeSince = v.firstSaleAt
      ? new Date(
          Math.min(v.firstSaleAt.getTime(), v.productCreatedAt.getTime()),
        )
      : v.productCreatedAt;
    const daysActive = Math.floor((now.getTime() - activeSince.getTime()) / MS_PER_DAY);

    const cashTiedUp = v.inventoryQuantity * v.price;
    const monthsOfSupply =
      v.unitsPerDay > 0 ? v.inventoryQuantity / v.unitsPerDay / 30 : null;

    const prior = priorByVariant.get(v.variantId) ?? 0;
    const recent = v.unitsInWindow;
    let trend: SalesTrend;
    if (recent === 0 && prior === 0) trend = "dormant";
    else if (recent < prior * DECLINE_RATIO) trend = "declining";
    else trend = "steady";

    return { v, daysActive, cashTiedUp, monthsOfSupply, trend };
  });

  // New-product guard: only judge items that have been around long enough.
  const aged = enriched.filter((e) => e.daysActive >= minActiveDays);
  const excludedNewCount = enriched.length - aged.length;

  // Only items you actually hold stock of can be "tying up cash" — an item with
  // zero on hand (sold through, untracked, or a digital gift card) is out of
  // scope for this cash-focused surface.
  const evaluable = aged.filter((e) => e.v.inventoryQuantity > 0);

  // Bottom slice by revenue velocity (self-calibrating per store): the slowest
  // N% of the catalog. Then apply the stock-weighting gate so only items that
  // are genuinely slow to clear (or dead) survive — a cheap fast seller has low
  // revenue velocity but turns over quickly, so it shouldn't be flagged.
  const byRevenue = [...evaluable].sort(
    (a, b) => a.v.revenuePerDay - b.v.revenuePerDay,
  );
  const bottomSliceCount = Math.ceil(
    (evaluable.length * reevaluateBottomPercent) / 100,
  );
  const bottomSlice = byRevenue.slice(0, bottomSliceCount);

  const rows: ReevaluateRow[] = bottomSlice
    .filter(
      (e) =>
        e.monthsOfSupply === null || e.monthsOfSupply >= MIN_MONTHS_OF_SUPPLY,
    )
    .map((e) => ({
      ...e.v,
      daysActive: e.daysActive,
      cashTiedUp: e.cashTiedUp,
      monthsOfSupply: e.monthsOfSupply,
      trend: e.trend,
      flagged: true,
    }))
    // Worst cash-drain first — that's where the merchant should look.
    .sort((a, b) => b.cashTiedUp - a.cashTiedUp);

  return {
    windowDays: window,
    bottomPercent: reevaluateBottomPercent,
    minActiveDays,
    minMonthsOfSupply: MIN_MONTHS_OF_SUPPLY,
    computedAt: now,
    evaluableCount: evaluable.length,
    excludedNewCount,
    rows,
    flaggedCount: rows.length,
  };
}
