"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, FileText, Home, MoreHorizontal, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/portal/tenant", label: "Home", icon: Home, exact: true },
  { href: "/portal/tenant/pay", label: "Pay", icon: CreditCard },
  { href: "/portal/tenant/requests", label: "Requests", icon: Wrench },
  { href: "/portal/tenant/documents", label: "Documents", icon: FileText },
  { href: "/portal/tenant/history", label: "More", icon: MoreHorizontal, also: ["/portal/tenant/autopay", "/portal/tenant/methods", "/portal/tenant/insurance", "/portal/tenant/messages"] },
];

/** Top tabs on desktop, a fixed bottom bar on phones (thumb reach). */
export function PortalNav({ variant }: { variant: "top" | "bottom" }) {
  const path = usePathname();
  const active = (i: (typeof ITEMS)[number]) => (i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/") || (i.also ?? []).some((a) => path.startsWith(a)));
  if (variant === "top") {
    return (
      <nav aria-label="Portal" className="mx-auto hidden max-w-3xl gap-1 px-4 md:flex">
        {[...ITEMS.slice(0, 4), { href: "/portal/tenant/autopay", label: "Autopay", icon: CreditCard }, { href: "/portal/tenant/history", label: "History", icon: FileText }, { href: "/portal/tenant/insurance", label: "Insurance", icon: FileText }].map((i) => {
          const on = "exact" in i && i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/");
          return (
            <Link key={i.href + i.label} href={i.href} aria-current={on ? "page" : undefined} className={cn("-mb-px border-b-2 px-3 py-2.5 text-[15px] font-medium", on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {i.label}
            </Link>
          );
        })}
      </nav>
    );
  }
  return (
    <nav aria-label="Portal" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface md:hidden">
      {ITEMS.map((i) => {
        const on = active(i);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 py-2 text-xs font-medium", on ? "text-primary" : "text-muted-foreground")}>
            <i.icon className="size-5" aria-hidden />
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
