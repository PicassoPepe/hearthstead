import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="portal-density flex min-h-dvh flex-col bg-background">
      <header className="flex h-16 items-center px-6">
        <Link href="/" className="flex items-center gap-2 rounded-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="DeedWood" className="h-12 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dark.svg" alt="DeedWood" className="hidden h-12 w-auto dark:block" />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-16">{children}</main>
    </div>
  );
}
