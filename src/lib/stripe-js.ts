"use client";

/**
 * Loads Stripe.js from js.stripe.com (allowed by our content security policy). Card and bank
 * details are typed into Stripe's own fields, so they never touch DeedWood's servers.
 * Only the pieces DeedWood uses are typed here.
 */
export type StripeElement = { mount(el: HTMLElement): void; destroy(): void; on(event: "change", cb: (e: { complete: boolean; error?: { message: string } }) => void): void };
export type StripeElements = { create(type: "payment" | "card", opts?: Record<string, unknown>): StripeElement; submit(): Promise<{ error?: { message: string } }> };
export type StripeJs = {
  elements(opts?: Record<string, unknown>): StripeElements;
  confirmSetup(opts: { elements: StripeElements; redirect: "if_required"; confirmParams: { return_url: string } }): Promise<{ error?: { message: string }; setupIntent?: { id: string; status: string } }>;
  createPaymentMethod(opts: { type: "card"; card: StripeElement; billing_details?: Record<string, unknown> }): Promise<{ error?: { message: string }; paymentMethod?: { id: string } }>;
};

declare global {
  interface Window { Stripe?: (key: string) => StripeJs }
}

let loading: Promise<StripeJs> | null = null;

export function loadStripe(publishableKey: string): Promise<StripeJs> {
  if (typeof window === "undefined") return Promise.reject(new Error("Stripe.js runs in the browser"));
  if (window.Stripe) return Promise.resolve(window.Stripe(publishableKey));
  loading ??= new Promise<StripeJs>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://js.stripe.com/v3/";
    s.async = true;
    s.onload = () => (window.Stripe ? resolve(window.Stripe(publishableKey)) : reject(new Error("Stripe.js didn't load")));
    s.onerror = () => { loading = null; reject(new Error("Couldn't reach Stripe. Check your connection and try again.")); };
    document.head.appendChild(s);
  });
  return loading;
}

/** Match the app's look inside Stripe's fields. */
export const STRIPE_APPEARANCE = { theme: "stripe", variables: { colorPrimary: "#0C4C54", borderRadius: "8px", fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" } };
