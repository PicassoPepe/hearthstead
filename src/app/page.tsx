import { redirect } from "next/navigation";
import { getContext } from "@/server/context";

export default async function Home() {
  const ctx = await getContext();
  redirect(ctx ? "/app/overview" : "/login");
}
