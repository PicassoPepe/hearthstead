"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { centsToInput, parseMoney } from "@/lib/money";
import { inputClass } from "./input";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  valueCents: number | null;
  onChangeCents: (cents: number | null) => void;
};

/** Text input that edits integer cents. Never produces floats. */
export const MoneyInput = React.forwardRef<HTMLInputElement, Props>(function MoneyInput(
  { valueCents, onChangeCents, className, onBlur, ...props },
  ref,
) {
  const [text, setText] = React.useState(valueCents == null ? "" : centsToInput(valueCents));
  const last = React.useRef(valueCents);
  React.useEffect(() => {
    if (valueCents !== last.current) {
      last.current = valueCents;
      setText(valueCents == null ? "" : centsToInput(valueCents));
    }
  }, [valueCents]);
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
        $
      </span>
      <input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        className={cn(inputClass, "tabular pl-6 text-right", className)}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const c = parseMoney(e.target.value);
          last.current = c;
          onChangeCents(c);
        }}
        onBlur={(e) => {
          const c = parseMoney(text);
          if (c != null) setText(centsToInput(c));
          onBlur?.(e);
        }}
        {...props}
      />
    </div>
  );
});
