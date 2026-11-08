"use server";

import type { Prisma } from "@prisma/client";
import { adminDb } from "@/server/db";
import { auth } from "@/server/auth";

const ALLOWED = new Set(["sidebarCollapsed", "checklistDismissed", "checklistDone", "dashboard", "setupDone", "welcomeDismissed"]);

/** Per-user UI preferences (global to the user, not tenant data). */
export async function setPreference(key: string, value: Prisma.InputJsonValue): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !ALLOWED.has(key)) return;
  const u = await adminDb.user.findUnique({ where: { id: session.user.id }, select: { preferences: true } });
  const prefs = { ...((u?.preferences ?? {}) as Record<string, Prisma.InputJsonValue>), [key]: value };
  await adminDb.user.update({ where: { id: session.user.id }, data: { preferences: prefs } });
}
