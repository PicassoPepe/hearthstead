"use client";

import * as React from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AddressSuggestion } from "@/adapters/address";

/** WAI-ARIA combobox for the street line; picking a suggestion fills city/state/ZIP. */
export function AddressAutocomplete({
  id,
  value,
  onChange,
  onPick,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onPick: (s: AddressSuggestion) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [items, setItems] = React.useState<AddressSuggestion[]>([]);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const listId = `${id}-list`;

  React.useEffect(() => {
    if (value.trim().length < 4) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/address?q=${encodeURIComponent(value)}`, { signal: ctrl.signal });
        if (r.ok) setItems(((await r.json()) as { suggestions: AddressSuggestion[] }).suggestions);
      } catch {
        /* aborted */
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [value]);

  const show = open && items.length > 0;
  const pick = (s: AddressSuggestion) => {
    onPick(s);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % items.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(items[active]!);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Start typing, e.g. 418 Oak"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Address suggestions"
        className={cn("absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-pop", !show && "hidden")}
      >
        {items.map((s, i) => (
          <li
            key={s.label}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(s);
            }}
            className={cn("flex cursor-pointer items-center gap-2 px-3 py-2 text-sm", i === active && "bg-surface-muted")}
          >
            <MapPin className="size-4 text-muted-foreground" aria-hidden />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
