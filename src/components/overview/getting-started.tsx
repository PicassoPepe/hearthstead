"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Circle, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { setPreference } from "@/server/actions/preferences";

export type ChecklistItem = { id: string; label: string; description: string; href: string; done: boolean; phase?: number };

export function GettingStarted({ items }: { items: ChecklistItem[] }) {
  const [hidden, setHidden] = React.useState(false);
  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / items.length) * 100);
  if (hidden) return null;
  return (
    <Card className="mb-6">
      <CardHeader>
        <div>
          <CardTitle>Getting started</CardTitle>
          <CardDescription>
            {done} of {items.length} complete. None of these are required. <Link href="/app/setup" className="font-medium text-primary underline-offset-4 hover:underline">Open setup guide</Link>
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Hide getting started checklist"
          onClick={async () => {
            setHidden(true);
            await setPreference("checklistDismissed", true);
            toast("Checklist hidden", {
              action: {
                label: "Undo",
                onClick: async () => {
                  setHidden(false);
                  await setPreference("checklistDismissed", false);
                },
              },
            });
          }}
        >
          <X aria-hidden />
        </Button>
      </CardHeader>
      <CardContent>
        <div
          className="mb-4 h-2 w-full overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((i) => (
            <li key={i.id}>
              <Link
                href={i.href}
                className="flex h-full items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:border-border-strong hover:bg-surface-muted/50"
              >
                {i.done ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                ) : (
                  <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className={i.done ? "font-medium text-muted-foreground line-through" : "font-medium"}>{i.label}</span>
                  <span className="sr-only">{i.done ? " (done)" : " (to do)"}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {i.description}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
