import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  Verification: "That sign-in link has expired or was already used. Request a new one.",
  AccessDenied: "We couldn't find an account for that email.",
  Configuration: "Sign-in is temporarily unavailable.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <LoginForm
      defaultEmail={sp.email ?? ""}
      invited={sp.invited === "1"}
      callbackUrl={toPath(sp.callbackUrl)}
      error={sp.error ? (ERRORS[sp.error] ?? "Sign-in failed. Please try again.") : undefined}
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
