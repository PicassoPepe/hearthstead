import { newBlock, siteSchema, type Block, type BlockType, type SiteContent } from "./blocks";

/** Four starting designs. Everything stays editable afterwards. */
export const TEMPLATES = {
  apartments: { label: "Modern Apartments", hint: "Lots of homes to show, amenities and a big Apply button" },
  family: { label: "Single-Family Rentals", hint: "Neighborhood and photos up front" },
  luxury: { label: "Luxury", hint: "Large photo, reviews, a few select homes" },
  student: { label: "Student Housing", hint: "Amenities, common questions and quick applications" },
} as const;
export type TemplateKey = keyof typeof TEMPLATES;

const make = (type: BlockType, patch: Record<string, unknown> = {}): Block => ({ ...newBlock(type), ...patch }) as Block;

export function templateContent(key: TemplateKey, org: { name: string; city?: string | null }): SiteContent {
  const where = org.city ? ` in ${org.city}` : "";
  const common = { title: org.name, footerText: "", analytics: { plausibleDomain: "" } };
  const residents = make("residents");
  const contact = make("contact");
  switch (key) {
    case "apartments":
      return siteSchema.parse({ ...common, tagline: `Apartments${where} by ${org.name}`, seoDescription: `Apartments for rent${where}. See available homes, book a tour and apply online with ${org.name}.`, theme: { primary: "#0C4C54", accent: "#B8774F", font: "inter", rounded: true, dark: false },
        sections: [make("hero", { headline: `Apartment living${where}, made easy`, subtext: "Modern homes, responsive maintenance and online rent payments." }), make("vacancies"), make("amenities", { items: ["In-unit or on-site laundry", "Off-street parking", "Pet friendly", "Online rent payments", "24/7 maintenance requests"] }), make("apply"), make("announcements"), make("faq", { items: [{ q: "How do I apply?", a: "Pick a home above and press Apply. It takes about 15 minutes." }, { q: "Are pets allowed?", a: "Many of our homes welcome pets. Check each listing for details." }] }), residents, contact] });
    case "family":
      return siteSchema.parse({ ...common, tagline: `Homes for rent${where}`, seoDescription: `Single-family homes for rent${where} from ${org.name}.`, theme: { primary: "#18383B", accent: "#B8774F", font: "jakarta", rounded: true, dark: false },
        sections: [make("hero", { headline: `Find your next home${where}`, subtext: "Well-kept houses, friendly local management." }), make("vacancies", { title: "Houses available now" }), make("gallery"), make("neighborhood", { body: "Close to schools, parks and shopping." }), make("testimonials"), make("showing"), residents, contact] });
    case "luxury":
      return siteSchema.parse({ ...common, tagline: `Residences by ${org.name}`, seoDescription: `Luxury residences${where} by ${org.name}.`, theme: { primary: "#1F2A2E", accent: "#B8774F", font: "serif", rounded: false, dark: false },
        sections: [make("hero", { headline: "Residences of distinction", subtext: "Thoughtful design, exceptional service.", primary: { label: "Book a private tour", target: "showing" }, secondary: { label: "View residences", target: "vacancies" } }), make("about", { title: "Our approach", body: "" }), make("testimonials"), make("vacancies", { title: "Available residences", max: 6 }), make("showing", { title: "Schedule a private tour" }), residents, contact] });
    case "student":
      return siteSchema.parse({ ...common, tagline: `Student housing${where}`, seoDescription: `Student apartments${where} — easy applications, roommate-friendly leases.`, theme: { primary: "#0E5A63", accent: "#B8774F", font: "jakarta", rounded: true, dark: false },
        sections: [make("hero", { headline: "Live close to campus", subtext: "Furnished options, utilities included, apply in minutes.", primary: { label: "Apply now", target: "apply" } }), make("amenities", { items: ["Furnished options", "High-speed internet", "Study lounge", "Bike storage", "Individual leases"] }), make("vacancies", { title: "Floor plans available" }), make("faq", { items: [{ q: "Do I need a guarantor?", a: "Most students apply with a parent or guardian as guarantor. You can invite them right from the application." }, { q: "Can I pick my roommates?", a: "Yes — tell us who you'd like to live with when you apply." }] }), make("apply"), make("announcements"), residents, contact] });
  }
}
