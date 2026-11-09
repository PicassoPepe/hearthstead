/** Next.js hook: unexpected page/route errors are recorded for the owner console and alerts. */
export async function onRequestError(err: unknown, request: { path: string }, context: { routeType: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordError } = await import("@/server/ops/errors");
  await recordError(context.routeType === "route" ? "route" : "render", err, { path: request.path, digest: (err as { digest?: string })?.digest ?? null });
}
