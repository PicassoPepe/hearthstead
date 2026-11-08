"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin progress bar at the top of the window while a client-side navigation is in flight.
 * Starts on clicks of same-origin links (and on browser back/forward); finishes when the URL the
 * router renders changes. Purely visual — screen readers already get the new page's title/heading.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [state, setState] = React.useState<"idle" | "loading" | "done">("idle");
  const timer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    const start = () => {
      window.clearTimeout(timer.current);
      // Only show for navigations that take a moment.
      timer.current = window.setTimeout(() => setState("loading"), 120);
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      start();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", start);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", start);
    };
  }, []);

  React.useEffect(() => {
    window.clearTimeout(timer.current);
    setState((s) => (s === "loading" ? "done" : "idle"));
    const t = window.setTimeout(() => setState("idle"), 300);
    return () => window.clearTimeout(t);
  }, [pathname, search]);

  if (state === "idle") return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 print:hidden">
      <div className={state === "loading" ? "nav-progress-run h-full bg-primary" : "h-full w-full bg-primary opacity-0 transition-opacity duration-300"} />
    </div>
  );
}
