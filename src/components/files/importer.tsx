"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileDropzone } from "@/components/records/files-panel";
import { IMPORT_SPECS, applyMapping, autoMap, missingRequired, templateCsv, type ImportKind, type ImportResult, type Mapping, type RawRow } from "@/lib/importer";
import { importRecords } from "@/server/actions/importer";
import { cn } from "@/lib/utils";

type Stage = "upload" | "map" | "review" | "done";

async function parseFile(file: File): Promise<{ headers: string[]; rows: RawRow[] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/browser");
    const grid = (await readSheet(file)) as unknown[][];
    const headers = (grid[0] ?? []).map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
    const rows = grid.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] == null ? "" : String(r[i])])));
    return { headers, rows };
  }
  if (name.endsWith(".csv") || file.type === "text/csv") {
    const Papa = (await import("papaparse")).default;
    const text = await file.text();
    const res = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    return { headers: res.meta.fields ?? [], rows: res.data };
  }
  throw new Error("Upload a .csv or .xlsx file");
}

/** Upload → map columns → preview & validate (server dry run) → import (atomic). */
export function Importer({ initialKind = "properties", canImport }: { initialKind?: ImportKind; canImport: Record<ImportKind, boolean> }) {
  const router = useRouter();
  const [kind, setKind] = React.useState<ImportKind>(initialKind);
  const [stage, setStage] = React.useState<Stage>("upload");
  const [fileName, setFileName] = React.useState("");
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<RawRow[]>([]);
  const [mapping, setMapping] = React.useState<Mapping>({});
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const spec = IMPORT_SPECS[kind];
  const records = React.useMemo(() => applyMapping(rows, mapping), [rows, mapping]);
  const missing = missingRequired(mapping, kind);

  const reset = () => {
    setStage("upload");
    setHeaders([]);
    setRows([]);
    setResult(null);
    setFileName("");
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([templateCsv(kind)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `hearthstead-${kind}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const validate = async () => {
    setBusy(true);
    const r = await importRecords({ kind, records, commit: false });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    setResult(r.data);
    setStage("review");
  };

  const commit = async () => {
    setBusy(true);
    const r = await importRecords({ kind, records, commit: true });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    setResult(r.data);
    if (!r.data.ok) return void toast.error("Some rows have problems — nothing was imported");
    setStage("done");
    toast.success(`Imported ${r.data.summary}`);
    router.refresh();
  };

  const stages: { id: Stage; label: string }[] = [
    { id: "upload", label: "Upload" },
    { id: "map", label: "Map columns" },
    { id: "review", label: "Review" },
    { id: "done", label: "Done" },
  ];
  const stageIdx = stages.findIndex((s) => s.id === stage);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Import from a spreadsheet</CardTitle>
          <CardDescription>CSV or Excel (.xlsx). Nothing is saved until every row passes validation.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        <ol className="flex flex-wrap gap-2 text-[13px]" aria-label="Import progress">
          {stages.map((s, i) => (
            <li key={s.id} aria-current={i === stageIdx ? "step" : undefined} className={cn("rounded-full px-2.5 py-1 font-medium", i === stageIdx ? "bg-primary-soft text-primary-soft-foreground" : i < stageIdx ? "text-foreground" : "text-muted-foreground")}>
              {i + 1}. {s.label}
            </li>
          ))}
        </ol>

        {stage === "upload" ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1.5 text-[13px] font-medium">
                What are you importing?
                <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as ImportKind)} className="w-64">
                  {(Object.keys(IMPORT_SPECS) as ImportKind[]).map((k) => (
                    <option key={k} value={k} disabled={!canImport[k]}>{IMPORT_SPECS[k].title}</option>
                  ))}
                </NativeSelect>
              </label>
              <Button variant="secondary" onClick={downloadTemplate}><Download aria-hidden /> Download template</Button>
            </div>
            <p className="text-sm text-muted-foreground">{spec.description}</p>
            <FileDropzone
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onFiles={async (files) => {
                const f = files[0]!;
                try {
                  const parsed = await parseFile(f);
                  if (parsed.rows.length === 0) return void toast.error("That file has no data rows");
                  setFileName(f.name);
                  setHeaders(parsed.headers);
                  setRows(parsed.rows);
                  setMapping(autoMap(parsed.headers, kind));
                  setStage("map");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Couldn't read that file");
                }
              }}
            />
          </div>
        ) : null}

        {stage === "map" ? (
          <div className="grid gap-4">
            <p className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden />
              <strong>{fileName}</strong> · {rows.length} row{rows.length === 1 ? "" : "s"} · {headers.length} columns
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <caption className="sr-only">Column mapping</caption>
                <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground">
                  <tr><th scope="col" className="px-3 py-2 font-medium">Hearthstead field</th><th scope="col" className="px-3 py-2 font-medium">Column in your file</th><th scope="col" className="px-3 py-2 font-medium">First value</th></tr>
                </thead>
                <tbody>
                  {spec.fields.map((f) => {
                    const header = mapping[f.key];
                    return (
                      <tr key={f.key} className="border-t border-border">
                        <th scope="row" className="px-3 py-2 text-left font-medium">
                          {f.label}
                          {f.required ? <span className="text-danger" aria-hidden> *</span> : null}
                          {f.required ? <span className="sr-only"> (required)</span> : null}
                          {f.help ? <div className="text-xs font-normal text-muted-foreground">{f.help}</div> : null}
                        </th>
                        <td className="px-3 py-2">
                          <NativeSelect
                            aria-label={`Column for ${f.label}`}
                            className="w-56"
                            value={header ?? ""}
                            onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || null })}
                          >
                            <option value="">— Don&apos;t import —</option>
                            {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                          </NativeSelect>
                        </td>
                        <td className="max-w-48 truncate px-3 py-2 text-muted-foreground">{header ? (rows[0]?.[header] ?? "") : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {missing.length ? <p role="alert" className="text-sm text-danger">Map the required fields: {missing.join(", ")}</p> : null}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={reset}>Start over</Button>
              <Button onClick={validate} loading={busy} disabled={missing.length > 0}>Validate {records.length} rows</Button>
            </div>
          </div>
        ) : null}

        {stage === "review" && result ? (
          <div className="grid gap-4">
            {result.ok ? (
              <p role="status" className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm text-success-soft-foreground">
                <CheckCircle2 className="size-4" aria-hidden /> All rows look good. Ready to import {result.summary}.
              </p>
            ) : (
              <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">
                <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" aria-hidden /> {result.issues.length} problem{result.issues.length === 1 ? "" : "s"} found. Fix them in your file and upload again, or change the mapping.</p>
              </div>
            )}
            {result.issues.length ? (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <caption className="sr-only">Problems</caption>
                  <thead className="sticky top-0 bg-surface-muted text-left text-xs text-muted-foreground"><tr><th scope="col" className="px-3 py-2">Row</th><th scope="col" className="px-3 py-2">Field</th><th scope="col" className="px-3 py-2">Problem</th></tr></thead>
                  <tbody>
                    {result.issues.slice(0, 200).map((iss, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-1.5 tabular">{iss.row || "—"}</td>
                        <td className="px-3 py-1.5">{spec.fields.find((f) => f.key === iss.field)?.label ?? iss.field ?? ""}</td>
                        <td className="px-3 py-1.5">{iss.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <caption className="sr-only">Preview of the first rows</caption>
                  <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground">
                    <tr>{spec.fields.filter((f) => mapping[f.key]).map((f) => <th key={f.key} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{f.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {records.slice(0, 8).map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        {spec.fields.filter((f) => mapping[f.key]).map((f) => <td key={f.key} className="whitespace-nowrap px-3 py-1.5">{r[f.key]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {records.length > 8 ? <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">…and {records.length - 8} more</p> : null}
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setStage("map")}>Back to mapping</Button>
              <Button variant="ghost" onClick={reset}>Upload a different file</Button>
              {result.ok ? <Button onClick={commit} loading={busy}>Import {result.summary}</Button> : null}
            </div>
          </div>
        ) : null}

        {stage === "done" && result ? (
          <div className="grid gap-3">
            <p role="status" className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-5 text-success" aria-hidden /> Imported {result.summary}.</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(result.created ?? {}).map(([k, n]) => <Badge key={k} tone="success">{n} {k}</Badge>)}
            </div>
            <div className="flex gap-2">
              <Button asChild><Link href={kind === "owners" ? "/app/people/owners" : kind === "leases" ? "/app/leasing" : "/app/rentals"}>View {kind === "owners" ? "owners" : kind === "leases" ? "leases" : "properties"}</Link></Button>
              <Button variant="secondary" onClick={reset}>Import another file</Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
