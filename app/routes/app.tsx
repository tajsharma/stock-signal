import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate, PAID_PLAN, BILLING_TEST } from "../shopify.server";
import { recordPlan } from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);

  // Keep our mirrored plan in sync with Shopify on every app load, so email
  // gating (cron/webhooks) reflects the current subscription. Best-effort.
  try {
    const { hasActivePayment } = await billing.check({
      plans: [PAID_PLAN],
      isTest: BILLING_TEST,
    });
    await recordPlan(session.shop, hasActivePayment);
  } catch (error) {
    console.error("Billing sync failed:", error);
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/reorder">Reorder list</s-link>
        <s-link href="/app/reevaluate">Re-evaluate list</s-link>
        <s-link href="/app/notifications">Notifications</s-link>
        <s-link href="/app/billing">Plan &amp; billing</s-link>
        <s-link href="/app/additional">Additional page</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
