import type { StudentApplicationDraft } from "./student-application-contract.ts";

export const APPLICATION_LABELS: Record<string, string> = {
  CN: "Китай", MY: "Малайзия", DE: "Германия", FR: "Франция", ES: "Испания", IT: "Италия",
  NL: "Нидерланды", PL: "Польша", HU: "Венгрия", AT: "Австрия", CZ: "Чехия", GB: "Великобритания",
  CY: "Кипр", TR: "Турция", AE: "ОАЭ", EUROPE: "Европа",
  spring: "Весна", summer: "Лето", autumn: "Осень", winter: "Зима", undecided: "Пока не определился",
  secondary: "Учусь в школе", high_school: "Окончил школу", foundation: "Подготовительная программа",
  diploma: "Колледж / диплом", bachelor: "Бакалавриат", master: "Магистратура", phd: "Докторантура", language: "Языковая программа",
  beginner: "Начальный", intermediate: "Средний", advanced: "Продвинутый", fluent: "Свободное владение",
  ielts: "IELTS", toefl: "TOEFL iBT · шкала 1–6", toefl_120: "TOEFL iBT · шкала 0–120", pte: "PTE Academic", duolingo: "Duolingo English Test",
  under_5000: "До 5 000 $", "5000_10000": "5 000–10 000 $", "10000_20000": "10 000–20 000 $",
  "20000_30000": "20 000–30 000 $", over_30000: "Более 30 000 $",
  family: "Семья", savings: "Личные накопления", scholarship: "Стипендия / грант", loan: "Образовательный кредит", employer: "Работодатель",
};

export { STUDENT_APPLICATION_NATIONALITIES as NATIONALITY_COUNTRIES } from "./student-application-contract.ts";

export function countryLabel(code: string): string {
  return new Intl.DisplayNames(["ru"], { type: "region" }).of(code) ?? code;
}

/**
 * PORT-8c: названия стран для анкеты на языке интерфейса. KY берётся из ICU
 * только когда рантайм реально несёт кыргызские данные (иначе честный фолбэк
 * на существующие русские названия — не случайный английский). Staff-путь
 * `countryLabel` выше не меняется.
 */
export function localizedCountryLabel(code: string, locale: string): string {
  if (locale === "ky") {
    try {
      const names = new Intl.DisplayNames(["ky"], { type: "region" });
      if (names.resolvedOptions().locale.startsWith("ky")) {
        return names.of(code) ?? countryLabel(code);
      }
    } catch { /* фолбэк ниже */ }
  }
  return countryLabel(code);
}

export const STUDY_FIELD_OPTIONS = [
  "Бизнес и менеджмент", "Информатика и IT", "Инженерия", "Медицина и здоровье",
  "Экономика и финансы", "Право", "Дизайн и искусство", "Социальные науки",
  "Естественные науки", "Образование", "Туризм и гостиничное дело", "Языки и гуманитарные науки",
] as const;

export const ENGLISH_EXAMS = {
  ielts: { min: 0, max: 9, step: 0.5 },
  toefl: { min: 1, max: 6, step: 0.5 },
  toefl_120: { min: 0, max: 120, step: 1 },
  pte: { min: 10, max: 90, step: 1 },
  duolingo: { min: 10, max: 160, step: 5 },
} as const;

export function formatStudentApplicationAnswers(draft: StudentApplicationDraft): { label: string; value: string }[] {
  const english = draft.english.mode === "exam"
    ? `${APPLICATION_LABELS[draft.english.exam]}: ${draft.english.score} (со слов студента)`
    : `${APPLICATION_LABELS[draft.english.level]} · самооценка`;
  return [
    { label: "Имя и фамилия", value: `${draft.firstName} ${draft.lastName}` },
    { label: "Телефон", value: draft.phone },
    { label: "Страны обучения", value: draft.destinationCountries.map(countryLabel).join(", ") },
    { label: "Начало обучения", value: `${APPLICATION_LABELS[draft.intakeSeason]} ${draft.intakeYear}` },
    { label: "Образование", value: APPLICATION_LABELS[draft.educationLevel] },
    { label: "Средний балл", value: `${draft.averageGrade} из ${draft.gradeScale}` },
    { label: "Направления", value: draft.studyFields.join(", ") },
    { label: "Ступени обучения", value: draft.studyLevels.map((level) => APPLICATION_LABELS[level]).join(", ") },
    { label: "Гражданство", value: countryLabel(draft.nationality) },
    { label: "Английский", value: english },
    { label: "Обучение в год, USD", value: APPLICATION_LABELS[draft.tuitionBudget] },
    { label: "Источник финансирования", value: APPLICATION_LABELS[draft.fundingSource] },
  ];
}
