import { z } from "zod";

/** Shared Zod schemas: used by React Hook Form on the client and re-validated on the server. */
export const companySchema = z.object({
  name: z.string().trim().min(2, "Company name is required").max(120),
  email: z.union([z.literal(""), z.email("Enter a valid email")]),
  phone: z.string().trim().max(40),
  addressLine1: z.string().trim().max(200),
  city: z.string().trim().max(100),
  state: z.string().trim().max(40),
  postalCode: z.string().trim().max(20),
  timezone: z.string().min(1),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color like #0C4C54"),
});
export type CompanyInput = z.infer<typeof companySchema>;

export const inviteSchema = z.object({
  name: z.string().trim().min(2, "Enter their name").max(120),
  email: z.email("Enter a valid email"),
  roleId: z.string().min(1, "Choose a role"),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;
