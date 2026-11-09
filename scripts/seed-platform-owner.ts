/**
 * One-time setup of the DeedWood platform owner (the person who runs /admin).
 *
 *   PLATFORM_OWNER_EMAIL=you@yourcompany.com pnpm platform:owner
 *
 * - Creates (or finds) that login and marks it as the platform owner. Nobody can become platform
 *   owner by signing up — only this script, run by someone with access to the server.
 * - Prints a one-time sign-in link (valid 30 minutes). Open it, choose a password and turn on
 *   two-factor authentication; the owner console requires both.
 * - Refuses to add a second owner. To hand ownership to a different email (e.g. a lost account),
 *   run with --rotate and --secret=<the PLATFORM_BREAK_GLASS_SECRET set in the host's settings>.
 * - Never contains or prints a password.
 */
import { createNodePrisma } from "../prisma/node-client.mjs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";

if (existsSync(".env")) loadEnvFile(".env");

export type OwnerSeedResult = { status: "created" | "already" | "rotated"; userId: string; link: string | null };

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function seedPlatformOwner(db: PrismaClient, o: { email: string | undefined; name?: string; rotate?: boolean; secret?: string; breakGlass?: string; authSecret?: string; baseUrl?: string }): Promise<OwnerSeedResult> {
  const email = o.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Set PLATFORM_OWNER_EMAIL to the platform owner's email address.");
  const owners = await db.platformAdmin.findMany({ where: { role: "OWNER" } });
  let user = await db.user.findUnique({ where: { email } });
  if (user && owners.some((x) => x.userId === user!.id)) return { status: "already", userId: user.id, link: null };
  if (owners.length) {
    if (!o.rotate) throw new Error("A platform owner already exists. To replace it, run again with --rotate --secret=<PLATFORM_BREAK_GLASS_SECRET>.");
    if (!o.breakGlass || o.breakGlass.length < 24) throw new Error("Rotating needs PLATFORM_BREAK_GLASS_SECRET (24+ characters) in the server's settings.");
    if (!o.secret || !same(o.secret, o.breakGlass)) throw new Error("The --secret doesn't match PLATFORM_BREAK_GLASS_SECRET.");
  }
  user ??= await db.user.create({ data: { email, name: o.name?.trim() || null } });
  if (owners.length) await db.platformAdmin.deleteMany({ where: { role: "OWNER" } });
  await db.platformAdmin.create({ data: { userId: user.id, role: "OWNER" } });
  await db.platformAuditLog.create({ data: { actorUserId: user.id, action: owners.length ? "owner.rotated" : "owner.created", targetType: "PlatformAdmin", targetId: user.id, reason: "seed-platform-owner script" } });

  // One-time email sign-in link (the same kind Auth.js sends), only for logins without two-factor yet.
  let link: string | null = null;
  if (!user.twoFactorEnabled && o.authSecret && o.baseUrl) {
    const token = randomBytes(32).toString("hex");
    await db.verificationToken.create({ data: { identifier: email, token: createHash("sha256").update(`${token}${o.authSecret}`).digest("hex"), expires: new Date(Date.now() + 30 * 60_000) } });
    const base = o.baseUrl.replace(/\/$/, "");
    link = `${base}/api/auth/callback/email?${new URLSearchParams({ callbackUrl: `${base}/admin/setup`, token, email })}`;
  }
  return { status: owners.length ? "rotated" : "created", userId: user.id, link };
}

async function main() {
  const args = process.argv.slice(2);
  const db = createNodePrisma(process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL);
  try {
    const r = await seedPlatformOwner(db, {
      email: process.env.PLATFORM_OWNER_EMAIL,
      name: process.env.PLATFORM_OWNER_NAME,
      rotate: args.includes("--rotate"),
      secret: args.find((a) => a.startsWith("--secret="))?.slice(9),
      breakGlass: process.env.PLATFORM_BREAK_GLASS_SECRET,
      authSecret: process.env.AUTH_SECRET,
      baseUrl: process.env.AUTH_URL,
    });
    if (r.status === "already") console.log("That email is already the platform owner. Sign in and open /admin.");
    else {
      console.log(r.status === "rotated" ? "Platform owner replaced." : "Platform owner created.");
      if (r.link) console.log(`\nOpen this link within 30 minutes to sign in, set a password and turn on two-factor:\n\n${r.link}\n`);
      else console.log("Sign in with your existing password, then open /admin.");
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1]?.endsWith("seed-platform-owner.ts")) void main();
