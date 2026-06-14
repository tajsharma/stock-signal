import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { recordOrderWebhook } from "../lib/sync.server";
import { processUrgentAlerts } from "../lib/alerts.server";

interface OrderPayload {
  line_items?: Array<{ variant_id?: number | null }>;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    await recordOrderWebhook(shop, payload as Record<string, unknown>);

    // Fire urgent reorder alerts for anything this sale pushed over the edge.
    const variantIds = (payload as OrderPayload).line_items
      ?.map((li) =>
        li.variant_id != null
          ? `gid://shopify/ProductVariant/${li.variant_id}`
          : null,
      )
      .filter((id): id is string => id !== null);
    if (variantIds?.length) {
      const result = await processUrgentAlerts(shop, variantIds);
      if (result.sent) console.log(`Urgent alert sent for ${shop}`);
    }
  } catch (error) {
    // Log and 200 anyway — Shopify retries on non-2xx, and the periodic
    // backfill will reconcile anything we drop here.
    console.error(`Failed to process ${topic} for ${shop}:`, error);
  }

  return new Response();
};
