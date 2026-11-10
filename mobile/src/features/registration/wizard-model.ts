// Модель мастера анкеты: порт ApplicationWizard.tsx веба (значения, проверки шагов,
// сборка анкеты) без React. Правила проверки — те же функции веба:
// validateStudentApplicationDraft (src/lib/student-application-contract.ts).
//
// Отличие от веба одно: 7 шагов вместо 9. «Образование» и «Ступень» слиты в один шаг,
// «Гражданство» и «Английский» тоже; порядок и набор вопросов те же, контракт сервера не меняется.
import {
  isStudentApplicationCountry,
  STUDENT_APPLICATION_CONSENT_VERSION,
  validateStudentApplicationDraft,
  type StudentApplicationDraft,
} from "@/features/registration/application-contract";
import { ENGLISH_EXAMS, NATIONALITY_COUNTRIES } from "@/features/registration/application-contract";
import { STUDY_COUNTRY_UNDECIDED } from "@web/lib/study-countries";

export const WIZARD_STEPS = ["countries", "intake", "educationLevels", "fields", "nationalityEnglish", "budget", "account"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];
export const LAST_STEP_INDEX = WIZARD_STEPS.length - 1;

export const SELECTION_LIMITS = { destinationCountries: 15, studyFields: 10, studyLevels: 6 } as const;
export type SelectionKey = keyof typeof SELECTION_LIMITS;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;

export type WizardValues = {
  requestId: string;
  firstName: string;
  lastName: string;
  phone: string;
  destinationCountries: string[];
  intakeSeason: string;
  intakeYear: string;
  educationLevel: string;
  averageGrade: string;
  gradeScale: string;
  studyFields: string[];
  studyLevels: string[];
  nationality: string;
  englishMode: "" | "exam" | "self";
  englishExam: string;
  englishScore: string;
  englishLevel: string;
  tuitionBudget: string;
  fundingSource: string;
  consent: boolean;
  /** Почта нового аккаунта; у вошедшего берётся из сессии. Не секрет, хранится в черновике. */
  email: string;
};

/** Ключ строки: словарь `apply` веба или словарь приложения. */
export type ValidationKey =
  | "validation.countries"
  | "validation.intake"
  | "validation.education"
  | "validation.fields"
  | "validation.levels"
  | "validation.nationality"
  | "validation.englishScore"
  | "validation.english"
  | "validation.budget"
  | "validation.review"
  | "wizard.err.firstName"
  | "wizard.err.phone"
  | "wizard.err.email"
  | "wizard.err.password"
  | "wizard.err.passwordLong"
  | "wizard.err.consent"
  | "wizard.err.aiConsent";

/**
 * 282: сохранённый черновик хранит только страны, которые анкета предлагает сейчас;
 * «Пока не решил» остаётся только один.
 */
export function currentDestinations(list: readonly string[]): string[] {
  const kept = list.filter(isStudentApplicationCountry);
  return kept.includes(STUDY_COUNTRY_UNDECIDED) && kept.length > 1 ? kept.filter((code) => code !== STUDY_COUNTRY_UNDECIDED) : kept;
}

export type NamePrefill = Readonly<{ firstName: string; lastName: string }>;

/** «Имя Фамилия» из приглашения -> поля; ограниченное предзаполнение, не замена черновика. */
export function namePrefillFromDisplayName(displayName: string | null | undefined): NamePrefill | null {
  const name = displayName?.trim().replace(/\s+/g, " ") ?? "";
  if (name === "") return null;
  const space = name.indexOf(" ");
  if (space < 0) return { firstName: name.slice(0, 60), lastName: "" };
  return { firstName: name.slice(0, space).slice(0, 60), lastName: name.slice(space + 1).slice(0, 60) };
}

