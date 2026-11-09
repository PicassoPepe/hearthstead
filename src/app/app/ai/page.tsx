import { Sparkles as SparklesIcon } from "lucide-react";
import { flagEnabled } from "@/server/platform-admin/flags";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { EntityTabs } from "@/components/patterns/entity-tabs";
import { Assistant } from "@/components/platform/assistant";
import { AgentActivity, AgentCards } from "@/components/platform/agents";
import { AGENTS, agentConfigs, type AgentKey } from "@/server/ai/agents";
import { getLlmProvider } from "@/adapters/llm";
import { PROVIDER_LABEL } from "@/adapters/llm/free";

export const metadata = { title: "AI" };

export default async function AiPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab === "agents" ? "agents" : "assistant";
  const ctx = await requireContext();
  if (!can(ctx.permissions, "ai", "view")) return <Forbidden what="the AI assistant" />;
  if (!(await flagEnabled("ai", ctx.org.id))) return <p className="rounded-card border border-border bg-surface p-6 text-sm text-muted-foreground">The AI helper isn&apos;t available for your account right now. Contact DeedWood support.</p>;
  const llm = getLlmProvider();
  const [cfgs, actions, pending] = await Promise.all([
    tab === "agents" ? agentConfigs(ctx.db) : Promise.resolve([]),
    tab === "agents" ? ctx.db.agentAction.findMany({ orderBy: { createdAt: "desc" }, take: 50 }) : Promise.resolve([]),
    ctx.db.agentAction.count({ where: { status: "PROPOSED" } }),
  ]);
  return (
    <>
      <PageHeader icon={<SparklesIcon aria-hidden />} title="AI" description={llm.name === "mock"
        ? "AI assistant (preview). Ask questions about your rentals and let helpers draft replies, triage repairs and suggest renewals. You approve anything they want to send. Every AI action is recorded."
        : `AI assistant (preview), powered by ${PROVIDER_LABEL[llm.name] ?? "an AI service"}. Drafts are suggestions — you approve anything sent. Every AI action is recorded.`} />
      <EntityTabs base="/app/ai" active={tab} tabs={[{ id: "assistant", label: "Assistant" }, { id: "agents", label: "Agents", count: pending || undefined }]} />
      {tab === "assistant" ? <Assistant /> : (
        <div className="grid gap-6">
          <AgentCards canEdit={can(ctx.permissions, "ai", "edit")} configs={cfgs.map((c) => ({ agent: c.agent as AgentKey, label: AGENTS[c.agent as AgentKey].label, description: AGENTS[c.agent as AgentKey].description, enabled: c.enabled, mode: c.mode, threshold: c.threshold, maxAutoIncreasePct: (c.settings as { maxAutoIncreasePct?: number }).maxAutoIncreasePct, lastRunAt: c.lastRunAt ? new Date(c.lastRunAt).toISOString() : null }))} />
          <section aria-labelledby="activity-h">
            <h2 id="activity-h" className="mb-2 font-semibold">Activity</h2>
            <AgentActivity canEdit={can(ctx.permissions, "ai", "edit")} actions={actions.map((a) => ({ id: a.id, agent: a.agent, kind: a.kind, summary: a.summary, confidence: a.confidence, status: a.status, result: a.result, createdAt: a.createdAt.toISOString(), preview: a.kind === "REPLY_MESSAGE" ? String((a.payload as { body?: string }).body ?? "") : null }))} />
          </section>
        </div>
      )}
    </>
  );
}
