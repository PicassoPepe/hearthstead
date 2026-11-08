import { PrismaClient } from "@prisma/client";
import { createScopedClient } from "../src/server/dal";
import { getStorage } from "../src/adapters/storage";
import { imageUrl } from "../src/server/images/service";
import { illustration, logoPng } from "../src/server/images/illustrations";

/**
 * Demo images without shipping binary assets: tiny procedural illustrations (sky, building,
 * windows, door, lawn) encoded as PNG. Each property gets a cover + two variations, and the org a logo.
 */
export async function seedImages(appUrl: string, orgId: string, adminId: string) {
  const app = new PrismaClient({ datasources: { db: { url: appUrl } } });
  const db = createScopedClient(app, { orgId, userId: adminId });
  const store = async (name: string, bytes: Buffer, category: string, link: { type: string; id: string } | null) => {
    const key = `${orgId}/seed-${category.toLowerCase()}-${name}`;
    await getStorage().put(key, new Uint8Array(bytes), "image/png");
    const a = await db.attachment.create({ data: { organizationId: orgId, name: `${name}.png`, contentType: "image/png", sizeBytes: bytes.length, storageKey: key, category, public: true, entityType: link?.type ?? null, entityId: link?.id ?? null, createdById: adminId } });
    return a.id;
  };
  const props = await db.property.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } });
  let n = 0;
  for (const [i, p] of props.entries()) {
    const kind = p.type === "SINGLE_FAMILY" || p.type === "TOWNHOME" ? "house" : "apartments";
    const ids: string[] = [];
    for (let v = 0; v < 3; v++) ids.push(await store(`${p.id}-${v}`, illustration(i * 7 + 3, kind, v), "PropertyPhoto", { type: "Property", id: p.id }));
    await db.property.update({ where: { id: p.id }, data: { photos: ids, photoUrl: imageUrl(ids[0]!) } });
    n += ids.length;
  }
  const logo = await store("logo", logoPng([15, 118, 110]), "Logo", null);
  await app.$disconnect();
  return { photos: n, logoUrl: imageUrl(logo) };
}
