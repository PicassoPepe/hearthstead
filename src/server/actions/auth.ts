"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn, signOut, auth } from "@/server/auth";
import { adminDb } from "@/server/db";
import { hashPassword, PASSWORD_MIN } from "@/server/auth/password";
import { provisionOrganization } from "@/server/orgs";
import { ORG_COOKIE } from "@/server/context";
import type { ActionResult } from "@/server/action-result";

const loginSchema = z.object({ email: z.email("Enter a valid email"), password: z.string().min(1, "Enter your password"), code: z.string().max(20).optional() });

export async function loginWithPassword(input: z.input<typeof loginSchema>, callbackUrl = "/app/overview"): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields." };
  try {
    await signIn("password", { email: parsed.data.email, password: parsed.data.password, code: parsed.data.code, redirect: false });
  } catch (e) {
    if (e instanceof AuthError && (e as { code?: string }).code === "2fa_required") return { ok: false, error: "Enter the 6-digit code from your authenticator app.", fieldErrors: { code: "required" } };
    if (e instanceof AuthError && (e as { code?: string }).code === "2fa_invalid") return { ok: false, error: "That code didn't work. Try the newest code, or a recovery code.", fieldErrors: { code: "invalid" } };
    if (e instanceof AuthError) return { ok: false, error: "That email and password don't match an account." };
    throw e;
  }
  redirect(safeCallback(callbackUrl));
}

const magicSchema = z.object({ email: z.email("Enter a valid email") });

export async function requestMagicLink(input: z.input<typeof magicSchema>, callbackUrl = "/app/overview"): Promise<ActionResult> {
  const parsed = magicSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid email" };
  const email = parsed.data.email.toLowerCase();
  const exists = await adminDb.user.findUnique({ where: { email } });
  // Don't reveal whether an account exists: always land on the check-email page.
  if (exists && !exists.deletedAt) {
    await signIn("email", { email, redirect: false, redirectTo: safeCallback(callbackUrl) });
  }
  redirect(`/login/check-email?email=${encodeURIComponent(email)}`);
}

const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name"),
  email: z.email("Enter a valid email"),
  password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`),
  orgName: z.string().trim().min(2, "Enter your company name"),
});

export async function signupAction(input: z.input<typeof signupSchema>): Promise<ActionResult> {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".")] ??= i.message;
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const email = parsed.data.email.toLowerCase();
  if (await adminDb.user.findUnique({ where: { email } })) {
    return { ok: false, error: "An account with that email already exists.", fieldErrors: { email: "Already registered — sign in instead." } };
  }
  const user = await adminDb.user.create({
    data: { email, name: parsed.data.name, passwordHash: await hashPassword(parsed.data.password) },
  });
  const { orgId } = await provisionOrganization(adminDb, { name: parsed.data.orgName, ownerUserId: user.id });
  (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", path: "/" });
  await signIn("password", { email, password: parsed.data.password, redirect: false });
  redirect("/app/overview");
}

export async function signOutAction(): Promise<void> {
  (await cookies()).delete(ORG_COOKIE);
  await signOut({ redirectTo: "/login" });
}

export async function switchOrganization(orgId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in" };
  const m = await adminDb.membership.findFirst({ where: { userId: session.user.id, organizationId: orgId, status: "ACTIVE", deletedAt: null } });
  if (!m) return { ok: false, error: "You're not a member of that organization." };
  (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", path: "/" });
  await adminDb.user.update({ where: { id: session.user.id }, data: { lastOrgId: orgId } });
  return { ok: true, data: undefined as void };
}

function safeCallback(url: string): string {
  return url.startsWith("/") && !url.startsWith("//") ? url : "/app/overview";
}
