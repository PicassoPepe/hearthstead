/**
 * Start `next dev` with a larger heap. Next forks its server and only passes the heap size on via
 * NODE_OPTIONS, so set it here (works on Windows, macOS and Linux).
 */
import { spawn } from "node:child_process";
const port = process.argv[2] ?? process.env.PORT ?? "3000";
const base = process.env.NODE_OPTIONS ?? "";
const opts = /max-old-space-size/.test(base) ? base : `${base} --max-old-space-size=6144`.trim();
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", port], { stdio: "inherit", env: { ...process.env, NODE_OPTIONS: opts } });
child.on("exit", (code) => process.exit(code ?? 0));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
