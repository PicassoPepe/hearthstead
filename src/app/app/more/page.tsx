import { Bot, FolderOpen, LifeBuoy, Settings, StickyNote, Workflow } from "lucide-react";
import { requireContext } from "@/server/context";
import { PageHeader } from "@/components/patterns/page-header";
import { BigActions, PageHelp } from "@/components/patterns/big-actions";
import { MoreHorizontal } from "lucide-react";

export const metadata = { title: "More" };

export default async function MorePage() {
  await requireContext();
  return (
    <>
      <PageHeader icon={<MoreHorizontal aria-hidden />} title="More tools" />
      <PageHelp>Extra tools you won&apos;t need every day.</PageHelp>
      <BigActions items={[
        { href: "/app/files", label: "Files & documents", hint: "Leases, photos and papers. Import from a spreadsheet.", icon: FolderOpen },
        { href: "/app/notes", label: "Notes", hint: "Notes you've written about properties and people.", icon: StickyNote },
        { href: "/app/ai", label: "AI helper", hint: "Ask a question like “who owes rent?” in plain words.", icon: Bot },
        { href: "/app/workflows", label: "Automations", hint: "Make things happen on their own, like a thank-you email.", icon: Workflow },
        { href: "/app/settings", label: "Settings", hint: "Your company, team, late fees and more.", icon: Settings },
        { href: "/app/help", label: "Help", hint: "Step-by-step guides.", icon: LifeBuoy },
      ]} />
    </>
  );
}
