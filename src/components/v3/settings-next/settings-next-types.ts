import type { PlatformWhatsAppTransport } from "@/lib/platform-whatsapp-transport";
import type { AccountDeletionOpenCount } from "@/lib/account-deletion-contract";
import type { ReportKey, ReportLinkRead } from "@/lib/report-link-contract";
import type { TelephonyAdminRead } from "@/lib/server/platform-telephony-admin";
import type { AccountDeletionDetailRead, AccountDeletionQueueRead } from "@/lib/v3/account-deletion-source";
import type { JournalStatus } from "@/lib/v3/settings-journal-contract";
import type { StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";
import type { StaffWorkspaceData } from "@/lib/v3/staff-workspace-contract";
import type { GateFacts, IntegrationRow, JournalEntry, SectionKey, StaffView } from "@/components/v3/settings/types";

/** Пункт ряда разделов «Настроек»: адрес собирает сервер (`?section=` и `&view=`), число — только у «Запросов на удаление». */
export type SettingsNavItem = Readonly<{ key: SectionKey; view: StaffView | null; title: string; href: string; current: boolean; count: number | null }>;

export type SettingsWhatsApp = Readonly<{
  status: string | null;
  canConnect: boolean;
  wazzup?: Readonly<{ transport: PlatformWhatsAppTransport; intakeEnabled: boolean }> | null;
}>;

export type SettingsJournalProps = Readonly<{
  entries: readonly JournalEntry[];
  status: JournalStatus;
  exportEnabled: boolean;
  facets: Readonly<{ objectTypes: readonly Readonly<{ key: string; count: number | null }>[] }>;
  active: Readonly<{ objectType?: string }>;
  /** Адреса фильтров и следующей страницы: журнал листается ссылками, их собирает страница (`query`). */
  hrefs: Readonly<{ all: string; types: Readonly<Record<string, string>>; next: string | null; retry: string }>;
  exportRequestId: string;
  exportStartAt: string;
  exportEndAt: string;
}>;

/**
 * Свойства «Настроек» нового вида — только данные: те же чтения и права, что у `Settings` (страница `settings/page.tsx`),
 * но без функций (`hrefFor`, `journalHrefFor`, `deletionHrefFor` собирает сервер) и без `Date` (время — строкой ISO).
 * Данных раздела нет, пока он не открыт: страница читает их только для своего раздела.
 */
export type SettingsNextProps = Readonly<{
  section: SectionKey;
  staffView: StaffView;
  nav: readonly SettingsNavItem[];
  nowIso: string;
  integrations: readonly IntegrationRow[];
  integrationsHref: string;
  deletionOpen: AccountDeletionOpenCount | null;
  whatsapp?: SettingsWhatsApp;
  staff?: Readonly<{
    data: StaffWorkspaceData;
    roles: StaffRoleWorkspace;
    organizationId: string;
    selectedMemberId?: string;
    selectedRoleId?: string;
  }>;
  telephony?: Readonly<{ read: TelephonyAdminRead | null; readOnly: boolean }>;
  reports?: Readonly<{ reads: Readonly<Record<ReportKey, ReportLinkRead>>; readOnly: boolean; ids: Readonly<Record<ReportKey, Readonly<{ save: string; remove: string }>>> }>;
  journal?: SettingsJournalProps;
  deletion?: Readonly<{ queue: AccountDeletionQueueRead | undefined; detail: AccountDeletionDetailRead | null; listHref: string }>;
  gates?: GateFacts;
  platform?: Readonly<{ platform: string; salesImportHref?: string; salesManagersHref?: string }>;
}>;
