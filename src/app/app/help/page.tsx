import Link from "next/link";
import { BookOpen, Building2, CreditCard, FileSignature, Hammer, LifeBuoy, Megaphone, PieChart, Rocket, Users } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Kbd } from "@/components/ui/misc";

export const metadata = { title: "Help" };

const SHORTCUTS = [
  { keys: ["⌘/Ctrl", "K"], label: "Open the command palette (search, navigate, create)" },
  { keys: ["Tab"], label: "Move between controls; focus is always visible" },
  { keys: ["Esc"], label: "Close a dialog, menu or the palette" },
];

type Guide = { icon: typeof Rocket; title: string; steps: { text: string; href?: string }[] };

/** Short, task-focused how-tos. Each step links to the exact place in the app. */
const GUIDES: Guide[] = [
  { icon: Rocket, title: "Get set up in 5 minutes", steps: [
    { text: "Run the setup guide: company details, logo, payments and team", href: "/app/setup" },
    { text: "Not ready for real data? Load sample data into a sandbox from step 2", href: "/app/setup?step=2" },
    { text: "Tick off the Getting started checklist on your Overview", href: "/app/overview" },
  ] },
  { icon: Building2, title: "Add properties and photos", steps: [
    { text: "Create new → Property walks you through address, units, rents and owners", href: "/app/new/property" },
    { text: "Open a property → Photos to drag in pictures; the first one is the cover" },
    { text: "Moving from another system? Import properties, owners and leases from CSV", href: "/app/files?import=properties" },
  ] },
  { icon: FileSignature, title: "Lease a unit", steps: [
    { text: "Create new → Lease: tenants, rent, deposit and move-in charges", href: "/app/new/lease" },
    { text: "Send the lease for e-signature from the lease's Files tab" },
    { text: "Invite tenants to the resident portal so they can pay online", href: "/app/people/tenants" },
  ] },
  { icon: CreditCard, title: "Collect rent", steps: [
    { text: "Connect online payments (ACH and card)", href: "/app/settings/payments" },
    { text: "Set reminders before and after the due date", href: "/app/settings/notifications" },
    { text: "Review the late-fee policy (grace period, caps)", href: "/app/settings/late-fees" },
    { text: "Record checks and cash with Create new → Payment", href: "/app/new/payment" },
  ] },
  { icon: Hammer, title: "Handle maintenance", steps: [
    { text: "Tenant requests arrive in Tasks; assign a vendor and track status", href: "/app/tasks" },
    { text: "Run move-in and move-out inspections with photos per item" },
    { text: "Turn a vendor invoice into a bill in one click from the work order" },
  ] },
  { icon: PieChart, title: "Owners and accounting", steps: [
    { text: "Pay bills and record expenses", href: "/app/accounting/bills" },
    { text: "Reconcile your bank accounts monthly", href: "/app/accounting/reconcile" },
    { text: "Run owner statements and distributions", href: "/app/accounting/distributions" },
    { text: "Reports: rent roll, P&L, balance sheet, 1099s and more", href: "/app/reports" },
  ] },
  { icon: Megaphone, title: "Fill vacancies", steps: [
    { text: "Create a listing — the AI writer drafts the description", href: "/app/rentals/listings" },
    { text: "Share your public listings page; prospects book showings and apply online" },
    { text: "Review applications with screening, then create the lease in one click", href: "/app/leasing/applications" },
  ] },
  { icon: Users, title: "Your team and security", steps: [
    { text: "Invite people with the right role", href: "/app/settings/users" },
    { text: "Turn on two-factor authentication and add a profile photo", href: "/app/settings/security" },
  ] },
];

export default function HelpPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader icon={<LifeBuoy aria-hidden />} title="Help center" description="Step-by-step guides for everyday work, plus keyboard shortcuts." />
      <ul className="grid gap-4 md:grid-cols-2">
        {GUIDES.map((g) => (
          <li key={g.title}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><span className="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"><g.icon className="size-4" aria-hidden /></span>{g.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="grid list-decimal gap-1.5 pl-5 text-sm marker:text-muted-foreground">
                  {g.steps.map((s) => (
                    <li key={s.text}>{s.href ? <Link href={s.href} className="text-foreground underline decoration-border-strong underline-offset-4 hover:text-primary hover:decoration-primary">{s.text}</Link> : s.text}</li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      <Card className="mt-4">
        <CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="size-4" aria-hidden /> Keyboard shortcuts</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {SHORTCUTS.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <span>{s.label}</span>
                <span className="flex gap-1">{s.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
