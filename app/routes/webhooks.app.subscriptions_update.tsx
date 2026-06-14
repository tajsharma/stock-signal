import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { setPlan } from "../lib/billing.server";

interface SubscriptionPayload {
  app_subscription?: { status?: string; name?: string };
}

// Keep our mirrored plan in sync when a merchant subscribes, cancels, or their
// subscription otherwise changes state. Only an ACTIVE subscription is Pro.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  const status = (payload as SubscriptionPayload).app_subscription?.status;
  console.log(`Received ${topic} for ${shop}: ${status}`);

  try {
    await setPlan(shop, status === "ACTIVE" ? "pro" : "free");
  } catch (error) {
    console.error(`Failed to update plan for ${shop}:`, error);
  }

  return new Response();
};
