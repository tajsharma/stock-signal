import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { sendDigest } from "../lib/email.server";

// Weekly-digest endpoint for an external scheduler to hit (e.g. a cron service
// calling GET /cron/digest?secret=YOUR_CRON_SECRET once a week). Guarded by a
// shared secret since it sits outside the app's Shopify auth.
//
// Until a real scheduler is wired up, the same logic runs from the "Send digest
// now" button on the Notifications page.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const expected = process.env.CRON_SECRET;
  const provided = new URL(request.url).searchParams.get("secret");
  if (!expected || provided !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Every shop opted into the digest with a recipient set.
  const shops = await prisma.storeSettings.findMany({
    where: { digestEnabled: true, digestEmail: { not: null } },
    select: { shop: true },
  });

  const results = [];
  for (const { shop } of shops) {
    try {
      const r = await sendDigest(shop);
      results.push({ shop, ...r });
    } catch (error) {
      results.push({ shop, sent: false, reason: String(error) });
    }
  }

  return Response.json({
    ranAt: new Date().toISOString(),
    shops: results.length,
    sent: results.filter((r) => r.sent).length,
    results,
  });
};
