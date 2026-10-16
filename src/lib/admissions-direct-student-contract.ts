/**
 * «Добавить студента» без отдела продаж (миграция 281, решения владельца
 * 16.10.2026): общий для формы и сервера контракт. Без серверных импортов:
 * его читает клиентская панель, server action и unit-тест.
 *
 * Форма собирает черновик (`AdmissionsDirectDraft`), `buildAdmissionsDirectPayload`
 * проверяет его так же, как сервер, и возвращает либо полезную нагрузку RPC
 * `create_admissions_student_case_v1`, либо ошибки по полям. Server action
 * повторно проверяет полученное `parseAdmissionsDirectPayload`: браузеру не
 * доверяем, решает всё равно база.
 */
import { ADMISSIONS_PIPELINE_STAGES, type AdmissionsPipelineStage } from "./platform-admissions-pipeline-contract.ts";
import {
  PLATFORM_APPLICATION_COUNTRIES,
  PLATFORM_APPLICATION_DEGREES,
  type PlatformApplicationCountry,
} from "./platform-application-contract.ts";
import { degree as degreeLabel } from "./v3/wording.ts";

/** Валюты договора и оплат: домен «Условий продажи» (181/184). */
export const ADMISSIONS_DIRECT_CURRENCIES = ["USD", "EUR", "KGS"] as const;
export type AdmissionsDirectCurrency = (typeof ADMISSIONS_DIRECT_CURRENCIES)[number];

/** Китай: стоимость по умолчанию 1 500 USD (решение владельца 16.10.2026). Подстановка, не правило сервера. */
export const CHINA_DEFAULT_COST = Object.freeze({ amount: "1500", currency: "USD" as AdmissionsDirectCurrency });

export const ADMISSIONS_DIRECT_PARENT_RELATIONS = Object.freeze({ mother: "Мама", father: "Папа" });
export type AdmissionsDirectParentRelation = keyof typeof ADMISSIONS_DIRECT_PARENT_RELATIONS;

/** Ступень пишется словом продукта (`wording.ts`), как в делах из анкеты (180). */
export const ADMISSIONS_DIRECT_DEGREES: readonly string[] = Object.freeze(
  PLATFORM_APPLICATION_DEGREES.map((key) => degreeLabel(key)).filter((label): label is string => label !== null),
);

export const ADMISSIONS_DIRECT_MAX_PAYMENTS = 20;

export type AdmissionsDirectPaymentDraft = Readonly<{ amount: string; currency: string; paidOn: string }>;

export type AdmissionsDirectDraft = Readonly<{
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  birthDate: string;
  age: string;
  parentRelation: string;
  parentFirstName: string;
  parentLastName: string;
  parentPhone: string;
  country: string;
  degree: string;
  program: string;
  intake: string;
  educationCurrent: string;
  english: string;
  chinese: string;
  /** Куратор: id членства или "" — без куратора («Ждут куратора»). */
  curator: string;
  stage: string;
  costAmount: string;
  costCurrency: string;
  signedOn: string;
  payments: readonly AdmissionsDirectPaymentDraft[];
  note: string;
}>;

export const EMPTY_ADMISSIONS_DIRECT_DRAFT: AdmissionsDirectDraft = Object.freeze({
  firstName: "", lastName: "", phone: "", email: "", birthDate: "", age: "",
  parentRelation: "", parentFirstName: "", parentLastName: "", parentPhone: "",
  country: "", degree: "", program: "", intake: "",
  educationCurrent: "", english: "", chinese: "",
  curator: "", stage: "new",
  costAmount: "", costCurrency: "USD", signedOn: "",
  payments: [],
  note: "",
});

