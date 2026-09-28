/**
 * «Студенты» — рабочая очередь дел (решение владельца 24–25.09.2026,
 * PLAN_CHANGES «Студенты» PR 2). Чистая логика без React и без запросов:
 * разбор адреса (включая прежние адреса), виды и вкладки, группы по сроку
 * «Следующего шага», слова строки и документов, подсказка прав редактора.
 * По этим функциям рисует страница, панель в браузере и unit-тест.
 *
 * Правило чисел одно: число берётся только из чтения
 * `staff_student_case_queue_counts_v1` (или из полного чтения страницы).
 * Нет чтения — нет числа, а не ноль.
 */
import {
  ADMISSIONS_PIPELINE_STAGES,
  type AdmissionsPipelineStage,
} from "../../../lib/platform-admissions-pipeline-contract.ts";
import { ADMISSIONS_ATTENTION, ADMISSIONS_DIRECTIONS } from "../../../lib/platform-admissions-playbook-contract.ts";
import {
  CASE_NEXT_ACTION_BANDS,
  STUDENT_CASE_QUEUE_QUERY_MAX_LENGTH,
  parseQueueUuid,
  parseStudentCaseQueueCursor,
  type CaseNextActionBand,
  type StudentCaseChecklistCounts,
  type StudentCaseQueueCounts,
  type StudentCaseQueueDirectionFilter,
  type StudentCaseQueueRequest,
  type StudentCaseQueueRow,
  type StudentCaseQueueSort,
  type StudentCaseQueueView,
} from "../../../lib/platform-student-case-queue-contract.ts";
import type { HandoffAcknowledgement } from "../../../lib/platform-handoff-acknowledgement.ts";
import type { ApplicationDocumentCursor, ApplicationDocumentQueueItem } from "../../../lib/portal/application-documents.ts";
import type { ApplicationPackageQueueItem } from "../../../lib/portal/application-packages.ts";
import { dayInOrganizationTimezone } from "../../../lib/platform-task-deadline.ts";
import { dayDelta } from "../calendar/types.ts";
import { dueBucket, formatQueueDay, queueDayWithWeekday, weekEnd } from "../queue/due-bucket.ts";
import { shortPersonName } from "../queue/person-name.ts";

export const STUDENTS_PATH = "/v3/profile";

/** Виды «Студентов» в порядке вкладок; «Нагрузка кураторов» — вид без строк дел. */
export const STUDENTS_QUEUE_VIEWS = ["mine", "needs_action", "active", "pending", "needs_curator", "closed", "curators"] as const;
export type StudentsQueueView = (typeof STUDENTS_QUEUE_VIEWS)[number];
/**
 * Вкладки EVO Docs — один центр проверки документов (Э8.5, 28.09.2026).
 * «Документы дела» (ключ адреса `review` — прежние ссылки работают),
 * «Исправить» и «Не хватает» отбирают дела по счётчикам чек-листа строки 241;
 * «Документы программ» — очередь документов требований программ (228),
 * «Комплекты» — очередь «Комплекты на проверку» (232); «Все» — последней.
 */
export const STUDENTS_DOCS_VIEWS = ["review", "program", "packages", "fix", "missing", "all"] as const;
export type StudentsDocsView = (typeof STUDENTS_DOCS_VIEWS)[number];
/** Вкладки-работа EVO Docs в порядке ряда: из них выбирается вкладка по умолчанию и следующая непустая. */
export const STUDENTS_DOCS_WORK_VIEWS = ["review", "program", "packages", "fix", "missing"] as const satisfies readonly StudentsDocsView[];

/**
 * Виды назначения кураторов: «Ждут куратора» и «Нагрузка кураторов». Их видит
 * тот, кто может назначать и замещать кураторов (`case.curator.assign`, не
 * просмотр роли), — то же условие, что у чтения нагрузки и команды замещения.
 */
const COVERAGE_VIEWS: ReadonlySet<string> = new Set(["needs_curator", "curators"]);

export const STUDENTS_VIEW_LABELS: Readonly<Record<StudentsQueueView, string>> = {
  mine: "Мои",
  needs_action: "Требуют действия",
  active: "Все в работе",
  pending: "Ожидает начала",
  needs_curator: "Ждут куратора",
  closed: "Закрытые",
  curators: "Нагрузка кураторов",
};
export const STUDENTS_DOCS_VIEW_LABELS: Readonly<Record<StudentsDocsView, string>> = {
  review: "Документы дела",
  program: "Документы программ",
  packages: "Комплекты",
  fix: "Исправить",
  missing: "Не хватает",
  all: "Все",
};

/** Строк на странице очереди; EVO Docs отбирает вкладки внутри чтения по 100 дел. */
export const STUDENTS_QUEUE_PAGE_SIZE = 50;
export const STUDENTS_DOCS_PAGE_SIZE = 100;

const DIRECTION_FILTERS = [...ADMISSIONS_DIRECTIONS, "unknown"] as const;
const QUERY_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

export type StudentsQueueMode = "queue" | "docs";

export type StudentsQueueParams = Readonly<{
  mode: StudentsQueueMode;
  view: StudentsQueueView | StudentsDocsView;
  /** Вид, который открывается без `view` в адресе (зависит от роли). */
  defaultView: StudentsQueueView | StudentsDocsView;
  /**
   * EVO Docs без `view` в адресе: экран после чтений откроет первую вкладку с
   * известным числом больше нуля, а с поиском или фильтром — «Документы дела»
   * (`docsInitialView`); а пока вид — `defaultView`.
   */
  autoView: boolean;
  query: string | null;
  direction: StudentCaseQueueDirectionFilter | null;
  curator: string | null;
  stage: AdmissionsPipelineStage | null;
  sort: StudentCaseQueueSort;
  cursor: string | null;
  open: string | null;
  /** Параметры замещения (`coverage_*`) — только для «Нагрузки кураторов». */
  coverage: Readonly<Partial<Record<"coverage_curator" | "coverage_case" | "coverage_after", string>>>;
}>;

