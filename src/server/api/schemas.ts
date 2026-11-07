import { z } from "zod";

/**
 * Public API schemas — the single source for request validation AND the OpenAPI 3.1 document
 * (generated with z.toJSONSchema). Money is always integer cents; dates are YYYY-MM-DD.
 */
const id = z.string().describe("Object ID");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date, YYYY-MM-DD");
const cents = z.number().int().describe("Amount in integer cents (USD)");

export const Address = z.object({ line1: z.string(), line2: z.string().nullable(), city: z.string(), state: z.string(), postal_code: z.string(), country: z.string() }).meta({ id: "Address" });
export const Property = z.object({ id, object: z.literal("property"), name: z.string(), type: z.string(), address: Address, portfolio_id: id.nullable(), unit_count: z.number().int(), created_at: z.string() }).meta({ id: "Property" });
export const Unit = z.object({ id, object: z.literal("unit"), property_id: id, name: z.string(), beds: z.number().int().nullable(), baths: z.number().nullable(), sqft: z.number().int().nullable(), market_rent: cents, occupied: z.boolean() }).meta({ id: "Unit" });
export const Tenant = z.object({ id, object: z.literal("tenant"), first_name: z.string().nullable(), last_name: z.string().nullable(), company_name: z.string().nullable(), email: z.string().nullable(), phone: z.string().nullable(), portal_status: z.string(), created_at: z.string() }).meta({ id: "Tenant" });
export const Lease = z.object({ id, object: z.literal("lease"), property_id: id, unit_ids: z.array(id), tenant_ids: z.array(id), status: z.string(), start_date: date, end_date: date.nullable(), move_out_date: date.nullable(), rent: cents, deposit: cents, created_at: z.string() }).meta({ id: "Lease" });
export const Balance = z.object({ object: z.literal("balance"), lease_id: id, receivable: cents, prepaid: cents, balance: cents.describe("Receivable minus prepaid; positive means the tenant owes") }).meta({ id: "Balance" });
export const Transaction = z.object({ id, object: z.literal("transaction"), lease_id: id, type: z.string(), amount: cents, date, due_date: date.nullable(), memo: z.string().nullable(), method: z.string().nullable(), voided: z.boolean() }).meta({ id: "Transaction" });
export const Task = z.object({ id, object: z.literal("task"), number: z.number().int(), type: z.string(), status: z.string(), priority: z.string(), title: z.string(), description: z.string().nullable(), category: z.string().nullable(), property_id: id.nullable(), unit_id: id.nullable(), due_date: date.nullable(), created_at: z.string() }).meta({ id: "Task" });

export const CreateTask = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().max(5000).optional(),
  type: z.enum(["TASK", "WORK_ORDER", "TENANT_REQUEST"]).default("TASK"),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  category: z.string().max(40).optional(),
  property_id: z.string().optional(),
  unit_id: z.string().optional(),
  due_date: date.optional(),
}).meta({ id: "CreateTask" });
export const UpdateTask = z.object({ status: z.enum(["NOT_STARTED", "IN_PROGRESS", "WAITING", "COMPLETED", "ARCHIVED"]).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), title: z.string().trim().min(2).max(200).optional() }).meta({ id: "UpdateTask" });
export const CreateTenant = z.object({ first_name: z.string().trim().min(1).max(60), last_name: z.string().trim().min(1).max(60), email: z.string().email().optional(), phone: z.string().max(30).optional() }).meta({ id: "CreateTenant" });
export const CreateCharge = z.object({ amount: z.number().int().positive().describe("Integer cents"), date: date.optional(), memo: z.string().max(200).optional(), account: z.enum(["RENT_INCOME", "LATE_FEE_INCOME", "OTHER_INCOME"]).default("OTHER_INCOME") }).meta({ id: "CreateCharge" });

export const ErrorBody = z.object({ error: z.object({ type: z.string(), message: z.string(), details: z.unknown().optional() }) }).meta({ id: "Error" });
export const list = <T extends z.ZodType>(item: T, name: string) => z.object({ object: z.literal("list"), data: z.array(item), has_more: z.boolean(), next_cursor: z.string().nullable() }).meta({ id: `${name}List` });
