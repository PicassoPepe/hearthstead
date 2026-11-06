"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { StickyNote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Avatar } from "@/components/ui/misc";
import { createNote, deleteNote } from "@/server/actions/records";

export type NoteView = { id: string; body: string; author: string; createdAt: string; mine: boolean };
const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function NotesPanel({ entityType, entityId, notes, canEdit }: { entityType: string; entityId: string; notes: NoteView[]; canEdit: boolean }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <section aria-label="Notes">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center rounded-card border border-dashed border-border-strong px-6 py-10 text-center">
            <StickyNote className="mb-2 size-5 text-muted-foreground" aria-hidden />
            <p className="font-medium">No notes yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Capture gate codes, owner preferences, or anything your team should know.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="rounded-card border border-border bg-surface p-4">
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Avatar name={n.author} className="size-6 text-[10px]" />
                  <span className="font-medium text-foreground">{n.author}</span>
                  <time dateTime={n.createdAt}>{fmt.format(new Date(n.createdAt))}</time>
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto size-7"
                      aria-label="Delete note"
                      onClick={async () => {
                        const r = await deleteNote(n.id);
                        if (!r.ok) return void toast.error(r.error);
                        router.refresh();
                        toast.success("Note deleted", {
                          action: { label: "Undo", onClick: async () => { await deleteNote(n.id, false); router.refresh(); } },
                        });
                      }}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </div>
                <p className="whitespace-pre-wrap text-sm">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {canEdit ? (
        <form
          className="h-fit rounded-card border border-border bg-surface p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const r = await createNote(entityType, entityId, body);
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            setBody("");
            toast.success("Note added");
            router.refresh();
          }}
        >
          <label htmlFor="new-note" className="text-sm font-medium">Add a note</label>
          <Textarea id="new-note" className="mt-1.5 min-h-28" value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} />
          <Button type="submit" className="mt-3 w-full" loading={busy} disabled={!body.trim()}>Save note</Button>
        </form>
      ) : null}
    </div>
  );
}
