import type { Locale } from "./i18n-data";
import { formatPortalString, type PortalStrings } from "./portal/i18n";
import type { StudentApplicationDraft } from "./student-application-contract";
import { localizedCountryLabel } from "./student-application-presentation";

type ApplyStrings = PortalStrings<"apply">;

/**
 * PORT-8c: локализованная сборка ответов анкеты. RU-значения словаря apply
 * зеркалят APPLICATION_LABELS байт-в-байт (закреплено contract-тестом),
 * поэтому RU-вывод совпадает со staff-функцией
 * formatStudentApplicationAnswers; направления показываются подписью
 * field.*, значение анкеты остаётся каноническим RU-текстом. Одна функция для
 * страницы статуса заявки и для «Моей анкеты» в «Профиле» (03.11.2026).
 */
export function localizedApplicationAnswers(
  draft: StudentApplicationDraft,
  strings: ApplyStrings,
  locale: Locale,
): { label: string; value: string }[] {
  const dictionary = strings as Record<string, string>;
  const opt = (key: string) => dictionary[`opt.${key}`] ?? key;
  const fieldLabel = (value: string) => dictionary[`field.${value}`] ?? value;
  const english = draft.english.mode === "exam"
    ? formatPortalString(strings.englishExamAnswer, { exam: opt(draft.english.exam), score: String(draft.english.score) })
    : formatPortalString(strings.englishSelfAnswer, { level: opt(draft.english.level) });
  return [
    { label: strings["answer.name"], value: `${draft.firstName} ${draft.lastName}` },
    { label: strings["answer.phone"], value: draft.phone },
    { label: strings["answer.countries"], value: draft.destinationCountries.map((code) => localizedCountryLabel(code, locale)).join(", ") },
    { label: strings["answer.intake"], value: `${opt(draft.intakeSeason)} ${draft.intakeYear}` },
    { label: strings["answer.education"], value: opt(draft.educationLevel) },
    { label: strings["answer.grade"], value: formatPortalString(strings.gradeOf, { grade: String(draft.averageGrade), scale: draft.gradeScale }) },
    { label: strings["answer.fields"], value: draft.studyFields.map(fieldLabel).join(", ") },
    { label: strings["answer.levels"], value: draft.studyLevels.map(opt).join(", ") },
    { label: strings["answer.nationality"], value: localizedCountryLabel(draft.nationality, locale) },
    { label: strings["answer.english"], value: english },
    { label: strings["answer.budget"], value: opt(draft.tuitionBudget) },
    { label: strings["answer.funding"], value: opt(draft.fundingSource) },
  ];
}
