import { execSync } from "node:child_process";

/** Reset demo data so every run starts from the same seed. */
export default function globalSetup(): void {
  execSync("pnpm -s db:seed", { stdio: "inherit" });
}
