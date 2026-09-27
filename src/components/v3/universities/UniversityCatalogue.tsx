import Link from "next/link";

import { Icon } from "@/components/icons";
import { UNIVERSITY_LEVELS, UNIVERSITY_LEVEL_LABELS, type UniversityContent, type UniversityFilters, type UniversityProgram } from "@/lib/platform-university-catalog";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";
import { staffUniversityCountryOptions } from "@/lib/university-staff-countries";
import { universityFormWorkspace } from "@/lib/v3/wording";
import {
  catalogueProgramCount,
  catalogueZoneToday,
  formatCatalogueDay,
  intakeDeadlineView,
  intakeStartView,
  intakeStateWord,
  programsWord,
  shownIntakes,
  type CataloguePage,
  type UniversityCatalogueRow,
} from "@/lib/v3/university-view";

import { DueWord } from "../blocks/DueWord";
import { UniversityPhoto as Photo } from "./UniversityPhoto";
import { UniversityToolbar } from "./UniversityToolbar";

/*
 * «Университеты» сотрудников — Э6 плана редизайна (27.09.2026): плотная
 * таблица на волосяных линиях вместо 30 карточек (аудит 26.09: 292 px на
 * карточку, ≈10 700 px страница). Реальное фото остаётся (48 px), срок подачи
 * — на виду в своей колонке. Страница университета начинается с таблицы
 * программ и наборов; фото — меньше и сбоку, с одной строкой авторства.
 * Оба облика; новый (`data-look="next"`) добавляет только вид слова срока.
 */

const DATE = "font-mono tabular-nums";
const QUIET_LINK = "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 underline underline-offset-4 hover:text-fg";

export function universityCountry(code: string) {
  const known = ({ CN: "Китай", MY: "Малайзия", AE: "ОАЭ", TR: "Турция" } as Record<string, string>)[code];
  if (known) return known;
  try { return new Intl.DisplayNames(["ru"], { type: "region" }).of(code) ?? code; } catch { return code; }
}

function Source({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 t-body-compact font-medium text-accent-text underline underline-offset-4 hover:text-fg">
      {children}<span className="sr-only"> (в новой вкладке)</span>
    </a>
  );
}

/* ---------------------------------------------------------------- Список */

/*
 * Раскладки по ширине своего контейнера (`@container/universities`): от 48rem
 * — строка таблицы (Университет 36 · Страна 11 · Программы 9 · Ближайший срок
 * 30 · Проверено 10); уже — стопка телефона: фото и название, под ними
 * «страна · программы», срок и дата проверки. Роли таблицы заданы явно: смена
 * display иначе стирает её семантику в части браузеров. Вся строка открывает
 * страницу университета (ссылка — название; её область — строка), фокус
 * клавиатуры — рамка всей строки (`.v3-queue-row`).
 */
const WIDE = "@min-[48rem]/universities:grid-cols-[minmax(0,36fr)_minmax(0,11fr)_minmax(0,9fr)_minmax(0,30fr)_minmax(0,10fr)] @min-[48rem]/universities:items-center";
const ROW = `grid grid-cols-1 gap-x-3 ${WIDE}`;
const HEAD = "t-caption flex h-8 items-center px-2 text-start text-fg-2 first:ps-3";
const CELL = "min-w-0 px-3 @min-[48rem]/universities:px-2";
/** В стопке у ячейки срока и проверки — отступ под фото 48 px: текст идёт одной колонкой. */
const STACK_INDENT = "ps-[4.5rem] @min-[48rem]/universities:ps-2";