export type StudentsQueueParse =
  | Readonly<{ kind: "ok"; params: StudentsQueueParams }>
  /** Прежний адрес или поиск по номеру дела: страница переадресует. */
  | Readonly<{ kind: "redirect"; href: string }>
  /** Адрес не разобран: «Не удалось применить фильтры» и «Сбросить». */
  | Readonly<{ kind: "invalid"; params: StudentsQueueParams }>;

export type StudentsQueueActor = Readonly<{
  /** Admin в своём интерфейсе (не просмотр роли). */
  admin: boolean;
  /** `case.curator.assign` вне просмотра роли: назначение, нагрузка и замещение кураторов. */
  coverage: boolean;
}>;

type SearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

const LEGACY_KEYS = ["case_q", "case_status", "attention", "case_before_at", "case_before_id"] as const;
const COVERAGE_KEYS = ["coverage_curator", "coverage_case", "coverage_after"] as const;

export function studentsDefaultView(mode: StudentsQueueMode, actor: StudentsQueueActor): StudentsQueueView | StudentsDocsView {
  if (mode === "docs") return "review";
  // Admin работает с исключениями по всем кураторам; сотрудник поступления — со своими делами.
  return actor.admin ? "needs_action" : "mine";
}

export function studentsViewAllowed(view: string, mode: StudentsQueueMode, actor: StudentsQueueActor): boolean {
  if (mode === "docs") return (STUDENTS_DOCS_VIEWS as readonly string[]).includes(view);
  return (STUDENTS_QUEUE_VIEWS as readonly string[]).includes(view) && (actor.coverage || !COVERAGE_VIEWS.has(view));
}

function single(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || typeof value === "string") return value;
  throw new StudentsQueueParamError();
}

class StudentsQueueParamError extends Error {}

