import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Mandatory GDPR webhook: delete a customer's personal data.
// authenticate.webhook verifies the HMAC and returns 401 on failure.
//
// RestockIQ stores no customer personal data (only variants, quantities, and
// order dates), so there is nothing to redact. We acknowledge the request.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} for ${shop} — no customer data to redact.`);
  return new Response();
};
