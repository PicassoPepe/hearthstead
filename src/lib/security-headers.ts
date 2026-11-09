/**
 * Security headers for every page (see next.config.ts). Plain data, so it's easy to test and to
 * tighten later. Hosts outside DeedWood the browser may load from:
 * - map tiles: OpenStreetMap and Esri imagery (Land records map)
 * - Stripe.js / Elements, for when online card payments are switched on
 */
const MAP_TILES = ["https://tile.openstreetmap.org", "https://server.arcgisonline.com"];
const STRIPE = { script: ["https://js.stripe.com"], frame: ["https://js.stripe.com", "https://hooks.stripe.com"], connect: ["https://api.stripe.com"] };

export function contentSecurityPolicy(dev = false): string {
  const d: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Next.js inlines small bootstrap scripts; nonces can replace 'unsafe-inline' in a later pass.
    "script-src": ["'self'", "'unsafe-inline'", ...STRIPE.script, ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...MAP_TILES],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...STRIPE.connect, ...(dev ? ["ws:", "wss:"] : [])],
    "frame-src": ["'self'", ...STRIPE.frame],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  };
  return Object.entries(d).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}

export function securityHeaders(dev = false): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(dev) },
    // Browsers ignore HSTS on plain-http addresses (like the one-click local install), so it's safe to always send.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: 'camera=(self), microphone=(), geolocation=(), payment=(self "https://js.stripe.com"), usb=(), interest-cohort=()' },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}