export function initialValues(requestId: string, draft: StudentApplicationDraft | null = null, prefill: NamePrefill | null = null, email = ""): WizardValues {
  return {
    requestId,
    firstName: draft?.firstName ?? prefill?.firstName ?? "",
    lastName: draft?.lastName ?? prefill?.lastName ?? "",
    phone: draft?.phone ?? "",
    destinationCountries: currentDestinations(draft?.destinationCountries ?? []),
    intakeSeason: draft?.intakeSeason ?? "",
    intakeYear: draft ? String(draft.intakeYear) : "",
    educationLevel: draft?.educationLevel ?? "",
    averageGrade: draft ? String(draft.averageGrade) : "",
    gradeScale: draft?.gradeScale ?? "5",
    studyFields: draft?.studyFields ?? [],
    studyLevels: draft?.studyLevels ?? [],
    nationality: draft?.nationality ?? "",
    englishMode: draft?.english.mode ?? "",
    englishExam: draft?.english.mode === "exam" ? draft.english.exam : "ielts",
    englishScore: draft?.english.mode === "exam" ? String(draft.english.score) : "",
    englishLevel: draft?.english.mode === "self" ? draft.english.level : "",
    tuitionBudget: draft?.tuitionBudget ?? "",
    fundingSource: draft?.fundingSource ?? "",
    consent: false,
    email,
  };
}

/** Число из поля: пробелы убираются, запятая русской клавиатуры становится точкой. */
export function parseNumber(text: string): number {
  const normalized = text.trim().replace(",", ".");
  return normalized === "" ? Number.NaN : Number(normalized);
}

/** Анкета для сервера: ровно 19 ключей контракта (проверяет validateStudentApplicationDraft). */
export function buildQuestionnaire(values: WizardValues): unknown {
  return {
    schemaVersion: 1,
    requestId: values.requestId,
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    phone: values.phone.trim(),
    destinationCountries: values.destinationCountries,
    intakeSeason: values.intakeSeason,
    intakeYear: parseNumber(values.intakeYear),
    educationLevel: values.educationLevel,
    averageGrade: parseNumber(values.averageGrade),
    gradeScale: values.gradeScale,
    studyFields: values.studyFields,
    studyLevels: values.studyLevels,
    nationality: values.nationality,
    english:
      values.englishMode === "exam"
        ? { mode: "exam", exam: values.englishExam, score: parseNumber(values.englishScore) }
        : { mode: "self", level: values.englishLevel },
    tuitionBudget: values.tuitionBudget,
    fundingSource: values.fundingSource,
    consent: values.consent,
    consentVersion: STUDENT_APPLICATION_CONSENT_VERSION,
  };
}

/** Анкета, готовая к отправке, или null (тот же валидатор, что у сервера). */
export function validDraft(values: WizardValues): StudentApplicationDraft | null {
  return validateStudentApplicationDraft(buildQuestionnaire(values));
}

