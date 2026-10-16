/**
 * Контракт экранов «CSCA» (миграции 285, 286; docs/portal/csca-contract.md).
 *
 * Строгие парсеры ответов RPC: на клиент проходят только поля контракта,
 * ключи ответов и разборы приходят лишь там, где их отдаёт сервер (после
 * ответа или после завершения теста). Неожиданная форма означает честную
 * ошибку экрана, а не «как-нибудь показать». Здесь же чистые помощники
 * отрисовщика: разрезка текста по `$`, замена палитры рисунка для тёмной
 * темы, часы теста по серверному времени.
 */

export const CSCA_TRACK = "csca-math" as const;
export type CscaTrack = typeof CSCA_TRACK;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY = /^[a-z0-9][a-z0-9-]{0,119}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const OPTION_IDS = ["a", "b", "c", "d"] as const;

export type CscaOptionId = (typeof OPTION_IDS)[number];

export function isCscaUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isCscaKey(value: unknown): value is string {
  return typeof value === "string" && KEY.test(value);
}

export function isCscaOptionId(value: unknown): value is CscaOptionId {
  return typeof value === "string" && (OPTION_IDS as readonly string[]).includes(value);
}

export class CscaParseError extends Error {
  constructor(where: string) {
    super(`CSCA payload has an unexpected shape (${where}).`);
    this.name = "CscaParseError";
  }
}

