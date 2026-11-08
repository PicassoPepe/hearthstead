"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      {/* Sonner renders an aria-live region; toasts are announced to screen readers. */}
      <Toaster position="bottom-right" richColors closeButton mobileOffset={{ bottom: 88 }} toastOptions={{ duration: 5000 }} />
    </ThemeProvider>
  );
}
