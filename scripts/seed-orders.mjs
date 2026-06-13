// Phase 0.5 — seed the dev store with backdated orders over the last 90 days.
//
// Assigns each eligible variant a sales-velocity profile (fast / medium / slow /
// declining / dead) and creates PAID orders with backdated `processedAt` dates,
// so the velocity engine has realistic history to chew on.
//
// Usage:
//   node scripts/seed-orders.mjs --dry-run   # print the plan, create nothing
//   node scripts/seed-orders.mjs             # create the orders
//   node scripts/seed-orders.mjs --force     # seed even if seed orders already exist
//
// Requires the app to be installed with read_orders + write_orders (run
// `npm run dev` and re-open the app in the admin after a scope change).
// Orders are tagged "stocksignal-seed" so they're easy to find later.

import { PrismaClient } from "@prisma/client";

const API_VERSION = "2026-04";
const SEED_TAG = "stocksignal-seed";
const DAYS = 90;

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

// Deterministic RNG so re-runs produce the same plan (mulberry32).
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(42);

// Velocity profiles: unitsPerDay(daysAgo) → expected units sold that day.
// "declining" sells well in the older window then drops off, to exercise the
// Re-evaluate trend flag later.
const PROFILES = [
  { name: "fast", rate: (d) => 1.2 + 0.6 * rng() },
  { name: "medium", rate: (d) => 0.35 + 0.3 * rng() },
  { name: "slow", rate: (d) => 0.06 + 0.08 * rng() },
  { name: "declining", rate: (d) => (d > 30 ? 0.9 : 0.06) },
  { name: "dead", rate: () => 0 },
];
// Repeating assignment pattern → guarantees a mix whatever the catalog size.
const PROFILE_PATTERN = ["fast", "medium", "slow", "dead", "medium", "declining", "slow", "fast", "dead", "slow"];

async function getSession() {
  const prisma = new PrismaClient();
  const session = await prisma.session.findFirst({ where: { isOnline: false } });
  await prisma.$disconnect();
  if (!session) throw new Error("No offline session in prisma/dev.sqlite — run `npm run dev` and open the app first.");
  return session;
}

async function adminGraphql(session, query, variables) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://${session.shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": session.accessToken },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors?.some((e) => e.extensions?.code === "THROTTLED")) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
  }
  throw new Error("Still throttled after 5 retries");
}

async function fetchVariants(session) {
  const variants = [];
  let cursor = null;
  do {
    const data = await adminGraphql(
      session,
      `query seedProducts($cursor: String) {
        products(first: 50, after: $cursor, query: "status:active") {
          pageInfo { hasNextPage endCursor }
          nodes {
            title isGiftCard
            variants(first: 20) {
              nodes { id sku title price inventoryQuantity inventoryItem { tracked } }
            }
          }
        }
      }`,
      { cursor },
    );
    for (const product of data.products.nodes) {
      if (product.isGiftCard) continue;
      for (const v of product.variants.nodes) {
        if (!v.inventoryItem.tracked) continue;
        const label = v.title === "Default Title" ? product.title : `${product.title} — ${v.title}`;
        variants.push({ id: v.id, label, price: v.price, stock: v.inventoryQuantity });
      }
    }
    const page = data.products.pageInfo;
    cursor = page.hasNextPage ? page.endCursor : null;
  } while (cursor);
  return variants;
}

async function existingSeedOrderCount(session) {
  const data = await adminGraphql(
    session,
    `{ ordersCount(query: "tag:${SEED_TAG}") { count } }`,
  );
  return data.ordersCount.count;
}

function buildPlan(variants) {
  // Stable order so the same variant always gets the same profile.
  const sorted = [...variants].sort((a, b) => a.label.localeCompare(b.label));
  return sorted.map((v, i) => ({ ...v, profile: PROFILES.find((p) => p.name === PROFILE_PATTERN[i % PROFILE_PATTERN.length]) }));
}

function buildOrders(plan) {
  const orders = [];
  for (let daysAgo = DAYS - 1; daysAgo >= 1; daysAgo--) {
    // Sample today's units per variant: integer part + Bernoulli on the fraction.
    const sold = [];
    for (const v of plan) {
      const expected = v.profile.rate(daysAgo);
      const units = Math.floor(expected) + (rng() < expected % 1 ? 1 : 0);
      if (units > 0) sold.push({ variantId: v.id, label: v.label, quantity: units });
      v.totalUnits = (v.totalUnits ?? 0) + units;
    }
    if (sold.length === 0) continue;
    // Split the day's line items into 1–3-item orders at random times of day.
    for (let i = sold.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [sold[i], sold[j]] = [sold[j], sold[i]];
    }
    while (sold.length > 0) {
      const lineItems = sold.splice(0, 1 + Math.floor(rng() * 3));
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - daysAgo);
      date.setUTCHours(9 + Math.floor(rng() * 11), Math.floor(rng() * 60), 0, 0);
      orders.push({ processedAt: date.toISOString(), lineItems });
    }
  }
  return orders;
}

async function createOrder(session, order) {
  const data = await adminGraphql(
    session,
    // Only select userErrors: reading the created Order back requires
    // protected-customer-data approval, which creating it does not.
    `mutation seedOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
      orderCreate(order: $order, options: $options) {
        userErrors { field message }
      }
    }`,
    {
      order: {
        processedAt: order.processedAt,
        financialStatus: "PAID",
        tags: [SEED_TAG],
        lineItems: order.lineItems.map(({ variantId, quantity }) => ({ variantId, quantity })),
      },
      // BYPASS: don't decrement stock — current inventory levels stay as-is so
      // days-of-stock-left scenarios remain predictable.
      options: { inventoryBehaviour: "BYPASS", sendReceipt: false },
    },
  );
  const errors = data.orderCreate.userErrors;
  if (errors.length > 0) throw new Error(`orderCreate failed: ${JSON.stringify(errors)}`);
}

const session = await getSession();
console.log(`Store: ${session.shop}\n`);

const variants = await fetchVariants(session);
const plan = buildPlan(variants);
const orders = buildOrders(plan);

console.log("Velocity plan (units over 90 days → approx units/day):");
for (const v of plan) {
  const perDay = (v.totalUnits / DAYS).toFixed(2);
  console.log(`  [${v.profile.name.padEnd(9)}] ${v.label} — ${v.totalUnits} units (~${perDay}/day), $${v.price}, ${v.stock} in stock`);
}
console.log(`\n${orders.length} orders to create across the last ${DAYS} days.`);

if (DRY_RUN) {
  console.log("Dry run — nothing created.");
  process.exit(0);
}

if (!session.scope?.includes("write_orders")) {
  console.error(`\nSession scopes are "${session.scope}" — missing write_orders.`);
  console.error("Run `npm run dev`, open the app in the admin and accept the new permissions, then re-run this script.");
  process.exit(1);
}

const existing = await existingSeedOrderCount(session);
if (existing > 0 && !FORCE) {
  console.error(`\n${existing} orders tagged "${SEED_TAG}" already exist — re-running would skew velocities.`);
  console.error("Pass --force to seed anyway.");
  process.exit(1);
}

let created = 0;
try {
  for (const order of orders) {
    await createOrder(session, order);
    created++;
    if (created % 25 === 0) console.log(`  ${created}/${orders.length} orders created…`);
    await new Promise((r) => setTimeout(r, 250)); // stay well under the API throttle
  }
} catch (error) {
  console.error(`\nFailed after creating ${created}/${orders.length} orders (all tagged "${SEED_TAG}").`);
  throw error;
}
console.log(`\nDone: ${created} backdated orders created, tagged "${SEED_TAG}".`);
