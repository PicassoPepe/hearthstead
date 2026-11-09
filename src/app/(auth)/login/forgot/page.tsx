import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Forgot password" };

export default function ForgotPage() {
  return <ForgotForm mock={(process.env.EMAIL_PROVIDER ?? "mock") === "mock"} />;
}
