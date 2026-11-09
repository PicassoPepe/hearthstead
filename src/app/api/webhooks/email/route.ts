import { NextResponse } from "next/server";
import { parseInboundEmail } from "@/adapters/email/inbound";
import { secretsMatch, verifyResendSignature } from "@/adapters/email/signature";
import { receiveInboundEmail } from "@/server/comms/service";

export const dynamic = "force-dynamic";

/**
 * Inbound email. Two accepted callers, both signature-checked:
 *  - Resend `email.received` (Svix headers + RESEND_WEBHOOK_SECRET)
 *  - A Cloudflare Email Routing worker posting JSON with header x-deedwood-email-secret
 *    equal to EMAIL_WEBHOOK_SECRET
 */
export async function POST(req: Request) {
  const payload = await req.text();
  const resendSecret = process.env.RESEND_WEBHOOK_SECRET;
  const forwardSecret = process.env.EMAIL_WEBHOOK_SECRET;
  const svix = req.headers.get("svix-signature");
  let ok = false;
  if (svix && resendSecret) {
    ok = verifyResendSignature(payload, {
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: svix,
    }, resendSecret);
  } else if (forwardSecret) {
    ok = secretsMatch(req.headers.get("x-deedwood-email-secret"), forwardSecret);
  }
  if (!ok) return NextResponse.json({ error: "Bad signature" }, { status: 401 });

  let json: unknown;
  try { json = JSON.parse(payload); } catch { return NextResponse.json({ error: "Bad payload" }, { status: 400 }); }
  const parsed = parseInboundEmail(json, req.headers.get("svix-id") ?? "");
  if (!parsed) return NextResponse.json({ error: "Unrecognized email" }, { status: 400 });

  let text = parsed.text;
  if (!text && parsed.resendEmailId && process.env.RESEND_API_KEY) {
    const res = await fetch(`https://api.resend.com/emails/receiving/${parsed.resendEmailId}`, {
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    });
    if (res.ok) {
      const body = (await res.json()) as { text?: string | null; html?: string | null };
      text = body.text || body.html || "";
    }
  }
  const result = await receiveInboundEmail({ from: parsed.from, subject: parsed.subject, text, externalId: parsed.externalId });
  return NextResponse.json(result);
}
