import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { newBlock, parseSite, siteSchema, BLOCK_LABELS, type BlockType } from "@/lib/site/blocks";
import { TEMPLATES, templateContent, type TemplateKey } from "@/lib/site/templates";
import { siteTheme } from "@/lib/site/theme";

describe("website content", () => {
  it("every section type and every design is valid", () => {
    for (const t of Object.keys(BLOCK_LABELS) as BlockType[]) expect(() => parseSite({ title: "x", sections: [newBlock(t)] })).not.toThrow();
    for (const k of Object.keys(TEMPLATES) as TemplateKey[]) {
      const c = templateContent(k, { name: "Maple & Main", city: "Louisville" });
      expect(siteSchema.parse(c).sections.length).toBeGreaterThan(4);
      expect(c.sections.some((s) => s.type === "vacancies")).toBe(true);
    }
  });
  it("text is stored as text — HTML stays harmless, lengths are limited", () => {
    const c = parseSite({ title: "<script>alert(1)</script>", sections: [{ ...newBlock("faq"), items: [{ q: "<img src=x onerror=alert(1)>", a: "ok" }] }] });
    expect(c.title).toBe("<script>alert(1)</script>"); // rendered by React as plain text, never as markup
    expect(() => parseSite({ title: "x".repeat(81) })).toThrow(ZodError);
  });
  it("rejects bad colors, unknown section types, odd image ids and unknown button targets", () => {
    expect(() => parseSite({ title: "x", theme: { primary: "red" } })).toThrow(ZodError);
    expect(() => parseSite({ title: "x", sections: [{ id: "abcdef12", type: "iframe", enabled: true }] })).toThrow(ZodError);
    expect(() => parseSite({ title: "x", sections: [{ ...newBlock("hero"), imageId: "../../etc/passwd" }] })).toThrow(ZodError);
    expect(() => parseSite({ title: "x", sections: [{ ...newBlock("hero"), primary: { label: "Go", target: "javascript" } }] })).toThrow(ZodError);
  });
  it("keeps text readable: a too-light main color is replaced", () => {
    const ok = siteTheme({ primary: "#0C4C54", accent: "#B8774F", font: "inter", rounded: true, dark: false }) as Record<string, string>;
    expect(ok["--site-primary"]).toBe("#0C4C54");
    expect(ok["--site-on-primary"]).toBe("#ffffff");
    const light = siteTheme({ primary: "#FFF59D", accent: "#B8774F", font: "inter", rounded: true, dark: false }) as Record<string, string>;
    expect(light["--site-primary"]).toBe("#0C4C54");
  });
});

describe("accent buttons", () => {
  it("darken until white text is readable", async () => {
    const { siteTheme } = await import("@/lib/site/theme");
    const t = siteTheme({ primary: "#0C4C54", accent: "#B8774F", font: "inter", rounded: true, dark: false }) as Record<string, string>;
    const lum = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i]!, 0);
    expect(1.05 / (lum(t["--site-accent"]!) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
