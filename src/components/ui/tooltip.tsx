"use client";
import * as React from "react";
import * as T from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

export const TooltipProvider = T.Provider;

export function Tooltip({ content, children, side = "right" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <T.Root delayDuration={300}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className={cn("z-50 rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow-pop dark:bg-slate-100 dark:text-slate-900")}>
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
