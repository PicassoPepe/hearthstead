import type { BillingState } from "@/server/billing/subscription";

export const BILLING_STATE_LABEL: Record<BillingState, { text: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  comped: { text: "Free (beta)", tone: "success" },
  trial: { text: "Free trial", tone: "warning" },
  trial_ended: { text: "Trial ended", tone: "danger" },
  active: { text: "Active", tone: "success" },
  past_due: { text: "Payment problem", tone: "warning" },
  read_only: { text: "Read-only (unpaid)", tone: "danger" },
  canceled: { text: "Canceled", tone: "danger" },
};
