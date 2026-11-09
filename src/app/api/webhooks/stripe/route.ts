import { NextResponse } from "next/server";
import { verifyStripeSignature } from "@/server/billing/stripe-client";
import { handleStripeEvent } from "@/server/billing/subscription";

/** Stripe Billing webhooks (subscription status). Signature-checked and idempotent. */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhooks aren't set up" }, { status: 503 });
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret)) return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  const event = JSON.parse(payload) as { id: string; type: string; data: { object: Record<string, unknown> } };
  const handled = await handleStripeEvent(event);
  return NextResponse.json({ received: true, duplicate: !handled });
}
