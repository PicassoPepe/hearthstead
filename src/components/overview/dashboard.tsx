"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, ChevronRight, Eye, EyeOff, GripVertical, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PRESETS, WIDGET_META, type DashboardLayout, type WidgetData, type WidgetId } from "@/lib/widgets";
import { setPreference } from "@/server/actions/preferences";
import { cn } from "@/lib/utils";

type Props = {
  data: WidgetData;
  layout: DashboardLayout;
  allowed: WidgetId[];
  filter: { propertyId: string; portfolioId: string };
  properties: { id: string; name: string }[];
  portfolios: { id: string; name: string }[];
};

export function Dashboard({ data, layout: saved, allowed, filter, properties, portfolios }: Props) {
  const router = useRouter();
  const [layout, setLayout] = React.useState(saved);
  const [editing, setEditing] = React.useState(false);
  const [viewAs, setViewAs] = React.useState("");
  const [announce, setAnnounce] = React.useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const active = viewAs ? PRESETS[viewAs]!.layout : layout;
  const shown = active.order.filter((id) => allowed.includes(id) && (editing || !active.hidden.includes(id)));

  // Saves are chained so a quick hide-then-move can't land out of order on the server.
  const queue = React.useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = React.useRef(0);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved">("idle");
  const persist = (next: DashboardLayout) => {
    setLayout(next);
    pendingSaves.current++;
    setSaveState("saving");
    queue.current = queue.current
      .then(() => setPreference("dashboard", next))
      .catch(() => void toast.error("Couldn't save your layout"))
      .finally(() => { if (--pendingSaves.current === 0) setSaveState("saved"); });
    return queue.current;
  };
  const move = (id: WidgetId, dir: -1 | 1) => {
    const i = layout.order.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= layout.order.length) return;
    void persist({ ...layout, order: arrayMove(layout.order, i, j) });
    setAnnounce(`${WIDGET_META[id].title} moved ${dir < 0 ? "earlier" : "later"}`);
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = layout.order.indexOf(e.active.id as WidgetId);
    const to = layout.order.indexOf(e.over.id as WidgetId);
    void persist({ ...layout, order: arrayMove(layout.order, from, to) });
    setAnnounce(`${WIDGET_META[e.active.id as WidgetId].title} moved to position ${to + 1}`);
  };
  const scope = filter.propertyId ? `p:${filter.propertyId}` : filter.portfolioId ? `f:${filter.portfolioId}` : "";

  return (
    <section aria-labelledby="dash-h">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <h2 id="dash-h" className="mr-auto text-[15px] font-semibold">Dashboard</h2>
        <Field label="Showing">{(a) => (
          <NativeSelect {...a} className="w-52" value={scope} onChange={(e) => {
            const v = e.target.value;
            const q = new URLSearchParams(v.startsWith("p:") ? { propertyId: v.slice(2) } : v.startsWith("f:") ? { portfolioId: v.slice(2) } : {});
            router.push(`/app/overview${q.size ? `?${q}` : ""}`);
          }}>
            <option value="">All properties</option>
            {portfolios.length ? <optgroup label="Portfolios">{portfolios.map((p) => <option key={p.id} value={`f:${p.id}`}>{p.name}</option>)}</optgroup> : null}
            <optgroup label="Properties">{properties.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}</optgroup>
          </NativeSelect>
        )}</Field>
        <Field label="View as">{(a) => (
          <NativeSelect {...a} className="w-44" value={viewAs} disabled={editing} onChange={(e) => setViewAs(e.target.value)}>
            <option value="">My layout</option>
            {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </NativeSelect>
        )}</Field>
        {viewAs ? (
          <Button variant="secondary" onClick={async () => { await persist(PRESETS[viewAs]!.layout); setViewAs(""); toast.success("Layout saved as yours"); }}>Use this layout</Button>
        ) : (
          <Button variant={editing ? "primary" : "secondary"} aria-pressed={editing} onClick={() => setEditing(!editing)}><Settings2 aria-hidden /> {editing ? "Done" : "Customize"}</Button>
        )}
      </div>
      {editing ? <p className="mb-3 text-sm text-muted-foreground">Drag widgets (or use the arrow buttons) to reorder; hide what you don&apos;t need. Changes save automatically.</p> : null}
      <p role="status" className="mb-2 text-xs text-muted-foreground" data-testid="layout-save-state">{saveState === "saving" ? "Saving layout…" : saveState === "saved" ? "Layout saved" : ""}</p>
      <p aria-live="polite" className="sr-only">{announce}</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={shown} strategy={rectSortingStrategy}>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((id, i) => (
              <SortableWidget key={id} id={id} editing={editing} hidden={active.hidden.includes(id)} first={i === 0} last={i === shown.length - 1}
                onMove={(d) => move(id, d)}
                onToggle={() => void persist({ ...layout, hidden: layout.hidden.includes(id) ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id] })}>
                <WidgetBody id={id} data={data} />
              </SortableWidget>
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {!shown.length ? <p className="rounded-card border border-dashed border-border p-6 text-center text-sm text-muted-foreground">All widgets are hidden. Choose Customize to show some.</p> : null}
    </section>
  );
}

function SortableWidget({ id, editing, hidden, first, last, onMove, onToggle, children }: { id: WidgetId; editing: boolean; hidden: boolean; first: boolean; last: boolean; onMove: (d: -1 | 1) => void; onToggle: () => void; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !editing });
  const meta = WIDGET_META[id];
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("flex flex-col rounded-card border border-border bg-surface shadow-card", isDragging && "z-10 shadow-lg ring-2 ring-primary", hidden && "opacity-60")} data-testid={`widget-${id}`}>
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        {editing ? (
          <button type="button" className="mt-0.5 cursor-grab rounded p-0.5 text-muted-foreground hover:bg-surface-muted" aria-label={`Drag ${meta.title}`} {...attributes} {...listeners}>
            <GripVertical className="size-4" aria-hidden />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{meta.title}</h3>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        </div>
        {editing ? (
          <div className="flex gap-0.5">
            <Button variant="ghost" size="icon-sm" disabled={first} aria-label={`Move ${meta.title} earlier`} onClick={() => onMove(-1)}><ArrowUp aria-hidden /></Button>
            <Button variant="ghost" size="icon-sm" disabled={last} aria-label={`Move ${meta.title} later`} onClick={() => onMove(1)}><ArrowDown aria-hidden /></Button>
            <Button variant="ghost" size="icon-sm" aria-label={hidden ? `Show ${meta.title}` : `Hide ${meta.title}`} onClick={onToggle}>{hidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}</Button>
          </div>
        ) : (
          <Link href={meta.href} className="flex items-center gap-0.5 text-xs font-medium text-primary hover:underline" aria-label={`Open ${meta.title} details`}>Details <ChevronRight className="size-3.5" aria-hidden /></Link>
        )}
      </div>
      <div className="flex-1 px-4 py-3">{children}</div>
    </li>
  );
}

