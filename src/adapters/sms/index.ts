/**
 * SmsProvider adapter.
 * - `mock` (default): accepts every message to a valid number and reports it delivered; nothing
 *   leaves the machine. Inbound replies are simulated from /dev/sms.
 * - `twilio`: Programmable Messaging REST API (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM).
 *   Inbound messages arrive at /api/webhooks/sms (signature-checked).
 */
export type SmsSendResult = { externalId: string; status: "SENT" | "DELIVERED" | "FAILED"; segments: number; error?: string };

export interface SmsProvider {
  readonly name: string;
  readonly from: string;
  send(input: { to: string; body: string }): Promise<SmsSendResult>;
}

/** GSM-7 messages split at 160 (153 when concatenated); anything else is UCS-2 at 70 (67). */
export function smsSegments(body: string): number {
  if (!body.length) return 0;
  const gsm = /^[\n\r -_a-zA-Z0-9@£$¥èéùìòÇØøÅåΔΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(body);
  const [single, multi] = gsm ? [160, 153] : [70, 67];
  return body.length <= single ? 1 : Math.ceil(body.length / multi);
}

/** Normalize a US number to +1XXXXXXXXXX; null when it isn't a 10-digit NANP number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) ? `+1${ten}` : null;
}

class MockSmsProvider implements SmsProvider {
  readonly name = "mock";
  readonly from = process.env.SMS_FROM ?? "+13125550100";
  async send({ to, body }: { to: string; body: string }): Promise<SmsSendResult> {
    const id = `SMmock${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    if (!normalizePhone(to)) return { externalId: id, status: "FAILED", segments: 0, error: "Invalid phone number" };
    // Numbers ending in 0000 simulate a carrier failure.
    if (to.endsWith("0000")) return { externalId: id, status: "FAILED", segments: smsSegments(body), error: "Carrier rejected the message (unreachable)" };
    if (process.env.NODE_ENV !== "test") console.log(`[sms:mock] → ${to} · ${body.slice(0, 80)}`);
    return { externalId: id, status: "DELIVERED", segments: smsSegments(body) };
  }
}

class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";
  constructor(private readonly sid: string, private readonly token: string, readonly from: string) {}
  async send({ to, body }: { to: string; body: string }): Promise<SmsSendResult> {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${this.sid}:${this.token}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: this.from, Body: body }),
    });
    const json = (await res.json()) as { sid?: string; status?: string; num_segments?: string; message?: string };
    if (!res.ok) return { externalId: json.sid ?? "", status: "FAILED", segments: 0, error: json.message ?? `Twilio error ${res.status}` };
    return { externalId: json.sid ?? "", status: "SENT", segments: Number(json.num_segments ?? smsSegments(body)) };
  }
}

let p: SmsProvider | undefined;
export function getSmsProvider(): SmsProvider {
  if (p) return p;
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = process.env;
  p = process.env.SMS_PROVIDER === "twilio" && sid && token && from ? new TwilioSmsProvider(sid, token, from) : new MockSmsProvider();
  return p;
}

/** Twilio request signature: base64(HMAC-SHA1(url + sorted(key+value), authToken)). */
export async function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string | null, token: string): Promise<boolean> {
  if (!signature) return false;
  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", token).update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
