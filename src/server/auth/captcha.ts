/**
 * Cloudflare Turnstile (free, privacy-friendly CAPTCHA). Switched on by setting both
 * TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY; until then the check is skipped (so local
 * installs and tests work without it).
 */
export const captchaSiteKey = () => (process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY ? process.env.TURNSTILE_SITE_KEY : null);

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
export function setCaptchaFetcher(f: Fetcher) { fetcher = f; }

/** True when the visitor passed the challenge (or CAPTCHA isn't switched on). */
export async function verifyCaptcha(token: string | null | undefined, ip?: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !process.env.TURNSTILE_SITE_KEY) return true;
  if (!token || token.length > 4096) return false;
  try {
    const body = new URLSearchParams({ secret, response: token, ...(ip && ip !== "local" ? { remoteip: ip } : {}) });
    const r = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const j = (await r.json()) as { success?: boolean };
    return j.success === true;
  } catch {
    return false; // fail closed: if we can't check, we don't let it through
  }
}

export const CAPTCHA_FAILED = "Please complete the “I'm human” check and try again.";
