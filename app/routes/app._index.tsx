import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { runBackfill } from "../lib/sync.server";
import { computeVelocity } from "../lib/velocity.server";
import { VELOCITY_WINDOWS } from "../lib/settings.server";

// Build a readable label, distinguishing variants of multi-variant products.
function variantLabel(productTitle: string, variantTitle: string | null) {
  return variantTitle && variantTitle !== "Default Title"
    ? `${productTitle} — ${variantTitle}`
    : productTitle;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Self-initialize: on the very first load for this shop, run the backfill so
  // the data layer is populated. Subsequent refreshes use the "Sync now"
  // button. (A production app would do this in a background job.)
  let sync = await prisma.shopSync.findUnique({ where: { shop } });
  if (!sync) {
    await runBackfill(admin, shop);
    sync = await prisma.shopSync.findUnique({ where: { shop } });
  }

  const [variantCount, orderLineCount, units] = await Promise.all([
    prisma.variant.count({ where: { shop } }),
    prisma.orderLine.count({ where: { shop } }),
    prisma.orderLine.aggregate({ where: { shop }, _sum: { quantity: true } }),
  ]);

  // Phase 2: run the velocity engine over the store's configured window.
  const velocity = await computeVelocity(shop);
  const topMovers = [...velocity.variants]
    .sort((a, b) => b.unitsPerDay - a.unitsPerDay)
    .slice(0, 8)
    .map((v) => ({
      label: variantLabel(v.productTitle, v.variantTitle),
      unitsInWindow: v.unitsInWindow,
      unitsPerDay: Number(v.unitsPerDay.toFixed(2)),
      revenuePerDay: Number(v.revenuePerDay.toFixed(2)),
      stock: v.inventoryQuantity,
    }));
  const sellingCount = velocity.variants.filter((v) => v.unitsPerDay > 0).length;

  return {
    lastBackfillAt: sync?.lastBackfillAt?.toISOString() ?? null,
    variantCount,
    orderLineCount,
    totalUnits: units._sum.quantity ?? 0,
    windowDays: velocity.windowDays,
    windows: [...VELOCITY_WINDOWS],
    sellingCount,
    topMovers,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const color = ["Red", "Orange", "Yellow", "Green"][
    Math.floor(Math.random() * 4)
  ];
  const response = await admin.graphql(
    `#graphql
      mutation populateProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            handle
            status
            variants(first: 10) {
              edges {
                node {
                  id
                  price
                  barcode
                  createdAt
                }
              }
            }
            demoInfo: metafield(namespace: "$app", key: "demo_info") {
              jsonValue
            }
          }
        }
      }`,
    {
      variables: {
        product: {
          title: `${color} Snowboard`,
          metafields: [
            {
              namespace: "$app",
              key: "demo_info",
              value: "Created by React Router Template",
            },
          ],
        },
      },
    },
  );
  const responseJson = await response.json();

  const product = responseJson.data!.productCreate!.product!;
  const variantId = product.variants.edges[0]!.node!.id!;

  const variantResponse = await admin.graphql(
    `#graphql
    mutation shopifyReactRouterTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
          barcode
          createdAt
        }
      }
    }`,
    {
      variables: {
        productId: product.id,
        variants: [{ id: variantId, price: "100.00" }],
      },
    },
  );

  const variantResponseJson = await variantResponse.json();

  const metaobjectResponse = await admin.graphql(
    `#graphql
    mutation shopifyReactRouterTemplateUpsertMetaobject($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
      metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
        metaobject {
          id
          handle
          title: field(key: "title") {
            jsonValue
          }
          description: field(key: "description") {
            jsonValue
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        handle: {
          type: "$app:example",
          handle: "demo-entry",
        },
        metaobject: {
          fields: [
            { key: "title", value: "Demo Entry" },
            {
              key: "description",
              value:
                "This metaobject was created by the Shopify app template to demonstrate the metaobject API.",
            },
          ],
        },
      },
    },
  );

  const metaobjectResponseJson = await metaobjectResponse.json();

  return {
    product: responseJson!.data!.productCreate!.product,
    variant:
      variantResponseJson!.data!.productVariantsBulkUpdate!.productVariants,
    metaobject:
      metaobjectResponseJson!.data!.metaobjectUpsert!.metaobject,
  };
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  // Separate fetcher for the StockSignal data-layer sync.
  const syncFetcher = useFetcher<{ variants: number; orderLines: number }>();
  const isSyncing =
    ["loading", "submitting"].includes(syncFetcher.state) &&
    syncFetcher.formMethod === "POST";

  // Fetcher for changing the velocity window (persists + revalidates loader).
  const windowFetcher = useFetcher();
  const changeWindow = (days: number) =>
    windowFetcher.submit(
      { windowDays: String(days) },
      { method: "POST", action: "/app/velocity-window" },
    );

  const shopify = useAppBridge();
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.product?.id) {
      shopify.toast.show("Product created");
    }
  }, [fetcher.data?.product?.id, shopify]);

  useEffect(() => {
    if (syncFetcher.data) {
      shopify.toast.show("Sync complete");
    }
  }, [syncFetcher.data, shopify]);

  const generateProduct = () => fetcher.submit({}, { method: "POST" });
  const runSync = () =>
    syncFetcher.submit({}, { method: "POST", action: "/app/sync" });

  return (
    <s-page heading="Shopify app template">
      <s-button slot="primary-action" onClick={generateProduct}>
        Generate a product
      </s-button>

      <s-section heading="StockSignal data layer (Phase 1)">
        <s-paragraph>
          Local cache of your catalog and order history, used by the velocity
          engine. Populated on first load; re-sync any time.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="large">
            <s-stack direction="block" gap="none">
              <s-text type="strong">{data.variantCount}</s-text>
              <s-text tone="neutral">variants</s-text>
            </s-stack>
            <s-stack direction="block" gap="none">
              <s-text type="strong">{data.orderLineCount}</s-text>
              <s-text tone="neutral">order lines</s-text>
            </s-stack>
            <s-stack direction="block" gap="none">
              <s-text type="strong">{data.totalUnits}</s-text>
              <s-text tone="neutral">units sold</s-text>
            </s-stack>
          </s-stack>
          <s-text tone="neutral">
            Last synced:{" "}
            {data.lastBackfillAt
              ? new Date(data.lastBackfillAt).toLocaleString()
              : "never"}
          </s-text>
          <s-stack direction="inline" gap="base">
            <s-button
              onClick={runSync}
              {...(isSyncing ? { loading: true } : {})}
            >
              Sync now
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Velocity engine (Phase 2)">
        <s-paragraph>
          Units sold per day per variant, averaged over a trailing window. This
          is the single engine that will feed both the reorder and re-evaluate
          lists. {data.sellingCount} of {data.variantCount} variants have sold
          in the current window.
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

          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Units ({data.windowDays}d)</s-table-header>
              <s-table-header>Units/day</s-table-header>
              <s-table-header>Revenue/day</s-table-header>
              <s-table-header>Stock</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.topMovers.map((m) => (
                <s-table-row key={m.label}>
                  <s-table-cell>{m.label}</s-table-cell>
                  <s-table-cell>{m.unitsInWindow}</s-table-cell>
                  <s-table-cell>{m.unitsPerDay.toFixed(2)}</s-table-cell>
                  <s-table-cell>${m.revenuePerDay.toFixed(2)}</s-table-cell>
                  <s-table-cell>{m.stock}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          <s-text tone="neutral">
            Top 8 by velocity. Full ranking and reorder flags arrive in Phase 3.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Congrats on creating a new Shopify app 🎉">
        <s-paragraph>
          This embedded app template uses{" "}
          <s-link
            href="https://shopify.dev/docs/apps/tools/app-bridge"
            target="_blank"
          >
            App Bridge
          </s-link>{" "}
          interface examples like an{" "}
          <s-link href="/app/additional">additional page in the app nav</s-link>
          , as well as an{" "}
          <s-link
            href="https://shopify.dev/docs/api/admin-graphql"
            target="_blank"
          >
            Admin GraphQL
          </s-link>{" "}
          mutation demo, to provide a starting point for app development.
        </s-paragraph>
      </s-section>
      <s-section heading="Get started with products">
        <s-paragraph>
          Generate a product with GraphQL and get the JSON output for that
          product. Learn more about the{" "}
          <s-link
            href="https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate"
            target="_blank"
          >
            productCreate
          </s-link>{" "}
          mutation in our API references. Includes a product{" "}
          <s-link
            href="https://shopify.dev/docs/apps/build/custom-data/metafields"
            target="_blank"
          >
            metafield
          </s-link>{" "}
          and{" "}
          <s-link
            href="https://shopify.dev/docs/apps/build/custom-data/metaobjects"
            target="_blank"
          >
            metaobject
          </s-link>
          .
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button
            onClick={generateProduct}
            {...(isLoading ? { loading: true } : {})}
          >
            Generate a product
          </s-button>
          {fetcher.data?.product && (
            <s-button
              onClick={() => {
                shopify.intents.invoke?.("edit:shopify/Product", {
                  value: fetcher.data?.product?.id,
                });
              }}
              target="_blank"
              variant="tertiary"
            >
              Edit product
            </s-button>
          )}
        </s-stack>
        {fetcher.data?.product && (
          <s-section heading="productCreate mutation">
            <s-stack direction="block" gap="base">
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  <code>{JSON.stringify(fetcher.data.product, null, 2)}</code>
                </pre>
              </s-box>

              <s-heading>productVariantsBulkUpdate mutation</s-heading>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  <code>{JSON.stringify(fetcher.data.variant, null, 2)}</code>
                </pre>
              </s-box>

              <s-heading>metaobjectUpsert mutation</s-heading>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  <code>
                    {JSON.stringify(fetcher.data.metaobject, null, 2)}
                  </code>
                </pre>
              </s-box>
            </s-stack>
          </s-section>
        )}
      </s-section>

      <s-section slot="aside" heading="App template specs">
        <s-paragraph>
          <s-text>Framework: </s-text>
          <s-link href="https://reactrouter.com/" target="_blank">
            React Router
          </s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>Interface: </s-text>
          <s-link
            href="https://shopify.dev/docs/api/app-home/using-polaris-components"
            target="_blank"
          >
            Polaris web components
          </s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>API: </s-text>
          <s-link
            href="https://shopify.dev/docs/api/admin-graphql"
            target="_blank"
          >
            GraphQL
          </s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>Custom data: </s-text>
          <s-link
            href="https://shopify.dev/docs/apps/build/custom-data"
            target="_blank"
          >
            Metafields &amp; metaobjects
          </s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>Database: </s-text>
          <s-link href="https://www.prisma.io/" target="_blank">
            Prisma
          </s-link>
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Next steps">
        <s-unordered-list>
          <s-list-item>
            Build an{" "}
            <s-link
              href="https://shopify.dev/docs/apps/getting-started/build-app-example"
              target="_blank"
            >
              example app
            </s-link>
          </s-list-item>
          <s-list-item>
            Explore Shopify&apos;s API with{" "}
            <s-link
              href="https://shopify.dev/docs/apps/tools/graphiql-admin-api"
              target="_blank"
            >
              GraphiQL
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
