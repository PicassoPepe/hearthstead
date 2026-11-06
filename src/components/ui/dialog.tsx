"use client";
import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  className,
  children,
  side,
  hideClose,
  ...props
}: React.ComponentPropsWithoutRef<typeof D.Content> & { side?: "center" | "right"; hideClose?: boolean }) {
  const drawer = side === "right";
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-slate-950/40 data-[state=open]:animate-in" />
      <D.Content
        className={cn(
          "fixed z-50 flex flex-col border border-border bg-surface shadow-pop focus:outline-none",
          drawer
            ? "inset-y-0 right-0 h-full w-full max-w-xl"
            : "left-1/2 top-1/2 max-h-[90dvh] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-card",
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : <D.Close className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground" aria-label="Close">
          <X className="size-4" aria-hidden />
        </D.Close>}
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-border px-5 py-4 pr-12", className)} {...props} />;
}
export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-y-auto px-5 py-4", className)} {...props} />;
}
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-border px-5 py-3", className)} {...props} />;
}
export const DialogTitle = React.forwardRef<HTMLHeadingElement, React.ComponentPropsWithoutRef<typeof D.Title>>(
  function DialogTitle({ className, ...props }, ref) {
    return <D.Title ref={ref} className={cn("text-base font-semibold", className)} {...props} />;
  },
);
export const DialogDescription = React.forwardRef<HTMLParagraphElement, React.ComponentPropsWithoutRef<typeof D.Description>>(
  function DialogDescription({ className, ...props }, ref) {
    return <D.Description ref={ref} className={cn("mt-1 text-[13px] text-muted-foreground", className)} {...props} />;
  },
);
