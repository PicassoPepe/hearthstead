"use client";

import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { usePathname } from "next/navigation";
import { SidebarNav } from "./sidebar-nav";
import { TopBar } from "./top-bar";
import { MobileTabBar } from "./mobile-tab-bar";
import { NavProgress } from "./nav-progress";
import { CommandPalette } from "./command-palette";
import { ShellProvider, type ShellData } from "./shell-context";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppShell({ data, children, modal }: { data: ShellData; children: React.ReactNode; modal?: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const pathname = usePathname();
  React.useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <ShellProvider value={data}>
      <TooltipProvider>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
          Skip to content
        </a>
        <div className="app-density flex min-h-dvh">
          <div className="sticky top-0 hidden h-dvh md:block print:hidden">
            <SidebarNav />
          </div>

          {/* Mobile drawer */}
          <D.Root open={mobileOpen} onOpenChange={setMobileOpen}>
            <D.Portal>
              <D.Overlay className="fixed inset-0 z-40 bg-slate-950/40 md:hidden" />
              <D.Content className="fixed inset-y-0 left-0 z-50 md:hidden" aria-describedby={undefined}>
                <D.Title className="sr-only">Navigation</D.Title>
                <SidebarNav forceExpanded onNavigate={() => setMobileOpen(false)} />
              </D.Content>
            </D.Portal>
          </D.Root>

          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar onOpenMobileNav={() => setMobileOpen(true)} />
            <div className="page-wash flex-1">
              <main id="main" key={pathname} tabIndex={-1} className="page-enter mx-auto w-full max-w-[1400px] px-4 pb-28 pt-6 focus:outline-none sm:px-6 md:pb-6 lg:px-8">
                {children}
              </main>
            </div>
          </div>
        </div>
        <React.Suspense fallback={null}><NavProgress /></React.Suspense>
        <MobileTabBar onOpenMenu={() => setMobileOpen(true)} />
        <CommandPalette />
        {modal}
      </TooltipProvider>
    </ShellProvider>
  );
}
