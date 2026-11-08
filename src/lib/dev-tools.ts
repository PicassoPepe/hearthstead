/**
 * Developer tools (/dev/outbox, /dev/sms, the local webhook sink, http webhook URLs) are on in
 * development, and off in production unless ENABLE_DEV_TOOLS=1 — used to run the end-to-end
 * suite against a production build. Never set it on a public deployment.
 */
export const devToolsEnabled = () => process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_TOOLS === "1";
