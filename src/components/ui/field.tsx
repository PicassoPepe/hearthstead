"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

type FieldProps = {
  label: string;
  /** id of the control; generated if omitted */
  id?: string;
  description?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean; "aria-required"?: boolean }) => React.ReactNode;
};

/** Label + control + help + error with correct ARIA wiring. Every input goes through this. */
export function Field({ label, id, description, error, required, className, children }: FieldProps) {
  const auto = React.useId();
  const controlId = id ?? auto;
  const descId = description ? `${controlId}-desc` : undefined;
  const errId = error ? `${controlId}-err` : undefined;
  const describedBy = [descId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={controlId}>
        {label}
        {required ? (
          <span className="text-danger" aria-hidden>
            {" "}*
          </span>
        ) : null}
      </Label>
      {children({ id: controlId, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, "aria-required": required || undefined })}
      {description ? (
        <p id={descId} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errId} className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
