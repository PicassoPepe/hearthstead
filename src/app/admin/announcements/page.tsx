import { requirePlatformPage } from "@/server/platform-admin/page";
import { adminDb } from "@/server/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnnouncementForm, EndAnnouncementButton } from "@/components/admin/admin-forms";

export const metadata = { title: "Announcements" };

export default async function AdminAnnouncements() {
  await requirePlatformPage();
  const list = await adminDb.platformAnnouncement.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  const now = new Date();
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Announcements</h1>
      <p className="text-sm text-muted-foreground">A notice at the top of the staff app — for planned maintenance, new features or important changes.</p>
      <Card><CardHeader><CardTitle>New announcement</CardTitle></CardHeader><CardContent><AnnouncementForm /></CardContent></Card>
      <ul className="grid gap-2">
        {list.map((a) => {
          const live = !a.deletedAt && a.startsAt <= now && (!a.endsAt || a.endsAt > now);
          return (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 rounded-card border border-border bg-surface p-3 text-sm shadow-card">
              <div><p className="font-medium">{a.title} {live ? <Badge tone="success">Showing</Badge> : <Badge>Ended</Badge>} {a.level === "WARNING" ? <Badge tone="warning">Important</Badge> : null}</p><p className="text-muted-foreground">{a.body}</p><p className="text-xs text-muted-foreground">{a.orgIds.length ? `${a.orgIds.length} compan${a.orgIds.length === 1 ? "y" : "ies"}` : "Every company"} · {a.createdAt.toISOString().slice(0, 10)}{a.endsAt ? ` → ${a.endsAt.toISOString().slice(0, 10)}` : ""}</p></div>
              {live ? <EndAnnouncementButton id={a.id} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
