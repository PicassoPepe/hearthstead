"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { refreshLandRecordAction } from "@/server/actions/rentals";
import { uploadFiles } from "@/server/actions/records";

export function RefreshLandRecordButton({ propertyId, hasRecord }: { propertyId: string; hasRecord: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button size="sm" variant={hasRecord ? "secondary" : "primary"} loading={busy} onClick={async () => {
      setBusy(true);
      const r = await refreshLandRecordAction(propertyId);
      setBusy(false);
      if (!r.ok) return void toast.error(r.error);
      if (r.data.status === "LOOKED_UP") toast.success("County record updated");
      else toast.warning(r.data.message ?? "No parcel found for this address");
      router.refresh();
    }}><RefreshCw aria-hidden /> {hasRecord ? "Refresh from county" : "Look up county record"}</Button>
  );
}

export function LandDocsUpload({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [category, setCategory] = React.useState("Deed");
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect aria-label="Document type" className="w-40" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="Deed">Deed</option>
        <option value="TitlePolicy">Title policy</option>
        <option value="Survey">Survey</option>
        <option value="Plat">Plat</option>
      </NativeSelect>
      <label htmlFor={id} className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium shadow-sm hover:bg-surface-muted focus-within:ring-2 focus-within:ring-ring ${busy ? "pointer-events-none opacity-60" : ""}`}>
        <Upload className="size-4" aria-hidden /> {busy ? "Uploading…" : "Attach document"}
        <input id={id} type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const fd = new FormData();
          fd.append("files", f);
          fd.append("entityType", "Property");
          fd.append("entityId", propertyId);
          fd.append("category", category);
          setBusy(true);
          const r = await uploadFiles(fd);
          setBusy(false);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Document attached");
          router.refresh();
        }} />
      </label>
    </div>
  );
}