function trimmed(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/** Поиск: одна строка до 200 символов — то же правило, что у чтения 241. */
export function parseStudentsQuery(value: string | undefined): string | null {
  const query = trimmed(value);
  if (query === null) return null;
  if ([...query].length > STUDENT_CASE_QUEUE_QUERY_MAX_LENGTH || QUERY_CONTROL.test(query)) throw new StudentsQueueParamError();
  return query;
}

/**
 * Прежний вид из старых параметров «Студентов» (фасеты 24.09): внимание
 * важнее статуса. Прочие прежние значения внимания («ждём партнёра», визы…)
 * у 241 своего вида не имеют — открываем «Все в работе», их надмножество.
 */
function legacyView(attention: string | null, state: string | null, actor: StudentsQueueActor): StudentsQueueView | null {
  if (attention !== null) {
    if (!(ADMISSIONS_ATTENTION as readonly string[]).includes(attention)) throw new StudentsQueueParamError();
    if (attention === "needs_curator") return actor.coverage ? "needs_curator" : "needs_action";
    return attention === "overdue" || attention === "awaiting_ack" ? "needs_action" : "active";
  }
  if (state === null) return null;
  if (state === "active") return "active";
  if (state === "closed") return "closed";
  if (state === "pending") return "pending";
  throw new StudentsQueueParamError();
}

/**
 * Адрес страницы → параметры очереди. Прежние адреса (`case_q`,
 * `case_status`, `attention`, `case_before_*`, `section=summary`) и поиск по
 * номеру дела дают переадресацию; всё остальное проверяется строго.
 */
export function parseStudentsQueueParams(
  searchParams: SearchParams,
  mode: StudentsQueueMode,
  actor: StudentsQueueActor,
): StudentsQueueParse {
  const defaultView = studentsDefaultView(mode, actor);
  const fallback: StudentsQueueParams = Object.freeze({
    mode, view: defaultView, defaultView, autoView: mode === "docs", query: null, direction: null, curator: null, stage: null,
    sort: mode === "docs" ? "updated" : "due", cursor: null, open: null, coverage: Object.freeze({}) as StudentsQueueParams["coverage"],
  });
  try {
    const legacy = LEGACY_KEYS.some((key) => searchParams[key] !== undefined) || single(searchParams, "section") === "summary";
    const rawView = trimmed(single(searchParams, "view"));
    const coverageEntries = COVERAGE_KEYS
      .map((key) => [key, single(searchParams, key)] as const)
      .filter((entry): entry is readonly [(typeof COVERAGE_KEYS)[number], string] => entry[1] !== undefined);
    let view: StudentsQueueView | StudentsDocsView | null = null;
    if (rawView !== null) {
      if (!studentsViewAllowed(rawView, mode, actor)) throw new StudentsQueueParamError();
      view = rawView as StudentsQueueView | StudentsDocsView;
    } else if (mode === "queue") {
      view = legacyView(trimmed(single(searchParams, "attention")), trimmed(single(searchParams, "case_status")), actor);
      // Ссылки замещения куратора открывают «Нагрузку кураторов».
      if (view === null && coverageEntries.length > 0 && actor.coverage) view = "curators";
    }
    const resolvedView = view ?? defaultView;

    const query = parseStudentsQuery(single(searchParams, "q") ?? single(searchParams, "case_q"));
    const directionValue = trimmed(single(searchParams, "direction"));
    if (directionValue !== null && !(DIRECTION_FILTERS as readonly string[]).includes(directionValue)) throw new StudentsQueueParamError();
    const curatorValue = trimmed(single(searchParams, "curator"));
    const curator = curatorValue === null ? null : parseQueueUuid(curatorValue) ?? fail();
    const stageValue = mode === "docs" ? null : trimmed(single(searchParams, "stage"));
    if (stageValue !== null && !(ADMISSIONS_PIPELINE_STAGES as readonly string[]).includes(stageValue)) throw new StudentsQueueParamError();
    const sortValue = mode === "docs" ? null : trimmed(single(searchParams, "sort"));
    if (sortValue !== null && sortValue !== "due" && sortValue !== "updated") throw new StudentsQueueParamError();
    const sort: StudentCaseQueueSort = mode === "docs" ? "updated" : sortValue === "updated" ? "updated" : "due";
    const cursorValue = legacy ? null : trimmed(single(searchParams, "cursor"));
    const cursor = cursorValue === null ? null : parseStudentCaseQueueCursor(cursorValue, studentsEffectiveSort(resolvedView, sort)) ?? fail();
    const openValue = trimmed(single(searchParams, "open"));
    const open = openValue === null || mode === "docs" || resolvedView === "curators" ? null : parseQueueUuid(openValue) ?? fail();
    const coverage = Object.freeze(Object.fromEntries(resolvedView === "curators" ? coverageEntries : [])) as StudentsQueueParams["coverage"];

    const params: StudentsQueueParams = Object.freeze({
      mode, view: resolvedView, defaultView, autoView: mode === "docs" && view === null, query, direction: directionValue as StudentCaseQueueDirectionFilter | null,
      // В «Нагрузке кураторов» прежний `curator` был только синхронизацией фасета с замещением.
      curator: resolvedView === "curators" && curator !== null && curator === coverage.coverage_curator ? null : curator,
      stage: stageValue as AdmissionsPipelineStage | null, sort, cursor, open, coverage,
    });
    // Поиск по номеру дела: 241 ищет по имени, стране и уровню, а номер — это дело.
    if (query !== null && parseQueueUuid(query) !== null) {
      return { kind: "redirect", href: studentsCaseHref(parseQueueUuid(query)!, { docs: mode === "docs" }) };
    }
    if (legacy) return { kind: "redirect", href: studentsQueueHref(params) };
    return { kind: "ok", params };
  } catch {
    return { kind: "invalid", params: fallback };
  }
}

function fail(): never {
  throw new StudentsQueueParamError();
}

type HrefOverrides = Partial<{
  view: StudentsQueueView | StudentsDocsView | null;
  query: string | null;
  direction: StudentCaseQueueDirectionFilter | null;
  curator: string | null;
  stage: AdmissionsPipelineStage | null;
  sort: StudentCaseQueueSort | null;
  cursor: string | null;
  open: string | null;
  coverage: StudentsQueueParams["coverage"] | null;
}>;

/**
 * Адрес очереди: порядок ключей постоянный, значения по умолчанию (вид по
 * роли, сортировка по сроку) не пишутся. `overrides` с `null` убирает ключ.
 * EVO Docs пишет вид всегда: вкладка по умолчанию зависит от чисел, поэтому
 * адрес без `view` означает «первая непустая», а не «Документы дела». Без
 * `view` остаётся только адрес, где вид и не выбирали (`autoView`).
 */
export function studentsQueueHref(params: StudentsQueueParams, overrides: HrefOverrides = {}): string {
  const value = <K extends keyof HrefOverrides>(key: K): StudentsQueueParams[K] | null =>
    Object.hasOwn(overrides, key) ? (overrides[key] ?? null) as StudentsQueueParams[K] | null : params[key];
  const query = new URLSearchParams();
  if (params.mode === "docs") query.set("section", "docs");
  const chosen = Object.hasOwn(overrides, "view") ? overrides.view ?? null : params.autoView ? null : params.view;
  const view = value("view") ?? params.defaultView;
  if (params.mode === "docs" ? chosen !== null : view !== params.defaultView) query.set("view", view);
  const text = value("query");
  if (text) query.set("q", text);
  const direction = value("direction");
  if (direction) query.set("direction", direction);
  const curator = value("curator");
  if (curator) query.set("curator", curator);
  const stage = value("stage");
  if (stage && params.mode === "queue") query.set("stage", stage);
  const sort = value("sort");
  if (sort && sort !== "due" && params.mode === "queue") query.set("sort", sort);
  const cursor = value("cursor");
  if (cursor) query.set("cursor", cursor);
  const open = value("open");
  if (open && view !== "curators") query.set("open", open);
  const coverage = value("coverage");
  if (view === "curators" && coverage) {
    for (const key of COVERAGE_KEYS) if (coverage[key]) query.set(key, coverage[key]);
  }
  const search = query.toString();
  return search ? `${STUDENTS_PATH}?${search}` : STUDENTS_PATH;
}

/** Адрес списка без открытой строки и без страницы — для вкладок и фильтров. */
export function studentsListHref(params: StudentsQueueParams, overrides: HrefOverrides = {}): string {
  return studentsQueueHref(params, { cursor: null, open: null, coverage: null, ...overrides });
}

const RETURN_KEYS: ReadonlySet<string> = new Set(["section", "view", "q", "direction", "curator", "stage", "sort", "cursor", "open"]);

/**
 * `returnTo` Student 360 обратно в очередь: только путь «Студентов» и только
 * ключи очереди, каждый проверен тем же разбором. Иначе — null, и «К списку»
 * ведёт на список по умолчанию.
 */
export function parseStudentsReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1600 || !/^\/v3\/profile(?:\?|$)/u.test(value)) return null;
  try {
    const url = new URL(value, "https://internal.invalid");
    if (url.pathname !== STUDENTS_PATH || url.hash || url.origin !== "https://internal.invalid") return null;
    const seen = new Set<string>();
    const raw: Record<string, string> = {};
    for (const [key, val] of url.searchParams) {
      if (!RETURN_KEYS.has(key) || seen.has(key)) return null;
      seen.add(key);
      raw[key] = val;
    }
    if (raw.section !== undefined && raw.section !== "docs") return null;
    const mode: StudentsQueueMode = raw.section === "docs" ? "docs" : "queue";
    // Виды назначения кураторов проверит сама страница; здесь достаточно, чтобы вид вообще существовал.
    const parsed = parseStudentsQueueParams(raw, mode, { admin: true, coverage: true });
    if (parsed.kind !== "ok") return null;
    const text = new URLSearchParams(Object.entries(raw).filter(([key]) => key !== "section"));
    const prefix = mode === "docs" ? "section=docs" : "";
    const search = [prefix, text.toString()].filter(Boolean).join("&");
    return search ? `${STUDENTS_PATH}?${search}` : STUDENTS_PATH;
  } catch {
    return null;
  }
}

