import { Hammer } from "lucide-react";
import type { AppContext } from "@/server/context";
import { can } from "@/server/permissions";
import { createItem, type CreateKind } from "@/lib/nav";
import { Forbidden } from "@/components/patterns/forbidden";
import { InviteUserForm } from "./invite-user-form";
import { PropertyWizard } from "@/components/rentals/property-wizard";
import { UnitForm } from "@/components/rentals/unit-form";
import { OwnerForm } from "@/components/rentals/owner-form";
import { wizardOptions } from "@/server/rentals/queries";
import { propertyScopeWhere } from "@/server/rentals/service";
import { PROPERTY_TYPE_META } from "@/lib/rentals";
import { LeaseWizard } from "@/components/leasing/lease-wizard";
import { TenantForm } from "@/components/leasing/tenant-form";
import { MoneyForm } from "@/components/leasing/money-form";
import { JournalEntryForm } from "@/components/accounting/journal-entry-form";
import { TaskForm } from "@/components/tasks/task-form";
import { VendorForm } from "@/components/tasks/vendor-form";
import { taskFormOptions } from "@/server/maintenance/queries";
import { leaseWizardOptions, moneyOptions } from "@/server/leasing/queries";

/** Renders the right create form for a kind. Later phases add their forms/wizards here. */
export async function CreateBody({ kind, ctx, mode: _mode, query = {} }: { kind: CreateKind; ctx: AppContext; mode: "modal" | "page"; query?: Record<string, string | undefined> }) {
  const item = createItem(kind)!;
  if (!can(ctx.permissions, item.module, "edit")) return <Forbidden what={`creating ${item.label.toLowerCase()}s`} />;

  switch (kind) {
    case "user": {
      const roles = await ctx.db.role.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, description: true } });
      return <InviteUserForm roles={roles} mode={_mode} />;
    }
    case "property":
      if (ctx.membership.propertyScope.length) return <Forbidden what="creating properties (your access is limited to specific properties)" />;
      return <PropertyWizard options={await wizardOptions(ctx)} />;
    case "unit": {
      const props = await ctx.db.property.findMany({
        where: propertyScopeWhere(ctx.membership.propertyScope),
        orderBy: { name: "asc" },
        select: { id: true, name: true, type: true, _count: { select: { units: { where: { deletedAt: null } } } } },
      });
      return <UnitForm defaultPropertyId={query.propertyId} properties={props.map((p) => ({ id: p.id, name: p.name, singleUnitFull: PROPERTY_TYPE_META[p.type].singleUnit && p._count.units > 0 }))} />;
    }
    case "owner":
      return <OwnerForm />;
    case "lease":
      return <LeaseWizard options={await leaseWizardOptions(ctx)} preset={{ propertyId: query.propertyId, unitId: query.unitId, tenantId: query.tenantId }} />;
    case "tenant":
      return <TenantForm />;
    case "task":
    case "work-order":
      if (ctx.membership.roleKey === "VENDOR") return <Forbidden what="creating tasks" />;
      return <TaskForm options={await taskFormOptions(ctx)} defaultType={kind === "work-order" ? "WORK_ORDER" : "TASK"} preset={{ propertyId: query.propertyId, unitId: query.unitId, parentTaskId: query.parentTaskId, leaseId: query.leaseId }} />;
    case "vendor":
      return <VendorForm />;
    case "charge":
      return <MoneyForm kind="CHARGE" options={await moneyOptions(ctx, true)} />;
    case "payment":
      return <MoneyForm kind="PAYMENT" options={await moneyOptions(ctx, true)} />;
    case "journal-entry": {
      const [accounts, properties] = await Promise.all([
        ctx.db.account.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
        ctx.db.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      ]);
      return <JournalEntryForm accounts={accounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))} properties={properties} today={new Date().toISOString().slice(0, 10)} />;
    }
    default:
      return (
        <div className="flex flex-col items-center py-6 text-center">
          <div aria-hidden className="mb-3 flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
            <Hammer className="size-5" />
          </div>
          <p className="font-medium">Creating a {item.label.toLowerCase()} arrives in Phase {item.phase}.</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            The modal-route framework is live — this form plugs in here without changing navigation.
          </p>
        </div>
      );
  }
}
