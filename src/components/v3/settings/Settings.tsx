import Link from "next/link";

import { Icon } from "@/components/icons";
import { StaffSection } from "./StaffSection";
import { AccountDeletionSection } from "./AccountDeletionSection";
import { TelephonySection } from "./TelephonySection";
import { ReportLinksSection } from "./ReportLinksSection";
import { WhatsAppConnectSection } from "./WhatsAppConnectSection";
import { WhatsAppTransportCard } from "./WhatsAppTransportCard";
import type { PlatformWhatsAppTransport } from "@/lib/platform-whatsapp-transport";
import type { ReportKey, ReportLinkRead } from "@/lib/report-link-contract";
import type { TelephonyAdminRead } from "@/lib/server/platform-telephony-admin";
import type { AccountDeletionOpenCount } from "@/lib/account-deletion-contract";
import type { AccountDeletionDetailRead, AccountDeletionQueueRead } from "@/lib/v3/account-deletion-source";
import type { StaffWorkspaceData } from "@/lib/v3/staff-workspace-contract";
import type { StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";

import {
  DocumentsSection,
  IntegrationsBanner,
  IntegrationsSection,
  JournalSection,
  PlatformSection,
} from "./sections";
import { SECTIONS, type GateFacts, type IntegrationRow, type JournalEntry, type SectionKey, type StaffView } from "./types";
import type { JournalStatus } from "@/lib/v3/settings-journal-contract";

/** Число не выполненных запросов на удаление (срок — 30 дней): круг со словами для чтения с экрана. */
function DeletionCount({ open, testId }: Readonly<{ open: AccountDeletionOpenCount | null | undefined; testId?: string }>) {
  if (!open || open.open <= 0) return null;
  return (
    <>
      <span aria-hidden="true" data-testid={testId}
        className="t-caption ms-2 min-w-5 rounded-full bg-fg px-1 text-center tabular-nums text-surface">
        {open.open > 99 ? "99+" : open.open}
      </span>
      <span className="sr-only">
        {`, не выполнено: ${open.open}${open.overdue > 0 ? `, просрочено: ${open.overdue}` : ""}`}
      </span>
    </>
  );
}

/**
 * Настройки: список разделов слева, раздел справа.
 *
 * Выбрано заказчиком из трёх раскладок. Довод: журналу действий нужно место —
 * фильтры, список, объяснения, — и в свёрнутом блоке его нет.
 *
 * Раздел — ссылка, а не виджет: адрес несёт `?section=` (у сотрудников ещё
 * `&view=`), поэтому раздел можно переслать, вернуться назад кнопкой
 * браузера и открыть без JavaScript. Э6 (27.09.2026): «Сотрудники», «Роли и
 * доступ» и «Отделы» — пункты этого же списка, второго уровня вкладок нет;
 * маршрут только для Admin, поэтому пометок «админ» нет.
 *
 * Состояние и настройки окружения доступны только для чтения. Все флаги живут в файлах
 * окружения на сервере с правами 0600; документация прямо запрещает менять их
 * из браузера. Поэтому в таблице «Интеграции» рядом с выключенным сервисом —
 * не тумблер, а слова о том, что сделать на сервере.
 */
export function Settings({
  section,
  staffView,
  isAdmin,
  hrefFor,
  integrations,
  journal,
  journalStatus,
  auditExportEnabled,
  journalFacets,
  journalFilters,
  journalHrefFor,
  gates,
  platform,
  salesImportHref,
  salesManagersHref,
  staff,
  selectedStaffMemberId,
  staffRoles,
  staffOrganizationId,
  selectedStaffRoleId,
  deletionQueue,
  deletionDetail,
  deletionHrefFor,
  deletionOpen,
  telephony,
  telephonyReadOnly,
  reports,
  reportsReadOnly,
  whatsappConnect,
}: {
  section: SectionKey;
  staffView: StaffView;
  isAdmin: boolean;
  hrefFor: (section: SectionKey, view: StaffView | null) => string;
  integrations: readonly IntegrationRow[];
  journal: readonly JournalEntry[];
  journalStatus: JournalStatus;
  auditExportEnabled: boolean;
  journalFacets: Readonly<{
    objectTypes: readonly Readonly<{ key: string; count: number | null }>[];
  }>;
  journalFilters: Readonly<{ objectType?: string; role?: string }>;
  journalHrefFor: (next: Readonly<{ objectType?: string; role?: string }>) => string;
  gates: GateFacts;
  platform: string;
  salesImportHref?: string;
  /** «Менеджеры в отчёте» (Э8.6) — то же право, что у переноса данных. */
  salesManagersHref?: string;
  staff?: StaffWorkspaceData;
  selectedStaffMemberId?: string;
  staffRoles?: StaffRoleWorkspace;
  staffOrganizationId: string;
  selectedStaffRoleId?: string;
  /** «Запросы на удаление» (280): очередь и выбранный запрос, только Admin. */
  deletionQueue?: AccountDeletionQueueRead;
  deletionDetail?: AccountDeletionDetailRead | null;
  deletionHrefFor?: (requestId: string | null) => string;
  /** Число не выполненных запросов у пункта «Запросы на удаление» в любом разделе (ревью 280, UI-F6). */
  deletionOpen?: AccountDeletionOpenCount | null;
  /** «Телефония» (срез T4b): чтение экрана; `null` — раздел не открыт. */
  telephony?: TelephonyAdminRead | null;
  /** Просмотр роли: экран виден, настройки не меняются. */
  telephonyReadOnly?: boolean;
  /** «Отчёты» (миграция 323): чтение двух ссылок; `undefined` — раздел не открыт. */
  reports?: Readonly<Record<ReportKey, ReportLinkRead>>;
  /** Просмотр роли: видны только строки состояния. */
  reportsReadOnly?: boolean;
  /**
   * «Подключение WhatsApp» (20.10.2026): слово WAHA и право подключать. Блок стоит под
   * таблицей «Интеграции», только у Администратора; нет данных — блока нет. Путь Wazzup (`wazzup`):
   * вместо кнопок QR и кода - карточка канала Wazzup, только чтение.
   */
  whatsappConnect?: Readonly<{
    status: string | null;
    canConnect: boolean;
    wazzup?: Readonly<{ transport: PlatformWhatsAppTransport; intakeEnabled: boolean }> | null;
  }>;
}) {
  const current = SECTIONS.find((entry) => entry.key === section && (entry.view === null || entry.view === staffView)) ?? SECTIONS[0];
  // Разделы сотрудников ставят свой видимый h2 с числом («Сотрудники · 5»,
  // «Роли и доступ»): второй, скрытый заголовок с тем же названием дал бы два
  // одинаковых заголовка (ревью #1079 — строгий режим Playwright у
  // scoped-staff-provisioner). Здесь h2 — у остальных разделов.
  const staffSection = current.key === "staff" && isAdmin && staff && staffRoles ? { staff, staffRoles } : null;
  // Один список разделов — две раскладки по ширине: столбец слева от 56rem, на узком экране — текущий раздел одной
  // кнопкой, остальные открываются списком (девять названий в четыре-пять строк съедали первый экран).
  // Число на пункте «Запросы на удаление» — в обеих раскладках, но `data-testid` — у одной (у столбца слева).
  const navLinks = (compact: boolean) => SECTIONS.map((entry) => (
    <li key={`${entry.key}-${entry.view ?? ""}`}>
      <Link
        href={hrefFor(entry.key, entry.view)}
        aria-current={entry === current ? "page" : undefined}
        className="v3-choice inline-flex min-h-11 w-full items-center whitespace-nowrap rounded-nav px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg"
      >
        {entry.title}
        {entry.key === "deletion" ? <DeletionCount open={deletionOpen} testId={compact ? undefined : "v3-settings-deletion-count"} /> : null}
      </Link>
    </li>
  ));

  return (
    <>
      {/* Одно предупреждение над разделами — только когда настроенный сервис сломан. На самих «Интеграциях» то же
          стоит в таблице ниже, второй раз его не повторяем. */}
      {section === "integrations" ? null : <IntegrationsBanner rows={integrations} href={hrefFor("integrations", null)} />}
      <div className="grid gap-5 @4xl:grid-cols-[minmax(0,210px)_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Разделы настроек" className="min-w-0">
          {/* Ключ — раздел: после перехода список закрывается сам. */}
          <details key={`${current.key}-${current.view ?? ""}`} className="group @4xl:hidden" data-testid="v3-settings-nav-compact">
            <summary className="v3-raised flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 items-center">
                {current.title}
                {/* Закрытый список не показывает пункты: число невыполненных запросов видно и на кнопке. */}
                {current.key === "deletion" ? null : <DeletionCount open={deletionOpen} />}
              </span>
              <Icon name="chevron-down" size={16} className="shrink-0 text-fg-3 group-open:rotate-180" />
            </summary>
            <ul className="mt-1 space-y-0.5 rounded-ctl border border-border bg-surface p-1">{navLinks(true)}</ul>
          </details>
          <ul className="hidden gap-1 @4xl:flex @4xl:flex-col">{navLinks(false)}</ul>
        </nav>

        <div className="min-w-0">
          {staffSection ? <StaffSection data={staffSection.staff} roles={staffSection.staffRoles} organizationId={staffOrganizationId}
            view={staffView} selectedMemberId={selectedStaffMemberId} selectedRoleId={selectedStaffRoleId} />
            : <h2 className="t-section mb-3 text-fg">{current.title}</h2>}
          {current.key === "integrations" ? <IntegrationsSection rows={integrations} connectCard={Boolean(whatsappConnect)} /> : null}
          {current.key === "integrations" && whatsappConnect ? (
            whatsappConnect.wazzup
              ? <WhatsAppTransportCard transport={whatsappConnect.wazzup.transport} intakeEnabled={whatsappConnect.wazzup.intakeEnabled} now={new Date()} />
              : <WhatsAppConnectSection initialStatus={whatsappConnect.status} canConnect={whatsappConnect.canConnect} />
          ) : null}
          {current.key === "telephony" ? <TelephonySection read={telephony ?? null} readOnly={telephonyReadOnly ?? false} now={new Date()} /> : null}
          {current.key === "reports" && reports ? <ReportLinksSection reads={reports} readOnly={reportsReadOnly ?? false} /> : null}
          {current.key === "journal" ? (
            <JournalSection
              entries={journal}
              status={journalStatus}
              exportEnabled={auditExportEnabled}
              facets={journalFacets}
              active={journalFilters}
              hrefFor={journalHrefFor}
            />
          ) : null}
          {current.key === "deletion" && deletionQueue && deletionHrefFor ? (
            <AccountDeletionSection queue={deletionQueue} detail={deletionDetail ?? null} hrefFor={deletionHrefFor} now={new Date()} />
          ) : null}
          {current.key === "documents" ? <DocumentsSection gates={gates} /> : null}
          {current.key === "platform" ? <PlatformSection platform={platform} salesImportHref={salesImportHref} salesManagersHref={salesManagersHref} /> : null}
        </div>
      </div>
    </>
  );
}
