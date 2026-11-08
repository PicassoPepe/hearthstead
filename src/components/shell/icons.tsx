import {
  LayoutDashboard, Building2, FileSignature, Users, Landmark, ListChecks, MessagesSquare,
  BarChart3, StickyNote, FolderOpen, Workflow, Sparkles, Settings, LifeBuoy, CalendarDays, Receipt, type LucideIcon,
} from "lucide-react";
import type { IconName } from "@/lib/nav";

export const NAV_ICONS: Record<IconName, LucideIcon> = {
  overview: LayoutDashboard,
  rentals: Building2,
  leasing: FileSignature,
  people: Users,
  accounting: Landmark,
  tasks: ListChecks,
  communications: MessagesSquare,
  reports: BarChart3,
  notes: StickyNote,
  files: FolderOpen,
  workflows: Workflow,
  ai: Sparkles,
  settings: Settings,
  help: LifeBuoy,
  calendar: CalendarDays,
  invoices: Receipt,
};
