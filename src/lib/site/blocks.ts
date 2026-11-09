import { z } from "zod";

/**
 * A company's public website is a list of sections ("blocks") stored as checked data — never
 * raw HTML — so nothing a user types can run as code on the page. Text is shown as plain text
 * (line breaks kept). Each section can be switched on or off without losing its content.
 */
const text = (max: number) => z.string().trim().max(max).default("");
const id = z.string().regex(/^[a-z0-9]{6,32}$/);
const imageId = z.string().regex(/^[a-z0-9]{10,40}$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const TARGETS = { vacancies: "See available homes", apply: "Apply now", showing: "Book a tour", contact: "Contact us", tenantPortal: "Resident login", ownerPortal: "Owner login", payRent: "Pay rent", maintenance: "Request a repair" } as const;
export type Target = keyof typeof TARGETS;
const target = z.enum(Object.keys(TARGETS) as [Target, ...Target[]]);
const button = z.object({ label: text(40), target });

const base = { id, enabled: z.boolean().default(true) };
export const blockSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("hero"), headline: text(120), subtext: text(400), imageId: imageId.nullable().default(null), primary: button.nullable().default(null), secondary: button.nullable().default(null) }),
  z.object({ ...base, type: z.literal("announcements"), title: text(80), items: z.array(z.object({ title: text(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).default(""), body: text(2000) })).max(30).default([]) }),
  z.object({ ...base, type: z.literal("vacancies"), title: text(80), intro: text(400), max: z.number().int().min(1).max(60).default(12), showRent: z.boolean().default(true) }),
  z.object({ ...base, type: z.literal("apply"), title: text(80), body: text(600), buttonLabel: text(40) }),
  z.object({ ...base, type: z.literal("showing"), title: text(80), body: text(600) }),
  z.object({ ...base, type: z.literal("about"), title: text(80), body: text(3000), team: z.array(z.object({ name: text(80), role: text(80), imageId: imageId.nullable().default(null) })).max(24).default([]) }),
  z.object({ ...base, type: z.literal("testimonials"), title: text(80), items: z.array(z.object({ quote: text(600), name: text(80) })).max(24).default([]) }),
  z.object({ ...base, type: z.literal("amenities"), title: text(80), items: z.array(text(80)).max(40).default([]) }),
  z.object({ ...base, type: z.literal("faq"), title: text(80), items: z.array(z.object({ q: text(200), a: text(1500) })).max(40).default([]) }),
  z.object({ ...base, type: z.literal("gallery"), title: text(80), imageIds: z.array(imageId).max(24).default([]), fromProperties: z.boolean().default(true) }),
  z.object({ ...base, type: z.literal("neighborhood"), title: text(80), body: text(3000), address: text(200) }),
  z.object({ ...base, type: z.literal("contact"), title: text(80), body: text(600), hours: text(300), showPhone: z.boolean().default(true), showEmail: z.boolean().default(true) }),
  z.object({ ...base, type: z.literal("residents"), title: text(80), body: text(600), tenantLogin: z.boolean().default(true), ownerLogin: z.boolean().default(true), payRent: z.boolean().default(true), maintenance: z.boolean().default(true) }),
]);
export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block["type"];

export const FONTS = { inter: "Clean (Inter)", jakarta: "Friendly (Plus Jakarta Sans)", serif: "Classic (serif)" } as const;
export const siteSchema = z.object({
  version: z.literal(1).default(1),
  title: text(80),
  tagline: text(160),
  theme: z.object({ primary: hex.default("#0C4C54"), accent: hex.default("#B8774F"), font: z.enum(["inter", "jakarta", "serif"]).default("inter"), rounded: z.boolean().default(true), dark: z.boolean().default(false) }).default({ primary: "#0C4C54", accent: "#B8774F", font: "inter", rounded: true, dark: false }),
  seoDescription: text(300),
  footerText: text(400),
  analytics: z.object({ plausibleDomain: z.string().trim().max(120).regex(/^[a-z0-9.-]*$/i, "Just the domain, like example.com").default("") }).default({ plausibleDomain: "" }),
  sections: z.array(blockSchema).max(40).default([]),
});
export type SiteContent = z.infer<typeof siteSchema>;

/** Checked copy of what the editor sent. Throws a ZodError (shown as field errors) when it's not valid. */
export function parseSite(v: unknown): SiteContent {
  return siteSchema.parse(v);
}

export const BLOCK_LABELS: Record<BlockType, { label: string; hint: string }> = {
  hero: { label: "Welcome banner", hint: "Big headline, photo and buttons at the top" },
  announcements: { label: "Announcements & news", hint: "Updates for residents and visitors" },
  vacancies: { label: "Available homes", hint: "Filled in automatically from your published listings" },
  apply: { label: "Apply now", hint: "A button to the online application" },
  showing: { label: "Book a tour", hint: "A short form — requests land in People interested" },
  about: { label: "About us & team", hint: "Your story and the people behind it" },
  testimonials: { label: "Reviews", hint: "Quotes from happy residents" },
  amenities: { label: "Amenities", hint: "Laundry, parking, pets welcome…" },
  faq: { label: "Common questions", hint: "Questions and answers" },
  gallery: { label: "Photo gallery", hint: "Your property photos, or pick your own" },
  neighborhood: { label: "Neighborhood", hint: "What's nearby, with a map link" },
  contact: { label: "Contact", hint: "Phone, email, hours and a message form" },
  residents: { label: "For residents & owners", hint: "Login, pay rent and repair-request buttons" },
};

export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);

/** A new, empty section of a given type with sensible starting text. */
export function newBlock(type: BlockType): Block {
  const b = { id: newId(), enabled: true };
  switch (type) {
    case "hero": return blockSchema.parse({ ...b, type, headline: "A place you'll love to come home to", subtext: "", primary: { label: "See available homes", target: "vacancies" }, secondary: { label: "Resident login", target: "tenantPortal" } });
    case "announcements": return blockSchema.parse({ ...b, type, title: "News & announcements", items: [] });
    case "vacancies": return blockSchema.parse({ ...b, type, title: "Available homes", intro: "" });
    case "apply": return blockSchema.parse({ ...b, type, title: "Ready to apply?", body: "Apply online in about 15 minutes.", buttonLabel: "Apply now" });
    case "showing": return blockSchema.parse({ ...b, type, title: "Book a tour", body: "Tell us when works for you and we'll confirm." });
    case "about": return blockSchema.parse({ ...b, type, title: "About us", body: "" });
    case "testimonials": return blockSchema.parse({ ...b, type, title: "What residents say", items: [] });
    case "amenities": return blockSchema.parse({ ...b, type, title: "Amenities", items: [] });
    case "faq": return blockSchema.parse({ ...b, type, title: "Common questions", items: [] });
    case "gallery": return blockSchema.parse({ ...b, type, title: "Photos" });
    case "neighborhood": return blockSchema.parse({ ...b, type, title: "The neighborhood", body: "", address: "" });
    case "contact": return blockSchema.parse({ ...b, type, title: "Get in touch", body: "Questions? Send us a message.", hours: "" });
    case "residents": return blockSchema.parse({ ...b, type, title: "Already a resident?", body: "Pay rent, request repairs and message us online." });
  }
}