/** Student 360: вход из очереди — «Обзор» (EVO Docs — «Документы»), с возвратом в тот же список. */
export function studentsCaseHref(
  caseId: string,
  options: Readonly<{ docs?: boolean; tab?: string; returnTo?: string | null }> = {},
): string {
  const query = new URLSearchParams({ case: caseId, tab: options.tab ?? (options.docs ? "documents" : "overview") });
  if (options.docs) query.set("section", "docs");
  if (options.returnTo) query.set("returnTo", options.returnTo);
  return `${STUDENTS_PATH}?${query.toString()}`;
}

/** Запрос страницы 241 для вида. EVO Docs читает дела в работе по 100 и отбирает вкладку сама. */
export function studentsQueueRequest(params: StudentsQueueParams): StudentCaseQueueRequest {
  const filters = {
    direction: params.direction,
    curatorMembershipId: params.curator,
    pipelineStage: params.mode === "queue" ? params.stage : null,
    query: params.query,
  };
  if (params.mode === "docs") {
    return { ...filters, view: "active", sort: "updated", cursor: params.cursor, pageSize: STUDENTS_DOCS_PAGE_SIZE };
  }
  return { ...filters, view: studentsCountsView(params), sort: studentsEffectiveSort(params.view, params.sort), cursor: params.cursor, pageSize: STUDENTS_QUEUE_PAGE_SIZE };
}

/** Вид 241 для чтения чисел: у «Нагрузки кураторов» и EVO Docs своих строк дел нет — «Все в работе». */
export function studentsCountsView(params: StudentsQueueParams): StudentCaseQueueView {
  return params.mode === "docs" || params.view === "curators" ? "active" : params.view as StudentCaseQueueView;
}

export type StudentsTab = Readonly<{ key: string; label: string; href: string; count: number | null; current: boolean }>;

/** Вкладки-виды очереди: число — только из чтения чисел при тех же фильтрах. */
export function studentsQueueTabs(
  params: StudentsQueueParams,
  counts: StudentCaseQueueCounts | null,
  actor: StudentsQueueActor,
): readonly StudentsTab[] {
  return STUDENTS_QUEUE_VIEWS
    .filter((view) => studentsViewAllowed(view, "queue", actor))
    .map((view) => ({
      key: view,
      label: STUDENTS_VIEW_LABELS[view],
      href: studentsListHref(params, { view }),
      count: view === "curators" || counts === null ? null : counts.views[view],
      current: params.view === view,
    }));
}

/** Какие очереди документов учётная запись читает: без чтения своей вкладки нет. */
export type DocsQueuesShown = Readonly<{ program: boolean; packages: boolean }>;

/** Вкладка EVO Docs есть в ряду: очереди программ и комплектов — только тем, кто их читает (или если адрес их назвал). */
function docsTabShown(view: StudentsDocsView, shown: DocsQueuesShown, current: StudentsQueueParams["view"] | null = null): boolean {
  if (view === "program") return shown.program || current === "program";
  if (view === "packages") return shown.packages || current === "packages";
  return true;
}

/**
 * Вкладки EVO Docs: число «Все» — из чтения чисел; вкладки дел — только при
 * полном чтении страницы; «Документы программ» и «Комплекты» — только при
 * полном чтении своей очереди. Вкладок очередей программ и комплектов нет у
 * того, кто их не читает (нет `document.read.full` или просмотр роли), — как
 * ссылок на них в шапке доски поступления.
 */
export function studentsDocsTabs(
  params: StudentsQueueParams,
  counts: Readonly<Record<StudentsDocsView, number | null>>,
  shown: DocsQueuesShown = { program: true, packages: true },
): readonly StudentsTab[] {
  return STUDENTS_DOCS_VIEWS.filter((view) => docsTabShown(view, shown, params.view)).map((view) => ({
    key: view,
    label: STUDENTS_DOCS_VIEW_LABELS[view],
    href: studentsListHref(params, { view }),
    count: counts[view],
    current: params.view === view,
  }));
}

/**
 * Вкладка EVO Docs без `view` в адресе: первая вкладка-работа с известным
 * числом больше нуля. Неизвестные числа (неполное чтение, сбой) не
 * угадываются — тогда «Документы дела». «Все» — не работа и сама не выбирается.
 */
export function docsAutoView(counts: Readonly<Record<StudentsDocsView, number | null>>, shown: DocsQueuesShown): StudentsDocsView {
  return STUDENTS_DOCS_WORK_VIEWS.find((view) => docsTabShown(view, shown) && (counts[view] ?? 0) > 0) ?? "review";
}

/**
 * Вкладка, которую EVO Docs открывает по адресу без `view`: без поиска и
 * фильтров — первая вкладка-работа (`docsAutoView`); с поиском, направлением
 * или куратором — «Документы дела». Числа очередей программ и комплектов
 * поиск и фильтры дел не сужают, и поиск не уводит на очередь, где его нет.
 */
export function docsInitialView(
  params: StudentsQueueParams,
  counts: Readonly<Record<StudentsDocsView, number | null>>,
  shown: DocsQueuesShown,
): StudentsDocsView {
  if (params.query || params.direction || params.curator) return "review";
  return docsAutoView(counts, shown);
}

/**
 * Пустая вкладка называет следующую непустую — по кругу ряда вкладок-работы,
 * только с известным числом больше нуля. null — непустых вкладок нет.
 */
export function docsNextNonEmpty(
  current: StudentsDocsView,
  counts: Readonly<Record<StudentsDocsView, number | null>>,
  shown: DocsQueuesShown,
): Readonly<{ view: StudentsDocsView; label: string; count: number }> | null {
  const order: readonly StudentsDocsView[] = STUDENTS_DOCS_WORK_VIEWS;
  // «Все» не в ряду работы: с неё поиск начинается с первой вкладки.
  const start = order.indexOf(current);
  for (let step = 1; step <= order.length; step += 1) {
    const view = order[(start + step) % order.length];
    const count = counts[view];
    if (view !== current && docsTabShown(view, shown) && count !== null && count > 0) return { view, label: STUDENTS_DOCS_VIEW_LABELS[view], count };
  }
  return null;
}

