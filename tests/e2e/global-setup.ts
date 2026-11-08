import { execSync } from "node:child_process";

const PORT = Number(process.env.PORT ?? 3000);

/**
 * Reset demo data so every run starts from the same seed, then warm the dev server: the first
 * request to a route compiles it, which under load can take longer than an assertion waits.
 * (Unauthenticated requests still compile the page before redirecting to sign-in.)
 */
export default async function globalSetup(): Promise<void> {
  execSync("pnpm -s db:seed", { stdio: "inherit" });
  const routes = [
    "/login", "/app/overview", "/app/rentals", "/app/rentals/x", "/app/rentals/units/x", "/app/leasing", "/app/leasing/x", "/app/new/property", "/app/new/lease",
    "/app/new/task", "/app/new/user", "/app/new/owner", "/app/people/tenants", "/app/people/tenants/x", "/app/people/owners/x", "/app/tasks", "/app/tasks/x",
    "/app/accounting", "/app/accounting/bills", "/app/accounting/bills/x", "/app/communications", "/app/reports", "/app/reports/profit-loss", "/app/settings",
    "/portal/tenant", "/portal/tenant/pay", "/portal/owner", "/dev/outbox", "/l/maple-main",
  ];
  for (const r of routes) {
    try {
      await fetch(`http://localhost:${PORT}${r}`, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
    } catch {
      /* the server may not be up yet when Playwright starts it; tests will compile on demand */
    }
  }
}
