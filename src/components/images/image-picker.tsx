"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageIcon, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/server/action-result";

/** Single image (logo, profile photo): preview, replace, remove. */
export function ImagePicker({ label, current, onUpload, onRemove, round, hint, disabled }: {
  label: string;
  current: string | null;
  onUpload: (fd: FormData) => Promise<ActionResult<{ url: string | null }>>;
  onRemove: () => Promise<ActionResult<{ url: string | null }>>;
  round?: boolean;
  hint?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [url, setUrl] = React.useState(current);
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();
  const run = async (p: Promise<ActionResult<{ url: string | null }>>) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    setUrl(r.data.url);
    toast.success(r.message ?? "Saved");
    router.refresh();
  };
  return (
    <div className="flex items-center gap-4">
      <div className={`flex size-20 shrink-0 items-center justify-center overflow-hidden border border-border bg-surface-muted ${round ? "rounded-full" : "rounded-card"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt={`Current ${label.toLowerCase()}`} className={`size-full ${round ? "object-cover" : "object-contain p-1"}`} /> : <ImageIcon className="size-7 text-muted-foreground" aria-hidden />}
      </div>
      <div className="grid gap-1.5">
        <div className="flex flex-wrap gap-2">
          <label htmlFor={id} className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium shadow-sm hover:bg-surface-muted focus-within:ring-2 focus-within:ring-ring ${disabled || busy ? "pointer-events-none opacity-60" : ""}`}>
            <Upload className="size-4" aria-hidden /> {url ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
            <input id={id} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" disabled={disabled || busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const fd = new FormData();
                fd.append("file", f);
                void run(onUpload(fd));
              }}
            />
          </label>
          {url ? <Button type="button" variant="ghost" disabled={disabled || busy} onClick={() => void run(onRemove())}><Trash2 aria-hidden /> Remove</Button> : null}
        </div>
        <p className="text-xs text-muted-foreground">{busy ? "Uploading…" : hint ?? "PNG, JPG, WebP or GIF · up to 8 MB"}</p>
      </div>
    </div>
  );
}
