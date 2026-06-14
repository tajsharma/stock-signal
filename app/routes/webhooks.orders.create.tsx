import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { recordOrderWebhook } from "../lib/sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    await recordOrderWebhook(shop, payload as Record<string, unknown>);
  } catch (error) {
    // Log and 200 anyway — Shopify retries on non-2xx, and the periodic
    // backfill will reconcile anything we drop here.
    console.error(`Failed to record ${topic} for ${shop}:`, error);
  }

  return new Response();
};
