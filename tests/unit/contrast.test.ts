import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** Validates design-token pairs against WCAG 2.2 AA (4.5:1 text, 3:1 non-text). */
function tokens(block: "root" | "dark"): Record<string, string> {
  const css = readFileSync("src/app/globals.css", "utf8");
  const re = block === "root" ? /:root\s*{([\s\S]*?)\n}/ : /\.dark\s*{([\s\S]*?)\n}/;
  const body = re.exec(css)![1]!;
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]));
}
function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ["foreground", "background"], ["foreground", "surface"], ["foreground", "surface-muted"],
  ["muted-foreground", "surface"], ["muted-foreground", "background"], ["muted-foreground", "surface-muted"],
  ["primary-foreground", "primary"], ["primary", "surface"], ["primary-soft-foreground", "primary-soft"],
  ["success-soft-foreground", "success-soft"], ["warning-soft-foreground", "warning-soft"],
  ["danger-soft-foreground", "danger-soft"], ["info-soft-foreground", "info-soft"],
  ["danger", "surface"], ["success", "surface"],
];

describe.each(["root", "dark"] as const)("contrast (%s theme)", (block) => {
  const t = tokens(block);
  it.each(TEXT_PAIRS)("%s on %s ≥ 4.5:1", (fg, bg) => {
    expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });
  it("input borders ≥ 3:1 against the surface", () => {
    expect(ratio(t.input!, t.surface!)).toBeGreaterThanOrEqual(3);
  });
  it("chart colors ≥ 3:1 against the surface", () => {
    for (let i = 1; i <= 6; i++) expect(ratio(t[`chart-${i}`]!, t.surface!), `chart-${i}`).toBeGreaterThanOrEqual(3);
  });
});
