import type { ScopedDb } from "@/server/dal";
import { adminDb } from "@/server/db";
import { addDays, formatDate, toISODate, utcDate, daysInMonth } from "@/lib/dates";
import { getSettings } from "@/server/settings/service";
import { leaseBalance } from "./money";

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The due date for `rentDueDay` in the month containing `d` (clamped to month length). */
export function dueDateIn(d: Date, rentDueDay: number) {
  return utcDate(d.getUTCFullYear(), d.getUTCMonth(), Math.min(rentDueDay, daysInMonth(d)));
}

/**
 * Which reminder (if any) is due today for a lease: BEFORE when today = due − daysBefore (this or
 * next month's due date), AFTER when today = due + daysAfter. 0 days turns that reminder off.
 */
export function reminderFor(today: Date, rentDueDay: number, daysBefore: number, daysAfter: number): { kind: "BEFORE" | "AFTER"; due: Date } | null {
  if (daysBefore > 0) {
    for (const base of [today, utcDate(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)]) {
      const due = dueDateIn(base, rentDueDay);
      if (toISODate(addDays(due, -daysBefore)) === toISODate(today)) return { kind: "BEFORE", due };
    }
  }
  if (daysAfter > 0) {
    for (const base of [today, utcDate(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)]) {
      const due = dueDateIn(base, rentDueDay);
      if (toISODate(addDays(due, daysAfter)) === toISODate(today)) return { kind: "AFTER", due };
    }
  }
  return null;
}

/**
 * Nightly: email (and text, when SMS is on and the tenant has a number) rent reminders per the
 * `notifications.*` settings resolved for each lease. Before-due reminders are skipped when the
 * lease is already paid ahead; past-due reminders only go out when there's a balance. Idempotent.
 */
export async function sendRentReminders(db: ScopedDb, today: Date) {
  const leases = await db.lease.findMany({
    where: { status: { in: ["ACTIVE", "EVICTION"] }, startDate: { lte: today } },
    include: { tenants: { include: { tenant: true } }, recurring: { where: { kind: "RENT", deletedAt: null } }, property: { select: { name: true } }, units: { include: { unit: { select: { name: true } } } } },
  });
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: db.ctx.orgId }, select: { name: true } });
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  const { sendMessage, findOrCreateConversation } = await import("@/server/comms/service");
  let sent = 0;
  for (const l of leases) {
    try {
      const s = await getSettings(db, ["notifications.rentReminderDaysBefore", "notifications.rentReminderDaysAfter", "communications.smsEnabled"], { orgId: db.ctx.orgId, propertyId: l.propertyId, leaseId: l.id });
      const r = reminderFor(today, l.rentDueDay, s["notifications.rentReminderDaysBefore"].value, s["notifications.rentReminderDaysAfter"].value);
      if (!r) continue;
      const dueOn = toISODate(r.due);
      if (await db.rentReminder.findFirst({ where: { leaseId: l.id, kind: r.kind, dueOn } })) continue;
      const bal = await db.tx((tx) => leaseBalance(tx, l.id));
      const rent = l.recurring.filter((c) => c.startDate <= r.due && (!c.endDate || c.endDate >= r.due)).reduce((n, c) => n + c.amountCents, 0);
      if (r.kind === "AFTER" && bal.balanceCents <= 0) continue;
      if (r.kind === "BEFORE" && (rent <= 0 || bal.balanceCents < 0 && -bal.balanceCents >= rent)) continue;
      const autopay = r.kind === "BEFORE" ? await db.autopay.findFirst({ where: { leaseId: l.id, active: true } }) : null;
      const unit = `${l.property.name}${l.units.length ? ` · ${l.units.map((u) => u.unit.name).join(", ")}` : ""}`;
      const channels = new Set<string>();
      for (const lt of l.tenants.filter((t) => t.role !== "COSIGNER")) {
        const t = lt.tenant;
        const first = t.firstName || "there";
        const body = r.kind === "BEFORE"
          ? `Hi ${first}, a friendly reminder from ${org.name}: rent of ${money(rent)} for ${unit} is due ${formatDate(r.due)}.${autopay ? " Autopay is on, so there's nothing you need to do." : ` Pay online: ${base}/portal/tenant/pay`}`
          : `Hi ${first}, our records show a balance of ${money(bal.balanceCents)} for ${unit}, which was due ${formatDate(r.due)}. Please pay as soon as you can: ${base}/portal/tenant/pay — or reply if you have questions.`;
        const conv = await findOrCreateConversation(db, { tenantId: t.id });
        const author = { userId: null, name: "Rent reminders" };
        if (t.email) {
          await sendMessage(db, conv.id, { body, channel: "EMAIL", author });
          channels.add("EMAIL");
        }
        if (s["communications.smsEnabled"].value && t.phone) {
          try {
            await sendMessage(db, conv.id, { body, channel: "SMS", author });
            channels.add("SMS");
          } catch {
            /* opted out / limit reached — the email still went */
          }
        }
      }
      if (!channels.size) continue;
      await db.rentReminder.create({ data: { organizationId: db.ctx.orgId, leaseId: l.id, kind: r.kind, dueOn, channels: [...channels] } });
      sent++;
    } catch (e) {
      console.error("[reminders]", l.id, e);
    }
  }
  return sent;
}