/**
 * Отбор строки на вкладку EVO Docs по счётчикам её чек-листа. Нет доступа к
 * документам — только «Все». «Не хватает» — в чек-листе есть места без
 * загруженного документа (`missing`: место в состоянии `required`, версии
 * нет); дело без чек-листа сюда не входит — его требования неизвестны.
 * «Комплекты» дела не отбирают: у них своя очередь.
 */
export function docsRowMatches(view: StudentsDocsView, row: Pick<StudentCaseQueueRow, "documents">): boolean {
  if (view === "all") return true;
  if (view === "packages" || view === "program") return false;
  const documents = row.documents;
  if (documents === null) return false;
  if (view === "missing") return documents.missing > 0;
  return view === "review" ? documents.submitted > 0 : documents.correctionRequired + documents.rejected > 0;
}

/** Документы прочитаны хотя бы у одного дела (или дел нет): без права на документы вкладкам дел нечего считать. */
export function docsReadable(rows: readonly Pick<StudentCaseQueueRow, "documents">[]): boolean {
  return rows.length === 0 || rows.some((row) => row.documents !== null);
}

/**
 * Числа вкладок EVO Docs. Вкладки дел считаются по прочитанным строкам,
 * поэтому число есть только у полного чтения (первая страница без
 * продолжения); «Документы программ» и «Комплекты» — только у своей очереди,
 * прочитанной целиком; «Все» — число вида «Все в работе» из чтения чисел.
 */
export function docsTabCounts(
  rows: readonly Pick<StudentCaseQueueRow, "documents">[],
  complete: boolean,
  counts: StudentCaseQueueCounts | null,
  packages: DocsPackagesRead = { kind: "hidden" },
  program: DocsProgramRead = { kind: "hidden" },
): Readonly<Record<StudentsDocsView, number | null>> {
  // Число «0» без прочитанных документов было бы неправдой: неизвестно — null.
  const known = complete && docsReadable(rows);
  return {
    review: known ? rows.filter((row) => docsRowMatches("review", row)).length : null,
    program: docsQueueCount(program),
    packages: docsQueueCount(packages),
    fix: known ? rows.filter((row) => docsRowMatches("fix", row)).length : null,
    missing: known ? rows.filter((row) => docsRowMatches("missing", row)).length : null,
    all: counts ? counts.views.active : complete ? rows.length : null,
  };
}

/**
 * Очередь документов для вкладки EVO Docs: «Документы программ»
 * (`staff_application_document_submission_queue_v1`) или «Комплекты»
 * (`application_package_queue_v1`) — до `DOCS_QUEUE_READ_PAGES` страниц по
 * 20, новые сверху. `hidden` — учётная запись эту очередь не читает (нет
 * `document.read.full` или просмотр роли): вкладки нет; `denied` — сервер
 * отказал; `error` — сбой. У `ready` `nextCursor` не null — очередь
 * прочитана не вся.
 */
export type DocsQueueRead<Item> =
  | Readonly<{ kind: "hidden" }>
  | Readonly<{ kind: "ready"; queue: Readonly<{ items: readonly Item[]; nextCursor: ApplicationDocumentCursor | null }> }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "error" }>;
export type DocsPackagesRead = DocsQueueRead<ApplicationPackageQueueItem>;
export type DocsProgramRead = DocsQueueRead<ApplicationDocumentQueueItem>;

/** Число вкладки очереди — только когда очередь прочитана целиком (последняя страница без продолжения). */
export function docsQueueCount(read: DocsQueueRead<unknown>): number | null {
  return read.kind === "ready" && read.queue.nextCursor === null ? read.queue.items.length : null;
}
export const docsPackagesCount = docsQueueCount;

/**
 * Сколько страниц очереди (по 20, новые сверху) читает вкладка — как у чтений
 * «Сегодня» (3 страницы): число вкладки и порядок «сначала дольше всех
 * ждущие» есть, пока очередь не длиннее 60.
 */
export const DOCS_QUEUE_READ_PAGES = 3;
export const DOCS_PACKAGE_READ_PAGES = DOCS_QUEUE_READ_PAGES;

/** Страница очереди: ответ действия чтения, приведённый к `queue`. */
export type DocsQueuePage<Item> =
  | Readonly<{ ok: true; queue: Readonly<{ items: readonly Item[]; nextCursor: ApplicationDocumentCursor | null }> }>
  | Readonly<{ ok: false; reason: string }>;
export type DocsPackagesPage = DocsQueuePage<ApplicationPackageQueueItem>;

/**
 * Чтение вкладки очереди: страницы подряд, пока есть продолжение, но не
 * больше `pages`. Отказ или сбой первой страницы — своё состояние; сбой
 * следующей — прочитанная часть без числа (продолжение остаётся). Одна
 * запись (`idOf`) дважды не показывается.
 */
export async function readDocsQueuePages<Item>(
  readPage: (cursor: ApplicationDocumentCursor | null) => Promise<DocsQueuePage<Item>>,
  idOf: (item: Item) => string,
  pages: number = DOCS_QUEUE_READ_PAGES,
): Promise<DocsQueueRead<Item>> {
  const items: Item[] = [];
  const seen = new Set<string>();
  let cursor: ApplicationDocumentCursor | null = null;
  for (let index = 0; index < pages; index += 1) {
    let page: DocsQueuePage<Item>;
    try {
      page = await readPage(cursor);
    } catch {
      page = { ok: false, reason: "unavailable" };
    }
    if (!page.ok) {
      if (index === 0) return Object.freeze({ kind: page.reason === "forbidden" ? "denied" : "error" });
      break;
    }
    for (const item of page.queue.items) {
      if (seen.has(idOf(item))) continue;
      seen.add(idOf(item));
      items.push(item);
    }
    cursor = page.queue.nextCursor;
    if (cursor === null) break;
  }
  return Object.freeze({ kind: "ready", queue: Object.freeze({ items: Object.freeze(items), nextCursor: cursor }) });
}

