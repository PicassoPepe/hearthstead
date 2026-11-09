/** Test-only: create a platform owner with a password and two-factor already on. Prints JSON. */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../../src/server/auth/password";
import { newTotpSecret } from "../../../src/server/platform/totp";

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_ADMIN_URL } } });
  const email = `owner-console-${Date.now()}@example.org`;
  const password = "Owner-Console-Test-1";
  const secret = newTotpSecret();
  const u = await db.user.create({ data: { email, name: "Platform Owner", passwordHash: await hashPassword(password), twoFactorEnabled: true, totpSecret: secret } });
  await db.platformAdmin.create({ data: { userId: u.id } });
  await db.$disconnect();
  console.log(JSON.stringify({ email, password, secret }));
}
void main();
