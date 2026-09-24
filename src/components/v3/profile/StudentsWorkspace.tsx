import Link from "next/link";

import { Icon } from "@/components/icons";
import { btnGhostCls, inputCls } from "@/components/ui";
import type { V3ProfileCaseDirectory, V3ProfileCaseDirectoryParams } from "@/lib/v3/profile-source";

import { admissionsDirectoryHref, withDocsSection } from "./admissions-view";
import { CuratorCoveragePanel } from "./CuratorCoveragePanel";
import { StudentCaseTable } from "./StudentCaseTable";
import { StudentsFacetDisclosure } from "./StudentsFacetDisclosure";
import {
  activeFilters,
  buildFacetGroups,
  curatorName,
  type FacetGroup,
  type StudentsCoverage,
  type StudentsSummary,
} from "./students-facets";

type CuratorOption = Readonly<{ membershipId: string; displayName: string }>;

const QUIET_LINK = "inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-fg-2 hover:text-fg";

function FacetList({ group }: Readonly<{ group: FacetGroup }>) {
  const headingId = `students-facet-${group.id}`;
  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between gap-3 px-3 pb-1">
        <h2 id={headingId} className="text-sm font-semibold text-fg">{group.title}</h2>
        {group.countLabel ? <span aria-hidden="true" className="text-xs text-fg-3">{group.countLabel}</span> : null}
      </div>
      <ul>
        {group.items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              aria-current={item.selected ? "true" : undefined}
              className="v3-choice flex min-h-11 items-center gap-3 rounded-nav px-3 text-sm text-fg-2 hover:bg-surface hover:text-fg"
            >
              <span className="min-w-0 flex-1 py-2.5 leading-5 [overflow-wrap:anywhere]">
                {item.label}
                {item.note ? <span className="font-normal text-fg-3"> · {item.note}</span> : null}
              </span>
              {item.count !== null ? (
                <span className={`shrink-0 font-mono tabular-nums ${item.selected ? "" : "text-fg-3"}`}>
                  <span className="sr-only">{group.countLabel}: </span>{item.count}
                </span>
              ) : null}
              {group.toggles && item.selected ? <span className="sr-only">, снять фильтр</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * «Студенты» (24.09.2026): одна страница вместо «Студентов» и «Сводки по
 * направлениям». Слева фасеты с числами из существующих чтений, справа поиск,
 * выбранные фильтры и плотная таблица дел. EVO Docs — та же таблица с
 * действиями строки, без счётчиков. Компонент чистый: данные читает страница.
 */
export function StudentsWorkspace({
  directory,
  params,
  docsMode,
  allowAdmissionsFilters,
  summary,
  curators,
  coverage,
  today,
  coverageRequestId,
}: Readonly<{
  directory: V3ProfileCaseDirectory;
  params: V3ProfileCaseDirectoryParams;
  docsMode: boolean;
  allowAdmissionsFilters: boolean;
  summary: StudentsSummary;
  curators: readonly CuratorOption[];
  coverage: StudentsCoverage;
  /** Сегодня в Бишкеке, YYYY-MM-DD. */
  today: string;
  coverageRequestId: string;
}>) {
  const rows = docsMode ? directory.rows.filter((row) => row.access === "full") : directory.rows;
  const docsPageWithoutAccess = docsMode && directory.rows.length > 0 && rows.length === 0;
  const directoryHref = withDocsSection("/v3/profile", docsMode);
  const workload = coverage.kind === "ready" ? coverage.workspace.curators : null;
  const groups = buildFacetGroups({
    params,
    docsMode,
    allowAdmissionsFilters,
    summary: summary === "unavailable" ? null : summary,
    curators,
    workload,
  });
  const filters = activeFilters(params, docsMode, curatorName(params.curatorMembershipId, curators, workload));
  const coverageCuratorId = coverage.kind === "ready" || coverage.kind === "unavailable" ? coverage.curatorId : null;
  const caption = `Дела студентов: ${rows.length} на этой странице${filters.length ? `. Фильтры: ${filters.map((filter) => filter.label).join(", ")}` : ""}`;

  return (
    <div data-testid="v3-student-case-directory" className="min-w-0 @min-[68rem]:grid @min-[68rem]:grid-cols-[15rem_minmax(0,1fr)] @min-[68rem]:items-start @min-[68rem]:gap-x-8">
      {/*
        THESIS: сводка и есть фильтр — каждое число стоит рядом с тем, что
        фильтрует, и одним кликом сужает таблицу дел. Отказ от плиток-KPI над
        списком, отдельного отчёта в меню и карточек-строк в рамках.
        OWN-WORLD: рабочий стол EVO — серая земля #f3f3f3; белое только у полей
        ввода и строки под курсором; волосяные линии #dedede вместо рамок; Golos
        Text; JetBrains Mono для чисел и дат; выбранное — .v3-choice; сплошной
        красный #d70217 только у «Создать задачу».
        STORY: сотрудник видит, сколько дел в работе по направлениям, где
        просрочки и кто без куратора; кликает число — таблица сужается;
        открывает дело по имени. Admin выбирает куратора, видит нагрузку и
        оформляет замещение на месте.
        FIRST VIEWPORT: 1440×900 — меню 260 px; H1 «Студенты»; слева липкая
        колонка фасетов 240 px (Направление, Требует внимания, Статус, Куратор;
        числа справа); справа поиск с «Найти», чипы фильтров и плотная таблица
        из шести колонок с закреплённой шапкой (Студент с направлением и
        уровнем, Этап, Следующий шаг, Срок, Куратор, Проблемы), не больше двух
        строк в ряду, видно не меньше десяти строк; главное действие —
        «Создать задачу» в верхней панели оболочки.
        FORM: «Фасеты и таблица», структура №1 из 7, seed key 34af73ee.
        FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
      */}
      <aside
        id="admissions-summary"
        aria-label="Фильтры студентов"
        className="min-w-0 @min-[68rem]:sticky @min-[68rem]:top-4 @min-[68rem]:-ms-3 @min-[68rem]:max-h-[calc(100dvh-2rem)] @min-[68rem]:overflow-y-auto @min-[68rem]:pb-4"
      >
        <StudentsFacetDisclosure summary={filters.length ? filters.map((filter) => filter.label).join(", ") : null}>
          <div className="space-y-6">
            {groups.map((group) => <FacetList key={group.id} group={group} />)}
            {summary === "unavailable" ? (
              <p role="status" className="px-3 text-sm text-fg-2">
                Счётчики недоступны, список работает. <a href={admissionsDirectoryHref(params, undefined, docsMode)} className="underline underline-offset-4">Повторить</a>
              </p>
            ) : null}
            {coverage.kind === "unavailable" && !coverage.curatorId ? (
              <p role="status" className="px-3 text-sm text-fg-2">Нагрузка кураторов сейчас недоступна.</p>
            ) : null}
          </div>
        </StudentsFacetDisclosure>
      </aside>

      {/* Своя ширина колонки решает, таблица это или стопки: колонка фасетов
          появляется, только когда рядом с ней помещается таблица (≥ 48rem). */}
      <div className="@container mt-5 min-w-0 space-y-4 @min-[68rem]:mt-0">
        <form key={JSON.stringify(params)} action="/v3/profile" method="get" role="search" aria-label="Найти студента" className="flex min-w-0 gap-2">
          {docsMode ? <input type="hidden" name="section" value="docs" /> : null}
          {params.direction ? <input type="hidden" name="direction" value={params.direction} /> : null}
          {params.attention ? <input type="hidden" name="attention" value={params.attention} /> : null}
          {params.state ? <input type="hidden" name="case_status" value={params.state} /> : null}
          {params.curatorMembershipId ? <input type="hidden" name="curator" value={params.curatorMembershipId} /> : null}
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Имя, маршрут или страна</span>
            <Icon name="search" size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-fg-3" />
            <input className={`${inputCls} ps-10`} type="search" defaultValue={params.query} name="case_q" placeholder="Имя студента или страна" maxLength={200} />
          </label>
          <button type="submit" className={btnGhostCls}>Найти</button>
        </form>

        {filters.length ? (
          <div role="group" aria-label="Выбранные фильтры" className="flex flex-wrap items-center gap-x-2 gap-y-3 py-1">
            {filters.map((filter) => (
              <Link
                key={filter.key}
                href={filter.href}
                aria-label={`Убрать фильтр: ${filter.label}`}
                className="relative inline-flex h-8 max-w-full items-center gap-1.5 rounded-nav bg-surface px-2.5 text-sm text-fg before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:bg-surface-2"
              >
                <span className="min-w-0 truncate">{filter.label}</span>
                <Icon name="x" size={14} className="shrink-0 text-fg-3" />
              </Link>
            ))}
            <Link href={directoryHref} className="relative inline-flex h-8 items-center px-1 text-sm font-medium text-fg-2 underline underline-offset-4 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:text-fg">
              Сбросить
            </Link>
          </div>
        ) : null}

        {!docsMode ? (
          <CuratorCoveragePanel
            coverage={coverage}
            fallbackName={curatorName(coverageCuratorId, curators, workload)}
            requestId={coverageRequestId}
            today={today}
          />
        ) : null}

        {params.invalid ? (
          <div role="alert" data-testid="v3-student-case-filter-rejected" className="space-y-1 border-t border-border py-8">
            <p className="font-medium text-danger">Не удалось применить фильтры.</p>
            <p className="text-sm text-fg-2">Проверьте запрос или <Link href={directoryHref} className="underline underline-offset-4">сбросьте фильтры</Link>.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="space-y-1 border-t border-border py-12 text-center">
            <p className="font-medium text-fg">{docsPageWithoutAccess ? "На этой странице нет дел с доступом к документам." : params.active ? "По вашему запросу ничего не найдено." : "Пока нет доступных дел студентов."}</p>
            <p className="text-sm text-fg-2">{docsPageWithoutAccess ? directory.hasNext && directory.nextCursor ? "Перейдите к следующим записям." : "Для работы с документами нужен полный доступ к делу." : params.active ? "Измените запрос или сбросьте фильтры." : docsMode ? "Студенты появляются после продажи в отчёте." : "Здесь появятся дела после передачи из продаж."}</p>
          </div>
        ) : (
          <StudentCaseTable rows={rows} docsMode={docsMode} today={today} caption={caption} />
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
          {!params.invalid && rows.length > 0 ? <p className="text-sm text-fg-3">На странице: <span className="font-mono text-fg-2">{rows.length}</span></p> : <span />}
          <nav aria-label="Страницы каталога студентов" className="flex flex-wrap items-center gap-x-6">
            {params.cursor ? <Link className={QUIET_LINK} href={admissionsDirectoryHref(params, undefined, docsMode)}><Icon name="arrow-left" size={16} />К началу</Link> : null}
            {directory.hasNext && directory.nextCursor ? <Link className={QUIET_LINK} href={admissionsDirectoryHref(params, directory.nextCursor, docsMode)} rel="next">Следующие записи<Icon name="arrow-right" size={16} /></Link> : null}
          </nav>
        </div>
      </div>
    </div>
  );
}
