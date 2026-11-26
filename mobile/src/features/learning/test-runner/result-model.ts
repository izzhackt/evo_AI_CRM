// Модель итога теста на время (контракт §7.4; веб: components/portal/csca/TestResultView.tsx и TimedTestRunner.tsx): чистые
// функции без React. Итог называется «оценка EVO», без баллов и порогов. Разбивка по модулям программы и по темам с
// названиями и английскими названиями тем; кнопки под итогом: урок слабой темы, «К темам», «Пройти ещё раз».
import { cscaTopicNextLessons, cscaWeakTopicLesson, type CscaHome, type CscaTestAttempt, type CscaTestResult } from "@web/lib/portal/csca";
import { formatPortalString, type PortalStrings } from "@web/lib/portal/i18n";

type Strings = PortalStrings<"csca">;
type Lang = "ru" | "ky";

export type TallyRow = {
  key: string;
  label: string;
  /** Английское название темы под русским или кыргызским (у модуля нет). */
  labelEn: string | null;
  correct: number;
  total: number;
  /** Доля верных для полосы: нуль, когда заданий в строке нет. */
  ratio: number;
};

export type ResultTallies = {
  sections: TallyRow[];
  topics: TallyRow[];
  /** Названия модулей и тем известны (главная трека прочитана). Пока нет, экран не показывает ключи вместо названий. */
  titlesKnown: boolean;
};

const ratioOf = (correct: number, total: number) => (total > 0 ? correct / total : 0);

/** «Модуль 2. Функции» и тема с английским названием. Без главной трека названий нет: тогда ключ темы последний запасной вариант. */
export function resultTallies(result: CscaTestResult, home: CscaHome | undefined, lang: Lang, strings: Strings): ResultTallies {
  const topics = new Map((home?.topics ?? []).map((topic) => [topic.topicKey, topic.metadata]));
  const sections = new Map((home?.modules[0]?.metadata.sections ?? []).map((section) => [section.section, section]));
  return {
    titlesKnown: home !== undefined,
    sections: result.bySection.map((entry) => {
      const section = sections.get(entry.section);
      const label = formatPortalString(strings.sectionLabel, { n: String(entry.section) });
      return {
        key: String(entry.section),
        label: section ? `${label}. ${lang === "ky" ? section.title_ky : section.title_ru}` : label,
        labelEn: null,
        correct: entry.correct,
        total: entry.total,
        ratio: ratioOf(entry.correct, entry.total),
      };
    }),
    topics: result.byTopic.map((entry) => {
      const meta = topics.get(entry.topicKey);
      return {
        key: entry.topicKey,
        label: meta ? (lang === "ky" ? meta.title_ky : meta.title_ru) : entry.topicKey,
        labelEn: meta?.title_en ?? null,
        correct: entry.correct,
        total: entry.total,
        ratio: ratioOf(entry.correct, entry.total),
      };
    }),
  };
}

export type ResultFact = { key: "how" | "unanswered" | "pace"; label: string; value: string };

/** Три факта под итогом: как завершён, без ответа, темп (веб: `cs-facts`). */
export function resultFacts(result: CscaTestResult, strings: Strings): ResultFact[] {
  return [
    { key: "how", label: strings.testsHistoryHow, value: strings[`completion.${result.completion}`] },
    { key: "unanswered", label: strings.notAnswered, value: String(result.unansweredCount) },
    {
      key: "pace",
      label: strings.paceHeading,
      value: result.pace.avgSeconds === null ? strings.resultPaceNone : formatPortalString(strings.resultPace, { avg: String(result.pace.avgSeconds), budget: String(result.pace.budgetSeconds) }),
    },
  ];
}

export type ResultAction =
  | { kind: "lesson"; label: string; lessonId: string; primary: true }
  | { kind: "topics"; label: string; primary: boolean }
  | { kind: "restart"; label: string; primary: false };

/**
 * Кнопки под итогом (веб: `TimedTestRunner`, «Итог ведёт к уроку слабой темы»): урок или практика слабой темы главной кнопкой,
 * «К темам» и «Пройти ещё раз» вторыми. Без слабой темы с уроком главной остаётся «К темам». Все кнопки стоят сразу под итогом,
 * до списка разбора (в пробном тесте это 48 заданий).
 */
export function resultActions(attempt: Pick<CscaTestAttempt, "result">, home: CscaHome | undefined, lang: Lang, strings: Strings): ResultAction[] {
  const result = attempt.result;
  const weak = result && home ? cscaWeakTopicLesson(result.byTopic, cscaTopicNextLessons(home.topics, home.lessons)) : null;
  const actions: ResultAction[] = [];
  if (weak) {
    actions.push({
      kind: "lesson",
      lessonId: weak.lessonId,
      primary: true,
      label: formatPortalString(weak.kind === "lesson" ? strings.resultNextLesson : strings.resultNextPractice, { title: lang === "ky" ? weak.titleKy : weak.titleRu }),
    });
  }
  actions.push({ kind: "topics", label: strings.backToTopics, primary: !weak });
  actions.push({ kind: "restart", label: strings.repeat, primary: false });
  return actions;
}

/** Правила вступления: четыре строки; пробный тест вместо «Разбор откроется» говорит «ответы отправятся сами» (веб `cs-rules`). */
export function introRules(allowEarlyFinish: boolean, strings: Strings, clockRule: string): string[] {
  return [strings.testRuleChange, strings.testRuleSave, clockRule, allowEarlyFinish ? strings.testRuleReview : strings.testRuleMock];
}
