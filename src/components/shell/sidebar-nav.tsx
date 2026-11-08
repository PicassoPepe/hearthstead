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

  const visible = (s: NavSection) => (!s.vendorOnly || shell.roleKey === "VENDOR") && (!s.module || can(shell.permissions, s.module, "view"));
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
      "group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors focus-visible:outline-sidebar-foreground",
      active
        ? "bg-sidebar-active text-sidebar-foreground before:absolute before:inset-y-1.5 before:-left-2 before:w-1 before:rounded-r before:bg-accent"
        : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground",
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
    <nav aria-label="Main" className={cn("flex h-full flex-col bg-sidebar text-sidebar-foreground", collapsed ? "w-[64px]" : "w-60")}>
      <div className={cn("flex h-14 items-center gap-2 border-b border-sidebar-border px-3", collapsed && "justify-center px-0")}>
        <Link href="/app/overview" className="flex min-w-0 items-center gap-2.5 rounded-md" onClick={onNavigate}>
          {shell.orgLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo served from our file route
            <img src={shell.orgLogoUrl} alt="" className="size-8 shrink-0 rounded-lg bg-white object-contain p-0.5" />
          ) : (
            <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-orange-500 font-display text-sm font-extrabold text-slate-950">
              {(shell.orgName || "H").slice(0, 1)}
            </span>
          )}
          {collapsed ? <span className="sr-only">{shell.orgName} home</span> : (
            <span className="min-w-0">
              <span className="block truncate font-display text-[14px] font-bold leading-tight">{shell.orgName || "Hearthstead"}</span>
              <span className="block text-[11px] text-sidebar-muted">Hearthstead</span>
            </span>
          )}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {sub ? (
          <div>
            <button
              type="button"
              onClick={() => setBrowsingTop(true)}
              className="mb-2 flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-[13.5px] font-semibold text-sidebar-foreground hover:bg-sidebar-hover"
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

      <div className="border-t border-sidebar-border p-2">
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