const Big = ({ children }: { children: React.ReactNode }) => <div className="text-2xl font-semibold tabular">{children}</div>;

function Bar({ value, max, label, href, tone = "chart-1" }: { value: number; max: number; label: string; href?: string; tone?: "chart-1" | "chart-2" }) {
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0;
  const inner = (
    <div className="grid grid-cols-[6rem_1fr_auto] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-surface-muted"><span className={cn("block h-full rounded-full", tone === "chart-1" ? "bg-chart-1" : "bg-chart-2")} style={{ width: `${pct}%` }} /></span>
      <span className="tabular">{formatMoney(value, { showCents: false })}</span>
    </div>
  );
  return href ? <Link href={href} className="block rounded hover:bg-surface-muted/60">{inner}</Link> : inner;
}

function WidgetBody({ id, data }: { id: WidgetId; data: WidgetData }) {
  switch (id) {
    case "rent": {
      const { dueCents: due, collectedCents: got } = data.rent;
      const pct = due ? Math.round((got / due) * 100) : 0;
      return (
        <div className="grid gap-2">
          <Big>{pct}%</Big>
          <div role="progressbar" aria-label="Rent collected this month" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-3 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.min(100, pct)}%` }} /></div>
          <p className="text-sm text-muted-foreground">{formatMoney(got, { showCents: false })} of {formatMoney(due, { showCents: false })} collected · {formatMoney(Math.max(0, due - got), { showCents: false })} to go</p>
        </div>
      );
    }
    case "aging": {
      const a = data.aging;
      const max = Math.max(a.current, a.d30, a.d60, a.d90, 1);
      const total = a.current + a.d30 + a.d60 + a.d90;
      return (
        <div className="grid gap-2">
          <Big>{formatMoney(total, { showCents: false })}</Big>
          <p className="text-sm text-muted-foreground">{a.tenantsOwing} tenant{a.tenantsOwing === 1 ? "" : "s"} with a balance</p>
          <Bar label="Not yet due" value={a.current} max={max} />
          <Bar label="1–30 days" value={a.d30} max={max} href="/app/reports/delinquency" />
          <Bar label="31–60 days" value={a.d60} max={max} href="/app/reports/delinquency" />
          <Bar label="60+ days" value={a.d90} max={max} href="/app/reports/delinquency" />
        </div>
      );
    }
    case "occupancy": {
      const o = data.occupancy;
      const pct = o.units ? Math.round((o.occupied / o.units) * 100) : 0;
      return (
        <div className="grid gap-2">
          <Big>{pct}%</Big>
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            <div className="bg-chart-1" style={{ width: `${o.units ? (o.occupied / o.units) * 100 : 0}%` }} />
            <div className="bg-chart-2" style={{ width: `${o.units ? (o.vacant / o.units) * 100 : 0}%` }} />
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-chart-1" /> {o.occupied} occupied</li>
            <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-chart-2" /> <Link className="hover:underline" href="/app/reports/vacancy">{o.vacant} vacant</Link></li>
            <li className="text-muted-foreground">{o.notice} on notice / moving out</li>
          </ul>
        </div>
      );
    }
    case "pnl":
      return <PnlChart rows={data.pnl} />;
    case "expiring": {
      const e = data.expiring;
      return (
        <div className="grid gap-3">
          <dl className="grid grid-cols-3 gap-2 text-center">
            {([["30 days", e.d30], ["60 days", e.d60], ["90 days", e.d90]] as const).map(([l, v]) => (
              <div key={l} className="rounded-lg bg-surface-muted/60 py-2"><dt className="text-xs text-muted-foreground">{l}</dt><dd className="text-xl font-semibold tabular">{v}</dd></div>
            ))}
          </dl>
          <ul className="grid gap-1 text-sm">
            {e.next.map((l) => <li key={l.id} className="flex justify-between gap-2"><Link className="truncate hover:underline" href={`/app/leasing/${l.id}`}>{l.label}</Link><span className="shrink-0 text-muted-foreground">{formatDate(l.endDate)}</span></li>)}
            {!e.next.length ? <li className="text-muted-foreground">Nothing ending in the next 90 days.</li> : null}
          </ul>
        </div>
      );
    }
    case "requests": {
      const r = data.requests;
      const open = (r.NOT_STARTED ?? 0) + (r.IN_PROGRESS ?? 0) + (r.WAITING ?? 0);
      return (
        <div className="grid gap-2">
          <Big>{open} open</Big>
          <ul className="grid grid-cols-3 gap-2 text-center text-sm">
            {([["Not started", r.NOT_STARTED], ["In progress", r.IN_PROGRESS], ["Waiting", r.WAITING]] as const).map(([l, v]) => (
              <li key={l} className="rounded-lg bg-surface-muted/60 py-2"><span className="block text-xs text-muted-foreground">{l}</span><span className="text-lg font-semibold tabular">{v ?? 0}</span></li>
            ))}
          </ul>
        </div>
      );
    }
    case "bills": {
      const b = data.bills;
      return (
        <div className="grid gap-2">
          <div className="flex gap-6">
            <div><div className="text-xs text-muted-foreground">Overdue</div><div className={cn("text-xl font-semibold tabular", b.overdueCents > 0 && "text-danger")}>{formatMoney(b.overdueCents, { showCents: false })}</div></div>
            <div><div className="text-xs text-muted-foreground">Next 7 days</div><div className="text-xl font-semibold tabular">{formatMoney(b.weekCents, { showCents: false })}</div></div>
          </div>
          <ul className="grid gap-1 text-sm">
            {b.next.map((x) => <li key={x.id} className="flex justify-between gap-2"><Link className="truncate hover:underline" href={`/app/accounting/bills/${x.id}`}>{x.vendor}</Link><span className={cn("shrink-0 tabular", x.dueDate < data.today && "text-danger")}>{formatMoney(x.openCents)} · {formatDate(x.dueDate)}</span></li>)}
            {!b.next.length ? <li className="text-muted-foreground">Nothing due this week.</li> : null}
          </ul>
        </div>
      );
    }
    case "cash":
      return (
        <ul className="grid gap-2 text-sm">
          {data.cash.map((c) => <li key={c.id} className="flex justify-between gap-2"><Link className="hover:underline" href={`/app/accounting/banking/${c.id}`}>{c.name}</Link><span className={cn("tabular font-medium", c.cents < 0 && "text-danger")}>{formatMoney(c.cents, { showCents: false })}</span></li>)}
          <li className="flex justify-between gap-2 border-t border-border pt-2 font-semibold"><span>Total</span><span className="tabular">{formatMoney(data.cash.reduce((s, c) => s + c.cents, 0), { showCents: false })}</span></li>
        </ul>
      );
  }
}

const monthShort = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

/** Grouped bars (income vs expenses) with hover tooltip, a legend and an accessible table. */
function PnlChart({ rows }: { rows: WidgetData["pnl"] }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const max = Math.max(1, ...rows.flatMap((r) => [r.income, r.expenses]));
  const W = 300;
  const H = 120;
  const band = W / rows.length;
  const bw = Math.min(16, band / 2 - 4);
  const y = (v: number) => H - Math.round((Math.max(0, v) / max) * (H - 4));
  const h = hover !== null ? rows[hover] : null;
  return (
    <div className="grid gap-2">
      <ul className="flex gap-4 text-xs" aria-hidden>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-1" /> Income</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-2" /> Expenses</li>
      </ul>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" aria-hidden onMouseLeave={() => setHover(null)}>
          <line x1={0} x2={W} y1={H} y2={H} className="stroke-border" strokeWidth={1} />
          {rows.map((r, i) => {
            const cx = band * i + band / 2;
            return (
              <g key={r.month} onMouseEnter={() => setHover(i)}>
                <rect x={band * i} y={0} width={band} height={H + 18} fill="transparent" />
                {hover === i ? <rect x={band * i + 2} y={0} width={band - 4} height={H} className="fill-surface-muted" /> : null}
                <rect x={cx - bw - 1} y={y(r.income)} width={bw} height={H - y(r.income)} rx={3} className="fill-chart-1" />
                <rect x={cx + 1} y={y(r.expenses)} width={bw} height={H - y(r.expenses)} rx={3} className="fill-chart-2" />
                <text x={cx} y={H + 13} textAnchor="middle" className="fill-muted-foreground text-[10px]">{monthShort(r.month)}</text>
              </g>
            );
          })}
        </svg>
        {h ? (
          <div className="pointer-events-none absolute top-0 rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-card" style={{ left: `min(calc(${((hover! + 0.5) / rows.length) * 100}% - 4rem), calc(100% - 8rem))` }}>
            <div className="font-medium">{monthShort(h.month)}</div>
            <div>Income {formatMoney(h.income, { showCents: false })}</div>
            <div>Expenses {formatMoney(h.expenses, { showCents: false })}</div>
            <div className="text-muted-foreground">Net {formatMoney(h.income - h.expenses, { showCents: false })}</div>
          </div>
        ) : null}
      </div>
      <table className="sr-only">
        <caption>Income and expenses by month</caption>
        <thead><tr><th scope="col">Month</th><th scope="col">Income</th><th scope="col">Expenses</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.month}><th scope="row">{monthShort(r.month)}</th><td>{formatMoney(r.income)}</td><td>{formatMoney(r.expenses)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
