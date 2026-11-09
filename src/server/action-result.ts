import { PermissionError } from "@/server/permissions";
import { CrossTenantError } from "@/server/dal/scope";
import { ZodError } from "zod";

/** Uniform server-action result so forms can show inline errors and toasts. */
export type ActionResult<T = void> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function runAction<T>(fn: () => Promise<T>, successMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: successMessage };
  } catch (e) {
    if (e instanceof PermissionError || e instanceof CrossTenantError) return { ok: false, error: e.message };
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of e.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
      return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
    }
    if (e instanceof UserFacingError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    console.error(e);
    // Server-only reporting (dynamic import keeps database code out of anything that imports this file).
    void import("@/server/ops/errors").then((m) => m.recordError("action", e)).catch(() => undefined);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export class UserFacingError extends Error {
  constructor(message: string, public readonly fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "UserFacingError";
  }
}
