import { z } from "zod";

/** Client-safe maintenance vocabulary and schemas. */
export const TASK_TYPES = ["TASK", "TENANT_REQUEST", "OWNER_REQUEST", "WORK_ORDER", "INSPECTION"] as const;
export const TASK_TYPE_LABEL: Record<(typeof TASK_TYPES)[number], string> = {
  TASK: "Task", TENANT_REQUEST: "Tenant request", OWNER_REQUEST: "Owner request", WORK_ORDER: "Work order", INSPECTION: "Inspection",
};
export const TASK_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "WAITING", "COMPLETED", "ARCHIVED"] as const;
export const STATUS_LABEL: Record<(typeof TASK_STATUSES)[number], string> = { NOT_STARTED: "Not started", IN_PROGRESS: "In progress", WAITING: "Waiting", COMPLETED: "Completed", ARCHIVED: "Archived" };
export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const PRIORITY_LABEL: Record<(typeof PRIORITIES)[number], string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" };

export const CATEGORIES = [
  { value: "PLUMBING", label: "Plumbing" },
  { value: "ELECTRICAL", label: "Electrical" },
  { value: "HVAC", label: "Heating & cooling" },
  { value: "APPLIANCE", label: "Appliance" },
  { value: "PEST", label: "Pests" },
  { value: "LOCKSMITH", label: "Locks & keys" },
  { value: "ROOFING", label: "Roof & leaks" },
  { value: "LANDSCAPING", label: "Landscaping & snow" },
  { value: "CLEANING", label: "Cleaning" },
  { value: "GENERAL", label: "General repair" },
] as const;
export type Category = (typeof CATEGORIES)[number]["value"];
export const categoryLabel = (c: string | null | undefined) => CATEGORIES.find((x) => x.value === c)?.label ?? "General";

export const taskInputSchema = z.object({
  type: z.enum(TASK_TYPES).default("TASK"),
  title: z.string().trim().min(3, "Give the task a title").max(140),
  description: z.string().trim().max(5000).optional().default(""),
  category: z.string().max(40).optional().nullable(),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  dueDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().default(""),
  propertyId: z.string().optional().nullable(),
  unitId: z.string().optional().nullable(),
  leaseId: z.string().optional().nullable(),
  tenantId: z.string().optional().nullable(),
  vendorId: z.string().optional().nullable(),
  assigneeIds: z.array(z.string()).max(20).default([]),
  estimateCents: z.number().int().min(0).nullable().optional(),
  notifyVendor: z.boolean().default(false),
  parentTaskId: z.string().optional().nullable(),
  permissionToEnter: z.boolean().nullable().optional(),
  preferredTimes: z.string().trim().max(200).optional().nullable(),
  inspectionKind: z.enum(["MOVE_IN", "MOVE_OUT", "PERIODIC"]).optional().nullable(),
});
export type TaskInput = z.input<typeof taskInputSchema>;

export const vendorSchema = z.object({
  name: z.string().trim().min(2, "Enter the vendor's name").max(120),
  contactName: z.string().trim().max(120).optional().default(""),
  email: z.union([z.literal(""), z.email("Enter a valid email")]).default(""),
  phone: z.string().trim().max(40).optional().default(""),
  trades: z.array(z.string()).default([]),
  taxIdLast4: z.union([z.literal(""), z.string().regex(/^\d{4}$/, "Last 4 digits only")]).default(""),
  send1099: z.boolean().default(true),
  w9OnFile: z.boolean().default(false),
  insuranceExpires: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default(""),
});
export type VendorInput = z.input<typeof vendorSchema>;

export const CONDITIONS = [
  { value: "GOOD", label: "Good" },
  { value: "FAIR", label: "Fair" },
  { value: "POOR", label: "Poor" },
  { value: "DAMAGED", label: "Damaged" },
  { value: "NA", label: "N/A" },
] as const;

/** Default room-by-room checklist for inspections. */
export const INSPECTION_TEMPLATE: { room: string; items: string[] }[] = [
  { room: "Entry & living room", items: ["Front door & locks", "Walls & paint", "Floors", "Windows & screens", "Light fixtures & outlets", "Smoke detector"] },
  { room: "Kitchen", items: ["Refrigerator", "Range / oven", "Dishwasher", "Sink & faucet", "Cabinets & counters", "Floors"] },
  { room: "Bathroom", items: ["Toilet", "Tub / shower", "Sink & faucet", "Exhaust fan", "Walls & ceiling", "Floors"] },
  { room: "Bedroom", items: ["Door", "Walls & paint", "Floors / carpet", "Closet", "Windows & blinds", "Smoke detector"] },
  { room: "Utilities", items: ["Water heater", "Furnace / HVAC filter", "Washer / dryer", "CO detector"] },
];

/** Status a task should move to when the tenant (or staff) does X — used for the portal timeline wording. */
export const PUBLIC_STATUS_TEXT: Record<string, string> = {
  NOT_STARTED: "Request received",
  IN_PROGRESS: "Work in progress",
  WAITING: "Waiting on parts or scheduling",
  COMPLETED: "Completed",
  ARCHIVED: "Closed",
};