/** «Комплекты»: страницы `readStaffApplicationPackageQueueAction`, комплект — по `packageId`. */
export function readDocsPackagePages(
  readPage: (cursor: ApplicationDocumentCursor | null) => Promise<DocsPackagesPage>,
  pages: number = DOCS_QUEUE_READ_PAGES,
): Promise<DocsPackagesRead> {
  return readDocsQueuePages(readPage, (item) => item.package.packageId, pages);
}

/** «Документы программ»: страницы `readStaffApplicationDocumentSubmissionQueueAction`, документ — по `submissionId`. */
export function readDocsProgramPages(
  readPage: (cursor: ApplicationDocumentCursor | null) => Promise<DocsQueuePage<ApplicationDocumentQueueItem>>,
  pages: number = DOCS_QUEUE_READ_PAGES,
): Promise<DocsProgramRead> {
  return readDocsQueuePages(readPage, (item) => item.submission.submissionId, pages);
}

// --- Ожидание проверки ----------------------------------------------------

/** С какого дня ожидания слово — предупреждение (`text-warn`): два дня и дольше. */
export const DOCS_WAIT_WARN_DAYS = 2;

export type DocsWaiting = Readonly<{
  /** Момент загрузки для `<time dateTime>`. */
  dateTime: string;
  /** День загрузки по Бишкеку: «25.09» (год — только не текущий). */
  day: string;
  /** «сегодня» или «ждёт 3 дн». */
  word: string;
  warn: boolean;
}>;

/**
 * Сколько ждёт проверки — от последней загрузки до сегодняшнего дня
 * Бишкека, днями (как «ждёт N дн» у переписки): загружено сегодня —
 * «сегодня», раньше — «ждёт N дн», с двух дней — предупреждением. Нет
 * времени — нет слова.
 */
export function docsWaiting(uploadedAt: string | null | undefined, today: string): DocsWaiting | null {
  if (!uploadedAt) return null;
  const moment = new Date(uploadedAt);
  if (!Number.isFinite(moment.getTime())) return null;
  const day = dayInOrganizationTimezone(moment);
  const days = Math.max(0, dayDelta(day, today));
  return { dateTime: uploadedAt, day: formatQueueDay(day, today), word: days === 0 ? "сегодня" : `ждёт${NBSP}${days}${NBSP}дн`, warn: days >= DOCS_WAIT_WARN_DAYS };
}

/**
 * Порядок строк очереди документов: «сначала дольше всех ждущие» — только
 * когда прочитано всё (иначе самые давние могли не попасть в прочитанную
 * часть, и порядок сервера остаётся — об этом говорит строка над таблицей).
 * Строка без времени ожидания оставляет порядок сервера целиком.
 */
export function docsOldestFirst<Item>(
  items: readonly Item[],
  uploadedAt: (item: Item) => string | null | undefined,
  idOf: (item: Item) => string,
  complete: boolean,
): Readonly<{ items: readonly Item[]; oldestFirst: boolean }> {
  if (!complete || items.some((item) => !uploadedAt(item) || !Number.isFinite(Date.parse(uploadedAt(item)!)))) return { items, oldestFirst: false };
  const sorted = [...items].sort((a, b) => Date.parse(uploadedAt(a)!) - Date.parse(uploadedAt(b)!) || (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0));
  return { items: sorted, oldestFirst: true };
}

// --- Сроки ---------------------------------------------------------------

/**
 * Момент «сегодня» для правила дня Бишкека: полдень (06:00 UTC) того дня,
 * который вернуло чтение 241. Так слово срока и группа строки считаются от
 * того же дня, что и у SQL, а не от часов сервера приложения.
 */
export function bishkekNoon(today: string): Date {
  return new Date(`${today}T06:00:00.000Z`);
}

/**
 * Группа дела по «Следующему шагу» — то же правило, что у
 * `platform_private.case_next_action_band` (241), поверх общего `dueBucket`:
 * «Завтра» очереди задач входит в «На этой неделе», если завтра не
 * понедельник следующей недели.
 */
export function caseNextActionBand(nextAction: string | null, dueOn: string | null, now: Date): CaseNextActionBand {
  if (!nextAction) return "no_step";
  if (!dueOn) return "undated";
  const bucket = dueBucket({ dueOn, dueAt: null }, now);
  if (bucket === "overdue") return "overdue";
  if (bucket === "today") return "today";
  if (bucket === "week") return "this_week";
  // В воскресенье завтра — уже следующая неделя: «Позже», как у SQL.
  if (bucket === "tomorrow") return dueOn <= weekEnd(dayInOrganizationTimezone(now)) ? "this_week" : "later";
  return "later";
}

export function studentsBandLabel(band: CaseNextActionBand, today: string): string {
  switch (band) {
    case "overdue": return "Просрочено";
    case "today": return `Сегодня · ${queueDayWithWeekday(today, today)}`;
    case "this_week": return "На этой неделе";
    case "later": return "Позже";
    case "undated": return "Без срока";
    case "no_step": return "Без следующего шага";
  }
}

export type StudentsBand<Row> = Readonly<{
  key: CaseNextActionBand | "all";
  label: string | null;
  count: number | null;
  tone: "danger" | "warn" | "default";
  rows: readonly Row[];
}>;

/**
 * Виды, где шаг можно задать: шаг задаётся только делу в работе, поэтому у
 * закрытых и ожидающих начала дел группы по его сроку ничего не значат.
 */
export function studentsStepView(view: StudentsQueueParams["view"]): boolean {
  return view !== "closed" && view !== "pending";
}

