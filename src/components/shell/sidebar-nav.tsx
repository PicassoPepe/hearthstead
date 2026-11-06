"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV_BOTTOM, NAV_MAIN, sectionForPath, type NavSection } from "@/lib/nav";
import { can } from "@/server/permissions";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { NAV_ICONS } from "./icons";
import { useShell } from "./shell-context";
import { setPreference } from "@/server/actions/preferences";

function isActive(pathname: string, href: string, exact = false): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

/**
 * Two-level sidebar. Entering a section with children swaps the list to that section's
 * submenu with a "← Section" header. Collapsible to icons (preference saved per user).
 */
export function SidebarNav({ onNavigate, forceExpanded = false }: { onNavigate?: () => void; forceExpanded?: boolean }) {
  const pathname = usePathname();
  const shell = useShell();
  const [collapsedPref, setCollapsedPref] = React.useState(shell.sidebarCollapsed);
  const collapsed = forceExpanded ? false : collapsedPref;

  const visible = (s: NavSection) => !s.module || can(shell.permissions, s.module, "view");
  const main = NAV_MAIN.filter(visible);
  const bottom = NAV_BOTTOM.filter((s) => s.id !== "settings" || can(shell.permissions, "settings", "view") || can(shell.permissions, "users", "view"));

  const routeSection = sectionForPath(pathname);
  // `browsing` lets the user pop back to the top-level list without navigating away.
  const [browsingTop, setBrowsingTop] = React.useState(false);
  React.useEffect(() => setBrowsingTop(false), [pathname]);
  const sub = !collapsed && !browsingTop && routeSection?.children ? routeSection : undefined;

  const toggleCollapsed = () => {
    const next = !collapsedPref;
    setCollapsedPref(next);
    void setPreference("sidebarCollapsed", next);
  };

  const linkCls = (active: boolean) =>
    cn(
      "group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors",
      active ? "bg-primary-soft text-primary-soft-foreground" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
      collapsed && "justify-center px-0",
    );

  const renderSection = (s: NavSection) => {
    const Icon = NAV_ICONS[s.icon];
    const active = routeSection?.id === s.id;
    const content = (
      <Link
        href={s.href}
        className={linkCls(active)}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          setBrowsingTop(false);
          onNavigate?.();
        }}
      >
        <Icon className="size-[18px] shrink-0" aria-hidden />
        {collapsed ? <span className="sr-only">{s.label}</span> : <span className="flex-1 truncate">{s.label}</span>}
        {!collapsed && s.children ? <ChevronRight className="size-4 opacity-60" aria-hidden /> : null}
      </Link>
    );
    return <li key={s.id}>{collapsed ? <Tooltip content={s.label}>{content}</Tooltip> : content}</li>;
  };

  return (
    <nav aria-label="Main" className={cn("flex h-full flex-col border-r border-border bg-surface", collapsed ? "w-[60px]" : "w-60")}>
      <div className={cn("flex h-14 items-center gap-2 border-b border-border px-3", collapsed && "justify-center px-0")}>
        <Link href="/app/overview" className="flex items-center gap-2 rounded-md" onClick={onNavigate}>
          <span aria-hidden className="flex size-7 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            H
          </span>
          {collapsed ? <span className="sr-only">Hearthstead home</span> : <span className="text-[15px] font-semibold tracking-tight">Hearthstead</span>}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {sub ? (
          <div>
            <button
              type="button"
              onClick={() => setBrowsingTop(true)}
              className="mb-2 flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[13.5px] font-semibold text-foreground hover:bg-surface-muted"
            >
              <ArrowLeft className="size-4" aria-hidden />
              <span>{sub.label}</span>
              <span className="sr-only">— back to all sections</span>
            </button>
            <ul className="space-y-0.5" aria-label={`${sub.label} pages`}>
              {sub.children!.map((c) => {
                const best = sub.children!
                  .filter((o) => isActive(pathname, o.href))
                  .sort((a, b) => b.href.length - a.href.length)[0];
                const active = best?.href === c.href;
                return (
                  <li key={c.href}>
                    <Link href={c.href} className={linkCls(active)} aria-current={active ? "page" : undefined} onClick={onNavigate}>
                      <span className="flex-1 truncate">{c.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <ul className="space-y-0.5">{main.map(renderSection)}</ul>
        )}
      </div>

      <div className="border-t border-border p-2">
        <ul className="space-y-0.5">{bottom.map(renderSection)}</ul>
        {!forceExpanded ? (
          <button
            type="button"
            onClick={toggleCollapsed}
            className={cn(linkCls(false), "mt-1 w-full")}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen className="size-[18px]" aria-hidden /> : <PanelLeftClose className="size-[18px]" aria-hidden />}
            {!collapsed ? <span className="flex-1 text-left">Collapse</span> : null}
          </button>
        ) : null}
      </div>
    </nav>
  );
}
