import type { AppContext } from "@/server/context";
import { adminDb } from "@/server/db";
import { vendorPayments } from "@/server/reports/engine";

export const THRESHOLD_CENTS = 60_000;

const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const dollars = (c: number) => (c / 100).toFixed(2);

export type Form1099 = { vendorId: string; name: string; tinLast4: string | null; address: string; city: string; state: string; zip: string; email: string | null; amountCents: number; ready: boolean; issue: string | null };

/** Vendors that need a 1099-NEC for the year, with readiness checks. */
export async function forms1099(ctx: AppContext, year: number) {
  const { vendors, paid } = await vendorPayments(ctx, year);
  const forms: Form1099[] = [];
  for (const v of vendors) {
    const amt = paid.get(v.id) ?? 0;
    if (!v.send1099 || amt < THRESHOLD_CENTS) continue;
    const issue = !v.w9OnFile ? "W-9 not on file" : !v.taxIdLast4 ? "Tax ID missing" : !(v.addressLine1 && v.city && v.state && v.postalCode) ? "Mailing address incomplete" : null;
    forms.push({ vendorId: v.id, name: v.name, tinLast4: v.taxIdLast4, address: v.addressLine1 ?? "", city: v.city ?? "", state: v.state ?? "", zip: v.postalCode ?? "", email: v.email, amountCents: amt, ready: !issue, issue });
  }
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: ctx.org.id } });
  return { year, payer: { name: org.name, address: org.addressLine1 ?? "", city: org.city ?? "", state: org.state ?? "", zip: org.postalCode ?? "", phone: org.phone ?? "" }, forms };
}

/**
 * IRIS-style bulk upload CSV for Form 1099-NEC (one row per recipient, box 1 = nonemployee
 * compensation). Hearthstead stores only the last 4 digits of each TIN, so the TIN column is
 * marked for completion before upload — the file says so in its first comment row.
 */
export function irisCsv(d: Awaited<ReturnType<typeof forms1099>>) {
  const header = ["Form Type", "Tax Year", "Payer Name", "Payer Address", "Payer City", "Payer State", "Payer ZIP", "Payer Phone", "Recipient TIN Type", "Recipient TIN", "Recipient Name", "Recipient Address", "Recipient City", "Recipient State", "Recipient ZIP", "Box 1 Nonemployee Compensation", "Ready", "Issue"];
  const rows = d.forms.map((f) => ["1099-NEC", d.year, d.payer.name, d.payer.address, d.payer.city, d.payer.state, d.payer.zip, d.payer.phone, "", f.tinLast4 ? `ENTER FULL TIN (ends ${f.tinLast4})` : "MISSING", f.name, f.address, f.city, f.state, f.zip, dollars(f.amountCents), f.ready ? "Yes" : "No", f.issue ?? ""]);
  const note = [`# Hearthstead 1099-NEC export for ${d.year}. Enter each recipient's full TIN (from their W-9) and TIN type (EIN/SSN) before uploading to IRS IRIS or your e-file provider.`];
  return [note, header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

/** Printable recipient copies (Copy B), one per page. */
export function copyBHtml(d: Awaited<ReturnType<typeof forms1099>>) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const page = (f: Form1099) => `<section style="page-break-after:always;border:2px solid #0f172a;padding:24px;margin:24px auto;max-width:720px;font-family:system-ui,sans-serif">
<div style="display:flex;justify-content:space-between"><strong>Form 1099-NEC · ${d.year}</strong><span>Copy B — For Recipient</span></div>
<table style="width:100%;margin-top:16px;border-collapse:collapse;font-size:14px">
<tr><td style="border:1px solid #94a3b8;padding:8px;width:50%;vertical-align:top"><small>PAYER</small><br/>${esc(d.payer.name)}<br/>${esc(d.payer.address)}<br/>${esc(`${d.payer.city}, ${d.payer.state} ${d.payer.zip}`)}<br/>${esc(d.payer.phone)}</td>
<td style="border:1px solid #94a3b8;padding:8px;vertical-align:top"><small>1 Nonemployee compensation</small><br/><strong style="font-size:20px">$${Number(dollars(f.amountCents)).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td></tr>
<tr><td style="border:1px solid #94a3b8;padding:8px;vertical-align:top"><small>RECIPIENT</small><br/>${esc(f.name)}<br/>${esc(f.address)}<br/>${esc(`${f.city}, ${f.state} ${f.zip}`)}</td>
<td style="border:1px solid #94a3b8;padding:8px;vertical-align:top"><small>RECIPIENT'S TIN</small><br/>***-**-${esc(f.tinLast4 ?? "????")}</td></tr></table>
<p style="font-size:12px;color:#475569">This is important tax information and is being furnished to the IRS. Keep it for your records.</p></section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>1099-NEC ${d.year}</title></head><body>${d.forms.map(page).join("") || "<p>No vendors need a 1099-NEC this year.</p>"}</body></html>`;
}
