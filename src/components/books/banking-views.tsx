"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Papa from "papaparse";
import { RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  categorizeBankTxnAction, completeReconciliationAction, createDepositAction, ignoreBankTxnAction, importBankCsvAction, matchBankTxnAction,
  startReconciliationAction, syncBankFeedAction, undoReconciliationAction,
} from "@/server/actions/books";

type Bank = { id: string; label: string; purpose: string };

export type UndepositedRow = { id: string; date: string; amountCents: number; method: string; reference: string | null; property: string; payer: string };

/** Undeposited Funds → pick payments → one bank deposit (matches the bank statement line). */
export function UndepositedFunds({ rows, banks, today, canEdit }: { rows: UndepositedRow[]; banks: Bank[]; today: string; canEdit: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = React.useState<string[]>([]);
  const [bank, setBank] = React.useState(banks.find((b) => b.purpose !== "SECURITY_DEPOSIT")?.id ?? "");
  const [date, setDate] = React.useState(today);
  const [busy, setBusy] = React.useState(false);
  const total = rows.filter((r) => picked.includes(r.id)).reduce((s, r) => s + r.amountCents, 0);
  const all = picked.length === rows.length && rows.length > 0;
  return (
    <section aria-labelledby="und-h" className="rounded-card border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-3">
        <div className="mr-auto">
          <h2 id="und-h" className="font-semibold">Undeposited funds</h2>
          <p className="text-sm text-muted-foreground">{rows.length} payments · {formatMoney(rows.reduce((s, r) => s + r.amountCents, 0))} waiting to be banked</p>
        </div>
        {canEdit && rows.length ? (
          <>
            <Field label="Deposit to">{(a) => <NativeSelect {...a} className="w-56" value={bank} onChange={(e) => setBank(e.target.value)}>{banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</NativeSelect>}</Field>
            <Field label="Deposit date">{(a) => <Input {...a} type="date" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
            <Button loading={busy} disabled={!picked.length} onClick={async () => {
              setBusy(true);
              const r = await createDepositAction({ bankAccountId: bank, date, paymentIds: picked });
              setBusy(false);
              if (!r.ok) return void toast.error(r.error);
              toast.success(`Deposited ${formatMoney(total)} (${picked.length} payments)`);
              setPicked([]);
              router.refresh();
            }}>Deposit {picked.length ? formatMoney(total) : "selected"}</Button>
          </>
        ) : null}
      </div>
      {rows.length ? (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Undeposited payments</caption>
            <thead className="sticky top-0 bg-surface-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select all payments" className="size-4" checked={all} onChange={(e) => setPicked(e.target.checked ? rows.map((r) => r.id) : [])} /></th>
                <th scope="col" className="px-3 py-2 font-medium">Date</th><th scope="col" className="px-3 py-2 font-medium">From</th><th scope="col" className="px-3 py-2 font-medium">Property</th><th scope="col" className="px-3 py-2 font-medium">Method</th><th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2"><input type="checkbox" className="size-4" aria-label={`Select ${formatMoney(r.amountCents)} from ${r.payer} on ${formatDate(r.date)}`} checked={picked.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))} /></td>
                  <td className="px-3 py-2">{formatDate(r.date)}</td>
                  <td className="px-3 py-2">{r.payer}</td>
                  <td className="px-3 py-2">{r.property}</td>
                  <td className="px-3 py-2">{r.method.toLowerCase()}{r.reference ? ` #${r.reference}` : ""}</td>
                  <td className="px-3 py-2 text-right tabular">{formatMoney(r.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="p-4 text-sm text-muted-foreground">Everything received has been deposited.</p>}
    </section>
  );
}

export type FeedRow = { id: string; date: string; description: string; amountCents: number; status: string; matched: string | null; suggestions: { lineId: string; date: string; amountCents: number; memo: string; daysApart: number }[] };

/** Bank feed review: match to a register line, categorize, or exclude. */
export function BankFeed({ bankAccountId, rows, categories, properties, canEdit }: { bankAccountId: string; rows: FeedRow[]; categories: { id: string; label: string }[]; properties: { id: string; name: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [tab, setTab] = React.useState<"review" | "done">("review");
  const [syncing, setSyncing] = React.useState(false);
  const [cat, setCat] = React.useState<FeedRow | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const shown = rows.filter((r) => (tab === "review" ? r.status === "UNMATCHED" : r.status !== "UNMATCHED"));
  const act = async (p: Promise<{ ok: boolean; error?: string; message?: string }>) => {
    const r = await p;
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message ?? "Done");
    router.refresh();
  };
  return (
    <section aria-labelledby="feed-h" className="rounded-card border border-border bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <h2 id="feed-h" className="mr-auto font-semibold">Bank feed</h2>
        <nav aria-label="Feed filter" className="inline-flex rounded-lg border border-border p-0.5">
          {(["review", "done"] as const).map((t) => (
            <button key={t} type="button" aria-current={tab === t ? "true" : undefined} onClick={() => setTab(t)} className={`rounded-md px-3 py-1 text-sm font-medium ${tab === t ? "bg-primary-soft text-primary-soft-foreground" : "text-muted-foreground"}`}>
              {t === "review" ? `For review (${rows.filter((r) => r.status === "UNMATCHED").length})` : "Handled"}
            </button>
          ))}
        </nav>
        {canEdit ? (
          <>
            <Button variant="secondary" size="sm" loading={syncing} onClick={async () => {
              setSyncing(true);
              const r = await syncBankFeedAction(bankAccountId);
              setSyncing(false);
              if (!r.ok) return void toast.error(r.error);
              toast.success(`Bank feed synced — ${r.data.added} new transaction${r.data.added === 1 ? "" : "s"}`);
              router.refresh();
            }}><RefreshCw aria-hidden /> Sync bank feed</Button>
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><Upload aria-hidden /> Import CSV</Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Bank statement CSV" onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              Papa.parse<Record<string, string>>(f, {
                header: true, skipEmptyLines: true,
                complete: async (res) => {
                  const r = await importBankCsvAction(bankAccountId, res.data);
                  e.target.value = "";
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(`Imported ${r.data.added} transactions${r.data.skipped ? ` (${r.data.skipped} already imported)` : ""}${r.data.errors.length ? ` · ${r.data.errors.length} rows skipped` : ""}`);
                  router.refresh();
                },
              });
            }} />
          </>
        ) : null}
      </div>
      <table className="w-full text-sm">
        <caption className="sr-only">Bank transactions</caption>
        <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground">
          <tr><th scope="col" className="px-3 py-2 font-medium">Date</th><th scope="col" className="px-3 py-2 font-medium">Description</th><th scope="col" className="px-3 py-2 text-right font-medium">Amount</th><th scope="col" className="px-3 py-2 font-medium">{tab === "review" ? "Suggested match" : "Status"}</th>{canEdit ? <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th> : null}</tr>
        </thead>
        <tbody>
          {shown.length ? shown.map((r) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.date)}</td>
              <td className="px-3 py-2">{r.description}</td>
              <td className={`px-3 py-2 text-right tabular font-medium ${r.amountCents > 0 ? "text-success" : ""}`}>{formatMoney(r.amountCents)}</td>
              <td className="px-3 py-2">
                {r.status === "UNMATCHED"
                  ? r.suggestions.length
                    ? <ul className="grid gap-1">{r.suggestions.map((s) => (
                        <li key={s.lineId} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{formatDate(s.date)} · {s.memo}</span>
                          {canEdit ? <Button size="sm" variant="secondary" onClick={() => act(matchBankTxnAction(r.id, s.lineId))} aria-label={`Match ${r.description} to ${s.memo}`}>Match</Button> : null}
                        </li>
                      ))}</ul>
                    : <span className="text-xs text-muted-foreground">No register match — categorize it</span>
                  : <span className="flex items-center gap-2"><StatusBadge status={r.status} />{r.matched ? <span className="text-xs text-muted-foreground">{r.matched}</span> : null}</span>}
              </td>
              {canEdit ? (
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {r.status === "UNMATCHED" ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setCat(r)} aria-label={`Categorize ${r.description}`}>Categorize</Button>
                      <Button size="sm" variant="ghost" onClick={() => act(ignoreBankTxnAction(r.id, true))} aria-label={`Exclude ${r.description}`}>Exclude</Button>
                    </>
                  ) : r.status !== "CATEGORIZED" ? <Button size="sm" variant="ghost" onClick={() => act(ignoreBankTxnAction(r.id, false))} aria-label={`Undo ${r.description}`}>Undo</Button> : null}
                </td>
              ) : null}
            </tr>
          )) : <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">{tab === "review" ? "Nothing to review. Sync the bank feed or import a CSV statement." : "Nothing handled yet."}</td></tr>}
        </tbody>
      </table>
      <CategorizeDialog row={cat} onClose={() => setCat(null)} categories={categories} properties={properties} onDone={() => router.refresh()} />
    </section>
  );
}