/**
 * Порядок чтения вида. У «Закрытых» и «Ожидает начала» шагов в работе нет:
 * по сроку 241 ставил бы дела без шага в порядке номеров, поэтому они всегда
 * по обновлению. Выбор человека (`sort`) в адресе остаётся для видов с шагами.
 */
export function studentsEffectiveSort(view: StudentsQueueParams["view"], sort: StudentCaseQueueSort): StudentCaseQueueSort {
  return studentsStepView(view) ? sort : "updated";
}

/**
 * Группы тела: при сортировке по сроку — группы 241 в их порядке, только
 * непустые на этой странице, с числом группы из чтения чисел; при сортировке
 * по обновлению и в «Закрытых» — один список без групп.
 */
export function studentsBands<Row extends Pick<StudentCaseQueueRow, "dueBand">>(
  rows: readonly Row[],
  sort: StudentCaseQueueSort,
  today: string,
  counts: StudentCaseQueueCounts | null,
  stepView = true,
): readonly StudentsBand<Row>[] {
  if (sort === "updated" || !stepView) return rows.length ? [{ key: "all", label: null, count: null, tone: "default", rows }] : [];
  return CASE_NEXT_ACTION_BANDS
    .map((band) => ({
      key: band,
      label: studentsBandLabel(band, today),
      count: counts ? counts.bands[band] : null,
      tone: band === "overdue" ? "danger" as const : band === "no_step" ? "warn" as const : "default" as const,
      rows: rows.filter((row) => row.dueBand === band),
    }))
    .filter((band) => band.rows.length > 0);
}

// --- Слова строки ----------------------------------------------------------

/** 1 задача, 2 задачи, 5 задач. */
export function russianPlural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  return units >= 2 && units <= 4 ? few : many;
}

export type StudentsSignal = Readonly<{ key: string; text: string; tone: "danger" | "warn" | "muted" }>;

const NBSP = "\u00a0";

export type StudentsSignalOptions = Readonly<{
  /**
   * Колонки «Куратор» нет (вид «Мои»: там в каждой строке были бы «Вы») —
   * исключения куратора переходят в сигналы: «ждёт принятия», «нужен
   * куратор» и чужое дело («куратор: Имя Ф.»).
   */
  curatorWords?: boolean;
  /** Сортировка по обновлению: групп по сроку нет, просроченный шаг назван словом. */
  overdueStep?: boolean;
}>;

/**
 * «Сигналы» строки — словами и только из самой строки 241: «нужен ответ»
 * (переписка ждёт сотрудника, 245), просроченные задачи, документы исправить
 * или отклонены, просроченный дедлайн (флаг внимания без просроченных задач
 * и шага), «ждём партнёра». Документы «на
 * проверке» — работа проверяющего: они в строке документов панели и в EVO
 * Docs, а не в сигналах. «Ждёт принятия» и «нужен куратор» — в колонке
 * «Куратор», а без неё (`curatorWords`) — первыми сигналами.
 */
export function studentsRowSignals(
  row: Pick<StudentCaseQueueRow, "overdueTaskCount" | "documents" | "attentionFlags" | "dueBand">
    & Partial<Pick<StudentCaseQueueRow, "isMine" | "currentCuratorMembershipId" | "currentCuratorDisplayName" | "needsReply">>,
  options: StudentsSignalOptions = {},
): readonly StudentsSignal[] {
  const signals: StudentsSignal[] = [];
  if (options.curatorWords) {
    if (row.attentionFlags.includes("awaiting_ack")) signals.push({ key: "awaiting", tone: "warn", text: "ждёт принятия" });
    if (row.attentionFlags.includes("needs_curator")) signals.push({ key: "needs_curator", tone: "danger", text: "нужен куратор" });
    else if (row.currentCuratorMembershipId && row.isMine === false) {
      signals.push({ key: "curator", tone: "muted", text: `куратор:${NBSP}${shortPersonName(row.currentCuratorDisplayName ?? "без имени")}` });
    }
  }
  // Студент написал и ждёт ответа сотрудника — работа, которую видно только здесь и в «Сообщениях».
  if (row.needsReply) signals.push({ key: "reply", tone: "danger", text: "нужен ответ" });
  if (options.overdueStep && row.dueBand === "overdue") signals.push({ key: "step", tone: "danger", text: "Шаг просрочен" });
  const tasks = row.overdueTaskCount;
  if (tasks > 0) {
    signals.push({ key: "tasks", tone: "danger", text: `${tasks}${NBSP}${russianPlural(tasks, "задача просрочена", "задачи просрочены", "задач просрочено")}` });
  }
  if (row.attentionFlags.includes("overdue") && tasks === 0 && row.dueBand !== "overdue") {
    signals.push({ key: "deadline", tone: "danger", text: "Просрочен дедлайн" });
  }
  const documents = row.documents;
  if (documents) {
    if (documents.correctionRequired > 0) {
      const count = documents.correctionRequired;
      signals.push({ key: "fix", tone: "warn", text: `${count}${NBSP}${russianPlural(count, "документ", "документа", "документов")} исправить` });
    }
    if (documents.rejected > 0) {
      const count = documents.rejected;
      signals.push({ key: "rejected", tone: "warn", text: `${count}${NBSP}${russianPlural(count, "документ отклонён", "документа отклонены", "документов отклонено")}` });
    }
  }
  if (row.attentionFlags.includes("awaiting_partner")) signals.push({ key: "partner", tone: "muted", text: "Ждём партнёра" });
  return signals;
}

export type StudentsDocumentsLine = Readonly<{
  /** «7 из 12 принято» или «Чек-лист не собран». */
  summary: string;
  parts: readonly StudentsSignal[];
}>;

