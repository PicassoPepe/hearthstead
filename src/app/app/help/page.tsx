import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Kbd } from "@/components/ui/misc";

export const metadata = { title: "Help" };

const SHORTCUTS = [
  { keys: ["⌘/Ctrl", "K"], label: "Open the command palette (search, navigate, create)" },
  { keys: ["Tab"], label: "Move between controls; focus is always visible" },
  { keys: ["Esc"], label: "Close a dialog, menu or the palette" },
];

export default function HelpPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Help" description="Shortcuts and how-tos." />
      <Card>
        <CardHeader><CardTitle>Keyboard shortcuts</CardTitle></CardHeader>
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
