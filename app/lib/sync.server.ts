import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

// How many days of order history to pull on backfill. The velocity engine's
// configurable window tops out at 90 days, so we backfill 90. NOTE: without the
// "read all orders" scope Shopify only returns ~60 days; the query won't error,
// it just returns fewer rows. Tunable.
export const BACKFILL_DAYS = 90;

const PRODUCTS_QUERY = `#graphql
  query Products($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        status
        createdAt
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            inventoryQuantity
          }
        }
      }
    }
  }
`;

const ORDERS_QUERY = `#graphql
  query SeedOrders($cursor: String, $query: String!) {
    orders(first: 100, after: $cursor, query: $query, sortKey: PROCESSED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        processedAt
        lineItems(first: 50) {
          nodes {
            id
            quantity
            variant { id }
          }
        }
      }
    }
  }
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Run an Admin GraphQL operation through the authenticated client, retrying
// once on a THROTTLED response (the dev store's catalog/order volume is small,
// so heavy backoff isn't needed here).
async function adminGraphql<T>(
  admin: AdminApiContext,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await admin.graphql(query, { variables });
    const body = (await res.json()) as { data?: T; errors?: unknown };
    const errors = body.errors;
    const throttled =
      Array.isArray(errors) &&
      errors.some(
        (e: { extensions?: { code?: string } }) =>
          e.extensions?.code === "THROTTLED",
      );
    if (throttled) {
      await sleep(2000);
      continue;
    }
    if (errors && (!Array.isArray(errors) || errors.length > 0)) {
      throw new Error(`Admin GraphQL error: ${JSON.stringify(errors)}`);
    }
    if (!body.data) throw new Error("Admin GraphQL returned no data");
    return body.data;
  }
  throw new Error("Admin GraphQL still throttled after retries");
}

interface ProductsResponse {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      id: string;
      title: string;
      status: string;
      createdAt: string;
      variants: {
        nodes: Array<{
          id: string;
          title: string | null;
          sku: string | null;
          price: string | null;
          inventoryQuantity: number | null;
        }>;
      };
    }>;
  };
}

// Pull the full catalog (products + variants + current inventory) and upsert a
// local Variant row per variant. The per-product leadTimeDays setting is
// preserved on update.
export async function backfillCatalog(
  admin: AdminApiContext,
  shop: string,
): Promise<number> {
  let cursor: string | null = null;
  let count = 0;

  do {
    const data: ProductsResponse = await adminGraphql<ProductsResponse>(
      admin,
      PRODUCTS_QUERY,
      { cursor },
    );

    for (const product of data.products.nodes) {
      const productCreatedAt = new Date(product.createdAt);
      for (const v of product.variants.nodes) {
        const shared = {
          shop,
          productId: product.id,
          productTitle: product.title,
          variantTitle: v.title,
          sku: v.sku,
          price: v.price ? Number(v.price) : 0,
          inventoryQuantity: v.inventoryQuantity ?? 0,
          productStatus: product.status,
          productCreatedAt,
        };
        await prisma.variant.upsert({
          where: { id: v.id },
          // On update, only refresh Shopify-owned fields — never clobber the
          // merchant's leadTimeDays setting.
          update: shared,
          create: { id: v.id, ...shared },
        });
        count++;
      }
    }

    cursor = data.products.pageInfo.hasNextPage
      ? data.products.pageInfo.endCursor
      : null;
  } while (cursor);

  return count;
}

interface OrdersResponse {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      id: string;
      processedAt: string;
      lineItems: {
        nodes: Array<{
          id: string;
          quantity: number;
          variant: { id: string } | null;
        }>;
      };
    }>;
  };
}

// Pull order history for the trailing BACKFILL_DAYS window and upsert one
// OrderLine per line item. Idempotent: re-running (or an overlapping webhook)
// upserts on the line-item id rather than double-counting.
export async function backfillOrders(
  admin: AdminApiContext,
  shop: string,
  days: number = BACKFILL_DAYS,
): Promise<number> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  // Shopify search syntax wants a date; processed_at:>=YYYY-MM-DD.
  const queryFilter = `processed_at:>=${cutoff.toISOString().slice(0, 10)}`;

  let cursor: string | null = null;
  let count = 0;

  do {
    const data: OrdersResponse = await adminGraphql<OrdersResponse>(
      admin,
      ORDERS_QUERY,
      { cursor, query: queryFilter },
    );

    for (const order of data.orders.nodes) {
      const processedAt = new Date(order.processedAt);
      for (const li of order.lineItems.nodes) {
        await prisma.orderLine.upsert({
          where: { id: li.id },
          update: {
            quantity: li.quantity,
            variantId: li.variant?.id ?? null,
            processedAt,
          },
          create: {
            id: li.id,
            shop,
            orderId: order.id,
            variantId: li.variant?.id ?? null,
            quantity: li.quantity,
            processedAt,
          },
        });
        count++;
      }
    }

    cursor = data.orders.pageInfo.hasNextPage
      ? data.orders.pageInfo.endCursor
      : null;
  } while (cursor);

  return count;
}

// Full Phase 1 backfill: catalog first (so variants exist), then orders.
export async function runBackfill(admin: AdminApiContext, shop: string) {
  const variants = await backfillCatalog(admin, shop);
  const orderLines = await backfillOrders(admin, shop);
  await prisma.shopSync.upsert({
    where: { shop },
    update: { lastBackfillAt: new Date() },
    create: { shop, lastBackfillAt: new Date() },
  });
  return { variants, orderLines };
}

// Remove ALL of a shop's RestockIQ data. Called on app/uninstalled and on
// the shop/redact compliance webhook (where full erasure is mandatory).
export async function purgeShopData(shop: string) {
  await prisma.orderLine.deleteMany({ where: { shop } });
  await prisma.variant.deleteMany({ where: { shop } });
  await prisma.shopSync.deleteMany({ where: { shop } });
  await prisma.storeSettings.deleteMany({ where: { shop } });
}

// --- orders/create webhook ---

// Minimal shape of the orders/create REST webhook payload we rely on.
interface OrderWebhookPayload {
  admin_graphql_api_id?: string;
  id?: number;
  processed_at?: string | null;
  created_at?: string | null;
  line_items?: Array<{
    admin_graphql_api_id?: string;
    id?: number;
    quantity?: number;
    variant_id?: number | null;
  }>;
}

const orderGid = (p: OrderWebhookPayload) =>
  p.admin_graphql_api_id ?? `gid://shopify/Order/${p.id}`;

// Record a newly created order from the orders/create webhook. Upserts each
// line item so duplicate webhook deliveries are safe.
export async function recordOrderWebhook(
  shop: string,
  payload: OrderWebhookPayload,
) {
  const orderId = orderGid(payload);
  const processedAt = new Date(
    payload.processed_at ?? payload.created_at ?? Date.now(),
  );

  for (const li of payload.line_items ?? []) {
    const lineId = li.admin_graphql_api_id ?? `gid://shopify/LineItem/${li.id}`;
    const variantId =
      li.variant_id != null
        ? `gid://shopify/ProductVariant/${li.variant_id}`
        : null;
    const quantity = li.quantity ?? 0;

    await prisma.orderLine.upsert({
      where: { id: lineId },
      update: { quantity, variantId, processedAt },
      create: { id: lineId, shop, orderId, variantId, quantity, processedAt },
    });
  }
}
