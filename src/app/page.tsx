import { redirect } from "next/navigation";
import { getContext } from "@/server/context";
import { getPortalContext } from "@/server/portal/context";

export default async function Home() {
  const ctx = await getContext();
  if (ctx) redirect("/app/overview");
  redirect((await getPortalContext()) ? "/portal/tenant" : "/login");
}
