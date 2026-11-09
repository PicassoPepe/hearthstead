import { getSmsProvider } from "@/adapters/sms";
import { devToolsEnabled } from "@/lib/dev-tools";

/** Offer "text me the code" when a real SMS provider is set up (or the test one in test mode). */
export const smsAvailable = () => getSmsProvider().name !== "mock" || devToolsEnabled();