/** Полезная нагрузка RPC — ровно та форма, которую принимает 281. */
export type AdmissionsDirectPayload = Readonly<{
  student: Readonly<{
    name: string; firstName?: string; lastName?: string; phone?: string; email?: string; birthDate?: string; age?: number;
  }>;
  parent?: Readonly<{ relation: AdmissionsDirectParentRelation; firstName?: string; lastName?: string; phone?: string }>;
  route: Readonly<{ country: PlatformApplicationCountry; degree?: string; program?: string; intake?: string }>;
  education?: Readonly<{ current?: string; english?: string; chinese?: string }>;
  curatorMembershipId: string | null;
  pipelineStage: AdmissionsPipelineStage;
  money?: Readonly<{
    cost?: Readonly<{ amountMinor: number; currency: AdmissionsDirectCurrency }>;
    signedOn?: string;
    payments?: readonly Readonly<{ amountMinor: number; currency: AdmissionsDirectCurrency; paidOn: string }>[];
  }>;
  note?: string;
}>;

export type AdmissionsDirectField =
  | "firstName" | "lastName" | "phone" | "email" | "birthDate" | "age"
  | "parentRelation" | "parentFirstName" | "parentLastName" | "parentPhone"
  | "country" | "degree" | "program" | "intake"
  | "educationCurrent" | "english" | "chinese"
  | "curator" | "stage" | "costAmount" | "costCurrency" | "signedOn" | "payments" | "note";

export type AdmissionsDirectErrors = Readonly<Partial<Record<AdmissionsDirectField, string>>>;

export type AdmissionsDirectBuild =
  | Readonly<{ ok: true; payload: AdmissionsDirectPayload }>
  | Readonly<{ ok: false; errors: AdmissionsDirectErrors; paymentErrors: readonly (string | null)[] }>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LINE_CONTROL = /[\u0000-\u001f\u007f]/u;
const NOTE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
/** Знаки, которые можно набрать в телефоне: цифры, «+» в начале, пробелы, скобки, точки, дефисы. */
const PHONE_SHAPE = /^\+?[\d\s().-]{7,40}$/u;
const MAX_MINOR = 1_000_000_000_000;

/** Сумма из поля в минимальных единицах: «1 500», «1500,50», «1500.5». "" — пусто, null — неверно. */
export function amountToMinor(value: string): number | "" | null {
  const normalized = value.replace(/[\s  ]/gu, "").replace(",", ".");
  if (normalized === "") return "";
  if (!/^\d{1,11}(\.\d{1,2})?$/u.test(normalized)) return null;
  const [whole, cents = ""] = normalized.split(".");
  const minor = Number(whole) * 100 + Number(cents.padEnd(2, "0"));
  return minor > 0 && minor <= MAX_MINOR ? minor : null;
}

/** Сумма из минимальных единиц для поля и подписи: 150000 → «1 500», 150050 → «1 500,50». */
export function minorToAmount(minor: number): string {
  const whole = Math.floor(minor / 100).toLocaleString("ru-RU").replace(/ /gu, " ");
  const cents = minor % 100;
  return cents === 0 ? whole : `${whole},${String(cents).padStart(2, "0")}`;
}

/**
 * Телефон в одном виде E.164 («+», код страны, номер), как `admissions_direct_phone` в 281;
 * null, если номер так не прочитать. Номер Кыргызстана можно без «+»: «0555 123 456» и
 * «996 555 123 456» становятся «+996555123456» (после +996 ровно 9 цифр, лишний «0» убирается).
 * «00» перед кодом страны равен «+». Другой номер без «+» неоднозначен.
 */
export function admissionsDirectPhone(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length > 40 || !PHONE_SHAPE.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/gu, "");
  let canonical = trimmed.startsWith("+") ? `+${digits}`
    : /^00[1-9]/u.test(digits) ? `+${digits.slice(2)}`
      : /^0\d{9}$/u.test(digits) ? `+996${digits.slice(1)}`
        : /^996\d{9}$/u.test(digits) ? `+${digits}`
          : null;
  if (canonical === null) return null;
  if (/^\+9960\d{9}$/u.test(canonical)) canonical = `+996${canonical.slice(5)}`;
  if (canonical.startsWith("+996")) return /^\+996\d{9}$/u.test(canonical) ? canonical : null;
  return /^\+[1-9]\d{6,14}$/u.test(canonical) ? canonical : null;
}

