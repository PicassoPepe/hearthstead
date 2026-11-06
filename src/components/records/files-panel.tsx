"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileText, ImageIcon, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deleteFile, uploadFiles } from "@/server/actions/records";

export type FileView = { id: string; name: string; contentType: string; size: string; uploadedAt: string; author: string; linkedTo?: { label: string; href: string } | null };
const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Keyboard-accessible dropzone: a real file input behind a styled label, plus drag & drop. */
export function FileDropzone({ onFiles, busy, accept }: { onFiles: (files: File[]) => void; busy?: boolean; accept?: string }) {
  const [over, setOver] = React.useState(false);
  const id = React.useId();
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(files);
      }}
      className={cn("rounded-card border-2 border-dashed p-6 text-center transition-colors", over ? "border-primary bg-primary-soft/40" : "border-border-strong")}
    >
      <UploadCloud className="mx-auto mb-2 size-6 text-muted-foreground" aria-hidden />
      <p className="text-sm">
        Drag files here, or{" "}
        <label htmlFor={id} className="cursor-pointer font-semibold text-primary underline-offset-4 hover:underline focus-within:underline">
          browse
          <input
            id={id}
            type="file"
            multiple
            accept={accept}
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) onFiles(files);
            }}
          />
        </label>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">PDF, images, Word, Excel or CSV · up to 10 MB each</p>
      {busy ? <p role="status" className="mt-2 text-xs font-medium">Uploading…</p> : null}
    </div>
  );
}

export function FilesPanel({ entityType, entityId, files, canEdit }: { entityType?: string; entityId?: string; files: FileView[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const upload = async (list: File[]) => {
    const fd = new FormData();
    for (const f of list) fd.append("files", f);
    if (entityType && entityId) {
      fd.append("entityType", entityType);
      fd.append("entityId", entityId);
    }
    setBusy(true);
    const r = await uploadFiles(fd);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`${list.length} file${list.length === 1 ? "" : "s"} uploaded`);
    router.refresh();
  };
  return (
    <div className="grid gap-4">
      {canEdit ? <FileDropzone onFiles={upload} busy={busy} /> : null}
      {files.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">No files yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-card border border-border bg-surface">
          {files.map((f) => {
            const Icon = f.contentType.startsWith("image/") ? ImageIcon : FileText;
            return (
              <li key={f.id} className="flex items-center gap-3 px-4 py-3">
                <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <a href={`/api/files/${f.id}`} target="_blank" rel="noopener" className="block truncate text-sm font-medium hover:underline">{f.name}</a>
                  <div className="text-xs text-muted-foreground">
                    {f.size} · {fmt.format(new Date(f.uploadedAt))} · {f.author}
                    {f.linkedTo ? <> · <a className="underline" href={f.linkedTo.href}>{f.linkedTo.label}</a></> : null}
                  </div>
                </div>
                <Button asChild variant="ghost" size="icon-sm" aria-label={`Download ${f.name}`}>
                  <a href={`/api/files/${f.id}?download=1`}><Download aria-hidden /></a>
                </Button>
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${f.name}`}
                    onClick={async () => {
                      const r = await deleteFile(f.id);
                      if (!r.ok) return void toast.error(r.error);
                      router.refresh();
                      toast.success(`${f.name} deleted`, { action: { label: "Undo", onClick: async () => { await deleteFile(f.id, false); router.refresh(); } } });
                    }}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
