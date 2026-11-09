/**
 * One place for the cookies DeedWood sets itself (Auth.js manages its own session cookies).
 *
 * Every cookie is httpOnly + SameSite=Lax. `secure` follows the address people use:
 * - hosted (AUTH_URL is https://…) → secure, so the cookie never travels over plain http;
 * - the one-click local install (AUTH_URL is http://127.0.0.1:…) → not secure, because the
 *   browser would otherwise drop it and nobody could sign in;
 * - no AUTH_URL → secure in production, not in development.
 */
type Env = { AUTH_URL?: string; NODE_ENV?: string };

export function shouldUseSecureCookies(env: Env = process.env): boolean {
  const url = env.AUTH_URL ?? "";
  if (url.startsWith("https://")) return true;
  if (url.startsWith("http://")) return false;
  return env.NODE_ENV === "production";
}

export type CookieOptions = { httpOnly: true; sameSite: "lax" | "strict"; secure: boolean; path: string; maxAge?: number };

export function cookieOptions(o: { path?: string; maxAge?: number; sameSite?: "lax" | "strict" } = {}, env: Env = process.env): CookieOptions {
  return { httpOnly: true, sameSite: o.sameSite ?? "lax", secure: shouldUseSecureCookies(env), path: o.path ?? "/", ...(o.maxAge ? { maxAge: o.maxAge } : {}) };
}
