import "server-only";
import { notFound, redirect } from "next/navigation";
import { PlatformAccessError, type PlatformCtx } from "./service";
import { getPlatformCtx } from "./access";

/** For /admin pages: the platform owner, or sign-in / two-factor setup / 404 for everyone else. */
export async function requirePlatformPage(opts: { allowNoMfa?: boolean } = {}): Promise<PlatformCtx> {
  try {
    return await getPlatformCtx(opts);
  } catch (e) {
    if (!(e instanceof PlatformAccessError)) throw e;
    if (e.reason === "signed_out") redirect("/login?callbackUrl=/admin");
    if (e.reason === "mfa_required") redirect("/admin/setup");
    notFound();
  }
}
