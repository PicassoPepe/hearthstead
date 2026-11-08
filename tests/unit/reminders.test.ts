import { describe, expect, it } from "vitest";
import { dueDateIn, reminderFor } from "@/server/leasing/reminders";
import { parseISODate as d, toISODate } from "@/lib/dates";

describe("rent reminder schedule", () => {
  it("clamps the due day to the month length", () => {
    expect(toISODate(dueDateIn(d("2027-02-10"), 31))).toBe("2027-02-28");
  });
  it("before-due reminders look ahead into next month", () => {
    const r = reminderFor(d("2026-11-28"), 1, 3, 2);
    expect(r?.kind).toBe("BEFORE");
    expect(toISODate(r!.due)).toBe("2026-12-01");
  });
  it("past-due reminders look back, including into last month", () => {
    expect(reminderFor(d("2026-11-03"), 1, 3, 2)).toMatchObject({ kind: "AFTER" });
    const r = reminderFor(d("2026-12-02"), 30, 0, 2);
    expect(toISODate(r!.due)).toBe("2026-11-30");
  });
  it("0 days turns a reminder off; other days are quiet", () => {
    expect(reminderFor(d("2026-11-28"), 1, 0, 0)).toBeNull();
    expect(reminderFor(d("2026-11-15"), 1, 3, 2)).toBeNull();
  });
});
