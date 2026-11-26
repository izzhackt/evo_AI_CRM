// Модель главной CSCA («Занятия»): чистые функции без React. Повторяют `LessonsView` веба
// (src/components/portal/csca/LessonsView.tsx), поэтому экран только рисует то, что здесь посчитано: тот же
// «Следующий шаг» со своими значками, три плитки, строки тестов на время и программа по модулям.
import type { SessionLabels } from "@web/components/portal/csca/session-labels";
import {
  cscaDayLabel,
  daysBetween,
  type CscaHome,
  type CscaLessonSummary,
  type CscaModule,
  type CscaSession,
  type CscaTestSummary,
  type CscaTopic,
  type CscaTopicState,
} from "@web/lib/portal/csca";
import { formatPortalString, type PortalStrings } from "@web/lib/portal/i18n";

import { cscaDayLabelSafe, cscaDurationLabel } from "@/features/learning/csca/format";

export type CscaLang = "ru" | "ky";
type Strings = PortalStrings<"csca">;

const pick = (lang: CscaLang, ru: string, ky: string) => (lang === "ky" ? ky : ru);

// ---- «Следующий шаг» ------------------------------------------------------------------------------------------------------

export type NextStepTarget =
  | { kind: "test"; formId: string }
  | { kind: "lesson"; lessonId: string }
  | { kind: "review" };

export type NextStepModel = {
  title: string;
  why: string;
  /** Значки под пояснением: что за шаг, сколько времени, сколько заданий. */
  meta: string[];
  action: { label: string; target: NextStepTarget } | null;
};

/** Кнопка урока или практики по состоянию: черновик продолжают, пройденное повторяют (веб `lessonAction`). */
export function lessonActionLabel(lesson: Pick<CscaLessonSummary, "draftAttemptId" | "completed" | "metadata">, strings: Strings): string {
  if (lesson.draftAttemptId) return strings.continue;
  if (lesson.completed) return strings.repeat;
  return lesson.metadata.kind === "practice" ? strings.startPractice : strings.startLesson;
}

/**
 * Следующий шаг как на вебе: тест (кнопка «Продолжить тест» или «Начать тест»), урок или практика (кнопка по состоянию
 * урока) и повторение ошибок. Шаг, чьего теста или урока нет в списках главной, показывается как «все пройдено» без
 * кнопки: вести некуда.
 */
export function nextStepModel(home: CscaHome, lang: CscaLang, strings: Strings): NextStepModel {
  const step = home.nextStep;
  let model: NextStepModel = { title: strings["nextStep.noneTitle"], why: strings["nextStep.noneWhy"], meta: [], action: null };
  if (step?.kind === "test") {
    const test = home.tests.find((entry) => entry.formId === step.formId);
    if (test) {
      model = {
        title: pick(lang, test.metadata.title_ru, test.metadata.title_ky),
        why: strings["nextStep.testWhy"],
        meta: [formatPortalString(strings.testItems, { count: String(test.itemsTotal) }), cscaDurationLabel(test.durationSeconds, strings)],
        action: { label: test.draft ? strings.testResume : strings.testBegin, target: { kind: "test", formId: test.formId } },
      };
    }
  } else if (step?.kind === "lesson") {
    const lesson = home.lessons.find((entry) => entry.lessonId === step.lessonId);
    const topic = home.topics.find((entry) => entry.topicKey === step.topicKey);
    if (lesson) {
      model = {
        title: pick(lang, lesson.metadata.title_ru, lesson.metadata.title_ky),
        why: strings[`nextStep.why.${topic?.state ?? step.topicState}`],
        meta: [
          strings[`kind.${lesson.metadata.kind}`],
          formatPortalString(strings.minutes, { n: String(lesson.metadata.est_minutes) }),
          formatPortalString(strings.itemsCount, { count: String(lesson.exercisesTotal) }),
        ],
        action: { label: lessonActionLabel(lesson, strings), target: { kind: "lesson", lessonId: lesson.lessonId } },
      };
    }
  } else if (step?.kind === "review") {
    model = {
      title: strings["nextStep.reviewTitle"],
      why: strings["nextStep.reviewWhy"],
      meta: [formatPortalString(strings.reviewDue, { count: String(home.review.dueCount) })],
      action: { label: strings.openReview, target: { kind: "review" } },
    };
  }
  return model;
}

// ---- три плитки -----------------------------------------------------------------------------------------------------------

/** Ближайшая сессия, которая ещё не началась (сегодняшняя считается): уже идущая или прошедшая плитки не нужна. */
export function nearestSession(home: Pick<CscaHome, "sessions" | "today">): CscaSession | null {
  return [...home.sessions]
    .sort((a, b) => a.examFrom.localeCompare(b.examFrom))
    .find((session) => daysBetween(home.today, session.examFrom) >= 0) ?? null;
}

/** «день», «дня», «дней» (RU) и одна форма у KY: слово после числа в плитке. */
export function dayUnit(days: number, lang: CscaLang, strings: Strings): string {
  const form = new Intl.PluralRules(lang === "ky" ? "ky" : "ru").select(days);
  return strings[form === "one" ? "tile.days.one" : form === "few" ? "tile.days.few" : "tile.days.many"];
}

export type ExamTile =
  | { kind: "none"; note: string }
  | { kind: "today"; value: string; note: string }
  | { kind: "days"; value: string; unit: string; note: string };