export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export function isEmailLike(email: string): boolean {
  const value = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export type StepContext = Readonly<{
  /** Пароль нового аккаунта; `null`, если аккаунт уже есть (мастер вошедшего). */
  password: string | null;
  aiConsent: boolean;
  /** Почта сессии вошедшего; тогда поле почты не проверяется. */
  signedInEmail?: string | null;
}>;

/** Шаг пройден? Возвращает ключ сообщения об ошибке или null. Порядок сообщений как у веба. */
export function validateStep(step: number, values: WizardValues, context: StepContext = { password: null, aiConsent: false }): ValidationKey | null {
  switch (WIZARD_STEPS[step]) {
    case "countries":
      return values.destinationCountries.length > 0 && values.destinationCountries.every(isStudentApplicationCountry) ? null : "validation.countries";
    case "intake":
      return values.intakeSeason !== "" && values.intakeYear !== "" ? null : "validation.intake";
    case "educationLevels": {
      if (values.educationLevel === "" || values.averageGrade.trim() === "") return "validation.education";
      const grade = parseNumber(values.averageGrade);
      if (!Number.isFinite(grade) || grade < 0 || grade > Number(values.gradeScale)) return "validation.education";
      return values.studyLevels.length > 0 ? null : "validation.levels";
    }
    case "fields":
      return values.studyFields.length > 0 ? null : "validation.fields";
    case "nationalityEnglish": {
      if (!NATIONALITY_COUNTRIES.includes(values.nationality)) return "validation.nationality";
      if (values.englishMode === "exam") {
        if (values.englishScore.trim() === "") return "validation.englishScore";
        const exam = ENGLISH_EXAMS[values.englishExam as keyof typeof ENGLISH_EXAMS];
        const score = parseNumber(values.englishScore);
        if (!exam || !Number.isFinite(score) || score < exam.min || score > exam.max || !Number.isInteger(score / exam.step)) return "validation.englishScore";
        return null;
      }
      return values.englishMode === "self" && values.englishLevel !== "" ? null : "validation.english";
    }
    case "budget":
      return values.tuitionBudget !== "" && values.fundingSource !== "" ? null : "validation.budget";
    case "account": {
      if (values.firstName.trim() === "" || values.lastName.trim() === "") return "wizard.err.firstName";
      const phoneDigits = values.phone.replace(/\D/g, "");
      if (!/^\+?[0-9 ()-]{7,40}$/.test(values.phone.trim()) || phoneDigits.length < 7 || phoneDigits.length > 15) return "wizard.err.phone";
      if (context.password !== null) {
        if (!isEmailLike(values.email)) return "wizard.err.email";
        if (context.password.length < PASSWORD_MIN_LENGTH) return "wizard.err.password";
        if (utf8ByteLength(context.password) > PASSWORD_MAX_BYTES) return "wizard.err.passwordLong";
      }
      if (!values.consent) return "wizard.err.consent";
      // Как registerStudentAction веба: вторая галочка (ИИ-помощники) обязательна и у вошедшего.
      if (!context.aiConsent) return "wizard.err.aiConsent";
      return validDraft(values) ? null : "validation.review";
    }
    default:
      return "validation.review";
  }
}

export type ToggleResult = { values: WizardValues; limitExceeded: boolean };

/** Выбор из списка: «Пока не решил» и страны взаимоисключающие; пределы 15/10/6 как в вебе. */
export function toggleSelection(values: WizardValues, key: SelectionKey, value: string): ToggleResult {
  const list = values[key];
  if (key === "destinationCountries" && !list.includes(value)) {
    const next = value === STUDY_COUNTRY_UNDECIDED ? [value] : [...list.filter((item) => item !== STUDY_COUNTRY_UNDECIDED), value];
    if (next.length > SELECTION_LIMITS[key]) return { values, limitExceeded: true };
    return { values: { ...values, [key]: next }, limitExceeded: false };
  }
  if (list.includes(value)) return { values: { ...values, [key]: list.filter((item) => item !== value) }, limitExceeded: false };
  if (list.length >= SELECTION_LIMITS[key]) return { values, limitExceeded: true };
  return { values: { ...values, [key]: [...list, value] }, limitExceeded: false };
}

/** Своё направление: обрезка, предел 100 знаков, без повтора. */
export function addCustomField(values: WizardValues, text: string): ToggleResult {
  const field = text.trim().slice(0, 100);
  if (field === "" || values.studyFields.includes(field)) return { values, limitExceeded: false };
  return toggleSelection(values, "studyFields", field);
}

function isStringList(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((item) => typeof item === "string" && item.length <= 100);
}

/**
 * Восстановить значения из сохранённого черновика поле за полем: чужой тип или длина
 * отбрасываются, остаётся значение по умолчанию. Согласие всегда сбрасывается (345:
 * галочку, отмеченную до выката или на другом тексте, студент подтверждает заново).
 */
export function restoreValues(saved: unknown, base: WizardValues): WizardValues {
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return base;
  const source = saved as Record<string, unknown>;
  const values: WizardValues = { ...base };
  for (const key of Object.keys(base) as (keyof WizardValues)[]) {
    if (key === "requestId" || key === "consent") continue;
    const incoming = source[key];
    const current = base[key];
    if (Array.isArray(current)) {
      if (isStringList(incoming, 15)) (values[key] as string[]) = [...incoming];
    } else if (typeof incoming === "string" && typeof current === "string" && incoming.length <= 320) {
      (values[key] as string) = incoming;
    }
  }
  if (values.englishMode !== "" && values.englishMode !== "exam" && values.englishMode !== "self") values.englishMode = base.englishMode;
  values.destinationCountries = currentDestinations(values.destinationCountries);
  values.consent = false;
  return values;
}

/** Номер шага из сохранённого значения. */
export function restoreStep(saved: unknown): number {
  return typeof saved === "number" && Number.isInteger(saved) ? Math.max(0, Math.min(LAST_STEP_INDEX, saved)) : 0;
}

/** Первый шаг с ошибкой (для «Проверьте анкету»), если сервер вернул `invalid`. */
export function firstInvalidStep(values: WizardValues): number | null {
  for (let step = 0; step < LAST_STEP_INDEX; step += 1) {
    if (validateStep(step, values)) return step;
  }
  return null;
}
