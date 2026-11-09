import { PrismaClient } from "@prisma/client";
import { createScopedClient } from "../src/server/dal";
import { getWebsite, publish, saveDraft } from "../src/server/site/service";
import { siteSchema, type Block } from "../src/lib/site/blocks";

/** A published demo website for Maple & Main (Modern Apartments design + a few real-looking touches). */
export async function seedWebsite(appUrl: string, orgId: string, adminId: string) {
  const app = new PrismaClient({ datasources: { db: { url: appUrl } } });
  const db = createScopedClient(app, { orgId, userId: adminId });
  const w = await getWebsite(db);
  const c = siteSchema.parse(w.draft);
  const today = new Date().toISOString().slice(0, 10);
  c.sections = c.sections.map((s): Block => {
    if (s.type === "announcements") return { ...s, items: [{ title: "Fall gutter cleaning", date: today, body: "Crews will be at Maple Court and Cedar Duplex this week. Please move cars from the side lots by 8 am." }, { title: "Pay rent online", date: today, body: "Residents can pay by bank or card and set up autopay in the resident portal." }] };
    if (s.type === "contact") return { ...s, hours: "Mon–Fri 9 am – 5 pm\nEmergencies: call any time" };
    return s;
  });
  c.sections.splice(5, 0, { id: "seedtestimonials", enabled: true, type: "testimonials", title: "What residents say", items: [{ quote: "Repairs get fixed fast and paying rent online is so easy.", name: "Priya, Maple Court" }, { quote: "Friendly, responsive and the apartment was spotless on move-in day.", name: "Marcus, Oak Terrace" }] });
  await saveDraft(db, c);
  await publish(db, "Demo website");
  await app.$disconnect();
  return { sections: c.sections.length };
}