function DeadlineCell({ row }: { row: UniversityCatalogueRow }) {
  const deadline = row.deadline;
  if (!deadline) {
    return (
      <td role="cell" className={`${CELL} ${STACK_INDENT} t-body-compact`} data-deadline="none">
        <p className="t-body-compact text-fg-3">Срок не подтверждён</p>
      </td>
    );
  }
  const more = deadline.sameDateCount > 0 ? ` · ещё наборов с этой датой: ${deadline.sameDateCount}` : "";
  return (
    <td role="cell" className={`${CELL} ${STACK_INDENT} t-body-compact`} data-deadline={deadline.dateTime}>
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <time dateTime={deadline.dateTime} className={`${DATE} text-fg`} title={`Срок в поясе ${deadline.timezone}, проверен ${deadline.verifiedOn.split("-").reverse().join(".")}`}>
          {deadline.text}
        </time>
        <DueWord view={deadline.word} className="text-fg-2" />
      </span>
      <span className="block truncate t-meta text-fg-2" title={`${deadline.program} — ${deadline.intake}${more}`}>
        {deadline.program}{more}
      </span>
    </td>
  );
}

function UniversityRow({ row, level, today }: { row: UniversityCatalogueRow; level: UniversityFilters["level"]; today: string }) {
  const { content, id } = row.university;
  const country = universityCountry(content.country);
  const programs = catalogueProgramCount(row.university, level);
  return (
    <tr role="row" data-university-row={id} className={`v3-queue-row relative ${ROW} border-b border-border py-2 hover:bg-surface`}>
      <th role="rowheader" scope="row" className={`${CELL} flex items-center gap-3 text-start font-normal @min-[48rem]/universities:ps-3`}>
        <Photo content={content} variant="thumb" />
        <span className="min-w-0">
          <Link
            href={`/v3/universities/${id}`}
            data-queue-open=""
            title={content.name}
            className="line-clamp-2 break-words t-item text-fg before:absolute before:inset-0 before:content-[''] hover:underline hover:underline-offset-4"
          >
            {content.name}
          </Link>
          {content.city ? <span className="block truncate t-meta text-fg-2 @max-[48rem]/universities:sr-only">{content.city}</span> : null}
          {/* Стопка телефона: страна, город и число программ — одной строкой под названием; ячейки остаются для читалки. */}
          <span aria-hidden="true" className="block t-meta text-fg-2 @min-[48rem]/universities:hidden">
            {[country, content.city, `${programs} ${programsWord(programs)}`].filter(Boolean).join(" · ")}
          </span>
        </span>
      </th>
      <td role="cell" className={`${CELL} sr-only t-body-compact text-fg @min-[48rem]/universities:not-sr-only`}>{country}</td>
      <td role="cell" className={`${CELL} sr-only t-body-compact tabular-nums text-fg @min-[48rem]/universities:not-sr-only`}>{programs}</td>
      <DeadlineCell row={row} />
      <td role="cell" className={`${CELL} ${STACK_INDENT} t-meta text-fg-2`}>
        <span className="@min-[48rem]/universities:sr-only">Проверено </span>
        <time dateTime={content.verifiedOn} className={DATE}>{formatCatalogueDay(content.verifiedOn, today)}</time>
      </td>
    </tr>
  );
}

