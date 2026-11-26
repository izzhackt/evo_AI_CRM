// Модель экрана «Прогресс» CSCA: чистые функции без React. Повторяют math/progress/page.tsx веба: темы по модулям программы
// с полосой состояний, строки «Ответов: N, верно M» и «урок пройден» (пусто, если ответов нет и урок не пройден), история
// тестов с датой по Бишкеку без года, темп против ориентира экзамена.
import type { CscaHome, CscaProgress, CscaTopicState } from "@web/lib/portal/csca";
import { formatPortalString, type PortalStrings } from "@web/lib/portal/i18n";

import { cscaDayLabelSafe } from "@/features/learning/csca/format";

type Strings = PortalStrings<"csca">;
type Lang = "ru" | "ky";

export type ProgressTopicRow = {
  topicKey: string;
  title: string;
  state: CscaTopicState;
  /** «Ответов: 12, верно 8 · урок пройден»; пустая строка, когда сказать нечего. */
  note: string;
  /** Тема без ответов: строка тише. */
  quiet: boolean;
};

export type ProgressSection = {
  section: number;
  /** «Модуль 2». */
  label: string;
  title: string | null;
  states: CscaTopicState[];
  rows: ProgressTopicRow[];
};

/**
 * Темы по модулям программы, в порядке программы. Модули и названия берёт главная трека; пока она не прочиталась, темы
 * всё равно видны: модуль называется только номером, у темы вместо названия её ключ.
 */
export function progressSections(progress: CscaProgress, home: CscaHome | undefined, lang: Lang, strings: Strings): ProgressSection[] {
  const topicMeta = new Map((home?.topics ?? []).map((topic) => [topic.topicKey, topic.metadata]));
  const known = home?.modules[0]?.metadata.sections ?? [];
  const numbers = [...new Set(progress.topics.map((topic) => topic.section))].sort((a, b) => a - b);
  const sections = known.length > 0
    ? known.map((section) => ({ section: section.section, title: lang === "ky" ? section.title_ky : section.title_ru }))
    : numbers.map((section) => ({ section, title: null as string | null }));
  return sections
    .map((entry) => {
      const topics = progress.topics.filter((topic) => topic.section === entry.section).sort((a, b) => a.orderIndex - b.orderIndex);
      return {
        section: entry.section,
        label: formatPortalString(strings.sectionLabel, { n: String(entry.section) }),
        title: entry.title,
        states: topics.map((topic) => topic.state),
        rows: topics.map((topic) => {
          const meta = topicMeta.get(topic.topicKey);
          const answers = topic.answersTotal > 0 ? formatPortalString(strings.topicAnswers, { total: String(topic.answersTotal), correct: String(topic.correctTotal) }) : "";
          const lesson = topic.lessonCompleted ? `${answers ? " · " : ""}${strings.topicLessonDone}` : "";
          return {
            topicKey: topic.topicKey,
            title: meta ? (lang === "ky" ? meta.title_ky : meta.title_ru) : topic.topicKey,
            state: topic.state,
            note: `${answers}${lesson}`,
            quiet: topic.answersTotal === 0,
          };
        }),
      };
    })
    .filter((section) => section.rows.length > 0);
}

export type HistoryRow = {
  attemptId: string;
  /** Форма теста для ссылки на разбор; у теста, которого нет в списке главной, ссылки нет. */
  formId: string | null;
  title: string;
  /** «16 октября»: день по Бишкеку, без года. */
  date: string;
  /** «5 из 24». */
  result: string;
  /** «Завершён вами» или «Время вышло». */
  how: string;
};

export function historyRows(progress: CscaProgress, home: CscaHome | undefined, lang: Lang, strings: Strings): HistoryRow[] {
  const forms = new Map((home?.tests ?? []).map((test) => [test.formKey, { formId: test.formId, title: lang === "ky" ? test.metadata.title_ky : test.metadata.title_ru }]));
  return progress.tests.map((test) => ({
    attemptId: test.attemptId,
    formId: forms.get(test.formKey)?.formId ?? null,
    title: forms.get(test.formKey)?.title ?? test.formKey,
    date: cscaDayLabelSafe(test.completedAt, lang, false),
    result: formatPortalString(strings.tallyLabel, { correct: String(test.correctCount), total: String(test.itemsTotal) }),
    how: strings[`completion.${test.completion}`],
  }));
}

/** Доля заполненной полосы темпа: средние секунды на задание к удвоенному ориентиру (метка ориентира стоит посередине). */
export function paceFill(avgSeconds: number, budgetSeconds: number): number {
  return budgetSeconds > 0 ? Math.min(1, avgSeconds / (budgetSeconds * 2)) : 1;
}
