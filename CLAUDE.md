# StockSignal — Project Context

## What this is
StockSignal is a Shopify app for small, owner-run stores (roughly <500 SKUs, tens to low-hundreds of orders/month). It tells a merchant **what to reorder and when, before they stock out**, and **what slow/dead inventory to re-evaluate** — using simple sales-velocity math, **not** machine-learning forecasting.

**Target user:** the small-store owner who does purchasing by gut, gets caught out by stockouts, and is priced out of $49–199/month forecasting tools (Prediko, Cogsy, etc.).

**Positioning:** we deliberately do NOT compete on forecasting accuracy. We win on simplicity, price, and serving the small-store segment the incumbents ignore.

## Core concept
**One velocity engine feeding two surfaces:**
- **Surface 1 — Reorder list:** what to restock (fast sellers running low).
- **Surface 2 — Re-evaluate list:** what to rethink (slow + dead sellers tying up cash).

## Tech stack (already scaffolded)
- React Router 7 (Shopify app template), TypeScript
- Polaris (admin UI — required for App Store approval)
- Prisma (database; SQLite in dev)
- Shopify Admin GraphQL API (data)
- Shopify Billing API (subscriptions)
- Email provider (Resend or Postmark) for notifications
- App Bridge, OAuth, session storage — provided by the template

## IMPORTANT: use the Shopify Dev MCP
Before writing or editing ANY Shopify-specific code (GraphQL queries/mutations, webhooks, Billing API, Polaris components), use the connected **shopify-dev-mcp** to look up current docs and validate against the live Admin API schema. Do not write Shopify API code from memory — validate first.

## Feature spec

### Velocity engine (foundation)
- Compute **units sold per day** per product variant over a trailing window (default 30 days; make the window configurable to 30/60/90).
- Pull order history via the Admin GraphQL API; keep fresh via the `orders/create` webhook plus a periodic recompute.

### Surface 1 — Reorder list
- **Days of stock left** = current inventory ÷ velocity.
- **Lead time** per product (default 7 days, editable per product/supplier).
- **Flag for reorder** when days-of-stock-left ≤ (lead time + safety buffer). Default buffer = a few days; make it tunable.
- **Suggested reorder quantity** = enough to cover N days of velocity (default ~30 days), accounting for stock on hand. Keep the formula simple and explainable.
- Display as a Polaris table, sorted by urgency (soonest to stock out first).

### Surface 2 — Re-evaluate list
- Rank by **revenue velocity** = units/day × price (use margin if cost data is available). NEVER rank by raw unit count alone — a low-unit, high-price item must not be wrongly flagged.
- Flag items in the **bottom slice of the store's own catalog** by revenue velocity (default bottom 20%), so it self-calibrates per store.
- Weight by **stock on hand** (months of supply / cash tied up) — a slow seller with lots of stock is worse than one with little.
- **New-product guard:** only evaluate SKUs active ≥ 30–60 days. Never flag brand-new products.
- Optional **trend flag:** compare last-30-days velocity vs. prior 30–90 days → "declining" vs. "steadily low."
- Output is advisory: "re-evaluate this," never auto-delete or auto-change anything.

## Delivery
- **Email only for v1.** Weekly digest + urgent alerts (when an item crosses into "reorder now").
- SMS/text alerts are explicitly **v1.1**, NOT v1.

## Pricing
- Freemium: a free tier (limited products or alerts-only) + one paid tier ~$7.99–9.99/month. Annual option later.

## Scope guardrails — DO NOT BUILD (v1)
Deliberately out of scope. Do not add these, even if they seem helpful:
- ❌ ML / demand forecasting / seasonality models (simple velocity math only)
- ❌ Purchase-order generation or sending to suppliers
- ❌ Multi-channel sync (Shopify-only)
- ❌ Multi-location / multi-warehouse logic (single location)
- ❌ Bundles, BOMs, raw-material tracking
- ❌ Storefront / theme UI (this is 100% back-office / admin-embedded)
- ❌ Automated reordering (we alert and suggest; the merchant acts)
- ❌ SMS/text notifications (deferred to v1.1)

## Build plan (build ONE phase at a time; test, then commit, then next)
- **Phase 0** ✅ — scaffold installed and running in the admin.
- **Phase 0.5** — seed dev store with products + backdated orders (~90 days) so velocity has history.
- **Phase 1** — data layer: Prisma models (per-product settings/lead time, computed velocity), Admin GraphQL pull of products/inventory/orders, initial backfill, `orders/create` + `app/uninstalled` webhooks.
- **Phase 2** — velocity engine (units/day per variant).
- **Phase 3** — Surface 1 (Reorder list) + Polaris UI. **First demoable milestone.**
- **Phase 4** — Surface 2 (Re-evaluate list) + Polaris UI.
- **Phase 5** — email (Resend/Postmark): weekly digest cron + urgent-alert trigger + settings.
- **Phase 6** — Billing API: free + one paid tier, feature-gating, tested in billing test mode.
- **Phase 7** — compliance + polish: mandatory GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`), error/empty states, onboarding, listing assets.
- **Phase 8** — submit to App Store, iterate.

## Working conventions
- Build one phase at a time. Do not jump ahead or implement anything from the OUT list.
- Validate all Shopify API code against the Dev MCP before writing it.
- Follow the existing scaffold's patterns and file structure.
- Keep logic simple and explainable — this is a learning project; prefer clarity over cleverness.
- Suggest a git commit after each working phase.
- When a decision is ambiguous (thresholds, defaults), pick a sensible default, state it, and flag it as tunable rather than blocking.
