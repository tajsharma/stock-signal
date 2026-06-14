import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { setVelocityWindow } from "../lib/settings.server";

// Resource route: persist the store's velocity window (30/60/90).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const days = Number(formData.get("windowDays"));
  const settings = await setVelocityWindow(session.shop, days);
  return { velocityWindowDays: settings.velocityWindowDays };
};
