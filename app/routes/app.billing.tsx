import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { redirect, useLoaderData, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, PAID_PLAN, BILLING_TEST } from "../shopify.server";
import { setPlan } from "../lib/billing.server";

const PRICE = "$7.99";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const { hasActivePayment } = await billing.check({
    plans: [PAID_PLAN],
    isTest: BILLING_TEST,
  });
  await setPlan(session.shop, hasActivePayment ? "pro" : "free");
  return { isPro: hasActivePayment, test: BILLING_TEST };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const intent = (await request.formData()).get("intent");

  if (intent === "upgrade") {
    // Redirects to Shopify's subscription approval screen.
    return billing.request({ plan: PAID_PLAN, isTest: BILLING_TEST });
  }

  if (intent === "cancel") {
    const { appSubscriptions } = await billing.check({
      plans: [PAID_PLAN],
      isTest: BILLING_TEST,
    });
    const sub = appSubscriptions[0];
    if (sub) {
      await billing.cancel({
        subscriptionId: sub.id,
        isTest: BILLING_TEST,
        prorate: true,
      });
    }
    await setPlan(session.shop, "free");
    return redirect("/app/billing");
  }

  return null;
};

export default function Billing() {
  const { isPro, test } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  const upgrade = () => submit({ intent: "upgrade" }, { method: "POST" });
  const cancel = () => submit({ intent: "cancel" }, { method: "POST" });

  return (
    <s-page heading="Plan & billing">
      {test && (
        <s-section>
          <s-banner tone="info">
            Billing is in <s-text type="strong">test mode</s-text> — you can
            subscribe and cancel without a real charge.
          </s-banner>
        </s-section>
      )}

      <s-section heading="Your plan">
        <s-stack direction="inline" gap="base">
          <s-text type="strong">
            {isPro ? "StockSignal Pro" : "Free"}
          </s-text>
          <s-badge tone={isPro ? "success" : "neutral"}>
            {isPro ? "Active" : "Current"}
          </s-badge>
        </s-stack>
      </s-section>

      <s-section heading="Free">
        <s-paragraph>
          The full reorder and re-evaluate lists in the admin — see what to
          restock and what's tying up cash, any time.
        </s-paragraph>
      </s-section>

      <s-section heading={`StockSignal Pro — ${PRICE}/month`}>
        <s-paragraph>
          Everything in Free, plus automated email so you don't have to check:
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>Weekly digest of reorder + re-evaluate items</s-list-item>
          <s-list-item>
            Urgent alerts the moment a sale pushes an item into “reorder now”
          </s-list-item>
        </s-unordered-list>
        {isPro ? (
          <s-button variant="secondary" onClick={cancel}>
            Cancel subscription
          </s-button>
        ) : (
          <s-button variant="primary" onClick={upgrade}>
            Upgrade for {PRICE}/month
          </s-button>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