const PHONE_ERROR = "Телефон с кодом страны, например +996 555 123 456. Номер Кыргызстана можно и так: 0555 123 456.";

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

/** Сегодня в Бишкеке (UTC+6), как `today` в 281. */
export function bishkekToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isCurrency(value: string): value is AdmissionsDirectCurrency {
  return (ADMISSIONS_DIRECT_CURRENCIES as readonly string[]).includes(value);
}
function isStage(value: string): value is AdmissionsPipelineStage {
  return (ADMISSIONS_PIPELINE_STAGES as readonly string[]).includes(value);
}
function isCountry(value: string): value is PlatformApplicationCountry {
  return (PLATFORM_APPLICATION_COUNTRIES as readonly string[]).includes(value);
}

const TEXT_LIMITS = {
  firstName: 60, lastName: 60, parentFirstName: 60, parentLastName: 60,
  degree: 60, program: 100, intake: 30, educationCurrent: 100, english: 60, chinese: 40,
} as const satisfies Partial<Record<AdmissionsDirectField, number>>;

/**
 * Черновик формы → нагрузка RPC. Те же правила, что у 281: имя и страна
 * обязательны; телефон в виде E.164 (`admissionsDirectPhone`), почта по форме
 * контакта; дата рождения, дата договора и даты оплат не позже сегодня,
 * возраст 5–99; родитель — мама или папа; оплаты с суммой, валютой и датой, в
 * валюте договора не больше стоимости. `today` — день в Бишкеке.
 */
