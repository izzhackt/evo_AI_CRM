import Link from "next/link";

import { StaffSection } from "./StaffSection";
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
  auditExportEnabled,
  journalFacets,
  journalFilters,
  journalHrefFor,
  gates,
  platform,
  salesImportHref,
  lookPreview,
  staff,
  selectedStaffMemberId,
  staffRoles,
  staffOrganizationId,
  selectedStaffRoleId,
}: {
  section: SectionKey;
  staffView: StaffView;
  isAdmin: boolean;
  hrefFor: (section: SectionKey, view: StaffView | null) => string;
  integrations: readonly IntegrationRow[];
  journal: readonly JournalEntry[];
  auditExportEnabled: boolean;
  journalFacets: Readonly<{
    objectTypes: readonly Readonly<{ key: string; count: number }>[];
  }>;
  journalFilters: Readonly<{ objectType?: string; role?: string }>;
  journalHrefFor: (next: Readonly<{ objectType?: string; role?: string }>) => string;
  gates: GateFacts;
  platform: string;
  salesImportHref?: string;
  /** Предпросмотр нового облика включён (Э1.1; только Admin). */
  lookPreview: boolean;
  staff?: StaffWorkspaceData;
  selectedStaffMemberId?: string;
  staffRoles?: StaffRoleWorkspace;
  staffOrganizationId: string;
  selectedStaffRoleId?: string;
}) {
  const current = SECTIONS.find((entry) => entry.key === section && (entry.view === null || entry.view === staffView)) ?? SECTIONS[0];
  // Разделы сотрудников ставят свой видимый h2 с числом («Сотрудники · 5»,
  // «Роли и доступ»): второй, скрытый заголовок с тем же названием дал бы два
  // одинаковых заголовка (ревью #1079 — строгий режим Playwright у
  // scoped-staff-provisioner). Здесь h2 — у остальных разделов.
  const staffSection = current.key === "staff" && isAdmin && staff && staffRoles ? { staff, staffRoles } : null;

  return (
    <>
      {/* Одно предупреждение над всеми разделами — только когда настроенный сервис сломан. */}
      <IntegrationsBanner rows={integrations} href={section === "integrations" ? null : hrefFor("integrations", null)} />
      <div className="grid gap-5 @4xl:grid-cols-[minmax(0,210px)_minmax(0,1fr)] lg:items-start">
        {/* На узком экране список переносится строками: семь названий в
            столбик съели бы первый экран, а в полосе с прокруткой текущий
            раздел уходил за край (снимок 390 px, Э6). */}
        <nav aria-label="Разделы настроек" className="min-w-0">
          <ul className="flex flex-wrap gap-1 @4xl:flex-col @4xl:flex-nowrap">
            {SECTIONS.map((entry) => (
              <li key={`${entry.key}-${entry.view ?? ""}`}>
                <Link
                  href={hrefFor(entry.key, entry.view)}
                  aria-current={entry === current ? "page" : undefined}
                  className="v3-choice inline-flex min-h-11 w-full items-center whitespace-nowrap rounded-nav px-3 text-sm text-fg-2 hover:bg-surface-2 hover:text-fg"
                >
                  {entry.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">
          {staffSection ? <StaffSection data={staffSection.staff} roles={staffSection.staffRoles} organizationId={staffOrganizationId}
            view={staffView} selectedMemberId={selectedStaffMemberId} selectedRoleId={selectedStaffRoleId} />
            : <h2 className="t-section mb-3 text-fg">{current.title}</h2>}
          {current.key === "integrations" ? <IntegrationsSection rows={integrations} /> : null}
          {current.key === "journal" ? (
            <JournalSection
              entries={journal}
              exportEnabled={auditExportEnabled}
              facets={journalFacets}
              active={journalFilters}
              hrefFor={journalHrefFor}
            />
          ) : null}
          {current.key === "documents" ? <DocumentsSection gates={gates} /> : null}
          {current.key === "platform" ? <PlatformSection platform={platform} salesImportHref={salesImportHref} lookPreview={lookPreview} /> : null}
        </div>
      </div>
    </>
  );
}
