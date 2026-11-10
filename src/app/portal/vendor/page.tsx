import { redirect } from "next/navigation";
import { auth } from "@/server/auth";

/**
 * Vendors work in the staff app (Invoices), not a separate portal shell.
 * This route exists so /portal/vendor — including a sign-in callback — is not a 404.
 */
export default async function VendorPortalEntry() {
  const session = await auth();
  if (!session?.user) redirect("/login?portal=vendor&callbackUrl=%2Fapp%2Finvoices");
  redirect("/app/invoices");
}
