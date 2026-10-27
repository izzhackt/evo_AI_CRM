import type { PlatformWhatsAppTransport } from "@/lib/platform-whatsapp-transport";
import type { AccountDeletionOpenCount } from "@/lib/account-deletion-contract";
import type { ReportKey, ReportLinkRead } from "@/lib/report-link-contract";
import type { TelephonyAdminRead } from "@/lib/server/platform-telephony-admin";
import type { AccountDeletionDetailRead, AccountDeletionQueueRead } from "@/lib/v3/account-deletion-source";
import type { JournalNotice, JournalStatus } from "@/lib/v3/settings-journal-contract";
import type { StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";
import type { StaffWorkspaceData } from "@/lib/v3/staff-workspace-contract";
import type { GateFacts, IntegrationRow, SectionKey, StaffView } from "@/components/v3/settings/types";

/** Пункт ряда разделов «Настроек»: адрес собирает сервер (`?section=` и `&view=`), число — только у «Запросов на удаление». */
export type SettingsNavItem = Readonly<{ key: SectionKey; view: StaffView | null; title: string; href: string; current: boolean; count: number | null }>;

export type SettingsWhatsApp = Readonly<{
  status: string | null;
  canConnect: boolean;
  wazzup?: Readonly<{ transport: PlatformWhatsAppTransport; intakeEnabled: boolean }> | null;
}>;

/** Строка таблицы «Журнала действий»: слова (событие, тип участника, тип объекта) уже посчитал сервер. */
export type JournalNextRow = Readonly<{ id: string; event: string; at: string; actor: string; object: string | null; objectId: string | null; profileHref: string | null }>;

/** Плитка фильтра «Тип записи»; первая — «Все». Адрес несёт выбор: отфильтрованный журнал можно переслать. */
export type JournalNextType = Readonly<{ key: string; title: string; count: number | null; href: string; active: boolean }>;

/**
 * «Журнал действий» нового вида — только данные и готовые слова (`journalNextProps`): таблицы слов журнала в клиентский кусок не едут. Строки —
 * только названные события; событий без названия `unnamed`. Журнал листается ссылкой `nextHref` (курсор сервера), и она есть и тогда, когда
 * названных событий на странице нет. `notice` — что сказано вместо строк (журнал выключен, не прочитан, пуст).
 */
export type SettingsJournalProps = Readonly<{
  status: JournalStatus;
  rows: readonly JournalNextRow[];
  unnamed: number;
  notice: JournalNotice | null;
  types: readonly JournalNextType[] | null;
  exportEnabled: boolean;
  exportHelp: string;
  exportObjectType: string | null;
  exportRequestId: string;
  exportStartAt: string;
  exportEndAt: string;
  nextHref: string | null;
  retryHref: string;
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