function CategorizeDialog({ row, onClose, categories, properties, onDone }: { row: FeedRow | null; onClose: () => void; categories: { id: string; label: string }[]; properties: { id: string; name: string }[]; onDone: () => void }) {
  const [accountId, setAccountId] = React.useState("");
  const [propertyId, setPropertyId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!row) return;
    const guess = categories.find((c) => (row.description.includes("FEE") ? /Bank Fees/.test(c.label) : row.description.includes("INTEREST") ? /Other Income/.test(c.label) : false));
    setAccountId(guess?.id ?? "");
  }, [row, categories]);
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Categorize transaction</DialogTitle><DialogDescription>{row ? `${formatDate(row.date)} · ${row.description} · ${formatMoney(row.amountCents)}` : ""}</DialogDescription></DialogHeader>
        <DialogBody className="grid gap-3">
          <Field label="Category" required>{(a) => <NativeSelect {...a} value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Choose…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</NativeSelect>}</Field>
          <Field label="Property">{(a) => <NativeSelect {...a} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}><option value="">Company (no property)</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>}</Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!accountId} onClick={async () => {
            setBusy(true);
            const r = await categorizeBankTxnAction(row!.id, { accountId, propertyId: propertyId || null });
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Categorized — posted to the ledger");
            onClose();
            onDone();
          }}>Post</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- reconciliation