/** Строка документов (EVO Docs и «Быстрый просмотр»). null — нет права читать документы. */
export function studentsDocumentsLine(documents: StudentCaseChecklistCounts | null): StudentsDocumentsLine | null {
  if (documents === null) return null;
  if (documents.total === 0) return { summary: "Чек-лист не собран", parts: [] };
  const parts: StudentsSignal[] = [];
  if (documents.submitted) parts.push({ key: "review", tone: "muted", text: `${documents.submitted}${NBSP}на проверке` });
  if (documents.correctionRequired) parts.push({ key: "fix", tone: "warn", text: `${documents.correctionRequired}${NBSP}исправить` });
  if (documents.rejected) parts.push({ key: "rejected", tone: "warn", text: `${documents.rejected}${NBSP}${russianPlural(documents.rejected, "отклонён", "отклонены", "отклонено")}` });
  if (documents.missing) parts.push({ key: "missing", tone: "muted", text: `${documents.missing}${NBSP}не${NBSP}загружено` });
  return { summary: `${documents.approved} из ${documents.total} принято`, parts };
}

/**
 * Ячейка «Документы» EVO Docs: первым — число, которое определяет вкладку
 * («2 на проверке» на «Документах дела», «1 исправить · 1 отклонён» на
 * «Исправить», «3 не загружено» на «Не хватает»), затем остальное тише. На
 * «Все» первым идёт «7 из 12 принято».
 * null — нет права читать документы.
 */
export type StudentsDocsPart = Readonly<{ key: string; text: string; tone: "default" | "danger" | "warn" | "muted" }>;

export function studentsDocsCell(
  view: StudentsDocsView,
  documents: StudentCaseChecklistCounts | null,
): Readonly<{ lead: readonly StudentsDocsPart[]; rest: readonly StudentsDocsPart[] }> | null {
  const line = studentsDocumentsLine(documents);
  if (line === null) return null;
  const summary: StudentsDocsPart = { key: "summary", tone: "default", text: line.summary };
  const leadKeys: readonly string[] = view === "review" ? ["review"] : view === "fix" ? ["fix", "rejected"] : view === "missing" ? ["missing"] : [];
  // Число вкладки — обычным цветом: «2 на проверке», «3 не загружено»; «исправить» и «отклонён» остаются предупреждением.
  const lead = line.parts.filter((part) => leadKeys.includes(part.key))
    .map((part) => part.key === "review" || part.key === "missing" ? { ...part, tone: "default" as const } : part);
  if (lead.length === 0) return { lead: [summary], rest: line.parts };
  return { lead, rest: [{ ...summary, tone: "muted" }, ...line.parts.filter((part) => !leadKeys.includes(part.key))] };
}

/** День последнего изменения дела (сортировка «по обновлению»): «обн. 22.09» по Бишкеку. */
export function studentsUpdatedDay(updatedAt: string, today: string): Readonly<{ dateTime: string; text: string }> | null {
  const moment = new Date(updatedAt);
  if (!Number.isFinite(moment.getTime())) return null;
  return { dateTime: updatedAt, text: formatQueueDay(dayInOrganizationTimezone(moment), today) };
}

// --- Редактор «Следующего шага» -------------------------------------------

export type NextStepAccessInput = Readonly<{
  admin: boolean;
  preview: boolean;
  /** Право `case.route.manage` у сотрудника (любая область). */
  routeManage: boolean;
  /** Есть назначение шире «своей» области: организация, отдел или направление. */
  broadScope: boolean;
}>;

export type NextStepAccess =
  | Readonly<{ kind: "edit" }>
  | Readonly<{ kind: "read_only"; reason: string | null }>;

/**
 * Показывать ли редактор шага. Это подсказка интерфейса, а не граница
 * доступа: запись проверяет `set_case_next_action_v1` (куратор дела, Admin
 * и `case.route.manage` в области отдела, направления или записи). Просмотр
 * роли не пишет; шаг задаётся только делу в работе.
 */
export function nextStepAccess(input: NextStepAccessInput, row: Pick<StudentCaseQueueRow, "state" | "isMine" | "studentCaseId">, recordScopes: readonly string[] = []): NextStepAccess {
  if (input.preview) return { kind: "read_only", reason: "В просмотре интерфейса роли шаг не меняется." };
  if (row.state === "closed") return { kind: "read_only", reason: "Дело закрыто: шаг не меняется." };
  if (row.state !== "active") return { kind: "read_only", reason: "Шаг задаётся только делу в работе." };
  if (input.admin) return { kind: "edit" };
  if (input.routeManage && (row.isMine || input.broadScope || recordScopes.includes(row.studentCaseId))) return { kind: "edit" };
  return { kind: "read_only", reason: null };
}

export type NextStepDueChoice = "today" | "tomorrow" | "friday" | "date" | "none";

/** Открытая задача дела в «Быстром просмотре» (из `staff_student_case_task_workspace`). */
export type StudentsPanelTask = Readonly<{
  id: string;
  title: string;
  status: string;
  dueOn: string | null;
  dueAt: string | null;
  assigneeDisplayName: string;
}>;

/**
 * «Приём дела» открытой строки — тот же снимок и та же форма, что в карточке
 * дела (`ProfileHandoffAcknowledgement`). Есть только у текущего куратора,
 * который может ответить, пока дело не принято (`studentsHandoffPending`);
 * иначе null, и панель блок не рисует.
 */
export type StudentsHandoff = HandoffAcknowledgement & Readonly<{ requestId: string }>;

/**
 * Блоку «Приём дела» в панели есть что делать: куратор может ответить, а дело
 * ещё не принято — то же правило, что у сигнала `awaiting_ack` (182). После
 * «Принять дело» ответ можно пересмотреть только в карточке дела: в очереди
 * принятое дело не открывается сплошной красной кнопкой.
 */
export function studentsHandoffPending(handoff: Pick<HandoffAcknowledgement, "canRespond" | "assignmentEventId" | "current">): boolean {
  return handoff.canRespond && handoff.assignmentEventId !== null && handoff.current?.decision !== "accepted";
}

/** Задачи панели: «недоступно» — это не «задач нет». */
export type StudentsOpenTasks =
  | Readonly<{ kind: "ready"; tasks: readonly StudentsPanelTask[] }>
  | Readonly<{ kind: "unavailable" }>;
