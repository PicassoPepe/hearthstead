"use client";

import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input, NativeSelect } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { formatMoney } from "@/lib/money";
import type { Scope } from "@/server/settings/registry";
import type { SettingRowData } from "@/server/settings/meta";
import { SOURCE_LABEL } from "@/server/settings/resolver";
import { clearSettingOverride, saveSetting } from "@/server/actions/settings";

function display(row: SettingRowData, v: unknown): string {
  switch (row.input.kind) {
    case "boolean": return v ? "On" : "Off";
    case "money": return formatMoney(Number(v));
    case "percent": return `${(Number(v) / 100).toFixed(2).replace(/\.00$/, "")}%`;
    case "select": return row.input.options.find((o) => o.value === v)?.label ?? String(v);
    case "number": return `${String(v)}${row.input.suffix ? ` ${row.input.suffix}` : ""}`;
    default: return String(v);
  }
}

/**
 * One setting at one scope. Shows where the effective value comes from ("Inherited from
 * Company" / "Default") with an Override toggle; edits save immediately with a toast.
 */
export function SettingRow({ row, scope, scopeId, canEdit }: { row: SettingRowData; scope: Scope; scopeId?: string; canEdit: boolean }) {
  const [overridden, setOverridden] = React.useState(row.source === scope);
  const [value, setValue] = React.useState<unknown>(row.value);
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();
  const parentLabel = SOURCE_LABEL[row.inheritedSource];
  const scopeNoun = scope === "ORG" ? "company" : scope.toLowerCase();

  const persist = (v: unknown, successMessage = `${row.label} saved`) =>
    startTransition(async () => {
      const r = await saveSetting({ key: row.key, scope, scopeId, value: v });
      if (r.ok) toast.success(successMessage);
      else toast.error(r.error);
    });

  const toggleOverride = (on: boolean) => {
    const prev = { overridden, value };
    setOverridden(on);
    if (on) {
      persist(value, `${row.label}: custom ${scopeNoun} value on`);
    } else {
      setValue(row.inheritedValue);
      startTransition(async () => {
        const r = await clearSettingOverride({ key: row.key, scope, scopeId });
        if (!r.ok) {
          setOverridden(prev.overridden);
          setValue(prev.value);
          toast.error(r.error);
          return;
        }
        toast.success(`${row.label} now uses the ${parentLabel.toLowerCase()} value`, {
          action: { label: "Undo", onClick: () => { setOverridden(true); setValue(prev.value); persist(prev.value); } },
        });
      });
    }
  };

  const disabled = !canEdit || !overridden || pending;
  const control = (() => {
    const common = { id, disabled, "aria-describedby": `${id}-src` } as const;
    switch (row.input.kind) {
      case "boolean":
        return (
          <Switch
            {...common}
            checked={Boolean(value)}
            onCheckedChange={(c) => { setValue(c); persist(c); }}
          />
        );
      case "money":
        return (
          <div className="w-36">
            <MoneyInput {...common} valueCents={Number(value)} onChangeCents={(c) => c != null && setValue(c)} onBlur={() => value !== row.value && persist(value)} />
          </div>
        );
      case "percent":
        return (
          <div className="flex items-center gap-1.5">
            <Input
              {...common}
              className="w-24 text-right tabular"
              inputMode="decimal"
              defaultValue={(Number(value) / 100).toString()}
              key={String(overridden)}
              onBlur={(e) => {
                const bps = Math.round(Number(e.target.value) * 100);
                if (Number.isFinite(bps)) { setValue(bps); persist(bps); }
              }}
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        );
      case "number":
        return (
          <div className="flex items-center gap-1.5">
            <Input
              {...common}
              type="number"
              className="w-20 text-right tabular"
              min={row.input.min}
              max={row.input.max}
              value={String(value)}
              onChange={(e) => setValue(Number(e.target.value))}
              onBlur={() => persist(value)}
            />
            {row.input.suffix ? <span className="text-sm text-muted-foreground">{row.input.suffix}</span> : null}
          </div>
        );
      case "select":
        return (
          <NativeSelect {...common} className="w-auto min-w-48" value={String(value)} onChange={(e) => { setValue(e.target.value); persist(e.target.value); }}>
            {row.input.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </NativeSelect>
        );
      case "color":
        return (
          <div className="flex items-center gap-2">
            <input type="color" {...common} value={String(value)} onChange={(e) => setValue(e.target.value)} onBlur={() => persist(value)} className="h-9 w-12 cursor-pointer rounded-lg border border-input bg-surface" />
            <span className="tabular text-sm text-muted-foreground">{String(value)}</span>
          </div>
        );
      case "text":
        return <Input {...common} value={String(value)} onChange={(e) => setValue(e.target.value)} onBlur={() => persist(value)} />;
    }
  })();

  return (
    <div className="flex flex-col gap-3 border-b border-border py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between" data-setting={row.key}>
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">{row.label}</label>
        {row.help ? <p className="text-xs text-muted-foreground">{row.help}</p> : null}
        <div id={`${id}-src`} className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          {overridden ? (
            <Badge tone="primary">Custom {scopeNoun} value</Badge>
          ) : (
            <Badge tone="outline">
              {row.inheritedSource === "DEFAULT" ? "Using default" : `Inherited from ${parentLabel}`}: {display(row, row.inheritedValue)}
            </Badge>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4">
        {control}
        {canEdit ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={overridden} onCheckedChange={toggleOverride} disabled={pending} aria-label={`Override ${row.label}`} />
            {scope === "ORG" ? "Customize" : "Override"}
          </label>
        ) : null}
      </div>
    </div>
  );
}
