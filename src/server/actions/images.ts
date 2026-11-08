"use server";

import { revalidatePath } from "next/cache";
import { requireContext, requirePermission } from "@/server/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import * as IMG from "@/server/images/service";

/** Upload/arrange photos and logos. FormData field "files" (or "file"). */
const filesFrom = (form: FormData, key = "files") => form.getAll(key).filter((f): f is File => f instanceof File && f.size > 0);

export async function addPhotosAction(kind: "property" | "unit", id: string, form: FormData): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const ctx = await requirePermission("rentals", "edit");
    const ids = await IMG.addPhotos(ctx.db, { kind, id }, filesFrom(form));
    revalidatePath("/app/rentals", "layout");
    return { count: ids.length };
  });
}

export async function setPhotosAction(kind: "property" | "unit", id: string, photos: string[]): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("rentals", "edit");
    await IMG.setPhotos(ctx.db, { kind, id }, photos);
    revalidatePath("/app/rentals", "layout");
  }, "Photos updated");
}

export async function setLogoAction(form: FormData | null): Promise<ActionResult<{ url: string | null }>> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit");
    const file = form ? filesFrom(form, "file")[0] ?? null : null;
    if (form && !file) throw new UserFacingError("Choose an image");
    const url = await IMG.setOrgLogo(ctx.db, file);
    revalidatePath("/", "layout");
    return { url };
  }, form ? "Logo updated" : "Logo removed");
}

export async function setAvatarAction(form: FormData | null): Promise<ActionResult<{ url: string | null }>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const file = form ? filesFrom(form, "file")[0] ?? null : null;
    if (form && !file) throw new UserFacingError("Choose an image");
    const url = await IMG.setAvatar(ctx.db, ctx.user.id, file);
    revalidatePath("/", "layout");
    return { url };
  }, form ? "Profile photo updated" : "Profile photo removed");
}
