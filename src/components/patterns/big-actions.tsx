import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export type BigAction = { href: string; label: string; hint: string; icon: LucideIcon; tone?: "primary" | "plain" };

/** Large, plain-language buttons: "what do you want to do?" */
export function BigActions({ items, columns = "sm:grid-cols-2 lg:grid-cols-3" }: { items: BigAction[]; columns?: string }) {
  return (
    <ul className={`grid gap-3 ${columns}`}>
      {items.map((a) => (
        <li key={a.href + a.label}>
          <Link href={a.href} scroll={false} className={`card-hover flex h-full items-center gap-4 rounded-card border p-4 shadow-card focus-visible:outline-2 ${a.tone === "primary" ? "border-primary/40 bg-primary-soft/40" : "border-border bg-surface"}`}>
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><a.icon className="size-6" aria-hidden /></span>
            <span className="min-w-0">
              <span className="block text-base font-semibold leading-snug">{a.label}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{a.hint}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** One plain sentence under a page title: what this page is for. */
export function PageHelp({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-muted-foreground"><strong className="font-semibold text-foreground">What is this page? </strong>{children}</p>;
}