let where = "";
const fail = (): never => {
  throw new CscaParseError(where);
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();
}
function str(value: unknown, max = 12000): string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max
    // Управляющие символы, кроме перевода строки, в контенте не встречаются.
    && !/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(value)
    ? value
    : fail();
}
function list<T>(value: unknown, parse: (item: unknown) => T, max = 200): T[] {
  return Array.isArray(value) && value.length <= max ? value.map((item) => parse(item)) : fail();
}
function int(value: unknown, max = Number.MAX_SAFE_INTEGER, min = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : fail();
}
function bool(value: unknown): boolean {
  return typeof value === "boolean" ? value : fail();
}
function uuid(value: unknown): string {
  return isCscaUuid(value) ? value : fail();
}
function key(value: unknown): string {
  return isCscaKey(value) ? value : fail();
}
function optionId(value: unknown): CscaOptionId {
  return isCscaOptionId(value) ? value : fail();
}
function stamp(value: unknown): string {
  const result = str(value, 40);
  return /^\d{4}-\d{2}-\d{2}T/u.test(result) && Number.isFinite(Date.parse(result)) ? result : fail();
}
function day(value: unknown): string {
  return typeof value === "string" && DATE.test(value) ? value : fail();
}
function share(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fail();
}
function nullable<T>(value: unknown, parse: (item: unknown) => T): T | null {
  return value === null || value === undefined ? null : parse(value);
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fail();
}
function https(value: unknown): string {
  const result = str(value, 500);
  return /^https:\/\/[^\s"<>]+$/u.test(result) ? result : fail();
}

// ---------------------------------------------------------------------------
// Коды ошибок RPC (§1.1 контракта)
// ---------------------------------------------------------------------------

export type CscaErrorCode =
  | "conflict"
  | "invalid"
  | "denied"
  | "unavailable"
  | "already_answered"
  | "deadline_passed"
  | "test_completed"
  | "early_finish_forbidden"
  | "review_not_due"
  | "report_limit";

/** SQLSTATE и имя отказа 22023 из ответа PostgREST в код экрана. */
const NAMED_22023: Readonly<Record<string, CscaErrorCode>> = {
  learning_test_deadline_passed: "deadline_passed",
  learning_test_completed: "test_completed",
  learning_test_early_finish_forbidden: "early_finish_forbidden",
  learning_review_not_due: "review_not_due",
  learning_report_limit: "report_limit",
  "Learning exercise is already answered": "already_answered",
};

export function cscaErrorCode(error: unknown): CscaErrorCode {
  const row = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  if (row.code === "40001") return "conflict";
  if (row.code === "42501") return "denied";
  if (row.code === "22023") {
    return (typeof row.message === "string" && NAMED_22023[row.message]) || "invalid";
  }
  return "unavailable";
}

// ---------------------------------------------------------------------------
// Общие формы
// ---------------------------------------------------------------------------

export type CscaTopicState = "not_started" | "few_data" | "gap" | "shaky" | "confident";
const TOPIC_STATES = ["not_started", "few_data", "gap", "shaky", "confident"] as const;

export type CscaSectionPoint = { point: string; label_ru: string; label_ky: string; label_en: string };
export type CscaSection = {
  section: number;
  title_ru: string;
  title_ky: string;
  title_en: string;
  mock_items_estimate: number;
  points: CscaSectionPoint[];
};

export type CscaModuleMeta = {
  title_ru: string;
  title_ky: string;
  level_note_ru: string;
  level_note_ky: string;
  syllabus_edition: string;
  syllabus_url: string;
  sections: CscaSection[];
};

export type CscaModule = {
  moduleId: string;
  moduleKey: string;
  version: string;
  metadata: CscaModuleMeta;
};

export type CscaTopicMeta = {
  title_ru: string;
  title_ky: string;
  title_en: string;
  section: number;
  syllabus_point: string;
  mock_items_estimate: number;
  likely_gap: boolean;
  prerequisites: string[];
};

export type CscaLessonKind = "lesson" | "practice";

export type CscaLessonMeta = {
  title_ru: string;
  title_ky: string;
  title_en: string;
  goal_ru: string;
  goal_ky: string;
  topic_key: string;
  kind: CscaLessonKind;
  est_minutes: number;
  syllabus_point: string;
};

export type CscaLessonResult = {
  exercisesTotal: number;
  correctCount: number;
  correctShare: number;
  wrongExerciseIds: string[];
  completedAt: string;
};

export type CscaItem = {
  itemKey: string;
  topicKey: string;
  syllabusPoint: string;
  difficulty: number;
  estSeconds: number;
  figureKey: string | null;
  stemEn: string;
  options: { id: CscaOptionId; label: string }[];
};

export type CscaLessonItem = CscaItem & { exerciseId: string; orderIndex: number };

export type CscaFigure = {
  svg: string;
  viewBox: string;
  width: number;
  height: number;
  altRu: string;
  altKy: string;
  altEn: string;
};

export type CscaTerm = { en: string; ru: string; ky: string };

export type CscaExplain = {
  correctOptionId: CscaOptionId;
  options: { id: CscaOptionId; explainRu: string; explainKy: string }[];
  solutionRu: string[];
  solutionKy: string[];
  terms: CscaTerm[];
};

function sectionPoint(value: unknown): CscaSectionPoint {
  const row = record(value);
  return {
    point: str(row.point, 12),
    label_ru: str(row.label_ru, 400),
    label_ky: str(row.label_ky, 400),
    label_en: str(row.label_en, 400),
  };
}

function moduleMeta(value: unknown): CscaModuleMeta {
  const row = record(value);
  return {
    title_ru: str(row.title_ru, 200),
    title_ky: str(row.title_ky, 200),
    level_note_ru: str(row.level_note_ru, 1000),
    level_note_ky: str(row.level_note_ky, 1000),
    syllabus_edition: str(row.syllabus_edition, 40),
    syllabus_url: https(row.syllabus_url),
    sections: list(row.sections ?? [], (item) => {
      const section = record(item);
      return {
        section: int(section.section, 20, 1),
        title_ru: str(section.title_ru, 200),
        title_ky: str(section.title_ky, 200),
        title_en: str(section.title_en, 200),
        mock_items_estimate: int(section.mock_items_estimate, 200),
        points: list(section.points, sectionPoint, 20),
      };
    }, 12),
  };
}

function cscaModule(value: unknown): CscaModule {
  const row = record(value);
  return {
    moduleId: uuid(row.moduleId),
    moduleKey: key(row.moduleKey),
    version: str(row.version, 40),
    metadata: moduleMeta(row.metadata),
  };
}

function topicMeta(value: unknown): CscaTopicMeta {
  const row = record(value);
  return {
    title_ru: str(row.title_ru, 300),
    title_ky: str(row.title_ky, 300),
    title_en: str(row.title_en, 300),
    section: int(row.section, 20, 1),
    syllabus_point: str(row.syllabus_point, 12),
    mock_items_estimate: int(row.mock_items_estimate ?? 0, 200),
    likely_gap: row.likely_gap === true,
    prerequisites: list(row.prerequisites ?? [], key, 20),
  };
}

function lessonMeta(value: unknown): CscaLessonMeta {
  const row = record(value);
  return {
    title_ru: str(row.title_ru, 300),
    title_ky: str(row.title_ky, 300),
    title_en: str(row.title_en, 300),
    goal_ru: str(row.goal_ru, 1000),
    goal_ky: str(row.goal_ky, 1000),
    topic_key: key(row.topic_key),
    kind: oneOf(row.kind, ["lesson", "practice"] as const),
    est_minutes: int(row.est_minutes, 120, 1),
    syllabus_point: str(row.syllabus_point, 12),
  };
}

function lessonResult(value: unknown): CscaLessonResult {
  const row = record(value);
  return {
    exercisesTotal: int(row.exercisesTotal, 200),
    correctCount: int(row.correctCount, 200),
    correctShare: share(row.correctShare),
    wrongExerciseIds: list(row.wrongExerciseIds, uuid, 200),
    completedAt: stamp(row.completedAt),
  };
}

function item(value: unknown): CscaItem {
  const row = record(value);
  const options = list(row.options, (entry) => {
    const option = record(entry);
    return { id: optionId(option.id), label: str(option.label, 2000) };
  }, 4);
  if (options.length !== 4 || new Set(options.map((option) => option.id)).size !== 4) fail();
  return {
    itemKey: key(row.itemKey),
    topicKey: key(row.topicKey),
    syllabusPoint: str(row.syllabusPoint, 12),
    difficulty: int(row.difficulty, 3, 1),
    estSeconds: int(row.estSeconds, 3600, 1),
    figureKey: nullable(row.figureKey, key),
    stemEn: str(row.stemEn, 4000),
    options,
  };
}

function lessonItem(value: unknown): CscaLessonItem {
  const row = record(value);
  if (row.type !== "item") fail();
  return { ...item(value), exerciseId: uuid(row.exerciseId), orderIndex: int(row.orderIndex, 200) };
}

const SVG_FORBIDDEN = /<\s*(script|style|foreignObject|image|iframe)|\bon[a-z]+\s*=|href\s*=|url\(|data:|<!|<\?/iu;

function figure(value: unknown): CscaFigure {
  const row = record(value);
  const svg = str(row.svg, 26000);
  // Профиль SVG проверяет база при вставке; здесь вторая страховка до показа.
  if (!/^<svg\s/u.test(svg) || !svg.trimEnd().endsWith("</svg>") || SVG_FORBIDDEN.test(svg)) fail();
  const viewBox = str(row.viewBox, 40);
  const match = /^0 0 (\d{2,4}) (\d{2,4})$/u.exec(viewBox) ?? fail();
  return {
    svg,
    viewBox,
    width: Number(match[1]),
    height: Number(match[2]),
    altRu: str(row.altRu, 2000),
    altKy: str(row.altKy, 2000),
    altEn: str(row.altEn, 2000),
  };
}

function figures(value: unknown): Record<string, CscaFigure> {
  const row = value === null || value === undefined ? {} : record(value);
  const entries = Object.entries(row);
  if (entries.length > 60) fail();
  return Object.fromEntries(entries.map(([figureKey, entry]) => [key(figureKey), figure(entry)]));
}

function term(value: unknown): CscaTerm {
  const row = record(value);
  return { en: str(row.en, 200), ru: str(row.ru, 200), ky: str(row.ky, 200) };
}

export function parseCscaExplain(value: unknown): CscaExplain {
  const row = record(value);
  const solutionRu = list(row.solutionRu, (step) => str(step, 2000), 12);
  const solutionKy = list(row.solutionKy, (step) => str(step, 2000), 12);
  if (solutionRu.length !== solutionKy.length) fail();
  return {
    correctOptionId: optionId(row.correctOptionId),
    options: list(row.options, (entry) => {
      const option = record(entry);
      return {
        id: optionId(option.id),
        explainRu: str(option.explainRu, 3000),
        explainKy: str(option.explainKy, 3000),
      };
    }, 4),
    solutionRu,
    solutionKy,
    terms: list(row.terms ?? [], term, 12),
  };
}

// ---------------------------------------------------------------------------
// Блоки теории (§13 контракта)
// ---------------------------------------------------------------------------

export type CscaCell = { tex: string } | { ru: string; ky: string };

export type CscaTheoryBlock =
  | { kind: "idea"; ru: string; ky: string }
  | { kind: "formula"; tex: string[]; note_ru: string; note_ky: string }
  | { kind: "figure"; figure_key: string; caption_ru: string; caption_ky: string }
  | { kind: "table"; caption_ru: string; caption_ky: string; header: CscaCell[]; rows: CscaCell[][] }
  | {
    kind: "example";
    title_ru: string;
    title_ky: string;
    stem_en: string;
    steps: { ru: string; ky: string }[];
    answer_ru: string;
    answer_ky: string;
  }
  | { kind: "pitfalls"; items: { ru: string; ky: string }[] }
  | { kind: "tip"; tip: "no_calculator"; ru: string; ky: string }
  | { kind: "terms"; terms: CscaTerm[] }
  | { kind: "interactive"; widget: string; figure_key: string | null; caption_ru: string; caption_ky: string };

function localizedPair(value: unknown, max = 4000): { ru: string; ky: string } {
  const row = record(value);
  return { ru: str(row.ru, max), ky: str(row.ky, max) };
}

function cell(value: unknown): CscaCell {
  const row = record(value);
  return typeof row.tex === "string" ? { tex: str(row.tex, 400) } : localizedPair(row, 400);
}

/** Неизвестный `kind` пропускается молча (будущие версии), как велит контракт. */
function theoryBlock(value: unknown): CscaTheoryBlock | null {
  const row = record(value);
  switch (row.kind) {
    case "idea":
      return { kind: "idea", ...localizedPair(row) };
    case "formula":
      return {
        kind: "formula",
        tex: list(row.tex, (line) => str(line, 600), 6),
        note_ru: str(row.note_ru, 2000),
        note_ky: str(row.note_ky, 2000),
      };
    case "figure":
      return {
        kind: "figure",
        figure_key: key(row.figure_key),
        caption_ru: str(row.caption_ru, 2000),
        caption_ky: str(row.caption_ky, 2000),
      };
    case "table": {
      const header = list(row.header, cell, 6);
      const rows = list(row.rows, (entry) => list(entry, cell, 6), 20);
      if (rows.some((cells) => cells.length !== header.length)) fail();
      return {
        kind: "table",
        caption_ru: str(row.caption_ru, 400),
        caption_ky: str(row.caption_ky, 400),
        header,
        rows,
      };
    }
    case "example":
      return {
        kind: "example",
        title_ru: str(row.title_ru, 300),
        title_ky: str(row.title_ky, 300),
        stem_en: str(row.stem_en, 3000),
        steps: list(row.steps, (step) => localizedPair(step, 2000), 8),
        answer_ru: str(row.answer_ru, 1000),
        answer_ky: str(row.answer_ky, 1000),
      };
    case "pitfalls":
      return { kind: "pitfalls", items: list(row.items, (entry) => localizedPair(entry, 2000), 6) };
    case "tip":
      return { kind: "tip", tip: oneOf(row.tip, ["no_calculator"] as const), ...localizedPair(row, 2000) };
    case "terms":
      return { kind: "terms", terms: list(row.terms, term, 40) };
    case "interactive":
      return {
        kind: "interactive",
        widget: key(row.widget),
        figure_key: nullable(row.figure_key, key),
        caption_ru: str(row.caption_ru, 2000),
        caption_ky: str(row.caption_ky, 2000),
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Главная трека, §3
// ---------------------------------------------------------------------------

export type CscaTopic = {
  topicKey: string;
  orderIndex: number;
  metadata: CscaTopicMeta;
  state: CscaTopicState;
  windowAnswers: number;
  windowCorrect: number;
  lessonCompleted: boolean;
  hasLessons: boolean;
};

export type CscaLessonSummary = {
  lessonId: string;
  lessonKey: string;
  orderIndex: number;
  metadata: CscaLessonMeta;
  exercisesTotal: number;
  completed: boolean;
  draftAttemptId: string | null;
  lastResult: CscaLessonResult | null;
};

export type CscaTestKind = "diagnostic" | "mock";

export type CscaTestMeta = { title_ru: string; title_ky: string; intro_ru: string; intro_ky: string };

export type CscaTestLastResult = {
  attemptId: string;
  completedAt: string;
  completion: "submitted" | "timeout";
  itemsTotal: number;
  answeredCount: number;
  correctCount: number;
  correctShare: number;
};

export type CscaTestSummary = {
  formId: string;
  formKey: string;
  kind: CscaTestKind;
  metadata: CscaTestMeta;
  durationSeconds: number;
  allowEarlyFinish: boolean;
  itemsTotal: number;
  draft: { attemptId: string; revision: number; startedAt: string; deadlineAt: string; answeredCount: number } | null;
  lastResult: CscaTestLastResult | null;
};

export type CscaSession = {
  sessionKey: string;
  examFrom: string;
  examTo: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  sourceUrl: string;
  verifiedOn: string;
};

export type CscaNextStep =
  | { kind: "test"; formId: string; formKey: string }
  | {
    kind: "lesson";
    lessonId: string;
    lessonKey: string;
    lessonKind: CscaLessonKind;
    topicKey: string;
    topicState: CscaTopicState;
  }
  | { kind: "review" };

export type CscaHome = {
  track: string;
  serverNow: string;
  today: string;
  modules: CscaModule[];
  topics: CscaTopic[];
  lessons: CscaLessonSummary[];
  tests: CscaTestSummary[];
  review: { dueCount: number; activeCount: number; nextDueOn: string | null };
  sessions: CscaSession[];
  targetSessionKey: string | null;
  nextStep: CscaNextStep | null;
};

const testMeta = (value: unknown): CscaTestMeta => {
  const row = record(value);
  return {
    title_ru: str(row.title_ru, 200),
    title_ky: str(row.title_ky, 200),
    intro_ru: str(row.intro_ru, 1000),
    intro_ky: str(row.intro_ky, 1000),
  };
};

function lessonSummary(value: unknown): CscaLessonSummary {
  const row = record(value);
  return {
    lessonId: uuid(row.lessonId),
    lessonKey: key(row.lessonKey),
    orderIndex: int(row.orderIndex, 1000),
    metadata: lessonMeta(row.metadata),
    exercisesTotal: int(row.exercisesTotal, 200),
    completed: bool(row.completed),
    draftAttemptId: nullable(row.draftAttemptId, uuid),
    lastResult: nullable(row.lastResult, lessonResult),
  };
}

function nextStep(value: unknown): CscaNextStep | null {
  if (value === null || value === undefined) return null;
  const row = record(value);
  if (row.kind === "test") return { kind: "test", formId: uuid(row.formId), formKey: key(row.formKey) };
  if (row.kind === "review") return { kind: "review" };
  if (row.kind === "lesson") {
    return {
      kind: "lesson",
      lessonId: uuid(row.lessonId),
      lessonKey: key(row.lessonKey),
      lessonKind: oneOf(row.lessonKind, ["lesson", "practice"] as const),
      topicKey: key(row.topicKey),
      topicState: oneOf(row.topicState, TOPIC_STATES),
    };
  }
  return fail();
}

export function parseCscaHome(value: unknown): CscaHome {
  where = "home";
  const row = record(value);
  const reviewRow = record(row.review);
  return {
    track: key(row.track),
    serverNow: stamp(row.serverNow),
    today: day(row.today),
    modules: list(row.modules, cscaModule, 4),
    topics: list(row.topics, (entry) => {
      const topic = record(entry);
      return {
        topicKey: key(topic.topicKey),
        orderIndex: int(topic.orderIndex, 1000),
        metadata: topicMeta(topic.metadata),
        state: oneOf(topic.state, TOPIC_STATES),
        windowAnswers: int(topic.windowAnswers, 6),
        windowCorrect: int(topic.windowCorrect, 6),
        lessonCompleted: bool(topic.lessonCompleted),
        hasLessons: bool(topic.hasLessons),
      };
    }, 120),
    lessons: list(row.lessons, lessonSummary, 300),
    tests: list(row.tests, (entry) => {
      const test = record(entry);
      const draft = test.draft === null || test.draft === undefined ? null : record(test.draft);
      const last = test.lastResult === null || test.lastResult === undefined ? null : record(test.lastResult);
      return {
        formId: uuid(test.formId),
        formKey: key(test.formKey),
        kind: oneOf(test.kind, ["diagnostic", "mock"] as const),
        metadata: testMeta(test.metadata),
        durationSeconds: int(test.durationSeconds, 4 * 3600, 1),
        allowEarlyFinish: bool(test.allowEarlyFinish),
        itemsTotal: int(test.itemsTotal, 200, 1),
        draft: draft
          ? {
            attemptId: uuid(draft.attemptId),
            revision: int(draft.revision, Number.MAX_SAFE_INTEGER, 1),
            startedAt: stamp(draft.startedAt),
            deadlineAt: stamp(draft.deadlineAt),
            answeredCount: int(draft.answeredCount, 200),
          }
          : null,
        lastResult: last
          ? {
            attemptId: uuid(last.attemptId),
            completedAt: stamp(last.completedAt),
            completion: oneOf(last.completion, ["submitted", "timeout"] as const),
            itemsTotal: int(last.itemsTotal, 200),
            answeredCount: int(last.answeredCount, 200),
            correctCount: int(last.correctCount, 200),
            correctShare: share(last.correctShare),
          }
          : null,
      };
    }, 20),
    review: {
      dueCount: int(reviewRow.dueCount, 100000),
      activeCount: int(reviewRow.activeCount, 100000),
      nextDueOn: nullable(reviewRow.nextDueOn, day),
    },
    sessions: list(row.sessions, (entry) => {
      const session = record(entry);
      return {
        sessionKey: key(session.sessionKey),
        examFrom: day(session.examFrom),
        examTo: day(session.examTo),
        registrationOpensAt: nullable(session.registrationOpensAt, stamp),
        registrationClosesAt: nullable(session.registrationClosesAt, stamp),
        sourceUrl: https(session.sourceUrl),
        verifiedOn: day(session.verifiedOn),
      };
    }, 24),
    targetSessionKey: nullable(row.targetSessionKey, key),
    nextStep: nextStep(row.nextStep),
  };
}

/** learning_modules_v2: только список уроков модуля (для соседних уроков темы). */
export function parseCscaModuleLessons(value: unknown): CscaLessonSummary[] {
  where = "modules";
  const row = record(value);
  return list(row.modules, (entry) => list(record(entry).lessons, lessonSummary, 300), 4).flat();
}

// ---------------------------------------------------------------------------
// Урок v2 и запись через 198, §5..§6
// ---------------------------------------------------------------------------

export type CscaAnswerEntry = {
  selected: CscaOptionId;
  correct: boolean;
  explain: CscaExplain;
  answeredAt: string;
};

export type CscaLessonAttempt = {
  attemptId: string;
  lessonId: string;
  status: "draft" | "completed";
  revision: number;
  answers: Record<string, CscaAnswerEntry>;
  answeredCount: number;
  exercisesTotal: number;
  result: CscaLessonResult | null;
};

export type CscaLessonView = {
  module: CscaModule & { track: string };
  topic: { topicKey: string; orderIndex: number; metadata: CscaTopicMeta } | null;
  lesson: {
    lessonId: string;
    lessonKey: string;
    orderIndex: number;
    metadata: CscaLessonMeta;
    theory: CscaTheoryBlock[];
    exercises: CscaLessonItem[];
  };
  figures: Record<string, CscaFigure>;
  draft: CscaLessonAttempt | null;
  latestCompleted: CscaLessonAttempt | null;
};

export function parseCscaLessonAttempt(value: unknown): CscaLessonAttempt {
  const row = record(value);
  const status = oneOf(row.status, ["draft", "completed"] as const);
  const answers = Object.fromEntries(Object.entries(record(row.answers)).slice(0, 200).map(([id, entry]) => {
    const answer = record(entry);
    return [uuid(id), {
      selected: optionId(record(answer.answer).selected),
      correct: bool(answer.correct),
      explain: parseCscaExplain(answer.explain),
      answeredAt: stamp(answer.answeredAt),
    }];
  }));
  const result = nullable(row.result, lessonResult);
  if ((status === "completed") !== (result !== null)) fail();
  return {
    attemptId: uuid(row.attemptId),
    lessonId: uuid(row.lessonId),
    status,
    revision: int(row.revision, Number.MAX_SAFE_INTEGER, 1),
    answers,
    answeredCount: int(row.answeredCount, 200),
    exercisesTotal: int(row.exercisesTotal, 200),
    result,
  };
}

export function parseCscaLessonView(value: unknown): CscaLessonView {
  where = "lesson";
  const row = record(value);
  const moduleRow = record(row.module);
  const lessonRow = record(row.lesson);
  const topicRow = row.topic === null || row.topic === undefined ? null : record(row.topic);
  return {
    module: { ...cscaModule(moduleRow), track: key(moduleRow.track) },
    topic: topicRow
      ? { topicKey: key(topicRow.topicKey), orderIndex: int(topicRow.orderIndex, 1000), metadata: topicMeta(topicRow.metadata) }
      : null,
    lesson: {
      lessonId: uuid(lessonRow.lessonId),
      lessonKey: key(lessonRow.lessonKey),
      orderIndex: int(lessonRow.orderIndex, 1000),
      metadata: lessonMeta(lessonRow.metadata),
      theory: list(lessonRow.theory ?? [], theoryBlock, 24).filter(
        (block): block is CscaTheoryBlock => block !== null,
      ),
      exercises: list(lessonRow.exercises, lessonItem, 20),
    },
    figures: figures(row.figures),
    draft: nullable(row.draft, parseCscaLessonAttempt),
    latestCompleted: nullable(row.latestCompleted, parseCscaLessonAttempt),
  };
}

export type CscaAnswerReceipt = {
  attemptId: string;
  revision: number;
  exerciseId: string;
  correct: boolean;
  explain: CscaExplain;
  answeredCount: number;
  exercisesTotal: number;
};

export function parseCscaAnswerReceipt(value: unknown): CscaAnswerReceipt {
  where = "answer";
  const row = record(value);
  return {
    attemptId: uuid(row.attemptId),
    revision: int(row.revision, Number.MAX_SAFE_INTEGER, 1),
    exerciseId: uuid(row.exerciseId),
    correct: bool(row.correct),
    explain: parseCscaExplain(row.explain),
    answeredCount: int(row.answeredCount, 200),
    exercisesTotal: int(row.exercisesTotal, 200),
  };
}

// ---------------------------------------------------------------------------
// Тест на время, §7
// ---------------------------------------------------------------------------

export type CscaTestResult = {
  itemsTotal: number;
  answeredCount: number;
  correctCount: number;
  unansweredCount: number;
  byTopic: { topicKey: string; total: number; answered: number; correct: number }[];
  bySection: { section: number; total: number; answered: number; correct: number }[];
  pace: { answeredWithTime: number; avgSeconds: number | null; budgetSeconds: number };
  completion: "submitted" | "timeout";
  completedAt: string;
};

export type CscaTestReviewEntry = {
  itemKey: string;
  selected: CscaOptionId | null;
  correct: boolean;
  seconds: number | null;
  flagged: boolean;
  explain: CscaExplain;
};

export type CscaTestAttempt = {
  attemptId: string;
  formId: string;
  formKey: string;
  kind: CscaTestKind;
  metadata: CscaTestMeta;
  durationSeconds: number;
  allowEarlyFinish: boolean;
  graceSeconds: number;
  status: "draft" | "completed";
  revision: number;
  startedAt: string;
  deadlineAt: string;
  serverNow: string;
  itemsTotal: number;
  answeredCount: number;
  answers: Record<string, CscaOptionId>;
  flags: string[];
  itemSeconds: Record<string, number>;
  items: CscaItem[];
  figures: Record<string, CscaFigure>;
  completion: "submitted" | "timeout" | null;
  completedAt: string | null;
  result: CscaTestResult | null;
  review: CscaTestReviewEntry[] | null;
};

function pace(value: unknown): CscaTestResult["pace"] {
  const row = record(value);
  return {
    answeredWithTime: int(row.answeredWithTime, 1000),
    avgSeconds: nullable(row.avgSeconds, (seconds) => int(seconds, 3600)),
    budgetSeconds: int(row.budgetSeconds, 3600, 1),
  };
}

function testResult(value: unknown): CscaTestResult {
  const row = record(value);
  const tally = (entry: Record<string, unknown>) => ({
    total: int(entry.total, 200),
    answered: int(entry.answered, 200),
    correct: int(entry.correct, 200),
  });
  return {
    itemsTotal: int(row.itemsTotal, 200),
    answeredCount: int(row.answeredCount, 200),
    correctCount: int(row.correctCount, 200),
    unansweredCount: int(row.unansweredCount, 200),
    byTopic: list(row.byTopic, (entry) => {
      const topic = record(entry);
      return { topicKey: key(topic.topicKey), ...tally(topic) };
    }, 120),
    bySection: list(row.bySection, (entry) => {
      const section = record(entry);
      return { section: int(section.section, 20, 1), ...tally(section) };
    }, 20),
    pace: pace(row.pace),
    completion: oneOf(row.completion, ["submitted", "timeout"] as const),
    completedAt: stamp(row.completedAt),
  };
}

export function parseCscaTestAttempt(value: unknown): CscaTestAttempt {
  where = "test";
  const row = record(value);
  const status = oneOf(row.status, ["draft", "completed"] as const);
  const items = list(row.items, item, 200);
  const itemKeys = new Set(items.map((entry) => entry.itemKey));
  const answers = Object.fromEntries(Object.entries(record(row.answers)).map(([itemKey, selected]) => {
    if (!itemKeys.has(itemKey)) fail();
    return [itemKey, optionId(selected)];
  }));
  const itemSeconds = Object.fromEntries(Object.entries(record(row.itemSeconds ?? {})).map(([itemKey, seconds]) => {
    if (!itemKeys.has(itemKey)) fail();
    return [itemKey, int(seconds, 3600)];
  }));
  const result = nullable(row.result, testResult);
  const review = nullable(row.review, (entries) => list(entries, (entry) => {
    const reviewRow = record(entry);
    return {
      itemKey: key(reviewRow.itemKey),
      selected: nullable(reviewRow.selected, optionId),
      correct: bool(reviewRow.correct),
      seconds: nullable(reviewRow.seconds, (seconds) => int(seconds, 3600)),
      flagged: bool(reviewRow.flagged),
      explain: parseCscaExplain(reviewRow.explain),
    };
  }, 200));
  if ((status === "completed") !== (result !== null)) fail();
  return {
    attemptId: uuid(row.attemptId),
    formId: uuid(row.formId),
    formKey: key(row.formKey),
    kind: oneOf(row.kind, ["diagnostic", "mock"] as const),
    metadata: testMeta(row.metadata),
    durationSeconds: int(row.durationSeconds, 4 * 3600, 1),
    allowEarlyFinish: bool(row.allowEarlyFinish),
    graceSeconds: int(row.graceSeconds, 600),
    status,
    revision: int(row.revision, Number.MAX_SAFE_INTEGER, 1),
    startedAt: stamp(row.startedAt),
    deadlineAt: stamp(row.deadlineAt),
    serverNow: stamp(row.serverNow),
    itemsTotal: int(row.itemsTotal, 200, 1),
    answeredCount: int(row.answeredCount, 200),
    answers,
    flags: list(row.flags ?? [], (flag) => {
      const flagKey = key(flag);
      return itemKeys.has(flagKey) ? flagKey : fail();
    }, 200),
    itemSeconds,
    items,
    figures: figures(row.figures),
    completion: nullable(row.completion, (completion) => oneOf(completion, ["submitted", "timeout"] as const)),
    completedAt: nullable(row.completedAt, stamp),
    result,
    review,
  };
}

export type CscaTestSaveReceipt = {
  attemptId: string;
  status: "draft" | "completed";
  revision: number;
  answeredCount: number;
  savedAt: string;
  deadlineAt: string;
  serverNow: string;
};

export function parseCscaTestSaveReceipt(value: unknown): CscaTestSaveReceipt {
  where = "test-save";
  const row = record(value);
  return {
    attemptId: uuid(row.attemptId),
    status: oneOf(row.status, ["draft", "completed"] as const),
    revision: int(row.revision, Number.MAX_SAFE_INTEGER, 1),
    answeredCount: int(row.answeredCount, 200),
    savedAt: stamp(row.savedAt),
    deadlineAt: stamp(row.deadlineAt),
    serverNow: stamp(row.serverNow),
  };
}

// ---------------------------------------------------------------------------
// Повторение, прогресс, сообщения, целевая сессия (§8..§11)
// ---------------------------------------------------------------------------

export type CscaReviewItem = { itemKey: string; box: number; dueOn: string; lapses: number; item: CscaItem };

export type CscaReview = {
  today: string;
  items: CscaReviewItem[];
  figures: Record<string, CscaFigure>;
  dueCount: number;
  activeCount: number;
  nextDueOn: string | null;
};

export function parseCscaReview(value: unknown): CscaReview {
  where = "review";
  const row = record(value);
  return {
    today: day(row.today),
    items: list(row.items, (entry) => {
      const reviewRow = record(entry);
      return {
        itemKey: key(reviewRow.itemKey),
        box: int(reviewRow.box, 4, 1),
        dueOn: day(reviewRow.dueOn),
        lapses: int(reviewRow.lapses, 10000),
        item: item(reviewRow.item),
      };
    }, 20),
    figures: figures(row.figures),
    dueCount: int(row.dueCount, 100000),
    activeCount: int(row.activeCount, 100000),
    nextDueOn: nullable(row.nextDueOn, day),
  };
}

export type CscaReviewReceipt = {
  itemKey: string;
  correct: boolean;
  explain: CscaExplain;
  box: number;
  dueOn: string | null;
  retired: boolean;
  lapses: number;
};

export function parseCscaReviewReceipt(value: unknown): CscaReviewReceipt {
  where = "review-record";
  const row = record(value);
  const retired = bool(row.retired);
  const dueOn = nullable(row.dueOn, day);
  if (retired !== (dueOn === null)) fail();
  return {
    itemKey: key(row.itemKey),
    correct: bool(row.correct),
    explain: parseCscaExplain(row.explain),
    box: int(row.box, 4, 1),
    dueOn,
    retired,
    lapses: int(row.lapses, 10000),
  };
}

export type CscaProgress = {
  today: string;
  coverage: { topicsTotal: number; topicsWithCompletedLesson: number };
  topics: {
    topicKey: string;
    orderIndex: number;
    section: number;
    state: CscaTopicState;
    windowAnswers: number;
    windowCorrect: number;
    answersTotal: number;
    correctTotal: number;
    lessonCompleted: boolean;
  }[];
  tests: {
    attemptId: string;
    formKey: string;
    kind: CscaTestKind;
    completion: "submitted" | "timeout";
    completedAt: string;
    itemsTotal: number;
    answeredCount: number;
    correctCount: number;
    avgSeconds: number | null;
  }[];
  pace: CscaTestResult["pace"];
  streak: { current: number; best: number; lastActiveOn: string | null };
  review: { dueCount: number; activeCount: number; retiredCount: number };
};

export function parseCscaProgress(value: unknown): CscaProgress {
  where = "progress";
  const row = record(value);
  const coverage = record(row.coverage);
  const streak = record(row.streak);
  const review = record(row.review);
  return {
    today: day(row.today),
    coverage: {
      topicsTotal: int(coverage.topicsTotal, 1000),
      topicsWithCompletedLesson: int(coverage.topicsWithCompletedLesson, 1000),
    },
    topics: list(row.topics, (entry) => {
      const topic = record(entry);
      return {
        topicKey: key(topic.topicKey),
        orderIndex: int(topic.orderIndex, 1000),
        section: int(topic.section, 20, 1),
        state: oneOf(topic.state, TOPIC_STATES),
        windowAnswers: int(topic.windowAnswers, 6),
        windowCorrect: int(topic.windowCorrect, 6),
        answersTotal: int(topic.answersTotal, 1_000_000),
        correctTotal: int(topic.correctTotal, 1_000_000),
        lessonCompleted: bool(topic.lessonCompleted),
      };
    }, 120),
    tests: list(row.tests, (entry) => {
      const test = record(entry);
      return {
        attemptId: uuid(test.attemptId),
        formKey: key(test.formKey),
        kind: oneOf(test.kind, ["diagnostic", "mock"] as const),
        completion: oneOf(test.completion, ["submitted", "timeout"] as const),
        completedAt: stamp(test.completedAt),
        itemsTotal: int(test.itemsTotal, 200),
        answeredCount: int(test.answeredCount, 200),
        correctCount: int(test.correctCount, 200),
        avgSeconds: nullable(test.avgSeconds, (seconds) => int(seconds, 3600)),
      };
    }, 20),
    pace: pace(row.pace),
    streak: {
      current: int(streak.current, 100000),
      best: int(streak.best, 100000),
      lastActiveOn: nullable(streak.lastActiveOn, day),
    },
    review: {
      dueCount: int(review.dueCount, 100000),
      activeCount: int(review.activeCount, 100000),
      retiredCount: int(review.retiredCount, 100000),
    },
  };
}

export function parseCscaReportReceipt(value: unknown): { reportId: string; itemKey: string } {
  where = "report";
  const row = record(value);
  return { reportId: uuid(row.reportId), itemKey: key(row.itemKey) };
}

export function parseCscaTargetReceipt(value: unknown): { targetSessionKey: string | null } {
  where = "target";
  const row = record(value);
  return { targetSessionKey: nullable(row.targetSessionKey, key) };
}

// ---------------------------------------------------------------------------
// Помощники отрисовщика
// ---------------------------------------------------------------------------

export type MathSegment = { math: boolean; value: string };

/**
 * Текст режется по `$`: чётные куски текст, нечётные формулы (§14). Знак `$`
 * в контенте всегда разделитель; при нечётном числе (сбой контента) хвост
 * остаётся текстом, а не теряется.
 */
export function splitMathText(input: string): MathSegment[] {
  const parts = input.split("$");
  const segments: MathSegment[] = [];
  const closed = parts.length % 2 === 1;
  parts.forEach((part, index) => {
    const math = index % 2 === 1 && (closed || index < parts.length - 1);
    const value = math || closed || index < parts.length - 1 ? part : `$${part}`;
    if (value.length > 0) segments.push({ math, value });
  });
  return segments;
}

/** Шесть цветов палитры рисунка: светлая (в данных) → тёмная (§15). */
export const CSCA_FIGURE_DARK_PALETTE: Readonly<Record<string, string>> = {
  "#ffffff": "#1e1c19",
  "#191714": "#f2efe9",
  "#6b6660": "#a39d94",
  "#e4dfd7": "#2c2925",
  "#d70217": "#ff4a57",
  "#177245": "#4cc38a",
};

/** Замена один к одному за один проход: цвет не переписывается дважды. */
export function darkFigureSvg(svg: string): string {
  return svg.replace(/#[0-9a-f]{6}\b/giu, (color) => CSCA_FIGURE_DARK_PALETTE[color.toLowerCase()] ?? color);
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Поправка часов: сервер минус клиент в момент получения ответа (§7.2). */
export function clockOffsetMs(serverNow: string, receivedAtMs: number): number {
  return Date.parse(serverNow) - receivedAtMs;
}

export function remainingSeconds(deadlineAt: string, offsetMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(deadlineAt) - (nowMs + offsetMs)) / 1000));
}

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const mm = String(minutes).padStart(hours > 0 ? 2 : 2, "0");
  const ss = String(rest).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** «17 октября» или «17 октября 2026 г.»: дата `YYYY-MM-DD` без сдвига пояса. */
export function cscaDayLabel(value: string, locale: string, withYear = false): string {
  return new Intl.DateTimeFormat(locale === "ky" ? "ky" : "ru", {
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

/** Дата и время в Бишкеке для окна регистрации («21 октября, 21:59»). */
export function cscaBishkekLabel(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ky" ? "ky" : "ru", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Bishkek",
  }).format(new Date(value));
}

/** Дни между двумя датами `YYYY-MM-DD` (по календарю, без часовых поясов). */
export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000);
}

/** Ответы теста для сохранения: только задания формы, только a..d. */
export function testSavePayload(
  items: readonly Pick<CscaItem, "itemKey">[],
  answers: Readonly<Record<string, CscaOptionId>>,
  flags: readonly string[],
  itemSeconds: Readonly<Record<string, number>>,
): { answers: Record<string, CscaOptionId>; flags: string[]; itemSeconds: Record<string, number> } {
  const keys = new Set(items.map((entry) => entry.itemKey));
  return {
    answers: Object.fromEntries(Object.entries(answers).filter(([itemKey, id]) => keys.has(itemKey) && isCscaOptionId(id))),
    flags: [...new Set(flags.filter((flag) => keys.has(flag)))],
    itemSeconds: Object.fromEntries(Object.entries(itemSeconds)
      .filter(([itemKey]) => keys.has(itemKey))
      .map(([itemKey, seconds]) => [itemKey, Math.min(3600, Math.max(0, Math.round(seconds)))])),
  };
}
