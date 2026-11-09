// Ответы анкеты для экрана статуса: подписи из словаря `apply` веба (answer.*, opt.*, field.*).
import { localizedCountryLabel } from "@/features/registration/application-contract";
import { studyCountryName } from "@web/lib/study-countries";
import type { StudentApplicationDraft } from "@/features/registration/application-contract";

type Strings = Readonly<Record<string, string>>;

export function applicationAnswers(draft: StudentApplicationDraft, strings: Strings, lang: "ru" | "ky"): { label: string; value: string }[] {
  const opt = (key: string) => strings[`opt.${key}`] ?? key;
  const fill = (template: string, vars: Record<string, string>) => Object.entries(vars).reduce((text, [k, v]) => text.replace(`{${k}}`, v), template);
  const country = (code: string) => studyCountryName(code, lang) ?? localizedCountryLabel(code, lang);
  const english =
    draft.english.mode === "exam"
      ? fill(strings.englishExamAnswer ?? "{exam}: {score}", { exam: opt(draft.english.exam), score: String(draft.english.score) })
      : fill(strings.englishSelfAnswer ?? "{level}", { level: opt(draft.english.level) });
  return [
    { label: strings["answer.name"], value: `${draft.firstName} ${draft.lastName}` },
    { label: strings["answer.phone"], value: draft.phone },
    { label: strings["answer.countries"], value: draft.destinationCountries.map(country).join(", ") },
    { label: strings["answer.intake"], value: `${opt(draft.intakeSeason)} ${draft.intakeYear}` },
    { label: strings["answer.education"], value: opt(draft.educationLevel) },
    { label: strings["answer.grade"], value: fill(strings.gradeOf ?? "{grade}/{scale}", { grade: String(draft.averageGrade), scale: draft.gradeScale }) },
    { label: strings["answer.fields"], value: draft.studyFields.map((field) => strings[`field.${field}`] ?? field).join(", ") },
    { label: strings["answer.levels"], value: draft.studyLevels.map(opt).join(", ") },
    { label: strings["answer.nationality"], value: country(draft.nationality) },
    { label: strings["answer.english"], value: english },
    { label: strings["answer.budget"], value: opt(draft.tuitionBudget) },
    { label: strings["answer.funding"], value: opt(draft.fundingSource) },
  ];
}
