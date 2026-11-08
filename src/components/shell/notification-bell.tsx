"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, CreditCard, FileSignature, MessageSquare, Sparkles, UserPlus, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { loadNotifications, markNotificationsRead, type NotificationView } from "@/server/actions/notifications";
import { cn } from "@/lib/utils";

const ICON: Record<string, typeof Bell> = { task: Wrench, message: MessageSquare, payment: CreditCard, application: UserPlus, signature: FileSignature, agent: Sparkles };

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Bell with unread badge. Loads on open and refreshes the count every minute. */
export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [unread, setUnread] = React.useState(initialUnread);
  const [items, setItems] = React.useState<NotificationView[] | null>(null);
  const refresh = React.useCallback(async () => {
    const r = await loadNotifications();
    setItems(r.items);
    setUnread(r.unread);
  }, []);
  React.useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  return (
    <DropdownMenu onOpenChange={(o) => { if (o) void refresh(); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className="relative">
          <Bell aria-hidden />
          {unread ? <span aria-hidden className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">{unread > 9 ? "9+" : unread}</span> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[22rem] max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unread ? (
            <button type="button" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={async () => {
              await markNotificationsRead();
              setUnread(0);
              setItems((x) => x?.map((n) => ({ ...n, read: true })) ?? null);
            }}><CheckCheck className="size-3.5" aria-hidden /> Mark all read</button>
          ) : null}
        </div>
        <DropdownMenuSeparator className="m-0" />
        <div className="max-h-[60vh] overflow-y-auto py-1" data-testid="notification-list">
          {items === null ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
          ) : (
            items.map((n) => {
              const Icon = ICON[n.kind] ?? Bell;
              return (
                <DropdownMenuItem key={n.id} className="items-start gap-3 rounded-none px-3 py-2.5" onSelect={async () => {
                  if (!n.read) {
                    void markNotificationsRead([n.id]);
                    setUnread((u) => Math.max(0, u - 1));
                  }
                  if (n.href) router.push(n.href);
                }}>
                  <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", n.read ? "bg-surface-muted text-muted-foreground" : "bg-primary-soft text-primary-soft-foreground")}><Icon className="size-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", n.read ? "text-muted-foreground" : "font-semibold")}>{n.title}{n.read ? "" : <span className="sr-only"> (unread)</span>}</span>
                    {n.body ? <span className="block truncate text-xs text-muted-foreground">{n.body}</span> : null}
                    <span className="block text-[11px] text-muted-foreground">{ago(n.createdAt)}</span>
                  </span>
                  {!n.read ? <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-primary" /> : null}
                </DropdownMenuItem>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
