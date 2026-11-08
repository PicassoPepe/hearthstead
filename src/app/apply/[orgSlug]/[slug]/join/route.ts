import { NextResponse, type NextRequest } from "next/server";
import { publicOrg } from "@/server/public/listings";
import { claimJoinToken } from "@/server/funnel/applications";
import { APPLY_COOKIE } from "@/lib/funnel";

/** Co-applicant / guarantor invitation link: claim the token into the apply cookie, then open the form. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ orgSlug: string; slug: string }> }) {
  const { orgSlug, slug } = await params;
  const o = await publicOrg(orgSlug);
  const t = req.nextUrl.searchParams.get("t");
  const r = o && t ? await claimJoinToken(o.db, t) : null;
  if (!r) return NextResponse.redirect(new URL(`/apply/${orgSlug}/${slug}?expired=1`, req.url));
  const res = NextResponse.redirect(new URL(`/apply/${orgSlug}/${slug}/form`, req.url));
  res.cookies.set(APPLY_COOKIE, r.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/apply", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
