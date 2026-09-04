import Link from "next/link";

import { Pill } from "@/components/v3/Pill";

import {
  AccessSection,
  DocumentsSection,
  IntegrationsSection,
  JournalSection,
  PlatformSection,
  StateSection,
} from "./sections";
import { SECTIONS, type GateFacts, type Health, type Integration, type JournalEntry, type RoleRow, type SectionKey } from "./types";

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
 * ВЕСЬ ЭКРАН ТОЛЬКО ДЛЯ ЧТЕНИЯ, и это не недоделка. Все флаги живут в файлах
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
  journalFacets,
  journalFilters,
  journalHrefFor,
  roles,
  capabilityNames,
  routeNames,
  gates,
  platform,
}: {
  section: SectionKey;
  isAdmin: boolean;
  hrefFor: (section: string) => string;
  health: readonly Health[];
  integrations: readonly Integration[];
  journal: readonly JournalEntry[];
  journalFacets: Readonly<{
    objectTypes: readonly Readonly<{ key: string; count: number }>[];
    roles: readonly string[];
  }>;
  journalFilters: Readonly<{ objectType?: string; role?: string }>;
  journalHrefFor: (next: Readonly<{ objectType?: string; role?: string }>) => string;
  roles: readonly RoleRow[];
  capabilityNames: readonly string[];
  routeNames: readonly string[];
  gates: GateFacts;
  platform: string;
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
                  className={`inline-flex min-h-9 w-full items-center gap-2 whitespace-nowrap rounded-nav px-3 text-sm ${
                    active
                      ? "bg-accent font-semibold text-on-accent"
                      : "text-fg-2 hover:bg-surface-2"
                  }`}
                >
                  {entry.title}
                  {entry.admin ? (
                    <span
                      className={`ms-auto rounded-[4px] px-1 font-mono text-2xs ${
                        active ? "bg-white/25 text-on-accent" : "bg-surface-2 text-fg-3"
                      }`}
                    >
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

        {current?.key === "state" ? <StateSection health={health} /> : null}
        {current?.key === "integrations" ? (
          <IntegrationsSection health={health} integrations={integrations} />
        ) : null}
        {current?.key === "journal" ? (
          <JournalSection
            entries={journal}
            facets={journalFacets}
            active={journalFilters}
            hrefFor={journalHrefFor}
          />
        ) : null}
        {current?.key === "access" ? (
          <AccessSection
            roles={roles}
            capabilityNames={capabilityNames}
            routeNames={routeNames}
          />
        ) : null}
        {current?.key === "documents" ? <DocumentsSection gates={gates} /> : null}
        {current?.key === "platform" ? <PlatformSection platform={platform} /> : null}
      </div>
    </div>
  );
}
