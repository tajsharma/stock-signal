# RestockIQ — App Store listing copy & submission checklist

Draft copy for the Shopify App Store listing, plus the assets you (the merchant
/ developer) need to produce. Text here is ready to paste into the Partner /
Dev Dashboard listing form; images must be created separately.

---

## App name
**RestockIQ**

## Tagline (subtitle, ~62 chars max)
Know what to reorder and what to drop — before you stock out.

## Short description (~120 chars)
Simple sales-velocity reordering and dead-stock alerts for small stores. No
forecasting jargon, no enterprise price tag.

## Long description

Running out of your bestseller costs you sales. Sitting on dead stock ties up
your cash. RestockIQ watches both — using plain sales-velocity math, not
black-box "AI forecasting" you can't explain or afford.

**Two lists, one simple engine:**

- **Reorder list** — see exactly what's running low, how many days of stock you
  have left, and a suggested order quantity. Sorted by urgency, so the thing
  about to stock out is always on top. Set a lead time per product and
  RestockIQ flags items the moment they cross the line.

- **Re-evaluate list** — find the slow and dead inventory quietly tying up your
  cash. Ranked by *revenue* velocity (not just unit count, so a pricey slow
  seller isn't unfairly flagged) and weighted by how much money is sitting in
  stock. Advisory only — RestockIQ never changes anything for you.

**Email that does the watching for you (Pro):** a weekly digest of what to
reorder and re-evaluate, plus urgent alerts the moment a sale pushes an item
into "reorder now."

Built for small, owner-run stores — the ones priced out of $49–199/month
forecasting tools. RestockIQ is simple, explainable, and affordable.

**What RestockIQ deliberately does *not* do:** no machine-learning
forecasting, no auto-reordering, no purchase orders, no multi-channel or
multi-warehouse complexity. Just clear answers to "what do I restock, and
what do I drop?"

## Key benefits (feature bullets)
- Days-of-stock-left and suggested reorder quantities, sorted by urgency
- Editable lead time per product
- Dead-stock / slow-mover list ranked by revenue velocity and cash tied up
- New-product guard so brand-new items are never wrongly flagged
- Configurable trailing window (30 / 60 / 90 days)
- Weekly email digest + urgent reorder alerts (Pro)

## Pricing
- **Free** — full reorder and re-evaluate lists in the admin.
- **RestockIQ Pro — $7.99/month** — adds automated weekly digest and urgent
  reorder alerts.

## Privacy / data handling note (for the listing + review)
RestockIQ reads product, inventory, and order data to compute sales velocity.
It stores only product/variant info and aggregated order line data (variant,
quantity, date) — **no customer names, emails, or addresses**. All three
mandatory compliance webhooks are implemented; `shop/redact` erases all stored
data for a shop.

---

## Submission checklist

### Required before submission
- [ ] App icon — 1200×1200px PNG, no transparency
- [ ] Feature image / banner — 1600×900px
- [ ] At least 3 screenshots (desktop, 1600×900 or 2560×1600):
  - [ ] Reorder list (urgency-sorted table with badges + suggested qty)
  - [ ] Re-evaluate list (cash-tied-up dead stock)
  - [ ] Home dashboard / at-a-glance
  - [ ] (optional) Notifications / email settings
- [ ] App listing copy (above) entered in the Dev Dashboard
- [ ] Privacy policy URL
- [ ] Pricing configured to match (Free + $7.99 Pro)
- [ ] Mandatory compliance webhooks verified (done in code — confirm in review)
- [ ] Test the install → onboarding → upgrade (test mode) → email flow end-to-end
- [ ] Demo store / screencast for the review team

### Production readiness (carry-over from build)
- [ ] Hosting with a stable HTTPS URL (replaces the dev tunnel)
- [ ] `RESEND_API_KEY` set in production; verify a sending domain (move off
      `onboarding@resend.dev` to a real from-address)
- [ ] `CRON_SECRET` set; point a weekly scheduler at `/cron/digest?secret=…`
- [ ] Rotate any dev API keys shared during development
- [ ] Switch billing out of test mode in production (`SHOPIFY_BILLING_TEST`)