export type StatTiles = {
  topics: { done: number; total: number; ratio: number };
  review: { due: number };
  exam: ExamTile;
};

export function statTiles(home: CscaHome, labels: SessionLabels, lang: CscaLang, strings: Strings): StatTiles {
  const done = home.topics.filter((topic) => topic.lessonCompleted).length;
  const total = home.topics.length;
  const next = nearestSession(home);
  const days = next ? daysBetween(home.today, next.examFrom) : null;
  let exam: ExamTile = { kind: "none", note: strings["tile.examNone"] };
  if (next && days !== null) {
    const note = labels[next.sessionKey]?.dates ?? cscaDayLabel(next.examFrom, lang);
    exam = days === 0
      ? { kind: "today", value: strings["tile.examToday"], note }
      : { kind: "days", value: String(days), unit: dayUnit(days, lang, strings), note };
  }
  return { topics: { done, total, ratio: total > 0 ? done / total : 0 }, review: { due: home.review.dueCount }, exam };
}

// ---- тесты на время -------------------------------------------------------------------------------------------------------

export type TestRowModel = {
  formId: string;
  formKey: string;
  title: string;
  /** «Заданий: 24 · 30 мин». */
  meta: string;
  /** «16 октября: верно 5 из 24» (день по Бишкеку, как велит контракт §1) и попытка, на которую ведёт строка. */
  last: { label: string; attemptId: string } | null;
  actionLabel: string;
};

export function testRowModel(test: CscaTestSummary, lang: CscaLang, strings: Strings): TestRowModel {
  const last = test.lastResult;
  return {
    formId: test.formId,
    formKey: test.formKey,
    title: pick(lang, test.metadata.title_ru, test.metadata.title_ky),
    meta: `${formatPortalString(strings.testItems, { count: String(test.itemsTotal) })} · ${cscaDurationLabel(test.durationSeconds, strings)}`,
    last: last
      ? {
          label: formatPortalString(strings.testLast, { date: cscaDayLabelSafe(last.completedAt, lang, false), correct: String(last.correctCount), total: String(last.itemsTotal) }),
          attemptId: last.attemptId,
        }
      : null,
    actionLabel: test.draft ? strings.testContinue : last ? strings.repeat : strings.testStart,
  };
}

// ---- программа по модулям -------------------------------------------------------------------------------------------------

export type ProgramLesson = {
  lessonId: string;
  lessonKey: string;
  kind: "lesson" | "practice";
  /** «Урок» или «Практика». */
  kindLabel: string;
  /** «18 мин · Пройден». */
  meta: string;
  done: boolean;
};
export type ProgramTopic = { topic: CscaTopic; title: string; lessons: ProgramLesson[] };
export type ProgramSection = {
  section: number;
  /** «Модуль 2». */
  label: string;
  title: string;
  /** «Пройдено 1 из 7». */
  doneLabel: string;
  states: CscaTopicState[];
  rich: ProgramTopic[];
  quiet: { topic: CscaTopic; title: string }[];
  /** Раскрыт ли модуль при открытии вкладки: тот, где лежит следующий шаг (иначе первый). */
  initiallyOpen: boolean;
};

export function programSections(home: CscaHome, track: Pick<CscaModule, "metadata">, lang: CscaLang, strings: Strings): ProgramSection[] {
  const lessonsOf = (topicKey: string) => home.lessons
    .filter((lesson) => lesson.metadata.topic_key === topicKey)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const nextTopic = home.nextStep?.kind === "lesson" ? home.nextStep.topicKey : null;
  const sections = track.metadata.sections
    .map((section) => ({
      section,
      topics: home.topics
        .filter((topic) => topic.metadata.section === section.section)
        .sort((a, b) => a.orderIndex - b.orderIndex),
    }))
    .filter((entry) => entry.topics.length > 0);
  const openIndex = Math.max(0, sections.findIndex((entry) => entry.topics.some((topic) => topic.topicKey === nextTopic)));
  const title = (topic: CscaTopic) => pick(lang, topic.metadata.title_ru, topic.metadata.title_ky);
  return sections.map(({ section, topics }, index) => {
    const rich = topics.filter((topic) => topic.hasLessons && lessonsOf(topic.topicKey).length > 0);
    const quiet = topics.filter((topic) => !rich.includes(topic));
    const done = topics.filter((topic) => topic.lessonCompleted).length;
    return {
      section: section.section,
      label: formatPortalString(strings.sectionLabel, { n: String(section.section) }),
      title: pick(lang, section.title_ru, section.title_ky),
      doneLabel: formatPortalString(strings.moduleDone, { done: String(done), total: String(topics.length) }),
      states: topics.map((topic) => topic.state),
      rich: rich.map((topic) => ({
        topic,
        title: title(topic),
        lessons: lessonsOf(topic.topicKey).map((lesson) => {
          const status = lesson.draftAttemptId ? strings.lessonStarted : lesson.completed ? strings.lessonDone : null;
          return {
            lessonId: lesson.lessonId,
            lessonKey: lesson.lessonKey,
            kind: lesson.metadata.kind,
            kindLabel: strings[`kind.${lesson.metadata.kind}`],
            meta: `${formatPortalString(strings.minutes, { n: String(lesson.metadata.est_minutes) })}${status ? ` · ${status}` : ""}`,
            done: lesson.completed,
          };
        }),
      })),
      quiet: quiet.map((topic) => ({ topic, title: title(topic) })),
      initiallyOpen: index === openIndex,
    };
  });
}
