import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { runBackfill } from "../lib/sync.server";

// Resource route: manually re-run the Phase 1 backfill (catalog + order history).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const result = await runBackfill(admin, session.shop);
  return result;
};
