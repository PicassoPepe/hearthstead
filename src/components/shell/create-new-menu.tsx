"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CREATE_MENU } from "@/lib/nav";
import { can } from "@/server/permissions";
import { useShell } from "./shell-context";

/** "+ Create New": grouped menu; each item opens as a modal route over the current page. */
export function CreateNewMenu() {
  const { permissions } = useShell();
  const groups = CREATE_MENU.map((g) => ({ ...g, items: g.items.filter((i) => can(permissions, i.module, "edit")) })).filter((g) => g.items.length);
  if (groups.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus aria-hidden />
          <span className="hidden sm:inline">Create new</span>
          <span className="sr-only sm:hidden">Create new</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(560px,calc(100vw-24px))] p-2">
        <div className="grid grid-cols-2 gap-x-2 sm:grid-cols-3">
          {groups.map((g, gi) => (
            <DropdownMenuGroup key={g.group} className="py-1">
              <DropdownMenuLabel>{g.group}</DropdownMenuLabel>
              {g.items.map((i) => (
                <DropdownMenuItem key={i.kind} asChild>
                  <Link href={`/app/new/${i.kind}`} scroll={false}>
                    {i.label}
                  </Link>
                </DropdownMenuItem>
              ))}
              {gi < groups.length - 1 ? <DropdownMenuSeparator className="sm:hidden" /> : null}
            </DropdownMenuGroup>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
