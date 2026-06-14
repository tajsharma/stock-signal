import prisma from "../db.server";

// The trailing-window options the velocity engine supports (days). Tunable.
export const VELOCITY_WINDOWS = [30, 60, 90] as const;
export type VelocityWindow = (typeof VELOCITY_WINDOWS)[number];
export const DEFAULT_VELOCITY_WINDOW: VelocityWindow = 30;

export function isVelocityWindow(n: number): n is VelocityWindow {
  return (VELOCITY_WINDOWS as readonly number[]).includes(n);
}

// Read a shop's settings, creating defaults on first access.
export async function getStoreSettings(shop: string) {
  return prisma.storeSettings.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
}

// Persist the velocity window, ignoring anything outside the allowed set.
export async function setVelocityWindow(shop: string, days: number) {
  const velocityWindowDays = isVelocityWindow(days)
    ? days
    : DEFAULT_VELOCITY_WINDOW;
  return prisma.storeSettings.upsert({
    where: { shop },
    update: { velocityWindowDays },
    create: { shop, velocityWindowDays },
  });
}

// Clamp a settings input to a sane range so a stray value can't break the math.
function clampDays(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// Persist the store-level reorder policy (safety buffer + coverage target).
export async function setReorderPolicy(
  shop: string,
  input: { safetyBufferDays?: number; reorderCoverageDays?: number },
) {
  const data: { safetyBufferDays?: number; reorderCoverageDays?: number } = {};
  if (input.safetyBufferDays !== undefined)
    data.safetyBufferDays = clampDays(input.safetyBufferDays, 0, 60, 3);
  if (input.reorderCoverageDays !== undefined)
    data.reorderCoverageDays = clampDays(input.reorderCoverageDays, 1, 180, 30);
  return prisma.storeSettings.upsert({
    where: { shop },
    update: data,
    create: { shop, ...data },
  });
}

// Persist the store-level re-evaluate policy (bottom slice % + new-product
// guard threshold).
export async function setReevaluatePolicy(
  shop: string,
  input: { reevaluateBottomPercent?: number; minActiveDays?: number },
) {
  const data: { reevaluateBottomPercent?: number; minActiveDays?: number } = {};
  if (input.reevaluateBottomPercent !== undefined)
    data.reevaluateBottomPercent = clampDays(
      input.reevaluateBottomPercent,
      1,
      100,
      20,
    );
  if (input.minActiveDays !== undefined)
    data.minActiveDays = clampDays(input.minActiveDays, 0, 365, 30);
  return prisma.storeSettings.upsert({
    where: { shop },
    update: data,
    create: { shop, ...data },
  });
}

// Persist the store's notification settings (recipient + toggles).
export async function setNotificationSettings(
  shop: string,
  input: {
    digestEmail?: string | null;
    digestEnabled?: boolean;
    urgentAlertsEnabled?: boolean;
  },
) {
  const data: {
    digestEmail?: string | null;
    digestEnabled?: boolean;
    urgentAlertsEnabled?: boolean;
  } = {};
  if (input.digestEmail !== undefined) {
    const trimmed = input.digestEmail?.trim();
    data.digestEmail = trimmed ? trimmed : null;
  }
  if (input.digestEnabled !== undefined) data.digestEnabled = input.digestEnabled;
  if (input.urgentAlertsEnabled !== undefined)
    data.urgentAlertsEnabled = input.urgentAlertsEnabled;
  return prisma.storeSettings.upsert({
    where: { shop },
    update: data,
    create: { shop, ...data },
  });
}

// Persist a per-product (per-variant) lead time, scoped to the shop so one
// store can't edit another's data.
export async function setVariantLeadTime(
  shop: string,
  variantId: string,
  leadTimeDays: number,
) {
  const value = clampDays(leadTimeDays, 0, 365, 7);
  return prisma.variant.updateMany({
    where: { id: variantId, shop },
    data: { leadTimeDays: value },
  });
}
