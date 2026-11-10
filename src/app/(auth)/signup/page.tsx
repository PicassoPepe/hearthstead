import { SignupForm } from "./signup-form";
import { CompanyStep } from "./company-step";
import { auth } from "@/server/auth";
import { adminDb } from "@/server/db";
import { captchaSiteKey } from "@/server/auth/captcha";
import { oauthProviders } from "@/server/auth/oauth";
import { smsAvailable } from "@/server/auth/sms-available";

export const metadata = { title: "Start your free trial" };

export default async function SignupPage() {
  // Signed in (e.g. with Google) but no company yet → just name the company.
  const s = await auth();
  if (s?.user?.id && !(await adminDb.membership.count({ where: { userId: s.user.id, deletedAt: null } }))) return <CompanyStep email={s.user.email ?? ""} />;
  return <SignupForm captchaSiteKey={captchaSiteKey()} oauth={oauthProviders()} sms={smsAvailable()} />;
}
