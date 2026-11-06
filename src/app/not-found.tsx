import Link from "next/link";

export default function NotFound() {
  return (
    <main className="portal-density flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="text-2xl font-semibold">We couldn&apos;t find that page</h1>
      <p className="text-muted-foreground">It may have moved, or you may not have access to it.</p>
      <Link href="/" className="mt-2 font-medium text-primary underline">Go home</Link>
    </main>
  );
}
