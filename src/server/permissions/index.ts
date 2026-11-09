/**
 * Role-based permissions with per-module levels and optional property scoping.
 * Pure module — safe to import from client components to hide UI the user can't use.
 * The server re-checks every action (see requirePermission in src/server/context.ts).
 */
export const MODULES = [
  "rentals",
  "leasing",
  "people",
  "accounting",
  "discounts",
  "tasks",
  "communications",
  "reports",
  "files",
  "workflows",
  "ai",
  "settings",
  "users",
] as const;
export type Module = (typeof MODULES)[number];

export const LEVELS = ["none", "view", "edit", "delete"] as const;
export type Level = (typeof LEVELS)[number];

export type PermissionSet = Partial<Record<Module, Level>>;

export const MODULE_LABELS: Record<Module, string> = {
  rentals: "Rentals",
  leasing: "Leasing",
  people: "People",
  accounting: "Accounting",
  discounts: "Discounts (Edit = give, Full = approve)",
  tasks: "Tasks & maintenance",
  communications: "Communications",
  reports: "Reports",
  files: "Files",
  workflows: "Workflows",
  ai: "AI assistant",
  settings: "Company settings",
  users: "Users & roles",
};

const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2, delete: 3 };

export function isLevel(v: unknown): v is Level {
  return typeof v === "string" && (LEVELS as readonly string[]).includes(v);
}

/** Normalise untrusted JSON (from the Role table) into a PermissionSet. Unknown keys drop. */
export function parsePermissions(raw: unknown): PermissionSet {
  const out: PermissionSet = {};
  if (!raw || typeof raw !== "object") return out;
  for (const m of MODULES) {
    const v = (raw as Record<string, unknown>)[m];
    if (isLevel(v)) out[m] = v;
  }
  return out;
}

export function levelFor(perms: PermissionSet, module: Module): Level {
  return perms[module] ?? "none";
}

export function can(perms: PermissionSet, module: Module, level: Exclude<Level, "none"> = "view"): boolean {
  return RANK[levelFor(perms, module)] >= RANK[level];
}

/** Empty scope means "all properties". */
export function canAccessProperty(propertyScope: readonly string[], propertyId: string): boolean {
  return propertyScope.length === 0 || propertyScope.includes(propertyId);
}

function all(level: Level): Record<Module, Level> {
  return Object.fromEntries(MODULES.map((m) => [m, level])) as Record<Module, Level>;
}

export type BuiltInRoleKey =
  | "ADMIN"
  | "PROPERTY_MANAGER"
  | "BOOKKEEPER"
  | "MAINTENANCE"
  | "VENDOR"
  | "OWNER_READONLY";

export const BUILT_IN_ROLES: Record<
  BuiltInRoleKey,
  { name: string; description: string; permissions: Record<Module, Level> }
> = {
  ADMIN: {
    name: "Admin",
    description: "Full access to everything, including billing, users and security.",
    permissions: all("delete"),
  },
  PROPERTY_MANAGER: {
    name: "Property Manager",
    description: "Runs day-to-day operations: rentals, leasing, people, tasks and communications.",
    permissions: {
      ...all("edit"),
      accounting: "edit",
      discounts: "edit",
      settings: "view",
      users: "view",
      workflows: "edit",
    },
  },
  BOOKKEEPER: {
    name: "Bookkeeper",
    description: "Owns the books: accounting and reports; read access elsewhere.",
    permissions: {
      ...all("view"),
      accounting: "delete",
      discounts: "view",
      reports: "edit",
      tasks: "view",
      communications: "view",
      workflows: "none",
      ai: "view",
      users: "none",
    },
  },
  MAINTENANCE: {
    name: "Maintenance",
    description: "Handles tasks, work orders and inspections. Read access to rentals and people.",
    permissions: {
      ...all("none"),
      rentals: "view",
      people: "view",
      tasks: "edit",
      files: "edit",
      communications: "view",
    },
  },
  VENDOR: {
    name: "Vendor",
    description: "External vendor. Sees only work orders assigned to them.",
    permissions: { ...all("none"), tasks: "view", files: "view" },
  },
  OWNER_READONLY: {
    name: "Read-only Owner",
    description: "Read-only access to rentals, leasing and reports, scoped to their properties.",
    permissions: { ...all("none"), rentals: "view", leasing: "view", reports: "view", files: "view" },
  },
};

export class PermissionError extends Error {
  constructor(public readonly module: Module, public readonly level: Level) {
    super(`You don't have ${level} access to ${MODULE_LABELS[module]}.`);
    this.name = "PermissionError";
  }
}
