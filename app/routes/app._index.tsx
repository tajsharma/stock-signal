import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { runBackfill } from "../lib/sync.server";
import { computeReorderList } from "../lib/reorder.server";
import { computeReevaluateList } from "../lib/reevaluate.server";
import { getStoreSettings, VELOCITY_WINDOWS } from "../lib/settings.server";

function variantLabel(productTitle: string, variantTitle: string | null) {
  return variantTitle && variantTitle !== "Default Title"
    ? `${productTitle} — ${variantTitle}`
    : productTitle;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Self-initialize the data layer on the very first load for this shop.
  let sync = await prisma.shopSync.findUnique({ where: { shop } });
  if (!sync) {
    await runBackfill(admin, shop);
    sync = await prisma.shopSync.findUnique({ where: { shop } });
  }

  const [variantCount, reorder, reevaluate, settings] = await Promise.all([
    prisma.variant.count({ where: { shop } }),
    computeReorderList(shop),
    computeReevaluateList(shop),
    getStoreSettings(shop),
  ]);

  const topMovers = [...reorder.rows]
    .sort((a, b) => b.unitsPerDay - a.unitsPerDay)
    .slice(0, 5)
    .map((r) => ({
      label: variantLabel(r.productTitle, r.variantTitle),
      unitsPerDay: Number(r.unitsPerDay.toFixed(2)),
      stock: r.inventoryQuantity,
    }));

  return {
    lastBackfillAt: sync?.lastBackfillAt?.toISOString() ?? null,
    variantCount,
    sellingCount: reorder.rows.length,
    windowDays: reorder.windowDays,
    windows: [...VELOCITY_WINDOWS],
    reorderFlagged: reorder.flaggedCount,
    reevaluateFlagged: reevaluate.flaggedCount,
    topMovers,
    plan: settings.plan,
    emailConfigured: Boolean(settings.digestEmail),
  };
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const shopify = useAppBridge();

  const syncFetcher = useFetcher<{ variants: number; orderLines: number }>();
  const isSyncing =
    ["loading", "submitting"].includes(syncFetcher.state) &&
    syncFetcher.formMethod === "POST";

  const windowFetcher = useFetcher();
  const changeWindow = (days: number) =>
    windowFetcher.submit(
      { windowDays: String(days) },
      { method: "POST", action: "/app/velocity-window" },
    );

  useEffect(() => {
    if (syncFetcher.data) shopify.toast.show("Sync complete");
  }, [syncFetcher.data, shopify]);

  const isPro = data.plan === "pro";

  return (
    <s-page heading="RestockIQ">
      <s-button
        slot="primary-action"
        onClick={() =>
          syncFetcher.submit({}, { method: "POST", action: "/app/sync" })
        }
        {...(isSyncing ? { loading: true } : {})}
      >
        Sync now
      </s-button>

      {/* Overview */}
      <s-section heading="At a glance">
        <s-stack direction="inline" gap="large">
          <s-stack direction="block" gap="none">
            <s-text type="strong">{data.reorderFlagged}</s-text>
            <s-link href="/app/reorder">to reorder</s-link>
          </s-stack>
          <s-stack direction="block" gap="none">
            <s-text type="strong">{data.reevaluateFlagged}</s-text>
            <s-link href="/app/reevaluate">to re-evaluate</s-link>
          </s-stack>
          <s-stack direction="block" gap="none">
            <s-text type="strong">{data.sellingCount}</s-text>
            <s-text tone="neutral">selling now</s-text>
          </s-stack>
          <s-stack direction="block" gap="none">
            <s-text type="strong">{data.variantCount}</s-text>
            <s-text tone="neutral">variants tracked</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      {/* Onboarding */}
      <s-section heading="Getting started">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <s-badge tone="success">Done</s-badge>
            <s-text>
              Catalog synced — {data.variantCount} variants, last updated{" "}
              {data.lastBackfillAt
                ? new Date(data.lastBackfillAt).toLocaleString()
                : "just now"}
              .
            </s-text>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-badge tone={data.reorderFlagged > 0 ? "warning" : "neutral"}>
              Step 1
            </s-badge>
            <s-text>
              Review your <s-link href="/app/reorder">reorder list</s-link> and
              set lead times per product.
            </s-text>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-badge tone="neutral">Step 2</s-badge>
            <s-text>
              Check the{" "}
              <s-link href="/app/reevaluate">re-evaluate list</s-link> for slow
              stock tying up cash.
            </s-text>
          </s-stack>
          <s-stack direction="inline" gap="base">
            <s-badge tone={isPro ? "success" : "neutral"}>Step 3</s-badge>
            <s-text>
              {isPro ? (
                <>
                  Email automation is on —{" "}
                  <s-link href="/app/notifications">manage notifications</s-link>
                  .
                </>
              ) : (
                <>
                  <s-link href="/app/billing">Upgrade to Pro</s-link> for
                  automated weekly digests and urgent reorder alerts.
                </>
              )}
            </s-text>
          </s-stack>
        </s-stack>
      </s-section>

      {/* Velocity preview */}
      <s-section heading="Top movers">
        <s-paragraph>
          Fastest sellers over the trailing {data.windowDays}-day window.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          <s-select
            label="Trailing window"
            value={String(data.windowDays)}
            onChange={(e) => changeWindow(Number(e.currentTarget.value))}
          >
            {data.windows.map((w) => (
              <s-option key={w} value={String(w)}>
                {w} days
              </s-option>
            ))}
          </s-select>
          {data.topMovers.length === 0 ? (
            <s-paragraph>
              No sales in this window yet. Once orders come in (or you widen the
              window), your fastest movers show here.
            </s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Product</s-table-header>
                <s-table-header>Units/day</s-table-header>
                <s-table-header>Stock</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.topMovers.map((m) => (
                  <s-table-row key={m.label}>
                    <s-table-cell>{m.label}</s-table-cell>
                    <s-table-cell>{m.unitsPerDay.toFixed(2)}</s-table-cell>
                    <s-table-cell>{m.stock}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
