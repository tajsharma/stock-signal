import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Mandatory GDPR webhook: a customer requested the data we store about them.
// authenticate.webhook verifies the HMAC and returns 401 on failure.
//
// RestockIQ stores NO customer personal data — our records hold only product
// variants, quantities, and order dates (no names, emails, or addresses). So
// there is nothing to compile or return; we acknowledge the request.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} for ${shop} — no customer data stored.`);
  return new Response();
};
