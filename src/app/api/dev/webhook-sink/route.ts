import { devToolsEnabled } from "@/lib/dev-tools";
import { NextResponse } from "next/server";
import { adminDb } from "@/server/db";
import { verifySignature } from "@/server/platform/events";

/** Development-only webhook receiver: verifies the signature like a real consumer would. */
export async function POST(req: Request) {
  if (!devToolsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.text();
  const delivery = await adminDb.webhookDelivery.findUnique({ where: { id: req.headers.get("deedwood-delivery") ?? "" }, include: { endpoint: true } });
  const ok = Boolean(delivery && verifySignature(delivery.endpoint.secret, body, req.headers.get("deedwood-signature") ?? ""));
  console.log(`[webhook-sink] ${req.headers.get("deedwood-event")} signature ${ok ? "valid" : "INVALID"}`);
  return NextResponse.json({ received: true, signatureValid: ok }, { status: ok ? 200 : 400 });
}
