import type { SiteContent } from "./blocks";

function lum(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
/** Darken a color step by step until white text on it is readable (WCAG AA 4.5:1). */
function darkenForWhite(hex: string) {
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const toHex = () => `#${[r, g, b].map((x) => Math.round(x!).toString(16).padStart(2, "0")).join("")}`;
  for (let i = 0; i < 30 && ratio("#ffffff", toHex()) < 4.5; i++) { r = r! * 0.92; g = g! * 0.92; b = b! * 0.92; }
  return toHex();
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

/** Theme → CSS variables, adjusted so text always meets WCAG AA contrast. */
export function siteTheme(t: SiteContent["theme"]) {
  const bg = t.dark ? "#121C1E" : "#F7F3EA";
  const surface = t.dark ? "#1A282B" : "#FBFAF6";
  const text = t.dark ? "#F7F3EA" : "#18383B";
  const primary = ratio(t.primary, surface) >= 4.5 ? t.primary : t.dark ? "#4DB0B8" : "#0C4C54";
  const onPrimary = ratio("#ffffff", primary) >= ratio("#0A2A2E", primary) ? "#ffffff" : "#0A2A2E";
  const font = t.font === "serif" ? "Georgia, 'Times New Roman', serif" : t.font === "jakarta" ? "'Plus Jakarta Sans Variable', system-ui, sans-serif" : "'Inter Variable', system-ui, sans-serif";
  return {
    "--site-bg": bg, "--site-surface": surface, "--site-text": text, "--site-muted": t.dark ? "#A8B5B7" : "#4A5C5E", "--site-border": t.dark ? "#2A3C40" : "#D9D2C5",
    "--site-primary": primary, "--site-on-primary": onPrimary, "--site-accent": darkenForWhite(t.accent), "--site-soft": t.dark ? "#1A3F44" : "#E6EFEF",
    "--site-radius": t.rounded ? "14px" : "4px", "--site-font": font,
  } as Record<string, string>;
}

