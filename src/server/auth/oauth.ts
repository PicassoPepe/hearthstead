/** "Sign in with …" buttons appear only for providers whose keys are set (see docs/LAUNCH.md). */
export type OAuthProvider = { id: "google" | "microsoft-entra-id"; label: string };
export function oauthProviders(): OAuthProvider[] {
  const out: OAuthProvider[] = [];
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) out.push({ id: "google", label: "Google" });
  if (process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET) out.push({ id: "microsoft-entra-id", label: "Microsoft" });
  return out;
}
