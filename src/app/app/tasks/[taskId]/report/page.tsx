import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { taskDetail } from "@/server/maintenance/queries";
import { PrintButton } from "@/components/leasing/print-button";
import { formatDate } from "@/lib/dates";
import { CONDITIONS } from "@/lib/maintenance";

export const metadata = { title: "Inspection report" };

/** Printable inspection report (browser "Save as PDF"). */
export default async function InspectionReport({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const ctx = await requireContext();
  if (!can(ctx.permissions, "tasks", "view")) notFound();
  const d = await taskDetail(ctx, taskId);
  if (!d || d.task.type !== "INSPECTION") notFound();
  const { task: t } = d;
  const org = await ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.org.id } });
  const rooms = [...new Set(t.items.map((i) => i.room))];
  const label = (c: string | null) => CONDITIONS.find((x) => x.value === c)?.label ?? "Not rated";
  return (
    <div className="mx-auto max-w-3xl bg-surface p-8 text-sm print:max-w-none print:p-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href={`/app/tasks/${t.id}`} className="text-primary hover:underline">← Back to inspection</Link>
        <PrintButton />
      </div>
      <header className="border-b border-border pb-4">
        <div className="text-lg font-semibold" style={{ color: org.brandColor }}>{org.name}</div>
        <h1 className="mt-1 text-xl font-semibold">{t.inspectionKind === "MOVE_IN" ? "Move-in" : t.inspectionKind === "MOVE_OUT" ? "Move-out" : "Periodic"} inspection</h1>
        <div className="text-muted-foreground">
          {d.property?.name}{d.unit && d.unit.name !== "Main" ? ` · Unit ${d.unit.name}` : ""} · {d.property ? `${d.property.addressLine1}, ${d.property.city}` : ""} · #{t.number} · {formatDate(t.completedAt ?? t.createdAt)}
        </div>
      </header>
      {t.aiSummary ? (
        <section className="mt-4 rounded-lg border border-border p-3">
          <h2 className="mb-1 font-semibold">Summary</h2>
          <p>{t.aiSummary}</p>
        </section>
      ) : null}
      {rooms.map((room) => (
        <section key={room} className="mt-5 break-inside-avoid">
          <h2 className="mb-2 font-semibold">{room}</h2>
          <table className="w-full">
            <caption className="sr-only">{room}</caption>
            <thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th scope="col" className="py-1.5">Item</th><th scope="col" className="py-1.5">Condition</th><th scope="col" className="py-1.5">Notes</th></tr></thead>
            <tbody>
              {t.items.filter((i) => i.room === room).map((i) => (
                <tr key={i.id} className="border-b border-border/60">
                  <td className="py-1.5">{i.item}</td>
                  <td className={`py-1.5 font-medium ${i.condition === "DAMAGED" || i.condition === "POOR" ? "text-danger" : ""}`}>{label(i.condition)}</td>
                  <td className="py-1.5">{i.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <footer className="mt-10 grid grid-cols-2 gap-8 text-xs text-muted-foreground">
        <div className="border-t border-border pt-2">Inspector signature &amp; date</div>
        <div className="border-t border-border pt-2">Tenant signature &amp; date</div>
      </footer>
    </div>
  );
}
