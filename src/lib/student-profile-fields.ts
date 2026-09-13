// Stable keys and template limits from EVO Docs src/shared/profile.ts (6e7cf741).
export const PROFILE_GROUPS = [
  "personal", "education", "study_goal", "father", "mother", "emergency",
] as const;

export type ProfileGroup = (typeof PROFILE_GROUPS)[number];

export interface ProfileFieldDefinition {
  readonly key: string;
  readonly label: string;
  readonly group: ProfileGroup;
  readonly maxLength: number;
  readonly required: boolean;
}

function field<const Key extends string>(
  key: Key,
  label: string,
  group: ProfileGroup,
  maxLength: number,
  required = false,
) {
  return Object.freeze({ key, label, group, maxLength, required });
}

export const PROFILE_FIELDS = [
  field("student_first_name", "Имя", "personal", 60, true),
  field("student_last_name", "Фамилия", "personal", 60, true),
  field("date_of_birth", "Дата рождения", "personal", 20, true),
  field("nationality", "Гражданство", "personal", 60, true),
  field("passport_number", "Номер паспорта", "personal", 30, true),
  field("passport_expiry_date", "Срок действия паспорта", "personal", 20),
  field("country_of_residence", "Страна проживания", "personal", 60),
  field("permanent_address", "Адрес постоянного проживания", "personal", 180, true),
  field("mobile_phone", "Мобильный телефон", "personal", 40, true),
  field("whatsapp_telegram", "WhatsApp / Telegram", "personal", 60),
  field("student_email", "Электронная почта студента", "personal", 120, true),
  field("chinese_level_hsk", "Уровень китайского / HSK", "personal", 40),
  field("english_level", "Уровень английского", "personal", 60),

  field("education_1_school_name", "Учебное заведение 1", "education", 100),
  field("education_1_country_city", "Страна и город 1", "education", 80),
  field("education_1_year_from", "Год начала обучения 1", "education", 12),
  field("education_1_year_to", "Год окончания обучения 1", "education", 12),
  field("education_1_degree_certificate", "Степень / аттестат 1", "education", 80),
  field("education_2_school_name", "Учебное заведение 2", "education", 100),
  field("education_2_country_city", "Страна и город 2", "education", 80),
  field("education_2_year_from", "Год начала обучения 2", "education", 12),
  field("education_2_year_to", "Год окончания обучения 2", "education", 12),
  field("education_2_degree_certificate", "Степень / аттестат 2", "education", 80),
  field("education_3_school_name", "Учебное заведение 3", "education", 100),
  field("education_3_country_city", "Страна и город 3", "education", 80),
  field("education_3_year_from", "Год начала обучения 3", "education", 12),
  field("education_3_year_to", "Год окончания обучения 3", "education", 12),
  field("education_3_degree_certificate", "Степень / аттестат 3", "education", 80),
  field("current_study_status", "Текущий статус обучения", "education", 100),
  field("expected_graduation_year", "Ожидаемый год выпуска", "education", 12),
  field("extracurricular_achievements", "Внеучебные занятия и достижения", "education", 400),

  field("desired_country_of_study", "Желаемая страна обучения", "study_goal", 60),
  field("desired_university", "Желаемый университет", "study_goal", 120),
  field("field_major", "Направление / специальность", "study_goal", 100, true),
  field("program_level", "Уровень программы", "study_goal", 60),
  field("desired_start_date", "Желаемая дата начала обучения", "study_goal", 30),
  field("budget_per_year", "Бюджет на год", "study_goal", 60),
  field("scholarship_interest", "Интерес к стипендии", "study_goal", 20),
  field("why_this_field", "Почему выбрано это направление", "study_goal", 500),

  field("father_first_name", "Имя отца", "father", 60),
  field("father_last_name", "Фамилия отца", "father", 60),
  field("father_employer", "Место работы отца", "father", 100),
  field("father_job_title", "Должность отца", "father", 80),
  field("father_mobile_phone", "Мобильный телефон отца", "father", 40),
  field("father_work_email", "Рабочая почта отца", "father", 120),
  field("father_personal_email", "Личная почта отца", "father", 120),

  field("mother_first_name", "Имя матери", "mother", 60),
  field("mother_last_name", "Фамилия матери", "mother", 60),
  field("mother_employer", "Место работы матери", "mother", 100),
  field("mother_job_title", "Должность матери", "mother", 80),
  field("mother_mobile_phone", "Мобильный телефон матери", "mother", 40),
  field("mother_work_email", "Рабочая почта матери", "mother", 120),
  field("mother_personal_email", "Личная почта матери", "mother", 120),

  field("emergency_contact_name", "Контакт для экстренной связи", "emergency", 100),
  field("emergency_contact_relationship", "Кем приходится студенту", "emergency", 60),
  field("emergency_contact_phone_email", "Телефон / почта для экстренной связи", "emergency", 140),
  field("previous_visa_refusals", "Были ли отказы в визе", "emergency", 20),
  field("visa_refusal_country", "Страна отказа в визе", "emergency", 60),
  field("chronic_conditions_allergies", "Хронические заболевания / аллергии", "emergency", 20),
  field("conditions_details", "Подробности о состоянии здоровья", "emergency", 240),
  field("lead_source", "Откуда узнали об EVO", "emergency", 120),
] as const satisfies readonly ProfileFieldDefinition[];

