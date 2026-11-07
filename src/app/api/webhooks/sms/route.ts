import { NextResponse } from "next/server";
import { receiveInboundSms } from "@/server/comms/service";
import { verifyTwilioSignature } from "@/adapters/sms";

/**
 * Inbound SMS webhook (Twilio "A message comes in"). Verifies the X-Twilio-Signature when
 * TWILIO_AUTH_TOKEN is set; always answers with empty TwiML so Twilio doesn't auto-reply.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (token) {
    const url = `${process.env.AUTH_URL ?? new URL(req.url).origin}/api/webhooks/sms`;
    if (!(await verifyTwilioSignature(url, params, req.headers.get("x-twilio-signature"), token))) return NextResponse.json({ error: "Bad signature" }, { status: 403 });
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "SMS webhook not configured" }, { status: 503 });
  }
  if (params.From && params.Body !== undefined) await receiveInboundSms({ from: params.From, body: params.Body, externalId: params.MessageSid ?? "" });
  return new NextResponse("<Response></Response>", { headers: { "content-type": "text/xml" } });
}
