"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export const CreateModalContext = React.createContext<{ close: () => void } | null>(null);

/** Modal route wrapper: closing it navigates back, so the page underneath keeps its state. */
export function CreateModal({
  title,
  description,
  children,
  size = "default",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** "wizard" = wide, tall, and the child manages its own padding/footer. */
  size?: "default" | "wizard" | "wide";
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(true);
  const close = React.useCallback(() => {
    setOpen(false);
    router.back();
  }, [router]);
  return (
    <CreateModalContext.Provider value={{ close }}>
      <Dialog open={open} onOpenChange={(o) => (!o ? close() : setOpen(true))}>
        <DialogContent
          aria-describedby={description ? "create-desc" : undefined}
          className={size === "wizard" ? "h-[min(860px,92dvh)] max-w-3xl" : size === "wide" ? "max-w-3xl" : undefined}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription id="create-desc">{description}</DialogDescription> : null}
          </DialogHeader>
          {size === "wizard" ? children : <div className="overflow-y-auto px-5 py-4">{children}</div>}
        </DialogContent>
      </Dialog>
    </CreateModalContext.Provider>
  );
}

export function useCreateModal() {
  return React.useContext(CreateModalContext);
}
