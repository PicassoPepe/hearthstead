import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { oauthProviders } from "@/server/auth/oauth";
import { captchaSiteKey } from "@/server/auth/captcha";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  Verification: "That sign-in link has expired or was already used. Request a new one.",
  "2fa_password": "This account uses two-factor authentication. Sign in with your password and authenticator code.",
  AccessDenied: "We couldn't find an account for that email.",
  OAuthAccountNotLinked: "That email already has a DeedWood account. Sign in with your password, then you can use Google next time.",
  Configuration: "Sign-in is temporarily unavailable.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <LoginForm
      defaultEmail={sp.email ?? ""}
      invited={sp.invited === "1"}
      portal={sp.portal === "1"}
      callbackUrl={toPath(sp.callbackUrl)}
      error={sp.error ? (ERRORS[sp.error] ?? "Sign-in failed. Please try again.") : undefined}
      oauth={oauthProviders()}
      captchaSiteKey={captchaSiteKey()}
    />
  );
}

/** Auth.js passes an absolute callbackUrl; keep only same-origin paths. */
function toPath(url: string | undefined): string {
  if (!url) return "/app/overview";
  try {
    const u = new URL(url, "http://local");
    return u.pathname.startsWith("/") && !u.pathname.startsWith("//") ? u.pathname + u.search : "/app/overview";
  } catch {
    return "/app/overview";
  }
}
