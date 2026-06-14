import prisma from "../db.server";
import {
  DEFAULT_VELOCITY_WINDOW,
  getStoreSettings,
  type VelocityWindow,
} from "./settings.server";

const MS_PER_DAY = 86_400_000;

// One variant's computed velocity over a trailing window. This is the single
// "velocity engine" output that both Surface 1 (reorder) and Surface 2
// (re-evaluate) read — neither surface recomputes sales math itself.
export interface VariantVelocity {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  price: number;
  inventoryQuantity: number;
  leadTimeDays: number; // per-product reorder lead time

  windowDays: number;
  unitsInWindow: number; // units sold within the trailing window
  unitsPerDay: number; // velocity = unitsInWindow / windowDays
  revenuePerDay: number; // unitsPerDay * price (foundation for Surface 2 ranking)

  firstSaleAt: Date | null; // earliest sale on record; activity proxy for the
  // new-product guard (productCreatedAt is unreliable on seeded stores)
  daysSinceFirstSale: number | null;
}

export interface VelocityResult {
  windowDays: number;
  computedAt: Date;
  variants: VariantVelocity[];
}

// Compute units/day per variant over a trailing window.
//
// Deliberately simple and explainable (no forecasting): for each variant,
// sum the units sold in the last `windowDays` and divide by `windowDays`.
// The divisor is the window length — NOT the product's age — so backdated
// history averages correctly and a young catalog can't inflate velocity.
//
// Every catalog variant is returned, including zero-velocity ones, because
// Surface 2 needs the dead/slow sellers. Callers sort/filter as needed.
export async function computeVelocity(
  shop: string,
  windowDays?: VelocityWindow,
): Promise<VelocityResult> {
  const window =
    windowDays ?? (await getStoreSettings(shop)).velocityWindowDays;
  const effectiveWindow = window || DEFAULT_VELOCITY_WINDOW;

  const now = new Date();
  const cutoff = new Date(now.getTime() - effectiveWindow * MS_PER_DAY);

  // Units sold per variant inside the window (one grouped query).
  const windowSales = await prisma.orderLine.groupBy({
    by: ["variantId"],
    where: { shop, variantId: { not: null }, processedAt: { gte: cutoff } },
    _sum: { quantity: true },
  });
  const unitsByVariant = new Map<string, number>();
  for (const row of windowSales) {
    if (row.variantId) unitsByVariant.set(row.variantId, row._sum.quantity ?? 0);
  }

  // Earliest sale per variant over ALL history (not just the window) — used as
  // the "active since" proxy for the new-product guard.
  const firstSales = await prisma.orderLine.groupBy({
    by: ["variantId"],
    where: { shop, variantId: { not: null } },
    _min: { processedAt: true },
  });
  const firstSaleByVariant = new Map<string, Date>();
  for (const row of firstSales) {
    if (row.variantId && row._min.processedAt)
      firstSaleByVariant.set(row.variantId, row._min.processedAt);
  }

  const variants = await prisma.variant.findMany({ where: { shop } });

  const result: VariantVelocity[] = variants.map((v) => {
    const unitsInWindow = unitsByVariant.get(v.id) ?? 0;
    const unitsPerDay = unitsInWindow / effectiveWindow;
    const firstSaleAt = firstSaleByVariant.get(v.id) ?? null;
    const daysSinceFirstSale = firstSaleAt
      ? Math.floor((now.getTime() - firstSaleAt.getTime()) / MS_PER_DAY)
      : null;

    return {
      variantId: v.id,
      productId: v.productId,
      productTitle: v.productTitle,
      variantTitle: v.variantTitle,
      sku: v.sku,
      price: v.price,
      inventoryQuantity: v.inventoryQuantity,
      leadTimeDays: v.leadTimeDays,
      windowDays: effectiveWindow,
      unitsInWindow,
      unitsPerDay,
      revenuePerDay: unitsPerDay * v.price,
      firstSaleAt,
      daysSinceFirstSale,
    };
  });

  return { windowDays: effectiveWindow, computedAt: now, variants: result };
}
