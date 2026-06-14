import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getStoreSettings, setNotificationSettings } from "../lib/settings.server";
import { sendDigest, type SendResult } from "../lib/email.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getStoreSettings(session.shop);
  return {
    digestEmail: settings.digestEmail ?? "",
    digestEnabled: settings.digestEnabled,
    urgentAlertsEnabled: settings.urgentAlertsEnabled,
    emailConfigured: Boolean(process.env.RESEND_API_KEY),
    isPro: settings.plan === "pro",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  if (form.get("intent") === "send") {
    const result = await sendDigest(session.shop);
    return { sentResult: result as SendResult };
  }

  await setNotificationSettings(session.shop, {
    digestEmail: form.has("digestEmail")
      ? String(form.get("digestEmail"))
      : undefined,
    digestEnabled: form.has("digestEnabled")
      ? form.get("digestEnabled") === "true"
      : undefined,
    urgentAlertsEnabled: form.has("urgentAlertsEnabled")
      ? form.get("urgentAlertsEnabled") === "true"
      : undefined,
  });
  return { ok: true };
};

export default function Notifications() {
  const data = useLoaderData<typeof loader>();
  const settingsFetcher = useFetcher();
  const sendFetcher = useFetcher<{ sentResult: SendResult }>();
  const shopify = useAppBridge();

  const isSending =
    ["loading", "submitting"].includes(sendFetcher.state) &&
    sendFetcher.formMethod === "POST";

  const save = (fields: Record<string, string>) =>
    settingsFetcher.submit(fields, { method: "POST" });

  useEffect(() => {
    const r = sendFetcher.data?.sentResult;
    if (!r) return;
    shopify.toast.show(
      r.sent ? "Digest sent" : `Not sent: ${r.reason ?? "unknown"}`,
      r.sent ? {} : { isError: true },
    );
  }, [sendFetcher.data, shopify]);

  return (
    <s-page heading="Notifications">
      {!data.isPro && (
        <s-section>
          <s-banner tone="info">
            Email automation is a{" "}
            <s-text type="strong">StockSignal Pro</s-text> feature. You can set
            your preferences here, but the digest and alerts only send on Pro.{" "}
            <s-link href="/app/billing">Upgrade</s-link> to turn them on.
          </s-banner>
        </s-section>
      )}
      {!data.emailConfigured && (
        <s-section>
          <s-banner tone="warning">
            Email isn't configured yet. Add a{" "}
            <s-text type="strong">RESEND_API_KEY</s-text> to your{" "}
            <s-text type="strong">.env</s-text> and restart the dev server.
            Settings save fine now; sends are skipped until the key is present.
          </s-banner>
        </s-section>
      )}

      <s-section heading="Where to send">
        <s-email-field
          label="Recipient email"
          value={data.digestEmail}
          placeholder="owner@yourstore.com"
          onChange={(e) => save({ digestEmail: e.currentTarget.value })}
        />
      </s-section>

      <s-section heading="What to send">
        <s-stack direction="block" gap="base">
          <s-checkbox
            label="Weekly digest"
            details="A summary of what to reorder and what to re-evaluate."
            checked={data.digestEnabled}
            onChange={(e) =>
              save({ digestEnabled: String(e.currentTarget.checked) })
            }
          />
          <s-checkbox
            label="Urgent reorder alerts"
            details="Emailed the moment a sale pushes an item into 'reorder now'."
            checked={data.urgentAlertsEnabled}
            onChange={(e) =>
              save({ urgentAlertsEnabled: String(e.currentTarget.checked) })
            }
          />
        </s-stack>
      </s-section>

      <s-section heading="Test it">
        <s-paragraph>
          Send this week's digest to {data.digestEmail || "the recipient above"}{" "}
          right now.
        </s-paragraph>
        <s-button
          onClick={() =>
            sendFetcher.submit({ intent: "send" }, { method: "POST" })
          }
          {...(isSending ? { loading: true } : {})}
        >
          Send digest now
        </s-button>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