function CataloguePagination({ page, hrefFor }: { page: CataloguePage; hrefFor: (offset: number) => string }) {
  if (page.previousOffset === null && page.nextOffset === null) return null;
  return (
    <nav aria-label="Страницы каталога" className="flex flex-wrap items-center justify-between gap-3">
      <p className="t-meta text-fg-2">
        {page.first ? <><span className="tabular-nums">{page.first}–{page.last}</span>{page.total !== null ? <> из <span className="tabular-nums">{page.total}</span></> : null}</> : "На этой странице университетов нет"}
      </p>
      <div className="flex gap-2">
        {page.previousOffset !== null ? (
          <Link href={hrefFor(page.previousOffset)} className="inline-flex min-h-11 items-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg">
            <Icon name="arrow-left" size={16} />Назад
          </Link>
        ) : null}
        {page.nextOffset !== null ? (
          <Link href={hrefFor(page.nextOffset)} className="inline-flex min-h-11 items-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg">
            Дальше<Icon name="arrow-right" size={16} />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export function UniversityList({
  page,
  filters,
  countries,
  canManage = false,
  now,
}: {
  page: CataloguePage;
  filters: UniversityFilters;
  countries: readonly string[];
  canManage?: boolean;
  now: Date;
}) {
  const base = "/v3/universities";
  const countryOptions = staffUniversityCountryOptions(countries, filters.country)
    .map((option) => ({ value: option.code, label: `${universityCountry(option.code)}${option.unavailable ? " — нет опубликованных карточек" : ""}` }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
  const levelOptions = UNIVERSITY_LEVELS.map((level) => ({ value: level, label: UNIVERSITY_LEVEL_LABELS[level] }));
  const hrefFor = (offset: number) => {
    const params = new URLSearchParams({ ...(filters.query ? { q: filters.query } : {}), ...(filters.country ? { country: filters.country } : {}), ...(filters.level ? { level: filters.level } : {}) });
    if (offset > 0) params.set("offset", String(offset));
    const tail = params.toString();
    return tail ? `${base}?${tail}` : base;
  };
  const today = dayInOrganizationTimezone(now);
  const filtered = Boolean(filters.query || filters.country || filters.level);

  return (
    <div className="@container/universities space-y-3">
      <UniversityToolbar action={base} query={filters.query} country={filters.country} level={filters.level} countries={countryOptions} levels={levelOptions} />
      {page.order === "name" ? (
        <p className="t-meta text-fg-2">Каталог больше, чем читается за один раз: порядок — по названию, по страницам.</p>
      ) : null}
      {!page.rows.length ? (
        <section className="rounded-card border border-border bg-surface px-5 py-8 text-center">
          <h2 className="t-section text-fg">{page.first === 0 && page.previousOffset !== null ? "На этой странице университетов нет" : "Пока нет опубликованных карточек по этому запросу"}</h2>
          <p className="t-body-compact mt-2 text-fg-2">
            {filtered ? "Попробуйте убрать фильтры." : null}
            {canManage ? " В управлении каталогом можно проверить источники и опубликовать карточку." : " Новые сведения появятся после проверки и публикации."}
          </p>
          {page.previousOffset !== null ? <Link className={`${QUIET_LINK} mt-2`} href={hrefFor(page.previousOffset)}>К предыдущей странице</Link> : null}
        </section>
      ) : (
        <table role="table" className="block w-full" data-testid="v3-university-table">
          <caption className="sr-only">
            {page.order === "deadline" ? "Университеты: сначала ближайший подтверждённый срок подачи, затем по названию" : "Университеты по названию"}
          </caption>
          <thead role="rowgroup" className="sr-only @min-[48rem]/universities:not-sr-only @min-[48rem]/universities:block">
            <tr role="row" className={`${ROW} border-b border-border`}>
              {["Университет", "Страна", "Программы", "Ближайший срок", "Проверено"].map((label) => (
                <th key={label} role="columnheader" scope="col" className={HEAD}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup" className="block">
            {page.rows.map((row) => <UniversityRow key={row.university.id} row={row} level={filters.level} today={today} />)}
          </tbody>
        </table>
      )}
      <CataloguePagination page={page} hrefFor={hrefFor} />
    </div>
  );
}

/* ------------------------------------------------------- Страница вуза */

/*
 * Таблица наборов программы: от 40rem своей ширины контейнера — строка
 * (Набор 20 · Срок подачи 22 · Начало 14 · Состояние 18 · Проверено 12 ·
 * Источник 14), уже — стопка с подписями у значений.
 */
const INTAKE_GRID = "grid grid-cols-1 gap-x-3 gap-y-0.5 @min-[40rem]/university:grid-cols-[minmax(0,20fr)_minmax(0,22fr)_minmax(0,14fr)_minmax(0,18fr)_minmax(0,12fr)_minmax(0,14fr)] @min-[40rem]/university:items-baseline";
const INTAKE_HEAD = "t-caption text-start text-fg-2";
const INTAKE_COLUMNS = ["Набор", "Срок подачи", "Начало", "Состояние", "Проверено", "Источник"] as const;

function StackLabel({ children }: { children: string }) {
  return <span className="me-1.5 t-caption text-fg-3 @min-[40rem]/university:sr-only">{children}:</span>;
}

function Program({ program, now, today }: { program: UniversityProgram; now: Date; today: string }) {
  const intakes = shownIntakes(program.intakes);
  return (
    <article className="py-4" data-program={program.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h3 className="t-item min-w-0 text-fg">{program.title}</h3>
        <Source href={program.sourceUrl}>Страница программы</Source>
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-0.5 t-meta text-fg-2">
        <div><dt className="sr-only">Уровень</dt><dd>{UNIVERSITY_LEVEL_LABELS[program.level]}</dd></div>
        {program.duration ? <div className="flex gap-1"><dt className="text-fg-3 after:content-[':']">Длительность</dt><dd>{program.duration}</dd></div> : null}
        {program.language ? <div className="flex gap-1"><dt className="text-fg-3 after:content-[':']">Язык обучения</dt><dd>{program.language}</dd></div> : null}
      </dl>
      <p className="mt-2 max-w-[70ch] t-body-compact text-fg-2">{program.summary}</p>
      {intakes.length ? (
        <table role="table" className="mt-3 block w-full" data-intakes="">
          <caption className="sr-only">Наборы: {program.title}</caption>
          <thead role="rowgroup" className="sr-only @min-[40rem]/university:not-sr-only @min-[40rem]/university:block">
            <tr role="row" className={`${INTAKE_GRID} border-b border-border pb-1.5`}>
              {INTAKE_COLUMNS.map((label) => (
                <th key={label} role="columnheader" scope="col" className={label === "Источник" ? `${INTAKE_HEAD} sr-only` : INTAKE_HEAD}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup" className="block">
            {intakes.map((intake, index) => {
              const deadline = intakeDeadlineView(intake, now);
              const zoneToday = catalogueZoneToday(intake.timezone, now) ?? today;
              const start = intakeStartView(intake, zoneToday);
              return (
                <tr key={intake.id ?? index} role="row" data-intake="" className={`${INTAKE_GRID} border-b border-border py-2 last:border-b-0`}>
                  <th role="rowheader" scope="row" className="t-body-compact text-start font-medium text-fg">{intake.label}</th>
                  <td role="cell" className="t-body-compact" data-cell="deadline">
                    <StackLabel>Срок подачи</StackLabel>
                    {deadline ? <>
                      <time dateTime={deadline.dateTime} className={`${DATE} text-fg`}>{deadline.text}</time>
                      {deadline.word ? <> <DueWord view={deadline.word} className="text-fg-2" /></> : null}
                      {deadline.zone ? <span className="block t-meta text-fg-3">{deadline.zone}</span> : null}
                    </> : <><span aria-hidden="true" className="text-fg-3">—</span><span className="sr-only">не указан</span></>}
                  </td>
                  <td role="cell" className="t-body-compact text-fg" data-cell="start">
                    <StackLabel>Начало</StackLabel>
                    {start ? <time dateTime={start.dateTime} className={start.mono ? DATE : undefined}>{start.text}</time>
                      : <><span aria-hidden="true" className="text-fg-3">—</span><span className="sr-only">не указано</span></>}
                  </td>
                  <td role="cell" className="t-body-compact text-fg-2">
                    <StackLabel>Состояние</StackLabel>
                    {intakeStateWord(intake, now)}
                  </td>
                  <td role="cell" className="t-body-compact text-fg-2">
                    <StackLabel>Проверено</StackLabel>
                    <time dateTime={intake.verifiedOn} className={DATE}>{formatCatalogueDay(intake.verifiedOn, today)}</time>
                  </td>
                  <td role="cell" className="t-body-compact @min-[40rem]/university:-my-2.5">
                    <Source href={intake.sourceUrl}>Источник<span className="sr-only">: {intake.label}</span></Source>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </article>
  );
}

/**
 * Содержание карточки университета — страница вуза и предпросмотр черновика
 * у Admin: сначала программы и наборы, затем «Об университете»; фото — сбоку
 * (от 56rem своего контейнера) или последним в стопке.
 */
/** «Малайзия · Johor Bahru · 3 программы» — место и размер вуза одной строкой. */
export function UniversityPlace({ content }: { content: UniversityContent }) {
  return (
    <>
      {universityCountry(content.country)}{content.city ? ` · ${content.city}` : ""} · <span className="tabular-nums">{content.programs.length}</span> {programsWord(content.programs.length)}
    </>
  );
}

/**
 * Карточка вуза. `placeInHeader` — страница вуза ставит строку места сразу
 * под заголовком (`PartShell meta`): название и место читаются одним целым,
 * тихие ссылки Admin — после них. Проверка черновика заголовка вуза не
 * имеет, и строка остаётся здесь.
 */
export function UniversityContentView({ content, now, placeInHeader = false }: { content: UniversityContent; now: Date; placeInHeader?: boolean }) {
  const today = dayInOrganizationTimezone(now);
  return (
    <div className="@container/university">
      <div className="grid gap-x-8 gap-y-6 @min-[56rem]/university:grid-cols-[minmax(0,1fr)_17rem] @min-[56rem]/university:items-start">
        <div className="min-w-0 space-y-6">
          {placeInHeader ? null : <p className="t-body-compact text-fg-2"><UniversityPlace content={content} /></p>}
          <section aria-labelledby="university-programs">
            <h2 id="university-programs" className="t-section text-fg">Программы и наборы</h2>
            <div className="mt-1 divide-y divide-border border-b border-border">
              {content.programs.map((program) => <Program key={program.id} program={program} now={now} today={today} />)}
            </div>
          </section>
          <section aria-labelledby="university-about">
            <h2 id="university-about" className="t-section text-fg">Об университете</h2>
            <p className="mt-2 max-w-[70ch] t-body text-fg">{content.overview}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-5">
              <Source href={content.websiteUrl}>Сайт учебного заведения</Source>
              <Source href={content.sourceUrl}>Основной источник карточки</Source>
              <span className="t-meta text-fg-3">Карточка проверена <time dateTime={content.verifiedOn} className={DATE}>{formatCatalogueDay(content.verifiedOn, today)}</time></span>
            </div>
          </section>
        </div>
        <aside aria-label="Фото кампуса" className="min-w-0 @max-[56rem]/university:max-w-80">
          <Photo content={content} variant="side" />
        </aside>
      </div>
    </div>
  );
}

/** Возврат к каталогу над заголовком страницы вуза. */
export function UniversityBackLink() {
  return (
    <Link href="/v3/universities" className="inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4">
      <Icon name="arrow-left" size={16} />Все университеты
    </Link>
  );
}

/**
 * Управление каталогом Admin на странице вуза — тихие ссылки: это редкая
 * задача, не главное действие. Цель нажатия — 44 px, а видимый зазор на
 * телефоне меньше: поле ссылки заходит в воздух над и под строкой.
 */
export function UniversityManageLinks({ id, formsHref }: { id: string; formsHref?: string }) {
  return (
    <div className="flex flex-wrap gap-x-4 max-sm:-my-2">
      {formsHref ? <Link className={QUIET_LINK} href={formsHref}>{universityFormWorkspace.title}</Link> : null}
      <Link className={QUIET_LINK} href={`/v3/universities/manage?edit=${id}`}>Предложить обновление</Link>
    </div>
  );
}

export function UniversityUnavailable() { return <p role="alert" className="rounded-card border border-border bg-surface p-5 text-sm text-danger">Не удалось загрузить каталог. Обновите страницу. Это не означает, что опубликованных университетов нет.</p>; }