export type ProfileFieldKey = (typeof PROFILE_FIELDS)[number]["key"];

export const PROFILE_FIELD_KEYS: readonly ProfileFieldKey[] = PROFILE_FIELDS.map(({ key }) => key);
export const PROFILE_REQUIRED_FIELD_KEYS: readonly ProfileFieldKey[] = PROFILE_FIELDS
  .filter(({ required }) => required).map(({ key }) => key);
export const PROFILE_FIELD_BY_KEY: ReadonlyMap<string, ProfileFieldDefinition> = new Map(
  PROFILE_FIELDS.map((definition) => [definition.key, definition]),
);

export const PROFILE_GROUP_LABELS: Readonly<Record<ProfileGroup, string>> = {
  personal: "Личные данные",
  education: "Образование",
  study_goal: "Цель обучения",
  father: "Отец",
  mother: "Мать",
  emergency: "Экстренная связь и дополнительные сведения",
};

// These three values belong to the canonical profile columns, not extensions.
export const PROFILE_CANONICAL_FIELDS = {
  date_of_birth: "date_of_birth",
  nationality: "citizenship_country",
  country_of_residence: "residency_country",
} as const satisfies Partial<Record<ProfileFieldKey, string>>;

export type ProfileFieldState = "extracted" | "needs_review" | "conflict" | "confirmed";

export interface ProfileFieldValue {
  readonly key: ProfileFieldKey;
  readonly value: string | null;
  readonly state: ProfileFieldState;
}

export interface ProfileFieldsSnapshot {
  readonly fields: readonly ProfileFieldValue[];
}

export interface ProfileFieldValidationOptions {
  /** UTC calendar day in YYYY-MM-DD; injectable to keep calendar checks deterministic. */
  readonly today?: string;
}

export interface NormalizedProfileField {
  readonly key: ProfileFieldKey;
  readonly value: string;
  readonly warnings: readonly string[];
  readonly valid: boolean;
}

export interface ProfileIssue {
  readonly key: ProfileFieldKey;
  readonly label: string;
  readonly kind: "missing" | "unconfirmed" | "conflict" | "invalid";
  readonly message: string;
}

export interface ProfileReadiness {
  readonly issues: readonly ProfileIssue[];
  readonly missingRequired: readonly ProfileIssue[];
  readonly unconfirmed: readonly ProfileIssue[];
  readonly conflicts: readonly ProfileIssue[];
  readonly invalid: readonly ProfileIssue[];
  readonly confirmedEmpty: readonly ProfileFieldKey[];
  readonly ready: boolean;
}

// The template's lower per-field limits are validation errors, never truncation.
// Character limits count Unicode code points, matching PostgreSQL char_length.
export const PROFILE_FIELD_INPUT_MAX_LENGTH = 4096;

