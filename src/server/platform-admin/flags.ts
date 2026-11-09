import { adminDb } from "@/server/db";

/** Feature switches set in the owner console (/admin → Feature switches). */
/** Known switches (others can be added from /admin). Default when no row exists. */
export const FLAGS: Record<string, { label: string; default: boolean }> = {
  sms: { label: "Text messages (SMS)", default: true },
  ai: { label: "AI helper", default: true },
  bankFeeds: { label: "Bank feeds", default: true },
  landRecords: { label: "Land records lookups", default: true },
  api: { label: "Public API", default: true },
};

/** Per-company row wins over the global row, which wins over the default. */
export async function flagEnabled(key: string, orgId: string | null): Promise<boolean> {
  const rows = await adminDb.featureFlag.findMany({ where: { key, OR: [{ orgId: null }, ...(orgId ? [{ orgId }] : [])] } });
  const own = rows.find((r) => r.orgId === orgId && orgId);
  const global = rows.find((r) => r.orgId === null);
  return own?.enabled ?? global?.enabled ?? FLAGS[key]?.default ?? false;
}

