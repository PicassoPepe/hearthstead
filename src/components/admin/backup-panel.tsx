"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, HardDriveDownload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { backupNowAction } from "@/server/actions/backups";

type Run = { id: string; at: string; kb: number; rows: number; ok: boolean; error: string | null; encrypted: boolean };

export function BackupPanel({ runs }: { runs: Run[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="grid gap-3">
      <div><Button loading={busy} onClick={async () => { setBusy(true); const r = await backupNowAction(); setBusy(false); if (!r.ok) return void toast.error(r.error); toast.success(`Backup saved (${r.data.kb} KB)`); router.refresh(); }}><HardDriveDownload aria-hidden /> Back up now</Button></div>
      {runs.length ? (
        <ul className="divide-y divide-border rounded-card border border-border bg-surface text-sm" data-testid="backup-list">
          {runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>{new Date(r.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} {r.ok ? <span className="text-muted-foreground">· {r.kb} KB · {r.rows.toLocaleString()} rows{r.encrypted ? " · encrypted" : ""}</span> : <Badge tone="danger">Failed: {r.error}</Badge>}</span>
              {r.ok ? <a href={`/api/backups/${r.id}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><Download className="size-4" aria-hidden /> Download</a> : null}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">No backups yet. One is made automatically every night.</p>}
    </div>
  );
}
