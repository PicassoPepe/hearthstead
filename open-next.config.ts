import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Default cache (no extra R2 bucket). The app is signed-in and dynamic; marketing pages are a
// separate static folder uploaded to Cloudflare Pages.
export default defineCloudflareConfig();
