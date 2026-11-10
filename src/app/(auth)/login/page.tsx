import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { oauthProviders } from "@/server/auth/oauth";
import { captchaSiteKey } from "@/server/auth/captcha";
import { LOGIN_COPY, loginAudience } from "@/lib/login-audience";

const ERRORS: Record<string, string> = {
  Verification: "That sign-in link has expired or was already used. Request a new one.",
  "2fa_password": "This account uses two-factor authentication. Sign in with your password and authenticator code.",
  AccessDenied: "We couldn't find an account for that email.",
  OAuthAccountNotLinked: "That email already has a DeedWood account. Sign in with your password, then you can use Google next time.",
  Configuration: "Sign-in is temporarily unavailable.",
};

export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }): Promise<Metadata> {
  const sp = await searchParams;
  const title = LOGIN_COPY[loginAudience({ portal: sp.portal, invited: sp.invited, callbackUrl: toPath(sp.callbackUrl) })].title;
  return { title: title === "Welcome back" ? "Sign in" : title };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const callbackUrl = toPath(sp.callbackUrl);
  return (
    <LoginForm
      defaultEmail={sp.email ?? ""}
      audience={loginAudience({ portal: sp.portal, invited: sp.invited, callbackUrl })}
      callbackUrl={callbackUrl}
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
