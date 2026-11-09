import {
  Home, Wrench, Wallet, MoreHorizontal, Building2, Users, MessagesSquare,
  BarChart3, StickyNote, FolderOpen, Workflow, Sparkles, Settings, LifeBuoy, CalendarDays, Receipt, type LucideIcon,
} from "lucide-react";
import type { IconName } from "@/lib/nav";

export const NAV_ICONS: Record<IconName, LucideIcon> = {
  overview: Home,
  rentals: Building2,
  leasing: Users,
  people: Users,
  accounting: Wallet,
  tasks: Wrench,
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
  more: MoreHorizontal,
};
