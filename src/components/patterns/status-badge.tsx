import { Badge } from "@/components/ui/badge";
import { CheckCircle2, CircleDashed, Clock, AlertTriangle, XCircle, Circle, Mail } from "lucide-react";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

/** Status always shown as icon + text (never color alone). Unknown statuses fall back to neutral. */
const MAP: Record<string, { tone: Tone; label: string; Icon: typeof Circle }> = {
  ACTIVE: { tone: "success", label: "Active", Icon: CheckCircle2 },
  INVITED: { tone: "info", label: "Invited", Icon: Mail },
  SUSPENDED: { tone: "danger", label: "Suspended", Icon: XCircle },
  DRAFT: { tone: "neutral", label: "Draft", Icon: CircleDashed },
  PENDING: { tone: "warning", label: "Pending", Icon: Clock },
  ENDED: { tone: "neutral", label: "Ended", Icon: Circle },
  EVICTION: { tone: "danger", label: "Eviction", Icon: AlertTriangle },
  NOT_STARTED: { tone: "neutral", label: "Not started", Icon: Circle },
  IN_PROGRESS: { tone: "info", label: "In progress", Icon: Clock },
  WAITING: { tone: "warning", label: "Waiting", Icon: Clock },
  COMPLETED: { tone: "success", label: "Completed", Icon: CheckCircle2 },
  FAILED: { tone: "danger", label: "Failed", Icon: XCircle },
  SUCCEEDED: { tone: "success", label: "Succeeded", Icon: CheckCircle2 },
  INITIATED: { tone: "neutral", label: "Initiated", Icon: CircleDashed },
  PROCESSING: { tone: "info", label: "Processing", Icon: Clock },
  PAID_OUT: { tone: "success", label: "Paid out", Icon: CheckCircle2 },
  CANCELED: { tone: "neutral", label: "Canceled", Icon: XCircle },
  VACANT: { tone: "warning", label: "Vacant", Icon: CircleDashed },
  OCCUPIED: { tone: "success", label: "Occupied", Icon: CheckCircle2 },
  NOT_INVITED: { tone: "neutral", label: "Not invited", Icon: Circle },
  ARCHIVED: { tone: "neutral", label: "Archived", Icon: Circle },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const m = MAP[status] ?? { tone: "neutral" as const, label: status.replace(/_/g, " ").toLowerCase(), Icon: Circle };
  return (
    <Badge tone={m.tone}>
      <m.Icon className="size-3" aria-hidden />
      {label ?? m.label}
    </Badge>
  );
}
