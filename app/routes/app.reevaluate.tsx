import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { computeReevaluateList } from "../lib/reevaluate.server";
import { setReevaluatePolicy } from "../lib/settings.server";

function variantLabel(productTitle: string, variantTitle: string | null) {
  return variantTitle && variantTitle !== "Default Title"
    ? `${productTitle} — ${variantTitle}`
    : productTitle;
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const TREND_LABEL: Record<string, string> = {
  declining: "Declining",
  steady: "Steadily low",
  dormant: "No recent sales",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const list = await computeReevaluateList(session.shop);

  return {
    windowDays: list.windowDays,
    bottomPercent: list.bottomPercent,
    minActiveDays: list.minActiveDays,
    minMonthsOfSupply: list.minMonthsOfSupply,
    evaluableCount: list.evaluableCount,
    excludedNewCount: list.excludedNewCount,
    flaggedCount: list.flaggedCount,
    rows: list.rows.map((r) => ({
      variantId: r.variantId,
      label: variantLabel(r.productTitle, r.variantTitle),
      revenuePerDay: Number(r.revenuePerDay.toFixed(2)),
      unitsPerDay: Number(r.unitsPerDay.toFixed(2)),
      stock: r.inventoryQuantity,
      monthsOfSupply: r.monthsOfSupply,
      cashTiedUp: Number(r.cashTiedUp.toFixed(2)),
      trend: r.trend,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  await setReevaluatePolicy(session.shop, {
    reevaluateBottomPercent: form.has("reevaluateBottomPercent")
      ? Number(form.get("reevaluateBottomPercent"))
      : undefined,
    minActiveDays: form.has("minActiveDays")
      ? Number(form.get("minActiveDays"))
      : undefined,
  });
  return { ok: true };
};

export default function ReevaluateList() {
  const data = useLoaderData<typeof loader>();
  const policyFetcher = useFetcher();

  const submitPolicy = (field: string, value: string) =>
    policyFetcher.submit({ [field]: value }, { method: "POST" });

  return (
    <s-page heading="Re-evaluate list">
      <s-section>
        <s-banner tone="info">
          Advisory only. These are slow or dead sellers tying up cash — worth a
          look (discount, bundle, delist), but RestockIQ never changes
          anything for you.
        </s-banner>
      </s-section>

      <s-section heading="What counts as slow">
        <s-paragraph>
          Items are ranked by <s-text type="strong">revenue velocity</s-text>{" "}
          (units/day × price), not unit count — so a pricey item that sells
          rarely isn't unfairly flagged. An item is flagged only if it's in the
          slowest {data.bottomPercent}% of your catalog{" "}
          <s-text type="strong">and</s-text> you're holding at least{" "}
          {data.minMonthsOfSupply} months of supply (or it's dead stock), so
          cheap fast sellers don't get caught. {data.evaluableCount} in-stock
          items are old enough to judge; {data.excludedNewCount} were skipped as
          too new (active under {data.minActiveDays} days).
        </s-paragraph>
        <s-stack direction="inline" gap="large">
          <s-number-field
            label="Bottom slice (%)"
            value={String(data.bottomPercent)}
            min={1}
            max={100}
            onChange={(e) =>
              submitPolicy("reevaluateBottomPercent", e.currentTarget.value)
            }
          />
          <s-number-field
            label="New-product guard (days)"
            value={String(data.minActiveDays)}
            min={0}
            onChange={(e) => submitPolicy("minActiveDays", e.currentTarget.value)}
          />
        </s-stack>
      </s-section>

      <s-section heading="Flagged for re-evaluation">
        {data.rows.length === 0 ? (
          <s-paragraph>
            Nothing flagged. Either every item sells well enough, or the catalog
            is too new to judge — try lowering the new-product guard.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Revenue/day</s-table-header>
              <s-table-header>Units/day</s-table-header>
              <s-table-header>Stock</s-table-header>
              <s-table-header>Months of supply</s-table-header>
              <s-table-header>Cash tied up</s-table-header>
              <s-table-header>Trend</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.rows.map((row) => (
                <s-table-row key={row.variantId}>
                  <s-table-cell>{row.label}</s-table-cell>
                  <s-table-cell>{money(row.revenuePerDay)}</s-table-cell>
                  <s-table-cell>{row.unitsPerDay.toFixed(2)}</s-table-cell>
                  <s-table-cell>{row.stock}</s-table-cell>
                  <s-table-cell>
                    {row.monthsOfSupply === null
                      ? "∞"
                      : `${row.monthsOfSupply.toFixed(1)} mo`}
                  </s-table-cell>
                  <s-table-cell>{money(row.cashTiedUp)}</s-table-cell>
                  <s-table-cell>
                    <s-badge
                      tone={row.trend === "declining" ? "warning" : "neutral"}
                    >
                      {TREND_LABEL[row.trend]}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
