"use client";

import * as React from "react";

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void; remove: (id: string) => void } }
}

let loading: Promise<void> | null = null;
function loadScript() {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("captcha script failed"));
    document.head.appendChild(s);
  });
  return loading;
}

/** The "I'm human" check. Renders nothing when CAPTCHA isn't switched on (siteKey null). */
export function Captcha({ siteKey, onToken, resetKey = 0 }: { siteKey: string | null; onToken: (t: string | null) => void; resetKey?: number }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const id = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!siteKey || !ref.current) return;
    let cancelled = false;
    loadScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return;
      if (id.current) window.turnstile.remove(id.current);
      id.current = window.turnstile.render(ref.current, { sitekey: siteKey, callback: (t: string) => onToken(t), "expired-callback": () => onToken(null), "error-callback": () => onToken(null), theme: "auto", size: "flexible" });
    }).catch(() => onToken(null));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, resetKey]);
  if (!siteKey) return null;
  return <div ref={ref} className="min-h-[65px]" aria-label="Security check" />;
}