export function buildAdmissionsDirectPayload(draft: AdmissionsDirectDraft, today: string = bishkekToday()): AdmissionsDirectBuild {
  const errors: Partial<Record<AdmissionsDirectField, string>> = {};
  const text = (field: keyof typeof TEXT_LIMITS): string | undefined => {
    const value = draft[field].trim();
    if (value === "") return undefined;
    if (value.length > TEXT_LIMITS[field] || LINE_CONTROL.test(value)) {
      errors[field] = `Не больше ${TEXT_LIMITS[field]} символов в одну строку.`;
      return undefined;
    }
    return value;
  };

  const firstName = text("firstName");
  const lastName = text("lastName");
  if (!firstName && !errors.firstName) errors.firstName = "Укажите имя студента.";

  const phone = draft.phone.trim();
  if (phone && admissionsDirectPhone(phone) === null) errors.phone = PHONE_ERROR;
  const email = draft.email.trim();
  if (email && (email.length > 120 || !EMAIL_PATTERN.test(email))) errors.email = "Проверьте почту.";

  const birthDate = draft.birthDate.trim();
  if (birthDate && (!isCalendarDate(birthDate) || birthDate < "1940-01-01" || birthDate > today)) {
    errors.birthDate = "Дата рождения не может быть позже сегодняшнего дня.";
  }
  const ageText = draft.age.trim();
  const age = ageText === "" ? undefined : Number(ageText);
  // Возраст нужен только без даты рождения: с датой поле выключено и не отправляется.
  if (!birthDate && age !== undefined && (!/^\d{1,2}$/u.test(ageText) || age < 5 || age > 99)) errors.age = "Возраст: целое число от 5 до 99.";

  const parentFirstName = text("parentFirstName");
  const parentLastName = text("parentLastName");
  const parentPhone = draft.parentPhone.trim();
  if (parentPhone && admissionsDirectPhone(parentPhone) === null) errors.parentPhone = PHONE_ERROR;
  const parentGiven = Boolean(parentFirstName || parentLastName || parentPhone);
  const relation = draft.parentRelation;
  if (parentGiven && relation !== "mother" && relation !== "father") errors.parentRelation = "Выберите, кто это: мама или папа.";

  const country = draft.country;
  if (!isCountry(country)) errors.country = "Выберите страну.";
  const degree = draft.degree.trim();
  if (degree && !ADMISSIONS_DIRECT_DEGREES.includes(degree)) errors.degree = "Выберите ступень из списка.";
  const program = text("program");
  const intake = text("intake");
  const educationCurrent = text("educationCurrent");
  const english = text("english");
  const chinese = text("chinese");

  const curator = draft.curator.trim();
  if (curator && !UUID_PATTERN.test(curator)) errors.curator = "Выберите куратора из списка.";
  if (!isStage(draft.stage)) errors.stage = "Выберите этап.";

  const costMinor = amountToMinor(draft.costAmount);
  if (costMinor === null) errors.costAmount = "Сумма: число больше нуля, до двух знаков после запятой.";
  if (costMinor !== "" && costMinor !== null && !isCurrency(draft.costCurrency)) errors.costCurrency = "Выберите валюту.";
  const signedOn = draft.signedOn.trim();
  // Договор студента, который пришёл с деньгами, уже подписан: дата не позже сегодня, как в 281.
  // Оплата раньше даты договора допустима (предоплата).
  if (signedOn && (!isCalendarDate(signedOn) || signedOn < "2000-01-01" || signedOn > today)) {
    errors.signedOn = "Укажите дату договора, не позже сегодняшнего дня.";
  }

  if (draft.payments.length > ADMISSIONS_DIRECT_MAX_PAYMENTS) errors.payments = `Не больше ${ADMISSIONS_DIRECT_MAX_PAYMENTS} оплат.`;
  // Полученные деньги оплачены сегодня или раньше (день в Бишкеке), как в 281.
  const paymentErrors = draft.payments.map((payment): string | null => {
    const minor = amountToMinor(payment.amount);
    if (minor === "" || minor === null) return "Сумма: число больше нуля, до двух знаков после запятой.";
    if (!isCurrency(payment.currency)) return "Выберите валюту.";
    if (!isCalendarDate(payment.paidOn) || payment.paidOn < "2000-01-01" || payment.paidOn > today) {
      return "Укажите дату оплаты, не позже сегодняшнего дня.";
    }
    return null;
  });
  const payments = draft.payments.map((payment) => ({
    amountMinor: amountToMinor(payment.amount) as number,
    currency: payment.currency as AdmissionsDirectCurrency,
    paidOn: payment.paidOn,
  }));
  if (!errors.payments && typeof costMinor === "number" && isCurrency(draft.costCurrency) && paymentErrors.every((e) => e === null)) {
    const sameCurrency = payments.filter((p) => p.currency === draft.costCurrency).reduce((sum, p) => sum + p.amountMinor, 0);
    if (sameCurrency > costMinor) errors.payments = `Получено больше стоимости договора в ${draft.costCurrency}.`;
  }

  const note = draft.note.trim();
  if (note.length > 3500 || NOTE_CONTROL.test(note)) errors.note = "Заметка: не больше 3 500 символов.";

  if (Object.keys(errors).length > 0 || paymentErrors.some((e) => e !== null)) {
    return { ok: false, errors, paymentErrors };
  }

  const name = [firstName, lastName].filter(Boolean).join(" ");
  const education = { current: educationCurrent, english, chinese };
  const money = {
    cost: typeof costMinor === "number" ? { amountMinor: costMinor, currency: draft.costCurrency as AdmissionsDirectCurrency } : undefined,
    signedOn: signedOn || undefined,
    payments: payments.length > 0 ? payments : undefined,
  };
  const payload: AdmissionsDirectPayload = {
    student: compact({
      name, firstName, lastName, phone: phone || undefined, email: email || undefined,
      birthDate: birthDate || undefined, age: birthDate ? undefined : age,
    }) as AdmissionsDirectPayload["student"],
    ...(parentGiven ? {
      parent: compact({ relation: relation as AdmissionsDirectParentRelation, firstName: parentFirstName, lastName: parentLastName,
        phone: parentPhone || undefined }) as NonNullable<AdmissionsDirectPayload["parent"]>,
    } : {}),
    route: compact({ country: country as PlatformApplicationCountry, degree: degree || undefined, program, intake }) as AdmissionsDirectPayload["route"],
    ...(Object.values(education).some(Boolean) ? { education: compact(education) } : {}),
    curatorMembershipId: curator || null,
    pipelineStage: draft.stage as AdmissionsPipelineStage,
    ...(Object.values(money).some((value) => value !== undefined) ? { money: compact(money) } : {}),
    ...(note ? { note } : {}),
  };
  return { ok: true, payload };
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function optionalText(value: unknown, max: number): boolean {
  return value === undefined || (typeof value === "string" && value.trim() === value && value.length > 0
    && value.length <= max && !LINE_CONTROL.test(value));
}

/**
 * Server action: нагрузка из браузера, проверенная ещё раз по форме контракта.
 * Возвращает её же (как `AdmissionsDirectPayload`) или null. Значения
 * проверяет база; здесь отсекаются чужие ключи и типы.
 */
export function parseAdmissionsDirectPayload(input: unknown): AdmissionsDirectPayload | null {
  if (!isRecord(input) || !exactKeys(input, ["student", "parent", "route", "education", "curatorMembershipId", "pipelineStage", "money", "note"])) return null;
  const { student, parent, route, education, curatorMembershipId, pipelineStage, money, note } = input;
  if (!isRecord(student) || !exactKeys(student, ["name", "firstName", "lastName", "phone", "email", "birthDate", "age"])
    || typeof student.name !== "string" || !optionalText(student.name, 200)
    || !optionalText(student.firstName, 60) || !optionalText(student.lastName, 60) || !optionalText(student.phone, 40)
    || !optionalText(student.email, 120) || !(student.birthDate === undefined || (typeof student.birthDate === "string" && isCalendarDate(student.birthDate)))
    || !(student.age === undefined || (Number.isInteger(student.age) && (student.age as number) >= 5 && (student.age as number) <= 99))) return null;
  if (parent !== undefined && (!isRecord(parent) || !exactKeys(parent, ["relation", "firstName", "lastName", "phone"])
    || (parent.relation !== "mother" && parent.relation !== "father")
    || !optionalText(parent.firstName, 60) || !optionalText(parent.lastName, 60) || !optionalText(parent.phone, 40))) return null;
  if (!isRecord(route) || !exactKeys(route, ["country", "degree", "program", "intake"]) || typeof route.country !== "string"
    || !isCountry(route.country) || !optionalText(route.degree, 60) || !optionalText(route.program, 100) || !optionalText(route.intake, 30)) return null;
  if (education !== undefined && (!isRecord(education) || !exactKeys(education, ["current", "english", "chinese"])
    || !optionalText(education.current, 100) || !optionalText(education.english, 60) || !optionalText(education.chinese, 40))) return null;
  if (!(curatorMembershipId === null || (typeof curatorMembershipId === "string" && UUID_PATTERN.test(curatorMembershipId)))) return null;
  if (typeof pipelineStage !== "string" || !isStage(pipelineStage)) return null;
  if (money !== undefined) {
    if (!isRecord(money) || !exactKeys(money, ["cost", "signedOn", "payments"])) return null;
    const { cost, signedOn, payments } = money;
    const amount = (value: unknown) => Number.isInteger(value) && (value as number) > 0 && (value as number) <= MAX_MINOR;
    if (cost !== undefined && (!isRecord(cost) || !exactKeys(cost, ["amountMinor", "currency"]) || !amount(cost.amountMinor)
      || typeof cost.currency !== "string" || !isCurrency(cost.currency))) return null;
    if (signedOn !== undefined && (typeof signedOn !== "string" || !isCalendarDate(signedOn))) return null;
    if (payments !== undefined && (!Array.isArray(payments) || payments.length === 0 || payments.length > ADMISSIONS_DIRECT_MAX_PAYMENTS
      || !payments.every((payment) => isRecord(payment) && exactKeys(payment, ["amountMinor", "currency", "paidOn"])
        && amount(payment.amountMinor) && typeof payment.currency === "string" && isCurrency(payment.currency)
        && typeof payment.paidOn === "string" && isCalendarDate(payment.paidOn)))) return null;
  }
  if (note !== undefined && (typeof note !== "string" || note.trim() !== note || note.length === 0 || note.length > 3500 || NOTE_CONTROL.test(note))) return null;
  return input as AdmissionsDirectPayload;
}

/**
 * Ответ server action. `field` — поле, которое назвала база (`admissions_direct_invalid:<ключ>`).
 * `curator_forbidden` — право есть, но этого куратора (или «Без куратора») актёр назвать не может;
 * `lead_exists` — у человека с тем же телефоном или почтой открытый лид в продажах.
 */
export type AdmissionsDirectResult =
  | Readonly<{ status: "saved"; studentCaseId: string; state: "active" | "pending" }>
  | Readonly<{ status: "invalid"; field: string | null }>
  | Readonly<{ status: "forbidden" | "curator_forbidden" | "case_exists" | "lead_exists" | "request_conflict" | "unavailable" }>;

/** Ключ нагрузки из ошибки базы → поле формы. */
const SERVER_FIELDS: Readonly<Record<string, AdmissionsDirectField>> = {
  name: "firstName", firstName: "firstName", lastName: "lastName", phone: "phone", email: "email", birthDate: "birthDate",
  age: "age", relation: "parentRelation", parentFirstName: "parentFirstName", parentLastName: "parentLastName",
  parentPhone: "parentPhone", country: "country", degree: "degree",
  program: "program", intake: "intake", current: "educationCurrent", english: "english", chinese: "chinese",
  curator: "curator", curatorMembershipId: "curator", pipelineStage: "stage", cost: "costAmount", costCurrency: "costCurrency",
  signedOn: "signedOn", payments: "payments", payment: "payments", paidOn: "payments", paymentsExceedCost: "payments", note: "note",
};

export function admissionsDirectServerField(key: string | null): AdmissionsDirectField | null {
  return key !== null && Object.hasOwn(SERVER_FIELDS, key) ? SERVER_FIELDS[key] : null;
}

/**
 * Куда вести после сохранения: дело в работе открывается целиком; дело без
 * куратора — строкой в «Ждут куратора»: там его назначают Руководитель
 * поступления и Admin (правило 248/281), оттуда же открывается само дело.
 */
export function admissionsDirectCaseHref(result: Readonly<{ studentCaseId: string; state: "active" | "pending" }>): string {
  return result.state === "active"
    ? `/v3/profile?case=${result.studentCaseId}`
    : `/v3/profile?view=needs_curator&open=${result.studentCaseId}`;
}

/** Слова ответа. Без технических кодов; что делать дальше — в самой фразе. */
export function admissionsDirectMessage(result: AdmissionsDirectResult): string {
  switch (result.status) {
    case "saved": return result.state === "active" ? "Студент добавлен. Открываем дело." : "Студент добавлен и ждёт куратора. Открываем «Ждут куратора».";
    case "invalid": return result.field === "paymentsExceedCost"
      ? "Получено больше стоимости договора в той же валюте. Проверьте суммы."
      : result.field === "curator" ? "Этого сотрудника нельзя назначить куратором. Выберите другого."
      : result.field === null ? "Проверьте поля формы и повторите." : "Проверьте отмеченные поля.";
    case "forbidden": return "Нет права добавлять студентов. Если оно должно быть, попросите Admin проверить вашу роль.";
    case "curator_forbidden": return "Этого куратора вы назначить не можете. Выберите куратора своего отдела или оставьте «Без куратора».";
    case "case_exists": return "У человека с этим телефоном или почтой уже есть открытое дело. Найдите его в «Студентах».";
    case "lead_exists": return "Этот человек уже есть в продажах как открытый лид. Дело появится, когда продажи передадут его в поступление.";
    case "request_conflict": return "Этот запрос уже использован с другими данными. Обновите страницу и заполните форму снова.";
    case "unavailable": return "Сохранение не подтверждено. Данные остались в форме; безопасно повторите.";
  }
}
