"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as D from "@radix-ui/react-dialog";
import { CalendarDays, CreditCard, FileSignature, Home, ListChecks, Menu, MessagesSquare, Plus, Receipt, Wrench, X, Building2, ClipboardCheck } from "lucide-react";
import { can } from "@/server/permissions";
import { useShell } from "./shell-context";
import { cn } from "@/lib/utils";

/**
 * Phone navigation for staff: four destinations + a central "+" that opens quick actions.
 * "Menu" opens the full sidebar drawer. Hidden from tablet width up.
 */
export function MobileTabBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const shell = useShell();
  const path = usePathname();
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => setOpen(false), [path]);
  const vendor = shell.roleKey === "VENDOR";
  const perm = (m: Parameters<typeof can>[1], l: "view" | "edit" = "view") => can(shell.permissions, m, l);

  const tabs = vendor
    ? [
        { href: "/app/tasks", label: "Work orders", icon: ListChecks },
        { href: "/app/invoices", label: "Invoices", icon: Receipt },
      ]
    : [
        { href: "/app/overview", label: "Home", icon: Home },
        ...(perm("tasks") ? [{ href: "/app/tasks", label: "Repairs", icon: Wrench }] : []),
        ...(perm("communications") ? [{ href: "/app/communications", label: "Messages", icon: MessagesSquare }] : []),
        { href: "/app/calendar", label: "Calendar", icon: CalendarDays },
      ].slice(0, 4);
  const left = tabs.slice(0, Math.ceil(tabs.length / 2));
  const right = tabs.slice(Math.ceil(tabs.length / 2));

  const actions = (vendor
    ? [{ href: "/app/invoices#new-invoice", label: "Submit an invoice", icon: Receipt, ok: true }]
    : [
        { href: "/app/new/repair", label: "Report a repair", icon: Wrench, ok: perm("tasks", "edit") },
        { href: "/app/new/payment", label: "Record a payment", icon: CreditCard, ok: perm("leasing", "edit") },
        { href: "/app/communications", label: "Send a message", icon: MessagesSquare, ok: perm("communications", "edit") },
        { href: "/app/new/task?type=INSPECTION", label: "Start an inspection", icon: ClipboardCheck, ok: perm("tasks", "edit") },
        { href: "/app/new/lease", label: "New lease", icon: FileSignature, ok: perm("leasing", "edit") },
        { href: "/app/new/property", label: "Add a property", icon: Building2, ok: perm("rentals", "edit") },
      ]
  ).filter((a) => a.ok);

  const Tab = ({ t }: { t: (typeof tabs)[number] }) => {
    const active = path === t.href || path.startsWith(`${t.href}/`);
    return (
      <Link href={t.href} aria-current={active ? "page" : undefined} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}>
        <t.icon className="size-5" aria-hidden />
        {t.label}
      </Link>
    );
  };

  return (
    <>
      <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden">
        <div className="mx-auto flex max-w-md items-stretch">
          {left.map((t) => <Tab key={t.href} t={t} />)}
          {actions.length ? (
            <div className="flex flex-1 items-start justify-center">
              <button type="button" onClick={() => setOpen(true)} aria-label="Quick actions" className="-mt-5 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-pop ring-4 ring-surface active:scale-95">
                <Plus className="size-6" aria-hidden />
              </button>
            </div>
          ) : null}
          {right.map((t) => <Tab key={t.href} t={t} />)}
          <button type="button" onClick={onOpenMenu} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted-foreground">
            <Menu className="size-5" aria-hidden /> Menu
          </button>
        </div>
      </nav>
      <D.Root open={open} onOpenChange={setOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-slate-950/40 md:hidden" />
          <D.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-[20px] bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-pop md:hidden" aria-describedby={undefined}>
            <div className="mb-3 flex items-center justify-between">
              <D.Title className="text-base font-semibold">Quick actions</D.Title>
              <D.Close className="rounded-full p-1.5 hover:bg-surface-muted" aria-label="Close"><X className="size-5" aria-hidden /></D.Close>
            </div>
            <ul className="grid grid-cols-2 gap-2">
              {actions.map((a) => (
                <li key={a.href}>
                  <Link href={a.href} scroll={false} className="flex h-full flex-col items-start gap-2 rounded-card border border-border p-3 text-sm font-medium active:bg-surface-muted">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"><a.icon className="size-5" aria-hidden /></span>
                    {a.label}
                  </Link>
                </li>
              ))}
            </ul>
          </D.Content>
        </D.Portal>
      </D.Root>
    </>
  );
}
