"use server";

import { requirePermission } from "@/server/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { audit } from "@/server/audit";
import { getLlmProvider } from "@/adapters/llm";
import { runReport } from "@/server/reports/engine";
import { orgToday } from "@/server/leasing/queries";
import { normalizeParams, reportMeta, type ReportKey } from "@/lib/reports";
import { formatMoney } from "@/lib/money";

/** AI summary of a report: only the computed headline figures are sent to the model, never raw rows. */
export async function summarizeReportAction(key: string, raw: Record<string, string>): Promise<ActionResult<string>> {
  return runAction(async () => {
    const ctx = await requirePermission("reports", "view");
    if (!reportMeta(key)) throw new UserFacingError("Unknown report");
    const today = await orgToday(ctx);
    const r = await runReport(ctx, key as ReportKey, normalizeParams(raw, today), today);
    const fmt = (h: (typeof r.highlights)[number]) => (h.kind === "money" ? formatMoney(h.value) : h.kind === "percent" ? `${(h.value / 100).toFixed(1)}%` : h.value.toLocaleString());
    const input = [`Report: ${r.title} (${r.subtitle})`, ...r.highlights.map((h) => `- ${h.label}: ${fmt(h)}`)].join("\n");
    const text = await getLlmProvider().complete({
      purpose: "report-summary",
      system: "You summarize property-management reports for a busy manager in 2–3 plain sentences. Use only the figures given; never invent numbers.",
      messages: [{ role: "user", content: input }],
      maxTokens: 300,
    });
    await audit(ctx.db, { action: "ai.report_summary", entityType: "Report", entityId: key, after: { params: raw } });
    return text;
  });
}
