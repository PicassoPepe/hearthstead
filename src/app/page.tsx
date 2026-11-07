import { redirect } from "next/navigation";
import { getContext } from "@/server/context";
import { getPortalContext } from "@/server/portal/context";
import { getOwnerPortalContext } from "@/server/portal/owner-context";

export default async function Home() {
  const ctx = await getContext();
  if (ctx) redirect("/app/overview");
  if (await getPortalContext()) redirect("/portal/tenant");
  redirect((await getOwnerPortalContext()) ? "/portal/owner" : "/login");
}
