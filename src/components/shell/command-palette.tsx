"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { useTheme } from "next-themes";
import { ArrowRight, Building2, Loader2, LogOut, Moon, Plus, Search, Settings, Sun, User, FileText, Repeat } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/misc";
import { CREATE_MENU, NAV_BOTTOM, NAV_MAIN, SETTINGS_NAV } from "@/lib/nav";
import { can } from "@/server/permissions";
import { useShell } from "./shell-context";
import { NAV_ICONS } from "./icons";
import { signOutAction, switchOrganization } from "@/server/actions/auth";
import type { SearchResult } from "@/server/search/types";

const ENTITY_ICON: Record<string, typeof User> = { user: User, setting: Settings, property: Building2, document: FileText };

export const OPEN_PALETTE_EVENT = "hs:open-command-palette";

/** Global Cmd/Ctrl+K palette: navigate, create, run actions and search every entity. */
export function CommandPalette() {
  const router = useRouter();
  const shell = useShell();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Debounced server search across entities.
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) setResults(((await res.json()) as { results: SearchResult[] }).results);
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const nav = [...NAV_MAIN, ...NAV_BOTTOM].filter((s) => !s.module || can(shell.permissions, s.module, "view"));
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.group] ??= []).push(r);
    return acc;
  }, {});

  const itemCls =
    "flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-sm aria-selected:bg-surface-muted data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground";
  const groupCls =
    "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent hideClose className="top-[12vh] max-w-xl translate-y-0 overflow-hidden p-0" aria-describedby="cmdk-desc">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription id="cmdk-desc" className="sr-only">
          Search properties, people and settings, jump to a page, or create something new.
        </DialogDescription>
        <Command label="Command palette" shouldFilter className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3">
            {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden /> : <Search className="size-4 text-muted-foreground" aria-hidden />}
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search or type a command…"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <Kbd>Esc</Kbd>
          </div>
          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">{loading ? "Searching…" : "No matches."}</Command.Empty>

            {Object.entries(grouped).map(([group, items]) => (
              <Command.Group key={group} heading={group} className={groupCls}>
                {items.map((r) => {
                  const Icon = ENTITY_ICON[r.type] ?? ArrowRight;
                  return (
                    <Command.Item key={r.id} value={`${r.title} ${r.subtitle ?? ""} ${r.id}`} onSelect={() => go(r.href)} className={itemCls}>
                      <Icon aria-hidden />
                      <span className="flex-1 truncate">{r.title}</span>
                      {r.subtitle ? <span className="truncate text-xs text-muted-foreground">{r.subtitle}</span> : null}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ))}

            <Command.Group heading="Go to" className={groupCls}>
              {nav.map((s) => {
                const Icon = NAV_ICONS[s.icon];
                return (
                  <Command.Item key={s.id} value={`go ${s.label}`} onSelect={() => go(s.href)} className={itemCls}>
                    <Icon aria-hidden />
                    {s.label}
                  </Command.Item>
                );
              })}
              {nav.flatMap((s) =>
                (s.id === "settings" ? SETTINGS_NAV : (s.children ?? [])).filter((c) => c.href !== s.href).map((c) => (
                  <Command.Item key={`${s.id}-${c.href}`} value={`go ${s.label} ${c.label} ${(c.keywords ?? []).join(" ")}`} onSelect={() => go(c.href)} className={itemCls}>
                    <ArrowRight aria-hidden />
                    <span className="text-muted-foreground">{s.label} /</span> {c.label}
                  </Command.Item>
                )),
              )}
            </Command.Group>

            <Command.Group heading="Create" className={groupCls}>
              {CREATE_MENU.flatMap((g) =>
                g.items
                  .filter((i) => can(shell.permissions, i.module, "edit"))
                  .map((i) => (
                    <Command.Item key={i.kind} value={`create new ${i.label}`} onSelect={() => go(`/app/new/${i.kind}`)} className={itemCls}>
                      <Plus aria-hidden />
                      New {i.label.toLowerCase()}
                    </Command.Item>
                  )),
              )}
            </Command.Group>

            <Command.Group heading="Actions" className={groupCls}>
              <Command.Item value="toggle theme dark light mode" onSelect={() => { setTheme(resolvedTheme === "dark" ? "light" : "dark"); setOpen(false); }} className={itemCls}>
                {resolvedTheme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
                Switch to {resolvedTheme === "dark" ? "light" : "dark"} mode
              </Command.Item>
              {shell.orgs
                .filter((o) => o.id !== shell.org.id)
                .map((o) => (
                  <Command.Item
                    key={o.id}
                    value={`switch organization ${o.name}`}
                    onSelect={async () => {
                      setOpen(false);
                      await switchOrganization(o.id);
                      router.push("/app/overview");
                      router.refresh();
                    }}
                    className={itemCls}
                  >
                    <Repeat aria-hidden />
                    Switch to {o.name}
                  </Command.Item>
                ))}
              <Command.Item value="sign out log out" onSelect={() => void signOutAction()} className={itemCls}>
                <LogOut aria-hidden />
                Sign out
              </Command.Item>
            </Command.Group>
          </Command.List>
          <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate</span>
            <span><Kbd>Enter</Kbd> open</span>
            <span className="ml-auto"><Kbd>⌘</Kbd> <Kbd>K</Kbd> toggle</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
