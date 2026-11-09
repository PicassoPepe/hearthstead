"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn, signOut, auth } from "@/server/auth";
import { adminDb } from "@/server/db";
import { hashPassword, PASSWORD_MIN } from "@/server/auth/password";
import { provisionOrganization } from "@/server/orgs";
import { ORG_COOKIE } from "@/server/context";
import { cookieOptions } from "@/lib/cookies";
import type { ActionResult } from "@/server/action-result";
import * as RL from "@/server/auth/rate-limit";
import { clientIp } from "@/server/auth/rate-limit";
import { securityEvent } from "@/server/auth/security-events";
import { audit } from "@/server/audit";
import { forOrg } from "@/server/dal/for-org";

const loginSchema = z.object({ email: z.email("Enter a valid email"), password: z.string().min(1, "Enter your password"), code: z.string().max(20).optional() });

export async function loginWithPassword(input: z.input<typeof loginSchema>, callbackUrl = "/app/overview"): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields." };
  try {
    await signIn("password", { email: parsed.data.email, password: parsed.data.password, ...(parsed.data.code?.trim() ? { code: parsed.data.code.trim() } : {}), redirect: false });
  } catch (e) {
    if (e instanceof AuthError && (e as { code?: string }).code === "2fa_required") return { ok: false, error: "Enter the 6-digit code from your authenticator app.", fieldErrors: { code: "required" } };
    if (e instanceof AuthError && (e as { code?: string }).code === "locked") return { ok: false, error: "Too many wrong tries for this account. Wait 15 minutes and try again, or sign in with an email link." };
    if (e instanceof AuthError && (e as { code?: string }).code === "rate_limited") return { ok: false, error: "Too many sign-in tries from here. Wait 15 minutes and try again." };
    if (e instanceof AuthError && (e as { code?: string }).code === "2fa_invalid") return { ok: false, error: "That code didn't work. Try the newest code, or a recovery code.", fieldErrors: { code: "invalid" } };
    if (e instanceof AuthError) return { ok: false, error: "That email and password don't match an account." };
    throw e;
  }
  redirect(safeCallback(callbackUrl));
}

const magicSchema = z.object({ email: z.email("Enter a valid email"), captcha: z.string().max(4096).optional() });

export async function requestMagicLink(input: z.input<typeof magicSchema>, callbackUrl = "/app/overview"): Promise<ActionResult> {
  const parsed = magicSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid email" };
  const email = parsed.data.email.toLowerCase();
  const h = await headers();
  const ip = clientIp(h);
  const { verifyCaptcha, CAPTCHA_FAILED } = await import("@/server/auth/captcha");
  if (!(await verifyCaptcha(parsed.data.captcha, ip))) return { ok: false, error: CAPTCHA_FAILED };
  try {
    if (ip !== "local") await RL.hit("magicIp", ip);
    await RL.hit("magicEmail", email);
  } catch (e) {
    if (!(e instanceof RL.RateLimited)) throw e;
    await securityEvent("MAGIC_LINK_LIMITED", { email, ip, userAgent: h.get("user-agent") });
    return { ok: false, error: "We just sent a few links to this email. Check your inbox (and spam folder), or wait 15 minutes and try again." };
  }
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
  channel: z.enum(["EMAIL", "SMS"]).default("EMAIL"),
  phone: z.string().trim().max(30).optional(),
  captcha: z.string().max(4096).optional(),
});

export type SignupStart = { pendingId: string; channel: "EMAIL" | "SMS"; sentTo: string; testCode?: string };

/**
 * Sign-up step 1: check the details and the "I'm human" check, then send a 6-digit code by email
 * or text. Nothing is created until the code is entered (step 2).
 */
export async function startSignupAction(input: z.input<typeof signupSchema>): Promise<ActionResult<SignupStart>> {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".")] ??= i.message;
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const v = parsed.data;
  const email = v.email.toLowerCase();
  const h = await headers();
  const ip = clientIp(h);
  const { verifyCaptcha, CAPTCHA_FAILED } = await import("@/server/auth/captcha");
  if (!(await verifyCaptcha(v.captcha, ip))) return { ok: false, error: CAPTCHA_FAILED };
  try {
    if (ip !== "local") await RL.hit("signupIp", ip);
    await RL.hit("resetEmail", `signup:${email}`);
  } catch {
    await securityEvent("SIGNUP_LIMITED", { email, ip, userAgent: h.get("user-agent") });
    return { ok: false, error: "Too many sign-up attempts. Wait an hour and try again." };
  }
  if (await adminDb.user.findUnique({ where: { email } })) {
    return { ok: false, error: "An account with that email already exists.", fieldErrors: { email: "Already registered — sign in instead." } };
  }
  const { normalizePhone, getSmsProvider } = await import("@/adapters/sms");
  const phone = v.channel === "SMS" ? normalizePhone(v.phone) : null;
  if (v.channel === "SMS" && !phone) return { ok: false, error: "Enter a 10-digit US mobile number.", fieldErrors: { phone: "Enter a 10-digit US mobile number" } };
  const S = await import("@/server/auth/signup-codes");
  const { id, code } = await S.createPending({ email, channel: v.channel, phone, payload: { name: v.name, orgName: v.orgName, passwordHash: await hashPassword(v.password) } });
  const sent = await deliverCode(v.channel, email, phone, code);
  if (!sent.ok) return { ok: false, error: sent.error };
  const { devToolsEnabled } = await import("@/lib/dev-tools");
  const showCode = v.channel === "SMS" && getSmsProvider().name === "mock" && devToolsEnabled();
  return { ok: true, data: { pendingId: id, channel: v.channel, sentTo: v.channel === "SMS" ? S.maskPhone(phone!) : S.maskEmail(email), ...(showCode ? { testCode: code } : {}) } };
}

