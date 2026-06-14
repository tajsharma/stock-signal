import { Resend } from "resend";
import { getStoreSettings } from "./settings.server";
import { computeReorderList, type ReorderRow } from "./reorder.server";
import {
  computeReevaluateList,
  type ReevaluateRow,
} from "./reevaluate.server";

const FROM = process.env.EMAIL_FROM || "StockSignal <onboarding@resend.dev>";
const MAX_ROWS = 10; // keep emails scannable

// Outcome of an attempted send. `sent: false` with a reason is normal (e.g. no
// API key in dev, notifications disabled) — callers log it, never throw.
export interface SendResult {
  sent: boolean;
  reason?: string;
  id?: string;
}

// Lazily build the Resend client. Returns null when no key is configured so the
// whole app keeps working in dev without email set up.
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function shopName(shop: string) {
  return shop.replace(/\.myshopify\.com$/, "");
}

// --- HTML rendering ---

function reorderRowsHtml(rows: ReorderRow[]) {
  if (rows.length === 0)
    return "<p>Nothing needs reordering right now. 🎉</p>";
  const items = rows
    .slice(0, MAX_ROWS)
    .map(
      (r) =>
        `<tr><td>${esc(r.productTitle)}${
          r.variantTitle && r.variantTitle !== "Default Title"
            ? " — " + esc(r.variantTitle)
            : ""
        }</td><td align="right">${
          r.daysOfStockLeft === null ? "—" : r.daysOfStockLeft.toFixed(1) + " d"
        }</td><td align="right">${r.inventoryQuantity}</td><td align="right"><b>${
          r.suggestedReorderQty
        }</b></td></tr>`,
    )
    .join("");
  return `<table width="100%" cellpadding="6" style="border-collapse:collapse;font-size:14px">
    <tr style="text-align:left;border-bottom:1px solid #ddd">
      <th>Product</th><th align="right">Days left</th><th align="right">Stock</th><th align="right">Suggested order</th>
    </tr>${items}</table>`;
}

function reevaluateRowsHtml(rows: ReevaluateRow[]) {
  if (rows.length === 0)
    return "<p>No slow or dead stock flagged right now.</p>";
  const items = rows
    .slice(0, MAX_ROWS)
    .map(
      (r) =>
        `<tr><td>${esc(r.productTitle)}${
          r.variantTitle && r.variantTitle !== "Default Title"
            ? " — " + esc(r.variantTitle)
            : ""
        }</td><td align="right">${money(r.revenuePerDay)}/day</td><td align="right">${
          r.monthsOfSupply === null ? "∞" : r.monthsOfSupply.toFixed(1) + " mo"
        }</td><td align="right"><b>${money(r.cashTiedUp)}</b></td></tr>`,
    )
    .join("");
  return `<table width="100%" cellpadding="6" style="border-collapse:collapse;font-size:14px">
    <tr style="text-align:left;border-bottom:1px solid #ddd">
      <th>Product</th><th align="right">Revenue</th><th align="right">Supply</th><th align="right">Cash tied up</th>
    </tr>${items}</table>`;
}

function wrap(title: string, body: string) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;color:#202223">
    <h1 style="font-size:20px">${esc(title)}</h1>${body}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
    <p style="font-size:12px;color:#6d7175">Sent by StockSignal. This is advice, not an action — nothing in your store was changed.</p>
  </div>`;
}

// --- Digest ---

// Build the weekly digest content for a shop from the two surfaces.
export async function composeDigest(shop: string) {
  const [reorder, reevaluate] = await Promise.all([
    computeReorderList(shop),
    computeReevaluateList(shop),
  ]);

  const subject = `StockSignal weekly: ${reorder.flaggedCount} to reorder, ${reevaluate.flaggedCount} to re-evaluate`;
  const html = wrap(`StockSignal — ${shopName(shop)}`, [
    `<h2 style="font-size:16px">🔄 Reorder soon (${reorder.flaggedCount})</h2>`,
    reorderRowsHtml(reorder.rows.filter((r) => r.flagged)),
    `<h2 style="font-size:16px;margin-top:24px">🐌 Re-evaluate (${reevaluate.flaggedCount})</h2>`,
    reevaluateRowsHtml(reevaluate.rows),
  ].join(""));

  return { subject, html, reorder, reevaluate };
}

// Send the weekly digest. No-ops (with a reason) if disabled, unconfigured, or
// no API key — never throws.
export async function sendDigest(shop: string): Promise<SendResult> {
  const settings = await getStoreSettings(shop);
  if (!settings.digestEnabled) return { sent: false, reason: "digest-disabled" };
  if (!settings.digestEmail) return { sent: false, reason: "no-recipient" };

  const resend = getResend();
  if (!resend) return { sent: false, reason: "no-api-key" };

  const { subject, html } = await composeDigest(shop);
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: settings.digestEmail,
    subject,
    html,
  });
  if (error) return { sent: false, reason: error.message };
  return { sent: true, id: data?.id };
}

// --- Urgent alert ---

// Send an urgent "reorder now" alert for items that just crossed the threshold.
export async function sendUrgentAlert(
  shop: string,
  email: string,
  items: ReorderRow[],
): Promise<SendResult> {
  if (items.length === 0) return { sent: false, reason: "no-items" };
  const resend = getResend();
  if (!resend) return { sent: false, reason: "no-api-key" };

  const subject =
    items.length === 1
      ? `⚠️ Reorder now: ${items[0].productTitle}`
      : `⚠️ ${items.length} items need reordering now`;
  const html = wrap(
    "Reorder now",
    `<p>A recent sale pushed ${
      items.length === 1 ? "this item" : "these items"
    } below your reorder threshold:</p>${reorderRowsHtml(items)}`,
  );

  const { data, error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject,
    html,
  });
  if (error) return { sent: false, reason: error.message };
  return { sent: true, id: data?.id };
}
