"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Check, ChevronsUpDown, HelpCircle, LogOut, Menu, Moon, Search, Sun, UserCog, Keyboard, BookOpen, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, Kbd } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateNewMenu } from "./create-new-menu";
import { NotificationBell } from "./notification-bell";
import { OPEN_PALETTE_EVENT } from "./command-palette";
import { useShell } from "./shell-context";
import { signOutAction, switchOrganization } from "@/server/actions/auth";

export function TopBar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const shell = useShell();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <header className="sticky top-0 z-30 flex h-14 print:hidden items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur sm:px-4">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onOpenMobileNav} aria-label="Open navigation">
        <Menu aria-hidden />
      </Button>

      <CreateNewMenu />

      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface-muted/60 px-3 text-left text-sm text-muted-foreground hover:border-border-strong sm:max-w-md"
        aria-label="Search everything (Command K)"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="truncate">Search properties, people, settings…</span>
        <span className="ml-auto hidden items-center gap-1 sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="ml-auto flex items-center gap-1">
        {shell.org.sandbox ? <Badge tone="warning">Sandbox</Badge> : null}

        <NotificationBell initialUnread={shell.unreadNotifications} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Help">
              <HelpCircle aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href="/app/help"><BookOpen aria-hidden /> Help center</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/app/setup"><Rocket aria-hidden /> Setup guide</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}>
              <Keyboard aria-hidden /> Keyboard shortcuts
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-surface-muted" aria-label={`Account menu for ${shell.user.name ?? shell.user.email}`}>
              <Avatar name={shell.user.name ?? shell.user.email} src={shell.userImage} />
              <span className="hidden max-w-36 text-left lg:block">
                <span className="block truncate text-[13px] font-medium leading-tight">{shell.user.name ?? shell.user.email}</span>
                <span className="block truncate text-xs leading-tight text-muted-foreground">{shell.org.name}</span>
              </span>
              <ChevronsUpDown className="hidden size-4 text-muted-foreground lg:block" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <div className="px-2 py-2">
              <div className="truncate text-sm font-medium">{shell.user.name}</div>
              <div className="truncate text-xs text-muted-foreground">{shell.user.email}</div>
              <div className="mt-1 text-xs text-muted-foreground">{shell.roleName} · {shell.org.name}</div>
            </div>
            <DropdownMenuSeparator />
            {shell.orgs.length > 1 ? (
              <>
                <DropdownMenuLabel>Organizations</DropdownMenuLabel>
                {shell.orgs.map((o) => (
                  <DropdownMenuItem
                    key={o.id}
                    onSelect={async () => {
                      if (o.id === shell.org.id) return;
                      await switchOrganization(o.id);
                      router.push("/app/overview");
                      router.refresh();
                    }}
                  >
                    {o.id === shell.org.id ? <Check aria-hidden /> : <span className="size-4" aria-hidden />}
                    <span className="truncate">{o.name}</span>
                    {o.id === shell.org.id ? <span className="sr-only">(current)</span> : null}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem asChild>
              <Link href="/app/settings/security"><UserCog aria-hidden /> Account & security</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
              {mounted && resolvedTheme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
              {mounted && resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOutAction()}>
              <LogOut aria-hidden /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
