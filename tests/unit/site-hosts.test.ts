import { describe, expect, it } from "vitest";
import { siteSlugForHost } from "@/lib/site/hosts";

const o = { appUrl: "https://app.deedwood.app", rootDomain: "deedwood.app" };
describe("website addresses", () => {
  it.each([
    ["localhost", { kind: "app" }],
    ["127.0.0.1", { kind: "app" }],
    ["app.deedwood.app", { kind: "app" }],
    ["deedwood.app", { kind: "app" }],
    ["www.deedwood.app", { kind: "app" }],
    ["maple-main.deedwood.app", { kind: "slug", slug: "maple-main" }],
    ["Maple-Main.DeedWood.app.", { kind: "slug", slug: "maple-main" }],
    ["admin.deedwood.app", { kind: "app" }],
    ["a.b.deedwood.app", { kind: "app" }],
    ["deedwood-production.up.railway.app", { kind: "app" }],
    ["www.maplemain.com", { kind: "custom" }],
  ])("%s", (host, want) => expect(siteSlugForHost(host, o)).toEqual(want));
  it("without a root domain, only custom domains map to sites", () => {
    expect(siteSlugForHost("maple.deedwood.app", { appUrl: "https://x.example" })).toEqual({ kind: "custom" });
  });
});