export function StartReconciliation({ bankAccountId, defaultDate, suggestedBalance }: { bankAccountId: string; defaultDate: string; suggestedBalance: number }) {
  const router = useRouter();
  const [date, setDate] = React.useState(defaultDate);
  const [bal, setBal] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <form noValidate className="flex flex-wrap items-start gap-3" onSubmit={async (e) => {
      e.preventDefault();
      if (bal === null) return void toast.error("Enter the statement's ending balance");
      setBusy(true);
      const r = await startReconciliationAction({ bankAccountId, statementDate: date, statementBalanceCents: bal });
      setBusy(false);
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    }}>
      <Field label="Statement end date" required>{(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      <Field label="Statement ending balance" required description={`Ledger shows ${formatMoney(suggestedBalance)}`}>{(a) => <MoneyInput {...a} valueCents={bal} onChangeCents={setBal} />}</Field>
      <Button type="submit" className="mt-6" loading={busy}>Start reconciling</Button>
    </form>
  );
}

export type RecLine = { id: string; date: string; memo: string; amountCents: number; cleared: boolean; inFeed: boolean };

export function ReconcileWorkspace({ rec, lines }: { rec: { id: string; statementDate: string; statementBalanceCents: number; openingBalanceCents: number }; lines: RecLine[] }) {
  const router = useRouter();
  const [ticked, setTicked] = React.useState<string[]>(() => lines.filter((l) => l.cleared || l.inFeed).map((l) => l.id));
  const [busy, setBusy] = React.useState(false);
  const cleared = rec.openingBalanceCents + lines.filter((l) => ticked.includes(l.id)).reduce((s, l) => s + l.amountCents, 0);
  const diff = rec.statementBalanceCents - cleared;
  const deposits = lines.filter((l) => l.amountCents > 0);
  const withdrawals = lines.filter((l) => l.amountCents < 0);
  const Section = ({ title, items }: { title: string; items: RecLine[] }) => (
    <fieldset className="rounded-card border border-border bg-surface shadow-card">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-center justify-between border-b border-border px-3 py-2"><h3 className="font-medium">{title}</h3><span className="text-xs text-muted-foreground">{items.filter((i) => ticked.includes(i.id)).length} of {items.length} cleared</span></div>
      <ul className="max-h-[28rem] divide-y divide-border overflow-auto text-sm">
        {items.map((l) => (
          <li key={l.id} className="flex items-center gap-3 px-3 py-1.5">
            <input id={`rl-${l.id}`} type="checkbox" className="size-4" checked={ticked.includes(l.id)} onChange={(e) => setTicked(e.target.checked ? [...ticked, l.id] : ticked.filter((x) => x !== l.id))} />
            <label htmlFor={`rl-${l.id}`} className="flex flex-1 items-center gap-2">
              <span className="w-24 shrink-0 tabular">{formatDate(l.date)}</span>
              <span className="flex-1 truncate">{l.memo}</span>
              {l.inFeed ? <Badge tone="success">In bank feed</Badge> : null}
              <span className="tabular">{formatMoney(Math.abs(l.amountCents))}</span>
            </label>
          </li>
        ))}
        {!items.length ? <li className="px-3 py-4 text-muted-foreground">None.</li> : null}
      </ul>
    </fieldset>
  );
  return (
    <div className="grid gap-4">
      <div className="sticky top-14 z-10 grid grid-cols-2 gap-3 rounded-card border border-border bg-surface p-3 shadow-card sm:grid-cols-4" aria-live="polite">
        <div><div className="text-xs text-muted-foreground">Opening (last reconciled)</div><div className="tabular font-semibold">{formatMoney(rec.openingBalanceCents)}</div></div>
        <div><div className="text-xs text-muted-foreground">Statement balance</div><div className="tabular font-semibold">{formatMoney(rec.statementBalanceCents)}</div></div>
        <div><div className="text-xs text-muted-foreground">Cleared balance</div><div className="tabular font-semibold">{formatMoney(cleared)}</div></div>
        <div><div className="text-xs text-muted-foreground">Difference</div><div className={`tabular font-semibold ${diff === 0 ? "text-success" : "text-danger"}`} data-testid="rec-difference">{formatMoney(diff)}</div></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setTicked(lines.map((l) => l.id))}>Clear all</Button>
        <Button variant="secondary" size="sm" onClick={() => setTicked([])}>Unclear all</Button>
        <Button className="ml-auto" loading={busy} disabled={diff !== 0} onClick={async () => {
          setBusy(true);
          const r = await completeReconciliationAction(rec.id, ticked);
          setBusy(false);
          if (!r.ok) return void toast.error(r.error);
          toast.success(`Reconciled through ${formatDate(rec.statementDate)}`);
          router.refresh();
        }}>Finish reconciliation</Button>
      </div>
      {diff !== 0 ? <p className="text-sm text-muted-foreground">Tick the transactions that appear on your statement. You can finish when the difference is $0.00.</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Deposits & credits" items={deposits} />
        <Section title="Checks & payments" items={withdrawals} />
      </div>
    </div>
  );
}

export function UndoReconciliationButton({ id }: { id: string }) {
  const router = useRouter();
  return <Button size="sm" variant="ghost" onClick={async () => {
    const r = await undoReconciliationAction(id);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Reconciliation undone");
    router.refresh();
  }}>Undo</Button>;
}