const DATE_KEYS = new Set<string>(["date_of_birth", "passport_expiry_date", "desired_start_date"]);
const EMAIL_KEYS = new Set<string>([
  "student_email", "father_work_email", "father_personal_email", "mother_work_email", "mother_personal_email",
]);
const PHONE_KEYS = new Set<string>(["mobile_phone", "father_mobile_phone", "mother_mobile_phone"]);
const YES_NO_KEYS = new Set<string>(["scholarship_interest", "previous_visa_refusals", "chronic_conditions_allergies"]);
const FIELD_STATES = new Set<string>(["extracted", "needs_review", "conflict", "confirmed"]);

export function isProfileFieldKey(value: unknown): value is ProfileFieldKey {
  return typeof value === "string" && PROFILE_FIELD_BY_KEY.has(value);
}

export function normalizeDate(value: string): string | null {
  if (typeof value !== "string" || [...value].length > PROFILE_FIELD_INPUT_MAX_LENGTH) return null;
  const trimmed = value.trim();
  const iso = /^(\d{4})[-/.\s](\d{1,2})[-/.\s](\d{1,2})$/.exec(trimmed);
  const local = /^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{4})$/.exec(trimmed);
  if (!iso && !local) return null;
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : [Number(local![3]), Number(local![2]), Number(local![1])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 2200 || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizePhone(value: string): string | null {
  if (typeof value !== "string" || [...value].length > PROFILE_FIELD_INPUT_MAX_LENGTH) return null;
  const trimmed = value.trim();
  // Do not turn usernames, extensions or arbitrary text into a different phone.
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

function todayFrom(options: ProfileFieldValidationOptions): string {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  if (typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(today)
    || normalizeDate(today) !== today) throw new TypeError("profile_fields_invalid_today");
  return today;
}

function normalizeField(key: string, rawValue: string | null, today: string): NormalizedProfileField {
  if (!isProfileFieldKey(key)) throw new TypeError("profile_fields_unknown_key");
  if (rawValue !== null && typeof rawValue !== "string") throw new TypeError("profile_fields_invalid_value");
  if (rawValue !== null && [...rawValue].length > PROFILE_FIELD_INPUT_MAX_LENGTH) {
    throw new RangeError("profile_fields_input_too_long");
  }
  const definition = PROFILE_FIELD_BY_KEY.get(key)!;
  const warnings: string[] = [];
  let value = (rawValue ?? "").normalize("NFKC").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  if (value && DATE_KEYS.has(key)) {
    const date = normalizeDate(value);
    if (date) {
      value = date;
      if (key === "date_of_birth" && value > today) warnings.push("Дата рождения не может быть в будущем.");
    } else warnings.push("Укажите существующую дату в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД (1900–2200).");
  }
  if (EMAIL_KEYS.has(key)) {
    value = value.toLowerCase();
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) warnings.push("Проверьте адрес электронной почты.");
  }
  if (value && PHONE_KEYS.has(key)) {
    const phone = normalizePhone(value);
    if (phone) value = phone;
    else warnings.push("Проверьте телефон: от 7 до 15 цифр, допустимы «+», пробелы, скобки и дефисы.");
  }
  if (key === "whatsapp_telegram") {
    // This source field also accepts a Telegram username, not only a number.
    value = normalizePhone(value) ?? value;
  }
  if (key === "passport_number") {
    value = value.toUpperCase().replace(/\s+/g, "");
    // The source registry permits 30 characters; its old advisory 20-character
    // regex must not become a stricter export limit than the actual template.
    if (value && (!/^[A-Z0-9-]+$/.test(value) || value.length < 5)) warnings.push("Проверьте формат номера паспорта.");
  }
  if (value && YES_NO_KEYS.has(key)) {
    const normalized = value.toLowerCase();
    if (["yes", "y", "да", "oui", "true"].includes(normalized)) value = "Yes";
    else if (["no", "n", "нет", "non", "false"].includes(normalized)) value = "No";
    else warnings.push("Укажите Yes или No (Да или Нет).");
  }
  if ([...value].length > definition.maxLength) {
    warnings.push(`Поле «${definition.label}» превышает лимит шаблона: ${definition.maxLength} символов. Значение не обрезано.`);
  }
  return { key, value, warnings, valid: warnings.length === 0 };
}

export function normalizeProfileField(
  key: string,
  rawValue: string | null,
  options: ProfileFieldValidationOptions = {},
): NormalizedProfileField {
  return normalizeField(key, rawValue, todayFrom(options));
}

export function fieldFormatIssue(
  key: string,
  value: string | null,
  options: ProfileFieldValidationOptions = {},
): string | null {
  return normalizeProfileField(key, value, options).warnings[0] ?? null;
}

function analyzeProfile(snapshot: ProfileFieldsSnapshot, options: ProfileFieldValidationOptions) {
  if (!snapshot || !Array.isArray(snapshot.fields) || snapshot.fields.length > PROFILE_FIELDS.length) {
    throw new TypeError("profile_fields_invalid_snapshot");
  }
  const today = todayFrom(options);
  const fields = new Map<ProfileFieldKey, { state: ProfileFieldState; normalized: NormalizedProfileField }>();
  for (const item of snapshot.fields) {
    if (!item || !isProfileFieldKey(item.key) || !FIELD_STATES.has(item.state)) {
      throw new TypeError("profile_fields_invalid_snapshot_field");
    }
    if (fields.has(item.key)) throw new TypeError("profile_fields_duplicate_key");
    fields.set(item.key, { state: item.state, normalized: normalizeField(item.key, item.value, today) });
  }
  const issues: ProfileIssue[] = [];
  const confirmedEmpty: ProfileFieldKey[] = [];
  for (const definition of PROFILE_FIELDS) {
    const current = fields.get(definition.key);
    const value = current?.normalized.value ?? "";
    const issue = (kind: ProfileIssue["kind"], message: string) => {
      issues.push({ key: definition.key, label: definition.label, kind, message });
    };
    // A conflict is unresolved even if its current value is empty and optional.
    if (current?.state === "conflict") issue("conflict", "Источники расходятся. Выберите верное значение.");
    if (!value && definition.required) issue("missing", "Заполните обязательное поле.");
    if (value && current?.state !== "confirmed" && current?.state !== "conflict") {
      issue("unconfirmed", "Проверьте значение и подтвердите его.");
    }
    if (current && !current.normalized.valid) issue("invalid", current.normalized.warnings.join(" "));
    if (current?.state === "confirmed" && !value && current.normalized.valid) confirmedEmpty.push(definition.key);
  }
  const readiness: ProfileReadiness = {
    issues,
    missingRequired: issues.filter(({ kind }) => kind === "missing"),
    unconfirmed: issues.filter(({ kind }) => kind === "unconfirmed"),
    conflicts: issues.filter(({ kind }) => kind === "conflict"),
    invalid: issues.filter(({ kind }) => kind === "invalid"),
    confirmedEmpty,
    ready: issues.length === 0,
  };
  return { fields, readiness };
}

export function getProfileReadiness(
  snapshot: ProfileFieldsSnapshot,
  options: ProfileFieldValidationOptions = {},
): ProfileReadiness {
  return analyzeProfile(snapshot, options).readiness;
}

export class ProfileExportNotReadyError extends Error {
  readonly issues: readonly ProfileIssue[];

  constructor(issues: readonly ProfileIssue[]) {
    super("Анкету пока нельзя экспортировать.");
    this.name = "ProfileExportNotReadyError";
    this.issues = issues;
  }
}

export function getProfileExportValues(
  snapshot: ProfileFieldsSnapshot,
  mode: "draft" | "final",
  options: ProfileFieldValidationOptions = {},
): Partial<Record<ProfileFieldKey, string>> {
  if (mode !== "draft" && mode !== "final") throw new TypeError("profile_fields_invalid_export_mode");
  const { fields, readiness } = analyzeProfile(snapshot, options);
  const blockers = mode === "final" ? readiness.issues : readiness.invalid.filter(
    ({ key }) => fields.get(key)?.state === "confirmed",
  );
  if (blockers.length) throw new ProfileExportNotReadyError(blockers);
  const values: Partial<Record<ProfileFieldKey, string>> = {};
  for (const [key, current] of fields) {
    if (current.state === "confirmed" && current.normalized.valid) values[key] = current.normalized.value;
  }
  return values;
}
