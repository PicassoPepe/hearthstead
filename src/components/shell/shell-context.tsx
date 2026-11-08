"use client";
import * as React from "react";
import type { PermissionSet } from "@/server/permissions";

export type ShellData = {
  user: { id: string; name: string | null; email: string };
  org: { id: string; name: string; slug: string; sandbox: boolean };
  orgs: { id: string; name: string; slug: string }[];
  roleName: string;
  permissions: PermissionSet;
  sidebarCollapsed: boolean;
  orgName: string;
  orgLogoUrl: string | null;
  userImage: string | null;
  roleKey?: string | null;
  unreadNotifications: number;
};

const Ctx = React.createContext<ShellData | null>(null);

export function ShellProvider({ value, children }: { value: ShellData; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShell(): ShellData {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useShell must be used inside <ShellProvider>");
  return v;
}
