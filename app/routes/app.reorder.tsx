import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { computeReorderList } from "../lib/reorder.server";
import { setReorderPolicy, setVariantLeadTime } from "../lib/settings.server";

function variantLabel(productTitle: string, variantTitle: string | null) {
  return variantTitle && variantTitle !== "Default Title"
    ? `${productTitle} — ${variantTitle}`
    : productTitle;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const list = await computeReorderList(session.shop);

  return {
    windowDays: list.windowDays,
    safetyBufferDays: list.safetyBufferDays,
    reorderCoverageDays: list.reorderCoverageDays,
    flaggedCount: list.flaggedCount,
    rows: list.rows.map((r) => ({
      variantId: r.variantId,
      label: variantLabel(r.productTitle, r.variantTitle),
      unitsPerDay: Number(r.unitsPerDay.toFixed(2)),
      stock: r.inventoryQuantity,
      daysOfStockLeft: r.daysOfStockLeft ?? null,
      leadTimeDays: r.leadTimeDays,
      thresholdDays: r.reorderThresholdDays,
      suggestedReorderQty: r.suggestedReorderQty,
      flagged: r.flagged,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "leadTime") {
    await setVariantLeadTime(
      session.shop,
      String(form.get("variantId")),
      Number(form.get("leadTimeDays")),
    );
    return { ok: true };
  }

  if (intent === "policy") {
    await setReorderPolicy(session.shop, {
      safetyBufferDays: form.has("safetyBufferDays")
        ? Number(form.get("safetyBufferDays"))
        : undefined,
      reorderCoverageDays: form.has("reorderCoverageDays")
        ? Number(form.get("reorderCoverageDays"))
        : undefined,
    });
    return { ok: true };
  }

  return { ok: false };
};

type Row = ReturnType<typeof useLoaderData<typeof loader>>["rows"][number];

export default function ReorderList() {
  const data = useLoaderData<typeof loader>();
  const policyFetcher = useFetcher();

  const submitPolicy = (field: string, value: string) =>
    policyFetcher.submit(
      { intent: "policy", [field]: value },
      { method: "POST" },
    );

  return (
    <s-page heading="Reorder list">
      <s-section>
        {data.flaggedCount > 0 ? (
          <s-banner tone="warning">
            {data.flaggedCount} item{data.flaggedCount === 1 ? "" : "s"} need
            reordering soon — they'll run out within their lead time plus safety
            buffer.
          </s-banner>
        ) : (
          <s-banner tone="success">
            Nothing needs reordering right now. Everything has more than its lead
            time plus buffer in stock.
          </s-banner>
        )}
      </s-section>

      <s-section heading="Reorder policy">
        <s-paragraph>
          An item is flagged when its days of stock left drop to or below its
          lead time plus the safety buffer. Velocity is averaged over the{" "}
          {data.windowDays}-day window (set on Home).
        </s-paragraph>
        <s-stack direction="inline" gap="large">
          <s-number-field
            label="Safety buffer (days)"
            value={String(data.safetyBufferDays)}
            min={0}
            onChange={(e) =>
              submitPolicy("safetyBufferDays", e.currentTarget.value)
            }
          />
          <s-number-field
            label="Coverage target (days)"
            value={String(data.reorderCoverageDays)}
            min={1}
            onChange={(e) =>
              submitPolicy("reorderCoverageDays", e.currentTarget.value)
            }
          />
        </s-stack>
      </s-section>

      <s-section heading="Selling items by urgency">
        {data.rows.length === 0 ? (
          <s-paragraph>
            No items have sold in the current window yet, so there's nothing to
            reorder. Make some sales (or widen the window) and check back.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Units/day</s-table-header>
              <s-table-header>Stock</s-table-header>
              <s-table-header>Days left</s-table-header>
              <s-table-header>Lead time</s-table-header>
              <s-table-header>Suggested order</s-table-header>
              <s-table-header>Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.rows.map((row) => (
                <ReorderTableRow key={row.variantId} row={row} />
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

function ReorderTableRow({ row }: { row: Row }) {
  const fetcher = useFetcher();

  return (
    <s-table-row>
      <s-table-cell>{row.label}</s-table-cell>
      <s-table-cell>{row.unitsPerDay.toFixed(2)}</s-table-cell>
      <s-table-cell>{row.stock}</s-table-cell>
      <s-table-cell>
        {row.daysOfStockLeft === null
          ? "—"
          : `${row.daysOfStockLeft.toFixed(1)} d`}
      </s-table-cell>
      <s-table-cell>
        <s-number-field
          label="Lead time"
          labelAccessibilityVisibility="exclusive"
          value={String(row.leadTimeDays)}
          min={0}
          onChange={(e) =>
            fetcher.submit(
              {
                intent: "leadTime",
                variantId: row.variantId,
                leadTimeDays: e.currentTarget.value,
              },
              { method: "POST" },
            )
          }
        />
      </s-table-cell>
      <s-table-cell>
        {row.suggestedReorderQty > 0 ? `${row.suggestedReorderQty} units` : "—"}
      </s-table-cell>
      <s-table-cell>
        <s-badge tone={row.flagged ? "warning" : "success"}>
          {row.flagged ? "Reorder now" : "OK"}
        </s-badge>
      </s-table-cell>
    </s-table-row>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
