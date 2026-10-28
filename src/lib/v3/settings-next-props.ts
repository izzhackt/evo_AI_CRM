import { randomUUID } from "node:crypto";

import type { SettingsNextProps } from "@/components/v3/settings-next/settings-next-types";
import { SECTIONS, type GateFacts, type IntegrationRow, type JournalEntry, type SectionKey, type StaffView } from "@/components/v3/settings/types";
import type { AccountDeletionOpenCount } from "@/lib/account-deletion-contract";
import { REPORT_KEYS, type ReportKey, type ReportLinkRead } from "@/lib/report-link-contract";
import type { TelephonyAdminRead } from "@/lib/server/platform-telephony-admin";
import type { AccountDeletionDetailRead, AccountDeletionQueueRead } from "@/lib/v3/account-deletion-source";
import type { JournalStatus } from "@/lib/v3/settings-journal-contract";
import { journalNextProps } from "@/lib/v3/settings-next-journal";
import type { StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";
import type { StaffWorkspaceData } from "@/lib/v3/staff-workspace-contract";

type JournalHref = Readonly<{ objectType?: string; snapshotAt?: string; snapshotId?: string; cursorAt?: string; cursorId?: string }>;

/**
 * Свойства «Настроек» нового вида из того, что страница уже прочитала для `Settings`: те же данные, адреса собраны на сервере,
 * время — строкой, request_id отчётов и экспорта журнала выданы здесь (как раньше выдавали `ReportLinksSection` и `JournalSection`).
 * Ничего не читает и не проверяет права: это делает страница до выбора вида.
 */
export function settingsNextProps(input: Readonly<{
  section: SectionKey;
  staffView: StaffView;
  hrefFor: (section: SectionKey, view: StaffView | null) => string;
  integrations: readonly IntegrationRow[];
  whatsappConnect?: SettingsNextProps["whatsapp"];
  staff?: StaffWorkspaceData;
  staffRoles?: StaffRoleWorkspace;
  staffOrganizationId: string;
  selectedStaffMemberId?: string;
  selectedStaffRoleId?: string;
  telephony?: TelephonyAdminRead | null;
  telephonyReadOnly: boolean;
  reports?: Readonly<Record<ReportKey, ReportLinkRead>>;
  reportsReadOnly: boolean;
  journal: readonly JournalEntry[];
  journalStatus: JournalStatus;
  auditExportEnabled: boolean;
  journalFacets: Readonly<{ objectTypes: readonly Readonly<{ key: string; count: number | null }>[] }>;
  journalFilters: Readonly<{ objectType?: string }>;
  journalHrefFor: (next: JournalHref) => string;
  deletionQueue?: AccountDeletionQueueRead;
  deletionDetail: AccountDeletionDetailRead | null;
  deletionHrefFor: (requestId: string | null) => string;
  deletionOpen: AccountDeletionOpenCount | null;
  gates: GateFacts;
  platform: string;
  salesImportHref?: string;
  salesManagersHref?: string;
  now: Date;
}>): SettingsNextProps {
  const { section, staffView } = input;
  const nav = SECTIONS.map((entry) => ({
    key: entry.key, view: entry.view, title: entry.title, href: input.hrefFor(entry.key, entry.view),
    current: entry.key === section && (entry.view === null || entry.view === staffView),
    count: entry.key === "deletion" && input.deletionOpen && input.deletionOpen.open > 0 ? input.deletionOpen.open : null,
  }));
  return {
    section, staffView, nav, nowIso: input.now.toISOString(),
    integrations: input.integrations, integrationsHref: input.hrefFor("integrations", null), deletionOpen: input.deletionOpen,
    whatsapp: input.whatsappConnect,
    staff: input.staff && input.staffRoles
      ? { data: input.staff, roles: input.staffRoles, organizationId: input.staffOrganizationId, selectedMemberId: input.selectedStaffMemberId, selectedRoleId: input.selectedStaffRoleId }
      : undefined,
    telephony: section === "telephony" ? { read: input.telephony ?? null, readOnly: input.telephonyReadOnly } : undefined,
    reports: section === "reports" && input.reports
      ? { reads: input.reports, readOnly: input.reportsReadOnly, ids: Object.fromEntries(REPORT_KEYS.map((key) => [key, { save: randomUUID(), remove: randomUUID() }])) as NonNullable<SettingsNextProps["reports"]>["ids"] }
      : undefined,
    journal: section === "journal"
      ? journalNextProps({
        entries: input.journal, status: input.journalStatus, facets: input.journalFacets, filters: input.journalFilters, hrefFor: input.journalHrefFor,
        exportEnabled: input.auditExportEnabled, exportRequestId: randomUUID(), now: input.now,
      })
      : undefined,
    deletion: section === "deletion" ? { queue: input.deletionQueue, detail: input.deletionDetail, listHref: input.deletionHrefFor(null) } : undefined,
    gates: section === "documents" ? input.gates : undefined,
    platform: section === "platform" ? { platform: input.platform, salesImportHref: input.salesImportHref, salesManagersHref: input.salesManagersHref } : undefined,
  };
}
