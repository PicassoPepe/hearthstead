import { describe, expect, it } from "vitest";
import { CREATE_MENU, NAV_MAIN, createItem, sectionForPath } from "@/lib/nav";

describe("sectionForPath", () => {
  it.each([
    ["/app/overview", "overview"],
    ["/app/rentals", "rentals"],
    ["/app/rentals/units", "rentals"],
    ["/app/accounting/bills", "accounting"],
    ["/app/settings", "settings"],
    ["/app/settings/late-fees", "settings"],
    ["/app/settings/users", "settings"],
    ["/app/people/tenants", "leasing"],
    ["/app/money", "accounting"],
    ["/app/tasks", "tasks"],
    ["/app/more", "more"],
  ])("%s → %s", (path, id) => {
    expect(sectionForPath(path)?.id).toBe(id);
  });
  it("does not match on partial segments", () => {
    expect(sectionForPath("/app/rentalsx")).toBeUndefined();
  });
});

describe("navigation config", () => {
  it("has the required top-level items in order", () => {
    expect(NAV_MAIN.map((n) => n.label)).toEqual([
      "Home", "Properties", "Tenants", "Repairs", "Invoices", "Rent & Money", "Messages", "Calendar", "Reports", "More",
    ]);
  });
  it("vendor-only items are hidden from staff", () => {
    expect(NAV_MAIN.filter((n) => n.vendorOnly).map((n) => n.href)).toEqual(["/app/invoices"]);
  });
  it("create menu kinds are unique and resolvable", () => {
    const kinds = CREATE_MENU.flatMap((g) => g.items.map((i) => i.kind));
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const k of kinds) expect(createItem(k)?.kind).toBe(k);
    expect(createItem("nope")).toBeUndefined();
    expect(createItem("repair")?.kind).toBe("repair");
  });
});
