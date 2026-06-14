import prisma from "../db.server";
import { computeReorderList } from "./reorder.server";
import { getStoreSettings } from "./settings.server";
import { sendUrgentAlert, type SendResult } from "./email.server";

// Don't re-alert about the same variant more often than this.
const ALERT_THROTTLE_MS = 24 * 60 * 60 * 1000;

// After a new order, alert about any variant in that order that is now flagged
// for reorder and hasn't been alerted in the last 24h. Approximates "crossed
// into reorder now" without storing prior state: the order shows what just
// sold, the throttle stops repeat alerts. Stamps lastReorderAlertAt only on a
// real send, so once an API key is added alerts still fire.
export async function processUrgentAlerts(
  shop: string,
  orderedVariantIds: string[],
): Promise<SendResult> {
  if (orderedVariantIds.length === 0)
    return { sent: false, reason: "no-variants" };

  const settings = await getStoreSettings(shop);
  // Email automation is a Pro feature; the in-app lists stay free.
  if (settings.plan !== "pro") return { sent: false, reason: "upgrade-required" };
  if (!settings.urgentAlertsEnabled)
    return { sent: false, reason: "alerts-disabled" };
  if (!settings.digestEmail) return { sent: false, reason: "no-recipient" };

  const ordered = new Set(orderedVariantIds);
  const list = await computeReorderList(shop);
  const candidates = list.rows.filter(
    (r) => r.flagged && ordered.has(r.variantId),
  );
  if (candidates.length === 0)
    return { sent: false, reason: "none-newly-flagged" };

  // Respect the per-variant throttle.
  const variantRows = await prisma.variant.findMany({
    where: { shop, id: { in: candidates.map((c) => c.variantId) } },
    select: { id: true, lastReorderAlertAt: true },
  });
  const lastAlert = new Map(
    variantRows.map((v) => [v.id, v.lastReorderAlertAt]),
  );
  const now = Date.now();
  const toAlert = candidates.filter((c) => {
    const last = lastAlert.get(c.variantId);
    return !last || now - last.getTime() > ALERT_THROTTLE_MS;
  });
  if (toAlert.length === 0) return { sent: false, reason: "throttled" };

  const result = await sendUrgentAlert(shop, settings.digestEmail, toAlert);
  if (result.sent) {
    await prisma.variant.updateMany({
      where: { shop, id: { in: toAlert.map((c) => c.variantId) } },
      data: { lastReorderAlertAt: new Date() },
    });
  }
  return result;
}
