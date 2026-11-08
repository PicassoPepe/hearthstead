/** Shared constants and labels for the leasing funnel. */
export const APPLY_COOKIE = "dw_apply";
export const PROSPECT_STATUSES = ["NEW", "CONTACTED", "TOURED", "APPLIED", "LEASED", "LOST"] as const;
export const PROSPECT_STATUS_LABEL: Record<string, string> = { NEW: "New", CONTACTED: "Contacted", TOURED: "Toured", APPLIED: "Applied", LEASED: "Leased", LOST: "Lost" };
export const APP_STATUS_LABEL: Record<string, string> = { DRAFT: "In progress", SUBMITTED: "Submitted", SCREENING: "Screening", APPROVED: "Approved", DECLINED: "Declined", WITHDRAWN: "Withdrawn" };
export const LISTING_STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", PUBLISHED: "Published", UNLISTED: "Unlisted" };
export const SOURCES = ["WEBSITE", "ZILLOW", "WALK_IN", "REFERRAL", "PHONE", "OTHER"] as const;
