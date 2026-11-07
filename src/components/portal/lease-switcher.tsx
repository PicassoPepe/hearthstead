"use client";

import { useRouter } from "next/navigation";
import { NativeSelect } from "@/components/ui/input";
import { selectLease } from "@/server/actions/portal";

export function LeaseSwitcher({ leases, current }: { leases: { id: string; label: string; status: string }[]; current: string }) {
  const router = useRouter();
  return (
    <NativeSelect
      aria-label="Choose a lease"
      value={current}
      onChange={async (e) => {
        await selectLease(e.target.value);
        router.refresh();
      }}
    >
      {leases.map((l) => <option key={l.id} value={l.id}>{l.label}{l.status === "ENDED" ? " (ended)" : ""}</option>)}
    </NativeSelect>
  );
}
