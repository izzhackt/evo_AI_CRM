import { SettingsNextLazy, TelephonyManagerNextLazy } from "@/components/staff/settings-next/SettingsNextLazy";
import { isSectionKey, staffViewOf, type SectionKey, type StaffView } from "@/components/staff/settings/types";
import { isStaffPreview } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import { settingsNextProps } from "@/lib/v3/settings-next-props";
import { readTelephonyAdmin, telephonyIntegrationFactsFrom } from "@/lib/server/platform-telephony-admin";
import { readCountryCurators } from "@/lib/v3/country-curators-source";
import { readReportLink } from "@/lib/v3/report-links-source";
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
  readWhatsAppConnection,
} from "@/lib/v3/settings-source";
import { readAccountDeletionDetail, readAccountDeletionQueue, readOpenAccountDeletionCount } from "@/lib/v3/account-deletion-source";

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
    request?: string;
  }>;
}) {
  const params = await searchParams;
  if (params.section === "access") redirect("/settings?section=staff&view=roles");
  // «Состояние» стало таблицей «Интеграции» (Э6): прежний адрес ведёт туда.
  if (params.section === "state") redirect("/settings?section=integrations");
  // Настройки открываются на «Сотрудниках» (Э6, 27.09.2026).
  const section = isSectionKey(params.section) ? params.section : "staff";
  const staffView = staffViewOf(params.view);
  const journalFilters = normalizeJournalFilters({
    objectType: params.object,
  });
  const actor = await requireV3PageActor("/settings");
  const isAdmin = actor.systemRole === "admin" && actor.presentationRole === null;

  // «Телефония — руководитель» без прав Admin (`telephony.manage`, срез T4b
  // телефонии): страница открыта ему ради одного раздела. Остальные разделы,
  // их чтения и действия — только Admin, поэтому дальше этот сотрудник не идёт.
  if (actor.systemRole !== "admin") {
    return <TelephonyManagerNextLazy read={await readTelephonyAdmin(actor)} nowIso={new Date().toISOString()} />;
  }
  // «Телефония» и строка «Телефония» таблицы «Интеграции» читают одно и то же.
  const telephonyRead = section === "telephony" || section === "integrations" ? readTelephonyAdmin(actor) : Promise.resolve(null);

  const deletionSelected = isAdmin && section === "deletion" && typeof params.request === "string" ? params.request : null;
  // «Отчёты» (миграция 323): обе ссылки читаются только в своём разделе; в просмотре роли тоже — строки состояния.
  const reportsRead = section === "reports"
    ? Promise.all([readReportLink(actor, "marketing"), readReportLink(actor, "finance")]).then(([marketing, finance]) => ({ marketing, finance }))
    : Promise.resolve(undefined);
  // «Кураторы стран» (миграция 335): читается только в своём разделе.
  const countryCuratorsRead = section === "curators" ? readCountryCurators(actor) : Promise.resolve(undefined);
  const [integrations, journalRead, journalFacets, gates, platform, staff, staffRoles, salesManagement, deletionQueue, deletionDetail, deletionOpen, telephony, whatsappConnection, reports, countryCurators] = await Promise.all([
    telephonyRead.then((read) => readIntegrations(actor, new Date(), telephonyIntegrationFactsFrom(read))),
    isAdmin
      ? readJournal(actor, journalFilters, {
          snapshotCreatedAt: params.snapshot,
          snapshotId: params.snapshotId,
          cursorCreatedAt: params.cursor,
          cursorId: params.cursorId,
        })
      : Promise.resolve({ entries: [], cursorHonored: true, status: "ready" as const }),
    isAdmin
      ? readJournalFacets(actor)
      : Promise.resolve({ objectTypes: [] }),
    readGateFacts(actor),
    readPlatformFact(),
    isAdmin && section === "staff" ? readStaffWorkspace(actor) : Promise.resolve(undefined),
    isAdmin && section === "staff" ? readStaffRoles(actor) : Promise.resolve(undefined),
    isAdmin && section === "platform" ? readSalesRegisterManagement(actor, null) : Promise.resolve(undefined),
    section === "deletion" ? readAccountDeletionQueue(actor) : Promise.resolve(undefined),
    deletionSelected ? readAccountDeletionDetail(actor, deletionSelected) : Promise.resolve(null),
    // Число у пункта «Запросы на удаление»: дешёвый подсчёт, а не вся очередь.
    readOpenAccountDeletionCount(actor),
    telephonyRead,
    // «Подключение WhatsApp» (20.10.2026): то же живое слово WAHA, что у таблицы выше (одно чтение).
    section === "integrations" ? readWhatsAppConnection(actor) : Promise.resolve(undefined),
    reportsRead,
    countryCuratorsRead,
  ]);

  // Протухший курсор из адреса читается первой страницей; адрес при этом
  // обязан перестать врать — курсор снимается редиректом.
  if (!journalRead.cursorHonored) {
    const clean = new URLSearchParams();
    clean.set("section", "journal");
    if (params.object) clean.set("object", params.object);
    redirect(`/settings?${clean.toString()}`);
  }
  const journal = journalRead.entries;

  const query = (next: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value) search.set(key, value);
    const tail = search.toString();
    return tail ? `/settings?${tail}` : "/settings";
  };

  // «Новый вид»: ряд разделов, таблицы и панели набора.
  return (
    <SettingsNextLazy
      {...settingsNextProps({
        section,
        staffView,
        hrefFor: (next: SectionKey, view: StaffView | null) => query({ section: next, view: view ?? undefined }),
        integrations,
        whatsappConnect: whatsappConnection ? { status: whatsappConnection.status, canConnect: isAdmin, wazzup: whatsappConnection.wazzup } : undefined,
        staff,
        staffRoles,
        staffOrganizationId: actor.organizationId,
        selectedStaffMemberId: params.member,
        selectedStaffRoleId: params.role,
        telephony,
        telephonyReadOnly: isStaffPreview(actor),
        reports,
        reportsReadOnly: isStaffPreview(actor),
        countryCurators,
        journal,
        journalStatus: journalRead.status,
        auditExportEnabled: readAuditExportEnabled(),
        journalFacets,
        journalFilters,
        journalHrefFor: (next) => query({ section: "journal", object: next.objectType, snapshot: next.snapshotAt, snapshotId: next.snapshotId, cursor: next.cursorAt, cursorId: next.cursorId }),
        deletionQueue,
        deletionDetail,
        deletionHrefFor: (requestId: string | null) => query({ section: "deletion", request: requestId ?? undefined }),
        deletionOpen,
        gates,
        platform,
        salesImportHref: salesManagement?.status === "ready" && salesManagement.data.canImport ? "/finance?tab=sales&mode=import" : undefined,
        salesManagersHref: salesManagement?.status === "ready" && salesManagement.data.canImport ? salesManagersHref() : undefined,
        now: new Date(),
      })}
    />
  );
}
