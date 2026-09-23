import Link from "next/link";

import { Pill } from "@/components/v3/Pill";
import { StaffSection } from "./StaffSection";
import type { StaffWorkspaceData } from "@/lib/v3/staff-workspace-contract";
import type { StaffRoleWorkspace } from "@/lib/v3/staff-roles-contract";

import {
  DocumentsSection,
  IntegrationsSection,
  JournalSection,
  PlatformSection,
  StateSection,
} from "./sections";
import { SECTIONS, type GateFacts, type Health, type Integration, type JournalEntry, type SectionKey } from "./types";

/**
 * Настройки: рельс разделов слева, раздел справа.
 *
 * Выбрано заказчиком из трёх раскладок. Довод: журналу действий нужно место —
 * фильтры, список, объяснения, — и в свёрнутом блоке его нет. А два раздела
 * видны только администратору, и в рельсе это видно сразу, до нажатия.
 *
 * Раздел — ссылка, а не виджет: адрес несёт `?section=`, поэтому раздел можно
 * переслать, вернуться назад кнопкой браузера и открыть без JavaScript. То же
 * решение, что во вкладках профиля.
 *
 * Состояние и настройки окружения доступны только для чтения. Все флаги живут в файлах
 * окружения на сервере с правами 0600; документация прямо запрещает менять их
 * из браузера. Поэтому рядом с каждым выключенным компонентом стоит не
 * тумблер, а адрес: где именно это лежит.
 */
export function Settings({
  section,
  isAdmin,
  hrefFor,
  health,
  integrations,
  journal,
  auditExportEnabled,
  journalFacets,
  journalFilters,
  journalHrefFor,
  gates,
  platform,
  salesImportHref,
  staff,
  staffView,
  selectedStaffMemberId,
  staffRoles,
  staffOrganizationId,
  selectedStaffRoleId,
}: {
  section: SectionKey;
  isAdmin: boolean;
  hrefFor: (section: string) => string;
  health: readonly Health[];
  integrations: readonly Integration[];
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
  staff?: StaffWorkspaceData;
  staffView: "people" | "departments" | "roles";
  selectedStaffMemberId?: string;
  staffRoles?: StaffRoleWorkspace;
  staffOrganizationId: string;
  selectedStaffRoleId?: string;
}) {
  const visible = SECTIONS.filter((s) => isAdmin || !s.admin);
  const current = visible.find((s) => s.key === section) ?? visible[0];

  return (
    <div className="grid gap-5 @4xl:grid-cols-[minmax(0,210px)_minmax(0,1fr)] lg:items-start">
      {/* На узком экране рельс становится полосой с прокруткой: шесть
          названий в столбик съели бы первый экран целиком. */}
      <nav
        aria-label="Разделы настроек"
        tabIndex={0}
        className="max-w-full overflow-x-auto lg:overflow-visible"
      >
        <ul className="flex w-max gap-1 @4xl:w-auto @4xl:flex-col">
          {visible.map((entry) => {
            const active = entry.key === current?.key;
            return (
              <li key={entry.key}>
                <Link
                  href={hrefFor(entry.key)}
                  aria-current={active ? "page" : undefined}
                  className="v3-choice inline-flex min-h-9 w-full items-center gap-2 whitespace-nowrap rounded-nav px-3 text-sm text-fg-2 hover:bg-surface-2"
                >
                  {entry.title}
                  {entry.admin ? (
                    <span className="ms-auto rounded-nav bg-surface-2 px-1 font-mono text-2xs font-normal text-fg-3">
                      админ
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-w-0">
        <h2 className="mb-3 flex flex-wrap items-center gap-2 text-md font-bold text-fg">
          {current?.title}
          {current?.admin ? <Pill>виден только администратору</Pill> : null}
        </h2>

        {current?.key === "staff" && staff && staffRoles ? <StaffSection data={staff} roles={staffRoles} organizationId={staffOrganizationId}
          view={staffView} selectedMemberId={selectedStaffMemberId} selectedRoleId={selectedStaffRoleId} /> : null}
        {current?.key === "state" ? <StateSection health={health} /> : null}
        {current?.key === "integrations" ? (
          <IntegrationsSection health={health} integrations={integrations} />
        ) : null}
        {current?.key === "journal" ? (
          <JournalSection
            entries={journal}
            exportEnabled={auditExportEnabled}
            facets={journalFacets}
            active={journalFilters}
            hrefFor={journalHrefFor}
          />
        ) : null}
        {current?.key === "documents" ? <DocumentsSection gates={gates} /> : null}
        {current?.key === "platform" ? <PlatformSection platform={platform} salesImportHref={salesImportHref} /> : null}
      </div>
    </div>
  );
}
