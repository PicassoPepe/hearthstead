"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, ImageIcon, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileDropzone } from "@/components/records/files-panel";
import { addPhotosAction, setPhotosAction } from "@/server/actions/images";
import { cn } from "@/lib/utils";

const url = (id: string) => `/api/images/${id}`;

/**
 * Photo gallery with upload (drag & drop or browse), reorder, set-as-cover and delete.
 * The first photo is the cover used on cards, the public listing site and the listing feed.
 */
export function PhotoGallery({ kind, id, photos, canEdit, inherited }: { kind: "property" | "unit"; id: string; photos: string[]; canEdit: boolean; inherited?: string[] }) {
  const router = useRouter();
  const [list, setList] = React.useState(photos);
  const [busy, setBusy] = React.useState(false);
  const [view, setView] = React.useState<number | null>(null);
  React.useEffect(() => setList(photos), [photos]);

  const upload = async (files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    setBusy(true);
    const r = await addPhotosAction(kind, id, fd);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`${r.data.count} photo${r.data.count === 1 ? "" : "s"} added`);
    router.refresh();
  };
  const save = async (next: string[], msg?: string) => {
    const prev = list;
    setList(next);
    const r = await setPhotosAction(kind, id, next);
    if (!r.ok) {
      setList(prev);
      return void toast.error(r.error);
    }
    if (msg) toast.success(msg);
    router.refresh();
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    void save(next);
  };

  const shown = list.length ? list : inherited ?? [];
  return (
    <section aria-label="Photos" className="grid gap-4">
      {canEdit ? <FileDropzone onFiles={upload} busy={busy} accept="image/png,image/jpeg,image/webp,image/gif" label="photos" hint="JPG, PNG, WebP or GIF · up to 8 MB each · the first photo is the cover" /> : null}
      {!list.length && inherited?.length ? <p className="text-sm text-muted-foreground">No unit photos yet — showing the property&apos;s photos.</p> : null}
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          <ImageIcon className="size-8" aria-hidden />
          No photos yet{canEdit ? " — add a few so listings and portals look their best." : "."}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="photo-grid">
          {shown.map((p, i) => {
            const own = list.length > 0;
            return (
              <li key={p} className="group relative overflow-hidden rounded-card border border-border bg-surface shadow-card">
                <button type="button" onClick={() => setView(i)} className="block aspect-[4/3] w-full" aria-label={`View photo ${i + 1}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url(p)} alt="" loading="lazy" className="size-full object-cover transition-transform group-hover:scale-[1.03]" />
                </button>
                {i === 0 && own ? <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">Cover</span> : null}
                {canEdit && own ? (
                  <div className="flex items-center justify-between gap-1 border-t border-border p-1.5">
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" aria-label={`Move photo ${i + 1} left`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowLeft aria-hidden /></Button>
                      <Button size="icon" variant="ghost" aria-label={`Move photo ${i + 1} right`} disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowRight aria-hidden /></Button>
                      {i > 0 ? <Button size="icon" variant="ghost" aria-label={`Make photo ${i + 1} the cover`} onClick={() => save([p, ...list.filter((x) => x !== p)], "Cover photo updated")}><Star aria-hidden /></Button> : null}
                    </div>
                    <Button size="icon" variant="ghost" aria-label={`Delete photo ${i + 1}`} onClick={() => save(list.filter((x) => x !== p), "Photo deleted")}><Trash2 aria-hidden /></Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {view !== null && shown[view] ? <Lightbox photos={shown} index={view} onIndex={setView} onClose={() => setView(null)} /> : null}
    </section>
  );
}

export function Lightbox({ photos, index, onIndex, onClose }: { photos: string[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onIndex((index + 1) % photos.length);
      if (e.key === "ArrowLeft") onIndex((index - 1 + photos.length) % photos.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, onClose, onIndex]);
  const src = photos[index]!.startsWith("/") ? photos[index]! : url(photos[index]!);
  return (
    <div role="dialog" aria-modal="true" aria-label={`Photo ${index + 1} of ${photos.length}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 fade-in" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="max-h-[85vh] max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
      <button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white hover:bg-white/25"><X aria-hidden /></button>
      {photos.length > 1 ? (
        <>
          <button type="button" aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + photos.length) % photos.length); }} className="absolute left-4 rounded-full bg-white/15 p-2 text-white hover:bg-white/25"><ChevronLeft aria-hidden /></button>
          <button type="button" aria-label="Next photo" onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % photos.length); }} className="absolute right-4 rounded-full bg-white/15 p-2 text-white hover:bg-white/25"><ChevronRight aria-hidden /></button>
        </>
      ) : null}
      <p className="absolute bottom-4 text-sm text-white/80">{index + 1} / {photos.length}</p>
    </div>
  );
}

/** Read-only strip of photos with a lightbox — for portals and public pages. Accepts full URLs. */
export function PhotoStrip({ urls, className }: { urls: string[]; className?: string }) {
  const [view, setView] = React.useState<number | null>(null);
  if (!urls.length) return null;
  return (
    <div className={cn("grid gap-2", className)}>
      <button type="button" onClick={() => setView(0)} className="block aspect-[16/9] w-full overflow-hidden rounded-card" aria-label="View photos">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={urls[0]} alt="" className="size-full object-cover" />
      </button>
      {urls.length > 1 ? (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {urls.slice(1, 13).map((u, i) => (
            <li key={u}>
              <button type="button" onClick={() => setView(i + 1)} className="block aspect-square w-full overflow-hidden rounded-lg" aria-label={`View photo ${i + 2}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" loading="lazy" className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {view !== null ? <Lightbox photos={urls} index={view} onIndex={setView} onClose={() => setView(null)} /> : null}
    </div>
  );
}
