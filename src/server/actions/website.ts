"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import * as S from "@/server/site/service";
import { storeImage } from "@/server/images/service";
import { clientIp, hit, RateLimited } from "@/server/auth/rate-limit";
import type { SiteContent } from "@/lib/site/blocks";

/** Website editing needs settings-level access (it's the company's public face). */
const editor = () => requirePermission("settings", "edit");
const refresh = (slug: string) => { revalidatePath("/app/website"); revalidatePath(`/s/${slug}`); };

export async function saveSiteDraftAction(content: SiteContent): Promise<ActionResult<SiteContent>> {
  return runAction(async () => {
    const ctx = await editor();
    return S.saveDraft(ctx.db, content);
  });
}

export async function applySiteTemplateAction(key: string): Promise<ActionResult<SiteContent>> {
  return runAction(async () => {
    const ctx = await editor();
    return S.applyTemplate(ctx.db, key);
  }, "Design applied — press Publish when you're happy");
}

export async function publishSiteAction(note?: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await editor();
    await S.publish(ctx.db, note);
    refresh(ctx.org.slug);
  }, "Your website is published");
}

export async function restoreSiteVersionAction(versionId: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await editor();
    await S.restoreVersion(ctx.db, versionId);
    refresh(ctx.org.slug);
  }, "That version is back on your website");
}

export async function setSiteLiveAction(live: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await editor();
    await S.setLive(ctx.db, live);
    refresh(ctx.org.slug);
  }, live ? "Your website is visible again" : "Your website is hidden — nothing was deleted");
}

export async function setSiteDomainAction(domain: string | null): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await editor();
    await S.setCustomDomain(ctx.db, domain);
    refresh(ctx.org.slug);
  }, domain ? "Domain saved — follow the DNS steps below" : "Domain removed");
}

export async function uploadSiteImageAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await editor();
    const f = form.get("file");
    if (!(f instanceof File) || !f.size) throw new UserFacingError("Choose a photo");
    return { id: await storeImage(ctx.db, f, "SitePhoto", null) };
  });
}

// ─── Visitors ──────────────────────────────────────────────────────────────────

const msg = z.object({
  kind: z.enum(["contact", "tour"]),
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: z.string().trim().max(200).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email").default(""),
  phone: z.string().trim().max(30).default(""),
  message: z.string().trim().min(2, "Write a short message").max(2000),
  when: z.string().trim().max(120).optional(),
  /** Honeypot: people never see this field; bots fill it in. */
  website: z.string().max(0).optional(),
});

export async function sendSiteMessageAction(orgSlug: string, raw: z.input<typeof msg>): Promise<ActionResult> {
  return runAction(async () => {
    const h = await headers();
    const ip = clientIp(h);
    try {
      await hit("magicIp", `site:${ip}`);
    } catch (e) {
      if (e instanceof RateLimited) throw new UserFacingError("Thanks — we already got a few messages from you. Please try again later or call us.");
      throw e;
    }
    const v = msg.parse(raw);
    await S.receiveWebsiteMessage(orgSlug, v);
  }, "Thanks! We'll get back to you soon.");
}