async function deliverCode(channel: "EMAIL" | "SMS", email: string, phone: string | null, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (channel === "SMS") {
    const { getSmsProvider } = await import("@/adapters/sms");
    const r = await getSmsProvider().send({ to: phone!, body: `${code} is your DeedWood sign-up code. It expires in 15 minutes.` });
    return r.status === "FAILED" ? { ok: false, error: "We couldn't text that number. Check it, or get the code by email instead." } : { ok: true };
  }
  const { signupCodeEmail } = await import("@/server/emails");
  const { getEmailProvider } = await import("@/adapters");
  const m = signupCodeEmail(code);
  try {
    await getEmailProvider().send({ to: email, organizationId: null, subject: m.subject, html: m.html, text: m.text });
    return { ok: true };
  } catch {
    return { ok: false, error: "We couldn't send the email. Check the address and try again." };
  }
}

export async function resendSignupCodeAction(pendingId: string): Promise<ActionResult<{ testCode?: string }>> {
  const S = await import("@/server/auth/signup-codes");
  try {
    const { pending, code } = await S.newCodeFor(pendingId);
    const sent = await deliverCode(pending.channel as "EMAIL" | "SMS", pending.email, pending.phone, code);
    if (!sent.ok) return { ok: false, error: sent.error };
    const { getSmsProvider } = await import("@/adapters/sms");
    const { devToolsEnabled } = await import("@/lib/dev-tools");
    const showCode = pending.channel === "SMS" && getSmsProvider().name === "mock" && devToolsEnabled();
    return { ok: true, data: showCode ? { testCode: code } : {}, message: "New code sent" };
  } catch (e) {
    const { UserFacingError } = await import("@/server/action-result");
    if (e instanceof UserFacingError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Sign-up step 2: the right code creates the account and company, then signs in. */
export async function verifySignupAction(pendingId: string, code: string, password: string): Promise<ActionResult> {
  const S = await import("@/server/auth/signup-codes");
  const { UserFacingError } = await import("@/server/action-result");
  let p;
  try {
    p = await S.checkCode(pendingId, code);
  } catch (e) {
    if (e instanceof UserFacingError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    throw e;
  }
  const payload = p.payload as { name: string; orgName: string; passwordHash: string };
  const { verifyPassword } = await import("@/server/auth/password");
  if (!(await verifyPassword(password, payload.passwordHash))) return { ok: false, error: "Start again — something didn't match." };
  if (await adminDb.user.findUnique({ where: { email: p.email } })) return { ok: false, error: "An account with that email already exists. Sign in instead." };
  const now = new Date();
  const user = await adminDb.user.create({
    data: { email: p.email, name: payload.name, passwordHash: payload.passwordHash, emailVerified: p.channel === "EMAIL" ? now : null, phone: p.phone, phoneVerified: p.channel === "SMS" ? now : null },
  });
  const { orgId } = await provisionOrganization(adminDb, { name: payload.orgName, ownerUserId: user.id });
  if (p.channel === "SMS") await sendVerification(user.id, p.email);
  (await cookies()).set(ORG_COOKIE, orgId, cookieOptions());
  await signIn("password", { email: p.email, password, redirect: false });
  redirect("/app/setup");
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
  (await cookies()).set(ORG_COOKIE, orgId, cookieOptions());
  await adminDb.user.update({ where: { id: session.user.id }, data: { lastOrgId: orgId } });
  await audit(forOrg({ orgId, userId: session.user.id }), { action: "user.org_switched", entityType: "Organization", entityId: orgId });
  return { ok: true, data: undefined as void };
}

function safeCallback(url: string): string {
  return url.startsWith("/") && !url.startsWith("//") ? url : "/app/overview";
}

// ─── Forgot password & email confirmation ──────────────────────────────────────

const appBase = () => (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Always answers the same way, so it can't be used to find out who has an account. */
export async function requestPasswordResetAction(raw: { email: string; captcha?: string }): Promise<ActionResult> {
  const parsed = magicSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Enter a valid email", fieldErrors: { email: "Enter a valid email" } };
  const email = parsed.data.email.toLowerCase();
  const h = await headers();
  const ip = clientIp(h);
  const { verifyCaptcha, CAPTCHA_FAILED } = await import("@/server/auth/captcha");
  if (!(await verifyCaptcha(parsed.data.captcha, ip))) return { ok: false, error: CAPTCHA_FAILED };
  try {
    if (ip !== "local") await RL.hit("magicIp", `reset:${ip}`);
    await RL.hit("resetEmail", email);
  } catch (e) {
    if (!(e instanceof RL.RateLimited)) throw e;
    await securityEvent("RESET_LIMITED", { email, ip, userAgent: h.get("user-agent") });
    return { ok: true, data: undefined as void };
  }
  const user = await adminDb.user.findUnique({ where: { email } });
  if (user && !user.deletedAt) {
    const { issueToken } = await import("@/server/auth/account-tokens");
    const { passwordResetEmail } = await import("@/server/emails");
    const { getEmailProvider } = await import("@/adapters");
    const token = await issueToken(user.id, "RESET_PASSWORD");
    const m = passwordResetEmail(`${appBase()}/login/reset?token=${encodeURIComponent(token)}`);
    await getEmailProvider().send({ to: email, organizationId: null, subject: m.subject, html: m.html, text: m.text }).catch((e) => console.error("[reset] email failed", e));
    await securityEvent("PASSWORD_RESET_REQUESTED", { email, userId: user.id, ip, userAgent: h.get("user-agent") });
  }
  return { ok: true, data: undefined as void };
}

export async function resetPasswordAction(token: string, password: string): Promise<ActionResult> {
  try {
    const { resetPassword } = await import("@/server/auth/account-tokens");
    const user = await resetPassword(token, password);
    await RL.clear("loginFailEmail", user.email);
    const h = await headers();
    await securityEvent("PASSWORD_RESET", { email: user.email, userId: user.id, ip: clientIp(h), userAgent: h.get("user-agent") });
    return { ok: true, data: undefined as void, message: "Password changed — sign in with your new password." };
  } catch (e) {
    const { UserFacingError } = await import("@/server/action-result");
    if (e instanceof UserFacingError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    throw e;
  }
}

async function sendVerification(userId: string, email: string) {
  const { issueToken } = await import("@/server/auth/account-tokens");
  const { verifyEmailEmail } = await import("@/server/emails");
  const { getEmailProvider } = await import("@/adapters");
  const token = await issueToken(userId, "VERIFY_EMAIL");
  const m = verifyEmailEmail(`${appBase()}/login/verify?token=${encodeURIComponent(token)}`);
  await getEmailProvider().send({ to: email, organizationId: null, subject: m.subject, html: m.html, text: m.text }).catch((e) => console.error("[verify] email failed", e));
}

export async function resendVerificationAction(): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in first" };
  const u = await adminDb.user.findUnique({ where: { id: session.user.id } });
  if (!u) return { ok: false, error: "Sign in first" };
  if (u.emailVerified) return { ok: true, data: undefined as void, message: "Your email is already confirmed" };
  try {
    await RL.hit("verifyUser", u.id);
  } catch {
    return { ok: false, error: "We've sent a few already — check your inbox and spam folder, or try again in an hour." };
  }
  await sendVerification(u.id, u.email);
  return { ok: true, data: undefined as void, message: `Sent — check ${u.email}` };
}

/** "Sign in with Google / Microsoft". */
export async function oauthSignInAction(provider: "google" | "microsoft-entra-id", callbackUrl = "/app/overview"): Promise<void> {
  const { oauthProviders } = await import("@/server/auth/oauth");
  if (!oauthProviders().some((p) => p.id === provider)) return;
  await signIn(provider, { redirectTo: safeCallback(callbackUrl) });
}

/** People who signed in with Google/Microsoft but don't have a company yet name it here. */
export async function createMyCompanyAction(orgName: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in first" };
  const name = orgName.trim();
  if (name.length < 2) return { ok: false, error: "Enter your company name", fieldErrors: { orgName: "Enter your company name" } };
  if (await adminDb.membership.count({ where: { userId: session.user.id, deletedAt: null } })) redirect("/app/overview");
  const { orgId } = await provisionOrganization(adminDb, { name, ownerUserId: session.user.id });
  (await cookies()).set(ORG_COOKIE, orgId, cookieOptions());
  redirect("/app/setup");
}
