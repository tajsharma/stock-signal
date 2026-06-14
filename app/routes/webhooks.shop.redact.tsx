import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { purgeShopData } from "../lib/sync.server";

// Mandatory GDPR webhook: delete all data for a shop (sent ~48h after the app
// is uninstalled). authenticate.webhook verifies the HMAC and returns 401 on
// failure. We erase every RestockIQ record for the shop.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} for ${shop} — purging all shop data.`);
  await purgeShopData(shop);
  return new Response();
};
