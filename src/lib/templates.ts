/**
 * Document templates with {{merge.fields}}. Bodies are plain text with light markdown
 * (# headings, **bold**, blank-line paragraphs, "- " lists). Everything is HTML-escaped before
 * formatting, so merge values can never inject markup.
 */

export const MERGE_FIELDS: { key: string; label: string; sample: string }[] = [
  { key: "company.name", label: "Company name", sample: "Maple & Main Property Co." },
  { key: "company.phone", label: "Company phone", sample: "(312) 555-0100" },
  { key: "company.email", label: "Company email", sample: "office@maplemain.example" },
  { key: "today", label: "Today's date", sample: "November 7, 2026" },
  { key: "tenant.names", label: "Tenant name(s)", sample: "Riley Garcia" },
  { key: "tenant.email", label: "Primary tenant email", sample: "riley@example.com" },
  { key: "property.name", label: "Property", sample: "Oak Terrace Apartments" },
  { key: "property.address", label: "Property address", sample: "120 Oak Terrace, Chicago, IL 60614" },
  { key: "unit.name", label: "Unit", sample: "202" },
  { key: "lease.start", label: "Lease start", sample: "December 1, 2026" },
  { key: "lease.end", label: "Lease end", sample: "November 30, 2027" },
  { key: "lease.rent", label: "Monthly rent", sample: "$1,550.00" },
  { key: "lease.deposit", label: "Security deposit", sample: "$1,550.00" },
  { key: "lease.dueDay", label: "Rent due day", sample: "1st" },
  { key: "lease.lateFee", label: "Late fee", sample: "$75.00 after 3 days" },
  { key: "renewal.rent", label: "Renewal rent", sample: "$1,600.00" },
  { key: "renewal.start", label: "Renewal start", sample: "December 1, 2026" },
  { key: "renewal.end", label: "Renewal end", sample: "November 30, 2027" },
  { key: "renewal.expires", label: "Offer expires", sample: "November 21, 2026" },
  { key: "applicant.name", label: "Applicant name", sample: "Jordan Lee" },
  { key: "decision.reasons", label: "Decline reasons", sample: "Income below 3× rent" },
  { key: "screening.provider", label: "Screening provider", sample: "Mock Screening Co." },
];

export type MergeData = Record<string, string | null | undefined>;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Replace {{field}} with values; unknown or empty fields render as a visible blank line. */
export function mergeText(body: string, data: MergeData): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, k: string) => {
    const v = data[k];
    if (v === undefined || v === null || v === "") {
      missing.add(k);
      return "________";
    }
    return v;
  });
  return { text, missing: [...missing] };
}

/** Light markdown → safe HTML. */
export function textToHtml(text: string): string {
  const blocks = esc(text).split(/\n{2,}/);
  return blocks
    .map((b) => {
      const inline = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br/>");
      if (/^#{1,3} /.test(b)) {
        const level = b.match(/^#+/)![0].length + 1;
        return `<h${level}>${inline(b.replace(/^#+ /, ""))}</h${level}>`;
      }
      if (b.split("\n").every((l) => l.startsWith("- "))) return `<ul>${b.split("\n").map((l) => `<li>${inline(l.slice(2))}</li>`).join("")}</ul>`;
      return `<p>${inline(b)}</p>`;
    })
    .join("\n");
}

export function renderTemplate(body: string, data: MergeData) {
  const { text, missing } = mergeText(body, data);
  return { html: textToHtml(text), missing };
}

export const DEFAULT_TEMPLATES: { name: string; kind: string; body: string }[] = [
  {
    name: "Residential lease agreement",
    kind: "LEASE",
    body: `# Residential Lease Agreement

This lease is made on {{today}} between **{{company.name}}** ("Manager"), as agent for the owner, and **{{tenant.names}}** ("Tenant").

## 1. Premises
{{property.name}}, Unit {{unit.name}} — {{property.address}}.

## 2. Term
The lease begins **{{lease.start}}** and ends **{{lease.end}}**.

## 3. Rent
Monthly rent is **{{lease.rent}}**, due on the {{lease.dueDay}} of each month. Late fee: {{lease.lateFee}}. Rent can be paid online in the resident portal.

## 4. Security deposit
Tenant pays a security deposit of **{{lease.deposit}}**, held according to state law and returned with an itemized statement after move-out.

## 5. Maintenance
Tenant reports repairs through the resident portal. Manager may enter with 24 hours' notice, or immediately in an emergency.

## 6. Signatures
By signing electronically, each party agrees this lease is binding and that electronic signatures have the same effect as handwritten ones.`,
  },
  {
    name: "Lease renewal addendum",
    kind: "RENEWAL",
    body: `# Lease Renewal

{{company.name}} and **{{tenant.names}}** agree to renew the lease for {{property.name}}, Unit {{unit.name}}.

- New term: **{{renewal.start}}** to **{{renewal.end}}**
- New monthly rent: **{{renewal.rent}}**

All other terms of the current lease stay the same. This offer expires on {{renewal.expires}}.`,
  },
  {
    name: "Adverse action notice",
    kind: "ADVERSE_ACTION",
    body: `# Notice of Adverse Action

Dear {{applicant.name}},

Thank you for applying to rent {{property.name}}{{unit.name}}. After careful review, we are unable to approve your application at this time.

**Reason(s):** {{decision.reasons}}

This decision was based in whole or in part on information in a consumer report from {{screening.provider}}. The reporting agency did not make this decision and cannot explain why it was made.

Under the Fair Credit Reporting Act you have the right to a free copy of your report from the agency within 60 days, and to dispute the accuracy or completeness of any information in it.

Sincerely,
{{company.name}} · {{company.phone}}`,
  },
  {
    name: "Notice to enter",
    kind: "NOTICE",
    body: `# Notice of Entry

Dear {{tenant.names}},

{{company.name}} will enter {{property.name}}, Unit {{unit.name}} on ________ between ________ for the following purpose: ________.

Questions? Call {{company.phone}}.`,
  },
];
