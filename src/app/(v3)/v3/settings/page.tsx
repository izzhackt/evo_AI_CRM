import { PartShell } from "@/components/v3/PartShell";
import { Settings } from "@/components/v3/settings/Settings";
import { isSectionKey, staffViewOf, type SectionKey, type StaffView } from "@/components/v3/settings/types";
import { requireV3PageActor } from "@/lib/platform-guards";
import { redirect } from "next/navigation";

import { normalizeJournalFilters } from "@/lib/v3/settings-journal-contract";
import { readSalesRegisterManagement } from "@/lib/v3/sales-register-source";
import { salesManagersHref } from "@/lib/sales-register-navigation";
import { readStaffWorkspace } from "@/lib/v3/staff-workspace-source";
import { readStaffRoles } from "@/lib/server/staff-roles-service";
import {
  readAuditExportEnabled,
  readGateFacts,
  readIntegrations,
  readJournal,
  readJournalFacets,
  readPlatformFact,
} from "@/lib/v3/settings-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "Настройки" };

export default async function SettingsPart({
  searchParams,
}: {
  searchParams: Promise<{
    section?: string;
    view?: string;
    member?: string;
    role?: string;
    object?: string;
    snapshot?: string;
    snapshotId?: string;
    cursor?: string;
    cursorId?: string;
  }>;
}) {
  const params = await searchParams;
  if (params.section === "access") redirect("/v3/settings?section=staff&view=roles");
  // «Состояние» стало таблицей «Интеграции» (Э6): прежний адрес ведёт туда.
  if (params.section === "state") redirect("/v3/settings?section=integrations");
  // Настройки открываются на «Сотрудниках» (Э6, 27.09.2026).
  const section = isSectionKey(params.section) ? params.section : "staff";
  const staffView = staffViewOf(params.view);
  const journalFilters = normalizeJournalFilters({
    objectType: params.object,
  });
  const actor = await requireV3PageActor("/v3/settings");
  const isAdmin = actor.systemRole === "admin" && actor.presentationRole === null;

  const [integrations, journalRead, journalFacets, gates, platform, staff, staffRoles, salesManagement] = await Promise.all([
    readIntegrations(actor),
    isAdmin
      ? readJournal(actor, journalFilters, {
          snapshotCreatedAt: params.snapshot,
          snapshotId: params.snapshotId,
          cursorCreatedAt: params.cursor,
          cursorId: params.cursorId,
        })
      : Promise.resolve({ entries: [], cursorHonored: true }),
    isAdmin
      ? readJournalFacets(actor)
      : Promise.resolve({ objectTypes: [] }),
    readGateFacts(actor),
    readPlatformFact(),
    isAdmin && section === "staff" ? readStaffWorkspace(actor) : Promise.resolve(undefined),
    isAdmin && section === "staff" ? readStaffRoles(actor) : Promise.resolve(undefined),
    isAdmin && section === "platform" ? readSalesRegisterManagement(actor, null) : Promise.resolve(undefined),
  ]);

  // Протухший курсор из адреса читается первой страницей; адрес при этом
  // обязан перестать врать — курсор снимается редиректом.
  if (!journalRead.cursorHonored) {
    const clean = new URLSearchParams();
    clean.set("section", "journal");
    if (params.object) clean.set("object", params.object);
    redirect(`/v3/settings?${clean.toString()}`);
  }
  const journal = journalRead.entries;

  const query = (next: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value) search.set(key, value);
    const tail = search.toString();
    return tail ? `/v3/settings?${tail}` : "/v3/settings";
  };

  return (
    <PartShell
      title="Настройки"
    >
      <Settings
        section={section}
        staffView={staffView}
        // Authority grants access; presentation role controls the exact
        // interface while an admin previews Sales or Admissions.
        isAdmin={isAdmin}
        hrefFor={(next: SectionKey, view: StaffView | null) => query({ section: next, view: view ?? undefined })}
        integrations={integrations}
        journal={journal}
        auditExportEnabled={readAuditExportEnabled()}
        journalFacets={journalFacets}
        journalFilters={journalFilters}
        // Параметр типизирован шире, чем требует Settings: сюда же приходит
        // курсор страницы журнала, а смена фильтра его не несёт — и тем
        // самым честно возвращает на первую страницу.
        journalHrefFor={(next: Readonly<{
          objectType?: string;
          snapshotAt?: string;
          snapshotId?: string;
          cursorAt?: string;
          cursorId?: string;
        }>) =>
          query({
            section: "journal",
            object: next.objectType,
            snapshot: next.snapshotAt,
            snapshotId: next.snapshotId,
            cursor: next.cursorAt,
            cursorId: next.cursorId,
          })
        }
        gates={gates}
        platform={platform}
        salesImportHref={salesManagement?.status === "ready" && salesManagement.data.canImport ? "/v3/main?view=sales&mode=import" : undefined}
        salesManagersHref={salesManagement?.status === "ready" && salesManagement.data.canImport ? salesManagersHref() : undefined}
        staff={staff}
        staffRoles={staffRoles}
        staffOrganizationId={actor.organizationId}
        selectedStaffRoleId={params.role}
        selectedStaffMemberId={params.member}
      />
    </PartShell>
  );
}
