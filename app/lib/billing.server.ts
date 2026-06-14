import prisma from "../db.server";

export type Plan = "free" | "pro";

// Mirror Shopify's subscription state onto StoreSettings.plan so the rest of
// the app (cron, webhooks, email gating) can gate without an admin request
// context. Callers run billing.check() where `billing` is in scope and pass
// the result here.
export async function recordPlan(shop: string, hasActivePayment: boolean) {
  await setPlan(shop, hasActivePayment ? "pro" : "free");
}

export async function setPlan(shop: string, plan: Plan) {
  await prisma.storeSettings.upsert({
    where: { shop },
    update: { plan },
    create: { shop, plan },
  });
}

export async function getPlan(shop: string): Promise<Plan> {
  const settings = await prisma.storeSettings.findUnique({ where: { shop } });
  return settings?.plan === "pro" ? "pro" : "free";
}

export async function isPro(shop: string): Promise<boolean> {
  return (await getPlan(shop)) === "pro";
}
