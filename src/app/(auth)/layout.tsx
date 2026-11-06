import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="portal-density flex min-h-dvh flex-col bg-background">
      <header className="flex h-16 items-center px-6">
        <Link href="/" className="flex items-center gap-2 rounded-md">
          <span aria-hidden className="flex size-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">H</span>
          <span className="text-lg font-semibold tracking-tight">Hearthstead</span>
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-16">{children}</main>
    </div>
  );
}
