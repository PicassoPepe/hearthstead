import { ForgotForm } from "./forgot-form";
import { captchaSiteKey } from "@/server/auth/captcha";

export const metadata = { title: "Forgot password" };

export default function ForgotPage() {
  return <ForgotForm mock={(process.env.EMAIL_PROVIDER ?? "mock") === "mock"} captchaSiteKey={captchaSiteKey()} />;
}
