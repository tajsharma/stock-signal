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
