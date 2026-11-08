import { PrismaClient } from "@prisma/client";
import { deflateSync } from "node:zlib";
import { createScopedClient } from "../src/server/dal";
import { getStorage } from "../src/adapters/storage";
import { imageUrl } from "../src/server/images/service";

/**
 * Demo images without shipping binary assets: tiny procedural illustrations (sky, building,
 * windows, door, lawn) encoded as PNG. Each property gets a cover + two variations, and the org a logo.
 */
type RGB = [number, number, number];
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf: Buffer) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(w: number, h: number, px: Uint8Array) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(px.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

class Canvas {
  px: Uint8Array;
  constructor(public w: number, public h: number) { this.px = new Uint8Array(w * h * 3); }
  set(x: number, y: number, c: RGB) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const i = (y * this.w + x) * 3; this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2]; }
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB) { for (let y = Math.max(0, y0 | 0); y < Math.min(this.h, y1); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(this.w, x1); x++) this.set(x, y, c); }
  vgrad(y0: number, y1: number, a: RGB, b: RGB) { for (let y = y0; y < y1; y++) { const t = (y - y0) / (y1 - y0); this.rect(0, y, this.w, y + 1, a.map((v, i) => Math.round(v + (b[i]! - v) * t)) as RGB); } }
  tri(cx: number, top: number, half: number, base: number, c: RGB) { for (let y = top; y < base; y++) { const hw = ((y - top) / (base - top)) * half; this.rect(cx - hw, y, cx + hw, y + 1, c); } }
  circle(cx: number, cy: number, r: number, c: RGB) { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x | 0, y | 0, c); }
}
const shade = (c: RGB, f: number): RGB => c.map((v) => Math.max(0, Math.min(255, Math.round(v * f)))) as RGB;
const WALLS: RGB[] = [[196, 112, 84], [232, 220, 196], [120, 144, 156], [214, 186, 140], [158, 98, 74], [238, 232, 222], [96, 125, 139], [188, 170, 164]];

/** A building illustration. `kind` picks a house (gable roof) or an apartment block. */
export function illustration(seed: number, kind: "house" | "apartments", variant = 0) {
  const w = 640, h = 400, cv = new Canvas(w, h);
  const evening = variant === 2;
  cv.vgrad(0, 300, evening ? [250, 176, 120] : [126, 192, 238], evening ? [255, 226, 190] : [214, 236, 250]);
  cv.circle(evening ? 120 : 540, evening ? 230 : 70, 34, evening ? [255, 214, 120] : [255, 244, 200]);
  cv.vgrad(300, 400, [104, 168, 92], [70, 128, 62]);
  const wall = WALLS[seed % WALLS.length]!, trim: RGB = [250, 250, 248], glass: RGB = evening ? [255, 214, 140] : [60, 98, 128];
  // trees
  for (const tx of [60 + (seed % 3) * 10, 590 - (seed % 4) * 8]) { cv.rect(tx - 5, 250, tx + 5, 305, [94, 70, 50]); cv.circle(tx, 235, 38, [56, 120, 70]); cv.circle(tx - 14, 250, 26, [66, 136, 78]); }
  if (kind === "house") {
    const x0 = 180 + variant * 20, x1 = 460 + variant * 20;
    cv.rect(x0, 190, x1, 305, wall);
    cv.tri((x0 + x1) / 2, 110, (x1 - x0) / 2 + 24, 192, shade(wall, 0.45));
    cv.rect(x1 - 60, 120, x1 - 40, 170, shade(wall, 0.6)); // chimney
    cv.rect((x0 + x1) / 2 - 20, 240, (x0 + x1) / 2 + 20, 305, shade(wall, 0.5)); // door
    for (const wx of [x0 + 30, x1 - 80]) { cv.rect(wx - 4, 216, wx + 54, 270, trim); cv.rect(wx, 220, wx + 50, 266, glass); cv.rect(wx + 23, 220, wx + 27, 266, trim); }
  } else {
    const floors = 4 + (seed % 3), x0 = 150 + variant * 15, x1 = 490 + variant * 15, top = 300 - floors * 44;
    cv.rect(x0, top, x1, 305, wall);
    cv.rect(x0 - 8, top - 10, x1 + 8, top, shade(wall, 0.55));
    for (let f = 0; f < floors; f++) for (let i = 0; i < 5; i++) { const wx = x0 + 22 + i * 64, wy = top + 12 + f * 44; if (f === floors - 1 && i === 2) continue; cv.rect(wx, wy, wx + 36, wy + 26, (seed + f + i) % 5 === 0 && evening ? [255, 230, 160] : glass); cv.rect(wx - 3, wy + 26, wx + 39, wy + 30, trim); }
    cv.rect((x0 + x1) / 2 - 24, 255, (x0 + x1) / 2 + 24, 305, shade(wall, 0.5));
    cv.rect((x0 + x1) / 2 - 40, 248, (x0 + x1) / 2 + 40, 255, shade(wall, 0.35));
  }
  cv.rect(0, 305, w, 312, [190, 186, 176]); // sidewalk
  return encodePng(w, h, cv.px);
}

export function logoPng(brand: RGB) {
  const s = 256, cv = new Canvas(s, s);
  cv.rect(0, 0, s, s, brand);
  cv.tri(128, 52, 92, 128, [255, 255, 255]);
  cv.rect(64, 126, 192, 208, [255, 255, 255]);
  cv.rect(112, 150, 144, 208, brand);
  cv.rect(150, 70, 168, 110, [255, 255, 255]);
  return encodePng(s, s, cv.px);
}

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
