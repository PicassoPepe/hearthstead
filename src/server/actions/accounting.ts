"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { audit } from "@/server/audit";
import { postEntry, reverseEntry } from "@/server/ledger/journal";
import { parseISODate } from "@/lib/dates";
import { isoDate } from "@/lib/leasing";

const accountSchema = z.object({
  code: z.string().trim().regex(/^\d{3,6}$/, "Use a 3–6 digit code"),
  name: z.string().trim().min(2, "Name the account").max(80),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]),
  isBank: z.boolean().default(false),
  active: z.boolean().default(true),
});

export async function saveAccount(id: string | null, raw: z.input<typeof accountSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const v = accountSchema.parse(raw);
    if (v.isBank && v.type !== "ASSET") throw new UserFacingError("Bank accounts are assets", { isBank: "Bank accounts must be assets" });
    const clash = await ctx.db.account.findFirst({ where: { code: v.code, ...(id ? { id: { not: id } } : {}) } });
    if (clash) throw new UserFacingError("That code is already used", { code: `Used by ${clash.name}` });
    if (id) {
      const before = await ctx.db.account.findFirst({ where: { id } });
      if (!before) throw new UserFacingError("Account not found");
      if (before.isSystem && (before.type !== v.type || before.isBank !== v.isBank || !v.active)) throw new UserFacingError("System accounts can be renamed or renumbered, but not retyped or deactivated.");
      const hasLines = await ctx.db.journalLine.count({ where: { accountId: id } });
      if (hasLines && before.type !== v.type) throw new UserFacingError("This account has transactions, so its type can't change.");
      await ctx.db.account.update({ where: { id }, data: v });
      if (v.isBank && !(await ctx.db.bankAccount.findFirst({ where: { accountId: id } }))) await ctx.db.bankAccount.create({ data: { organizationId: ctx.org.id, accountId: id } });
      await audit(ctx.db, { action: "account.updated", entityType: "Account", entityId: id, before, after: v });
      revalidatePath("/app/accounting", "layout");
      return { id };
    }
    const a = await ctx.db.account.create({ data: { organizationId: ctx.org.id, ...v, createdById: ctx.user.id } });
    if (v.isBank) await ctx.db.bankAccount.create({ data: { organizationId: ctx.org.id, accountId: a.id } });
    await audit(ctx.db, { action: "account.created", entityType: "Account", entityId: a.id, after: v });
    revalidatePath("/app/accounting", "layout");
    return { id: a.id };
  }, id ? "Account saved" : "Account created");
}

const jeSchema = z.object({
  date: isoDate,
  memo: z.string().trim().min(2, "Add a memo").max(200),
  lines: z
    .array(z.object({ accountId: z.string().min(1, "Choose an account"), debitCents: z.number().int().min(0), creditCents: z.number().int().min(0), propertyId: z.string().optional(), memo: z.string().max(200).optional() }))
    .min(2, "Add at least two lines"),
});

export async function createJournalEntry(raw: z.input<typeof jeSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "edit");
    const v = jeSchema.parse(raw);
    const lines = v.lines.filter((l) => l.debitCents || l.creditCents);
    const dr = lines.reduce((s, l) => s + l.debitCents, 0);
    const cr = lines.reduce((s, l) => s + l.creditCents, 0);
    if (dr !== cr) throw new UserFacingError(`Debits and credits must be equal (off by ${(Math.abs(dr - cr) / 100).toFixed(2)})`);
    const props = [...new Set(lines.map((l) => l.propertyId).filter(Boolean))] as string[];
    if (props.length && (await ctx.db.property.count({ where: { id: { in: props } } })) !== props.length) throw new UserFacingError("Choose valid properties");
    const je = await ctx.db.tx((tx) =>
      postEntry(tx, ctx.org.id, ctx.user.id, {
        date: parseISODate(v.date), memo: v.memo, source: "MANUAL",
        lines: lines.map((l) => ({ account: { id: l.accountId }, debitCents: l.debitCents, creditCents: l.creditCents, propertyId: l.propertyId || null, memo: l.memo })),
      }),
    );
    await audit(ctx.db, { action: "journal_entry.created", entityType: "JournalEntry", entityId: je.id, after: v });
    revalidatePath("/app/accounting", "layout");
    return { id: je.id };
  }, "Journal entry posted");
}

export async function voidJournalEntry(id: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("accounting", "delete");
    const je = await ctx.db.journalEntry.findFirst({ where: { id } });
    if (!je) throw new UserFacingError("Entry not found");
    if (je.source !== "MANUAL") throw new UserFacingError("Only manual entries can be voided here. Void lease transactions from the lease ledger.");
    if (reason.trim().length < 3) throw new UserFacingError("Give a reason for the void");
    await ctx.db.tx((tx) => reverseEntry(tx, ctx.org.id, ctx.user.id, id, parseISODate(new Date().toISOString().slice(0, 10)), `Void: ${je.memo ?? ""} — ${reason}`));
    await audit(ctx.db, { action: "journal_entry.voided", entityType: "JournalEntry", entityId: id, after: { reason } });
    revalidatePath("/app/accounting", "layout");
  }, "Entry voided");
}
