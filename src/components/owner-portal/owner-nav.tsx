"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, FileText, Home, MessageSquare, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

const TOP = [
  { href: "/portal/owner", label: "Home", exact: true },
  { href: "/portal/owner/properties", label: "Properties" },
  { href: "/portal/owner/statements", label: "Statements" },
  { href: "/portal/owner/payments", label: "Distributions" },
  { href: "/portal/owner/requests", label: "Requests" },
  { href: "/portal/owner/documents", label: "Documents" },
  { href: "/portal/owner/messages", label: "Messages" },
];
const BOTTOM = [
  { href: "/portal/owner", label: "Home", icon: Home, exact: true },
  { href: "/portal/owner/properties", label: "Properties", icon: Building2 },
  { href: "/portal/owner/statements", label: "Statements", icon: FileText },
  { href: "/portal/owner/messages", label: "Messages", icon: MessageSquare },
  { href: "/portal/owner/payments", label: "More", icon: MoreHorizontal, also: ["/portal/owner/requests", "/portal/owner/documents"] },
];

export function OwnerNav({ variant, showReports }: { variant: "top" | "bottom"; showReports: boolean }) {
  const path = usePathname();
  const on = (h: string, exact?: boolean, also: string[] = []) => (exact ? path === h : path === h || path.startsWith(`${h}/`) || also.some((a) => path.startsWith(a)));
  if (variant === "top") {
    return (
      <nav aria-label="Owner portal" className="mx-auto hidden max-w-4xl gap-1 overflow-x-auto px-4 md:flex">
        {TOP.filter((i) => showReports || i.href !== "/portal/owner/statements").map((i) => (
          <Link key={i.href} href={i.href} aria-current={on(i.href, i.exact) ? "page" : undefined} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[15px] font-medium", on(i.href, i.exact) ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{i.label}</Link>
        ))}
      </nav>
    );
  }
  return (
    <nav aria-label="Owner portal" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface md:hidden">
      {BOTTOM.map((i) => (
        <Link key={i.href + i.label} href={i.href} aria-current={on(i.href, i.exact, i.also) ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 py-2 text-xs font-medium", on(i.href, i.exact, i.also) ? "text-primary" : "text-muted-foreground")}>
          <i.icon className="size-5" aria-hidden />{i.label}
        </Link>
      ))}
    </nav>
  );
}
