import { Badge } from "@/components/ui/badge";
import { CheckCircle2, CircleDashed, Clock, AlertTriangle, XCircle, Circle, Mail } from "lucide-react";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

/** Status always shown as icon + text (never color alone). Unknown statuses fall back to neutral. */
const MAP: Record<string, { tone: Tone; label: string; Icon: typeof Circle }> = {
  ACTIVE: { tone: "success", label: "Active", Icon: CheckCircle2 },
  INVITED: { tone: "info", label: "Invited", Icon: Mail },
  PAUSED: { tone: "warning", label: "Paused", Icon: Clock },
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
  OPEN: { tone: "warning", label: "Open", Icon: Clock },
  PARTIALLY_PAID: { tone: "info", label: "Partially paid", Icon: Clock },
  PAID: { tone: "success", label: "Paid", Icon: CheckCircle2 },
  VOID: { tone: "neutral", label: "Void", Icon: XCircle },
  OVERDUE: { tone: "danger", label: "Overdue", Icon: AlertTriangle },
  UNMATCHED: { tone: "warning", label: "For review", Icon: CircleDashed },
  MATCHED: { tone: "success", label: "Matched", Icon: CheckCircle2 },
  CATEGORIZED: { tone: "success", label: "Categorized", Icon: CheckCircle2 },
  IGNORED: { tone: "neutral", label: "Excluded", Icon: Circle },
  PUBLISHED: { tone: "success", label: "Published", Icon: CheckCircle2 },
  UNLISTED: { tone: "neutral", label: "Unlisted", Icon: Circle },
  SUBMITTED: { tone: "info", label: "Submitted", Icon: Clock },
  SCREENING: { tone: "info", label: "Screening", Icon: Clock },
  APPROVED: { tone: "success", label: "Approved", Icon: CheckCircle2 },
  DECLINED: { tone: "danger", label: "Declined", Icon: XCircle },
  WITHDRAWN: { tone: "neutral", label: "Withdrawn", Icon: Circle },
  SCHEDULED: { tone: "info", label: "Scheduled", Icon: Clock },
  NO_SHOW: { tone: "warning", label: "No-show", Icon: AlertTriangle },
  SENT: { tone: "info", label: "Sent", Icon: Mail },
  ACCEPTED: { tone: "success", label: "Accepted", Icon: CheckCircle2 },
  EXPIRED: { tone: "neutral", label: "Expired", Icon: Circle },
  VOIDED: { tone: "neutral", label: "Voided", Icon: XCircle },
  SIGNED: { tone: "success", label: "Signed", Icon: CheckCircle2 },
  VIEWED: { tone: "info", label: "Viewed", Icon: Clock },
  NEW: { tone: "info", label: "New", Icon: Circle },
  CONTACTED: { tone: "neutral", label: "Contacted", Icon: Mail },
  TOURED: { tone: "primary", label: "Toured", Icon: CheckCircle2 },
  APPLIED: { tone: "primary", label: "Applied", Icon: CheckCircle2 },
  LEASED: { tone: "success", label: "Leased", Icon: CheckCircle2 },
  LOST: { tone: "neutral", label: "Lost", Icon: XCircle },
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
