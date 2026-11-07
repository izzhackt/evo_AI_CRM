/**
 * Кабинеты студентов, которые создаёт администратор (342, решение 07.11.2026). Чистые правила без сервера: их видят и
 * форма, и действие, и тесты.
 */

/** Пометка в app_metadata пользователя Auth: вход с временным паролем, сначала свой пароль. Ставит только сервер. */
export const TEMPORARY_PASSWORD_FLAG = "evo_temporary_password";

/** Имя и фамилия от администратора в user_metadata: анкета подставляет их сама. Только подсказка, не право. */
export const ACCOUNT_NAME_PREFILL_KEY = "evo_name_prefill";

/** Служебная почта кабинета без почты: зона .invalid (RFC 2606), никуда не доставляется и студенту не показывается. */
export const TECHNICAL_STUDENT_EMAIL_DOMAIN = "students.evoadmissions.invalid";

/** Страница «Придумайте свой пароль» для входа с временным паролем. */
export const NEW_PASSWORD_PATH = "/auth/new-password";

/** Временный пароль: 14 знаков без похожих (0/O, 1/l/I), три группы через дефис — его диктуют и вводят с телефона. */
export const TEMPORARY_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const TEMPORARY_PASSWORD_PATTERN = /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/u;

export type StudentAccountInput = Readonly<{ firstName: string; lastName: string; email: string | null }>;

export type StudentAccountResult = Readonly<{ firstName: string; lastName: string; login: string; password: string }>;

export type StudentAccountActionState =
  | Readonly<{ status: "idle"; requestId: string }>
  | Readonly<{ status: "created"; requestId: string; account: StudentAccountResult }>
  // Повтор уже выполненного запроса (ответ потерялся): кабинет есть, пароль показывался один раз.
  | Readonly<{ status: "already_created"; requestId: string; login: string }>
  // «unconfirmed»: ответ базы на завершение не пришёл — кабинет мог создаться, аккаунт поэтому не удаляется.
  | Readonly<{ status: "invalid" | "forbidden" | "email_taken" | "unavailable" | "unconfirmed"; requestId: string }>;

/** Отказы базы для кабинета по делу (343): у дела уже есть студент, дело закрыто, ушло приглашение, дело без продавца. */
export type StudentCaseAccountRefusal = "case_has_cabinet" | "case_closed" | "case_invite_exists" | "case_unsupported";

export type StudentCaseAccountActionState =
  | Readonly<{ status: "idle"; requestId: string }>
  | Readonly<{ status: "created"; requestId: string; account: StudentAccountResult }>
  | Readonly<{ status: "already_created"; requestId: string; login: string }>
  | Readonly<{
    status: "invalid" | "forbidden" | "email_taken" | "unavailable" | "unconfirmed" | StudentCaseAccountRefusal; requestId: string;
  }>;

const CASE_REFUSAL_WORDS: Readonly<Record<string, StudentCaseAccountRefusal>> = {
  student_case_has_cabinet: "case_has_cabinet",
  student_case_closed: "case_closed",
  student_case_invite_exists: "case_invite_exists",
  student_case_unsupported: "case_unsupported",
};

/** Слово отказа базы (343) — в отказ приложения; чужое слово — null. */
export function studentCaseRefusal(word: unknown): StudentCaseAccountRefusal | null {
  return typeof word === "string" && Object.hasOwn(CASE_REFUSAL_WORDS, word) ? CASE_REFUSAL_WORDS[word] : null;
}

export type StudentCaseCabinet = Readonly<{
  state: "open" | "bound" | "none";
  refusal: StudentCaseAccountRefusal | null;
  /** Чем студент входит (344): логин, иначе его почта; служебная почта сюда не попадает. */
  login: string | null;
  email: string | null;
}>;
export type CaseCabinetView = "form" | "open" | StudentCaseAccountRefusal;

/**
 * Что показать Admin в «Доступ к порталу» (343): форму, «Кабинет открыт» или причину, по которой кабинет здесь не
 * открыть. null — ничего: состояние не прочитано, студент привязан приглашением и ждёт анкету, или дело закрыто (об этом
 * уже говорит блок приглашения).
 */
export function caseCabinetView(cabinet: StudentCaseCabinet | null | undefined, caseState: string): CaseCabinetView | null {
  if (!cabinet || cabinet.state === "bound") return null;
  if (cabinet.state === "open") return "open";
  if (caseState === "closed") return null;
  return cabinet.refusal ?? "form";
}

const NAME_MAX = 60;

/** Имя и фамилия обязательны (из них логин), почта — по желанию. Невалидное — null. */
export function parseStudentAccountInput(firstName: string, lastName: string, email: string): StudentAccountInput | null {
  const first = firstName.trim().replace(/\s+/gu, " ");
  const last = lastName.trim().replace(/\s+/gu, " ");
  const mail = email.trim().toLowerCase();
  if (first.length === 0 || last.length === 0 || first.length > NAME_MAX || last.length > NAME_MAX) return null;
  if (/[\u0000-\u001f<>]/u.test(first + last)) return null;
  if (mail.length > 0 && (mail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(mail))) return null;
  return { firstName: first, lastName: last, email: mail.length > 0 ? mail : null };
}

export function isTechnicalStudentEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${TECHNICAL_STUDENT_EMAIL_DOMAIN}`);
}

/** Имя и фамилия, которые ввёл администратор, — из user_metadata; чужая форма — null. */
export function accountNamePrefill(userMetadata: unknown): Readonly<{ firstName: string; lastName: string }> | null {
  if (typeof userMetadata !== "object" || userMetadata === null) return null;
  const value = (userMetadata as Record<string, unknown>)[ACCOUNT_NAME_PREFILL_KEY];
  if (typeof value !== "object" || value === null) return null;
  const { firstName, lastName } = value as Record<string, unknown>;
  if (typeof firstName !== "string" || typeof lastName !== "string") return null;
  const parsed = parseStudentAccountInput(firstName, lastName, "");
  return parsed ? { firstName: parsed.firstName, lastName: parsed.lastName } : null;
}

/**
 * Имя и фамилия для кабинета по делу (343): из анкеты, если в ней есть оба поля, иначе из имени дела — первое слово
 * имя, остальное фамилия. Порядок в CRM бывает и «Фамилия Имя», поэтому форма показывает логин и админ правит.
 */
export function caseAccountNamePrefill(
  displayName: string,
  fields: readonly Readonly<{ key: string; value: string | null }>[] | null | undefined,
): Readonly<{ firstName: string; lastName: string }> {
  const field = (key: string) => fields?.find((item) => item.key === key)?.value?.trim() ?? "";
  const first = field("student_first_name");
  const last = field("student_last_name");
  if (first && last) return { firstName: first, lastName: last };
  const words = displayName.trim().split(/\s+/u).filter(Boolean);
  return { firstName: words[0] ?? "", lastName: words.slice(1).join(" ") };
}

/** Есть ли у пользователя Auth пометка временного пароля (app_metadata из сессии или токена). */
export function hasTemporaryPassword(appMetadata: unknown): boolean {
  return typeof appMetadata === "object" && appMetadata !== null
    && (appMetadata as Record<string, unknown>)[TEMPORARY_PASSWORD_FLAG] === true;
}

/** Сброс пароля студента администратором (344): новый временный пароль виден один раз и нигде не хранится. */
export type StudentPasswordResetActionState =
  | Readonly<{ status: "idle"; requestId: string }>
  | Readonly<{ status: "reset"; requestId: string; password: string }>
  // «already_reset»: этот запрос уже сбросил пароль, но ответ потерялся — пароль не показать, нужен новый сброс.
  | Readonly<{ status: "already_reset" | "invalid" | "forbidden" | "no_cabinet" | "unavailable"; requestId: string }>;

/** Сообщение для WhatsApp после сброса: чем входить (логин или почта) и новый временный пароль. */
export function studentPasswordResetMessage(
  signIn: Readonly<{ login: string | null; email: string | null }>,
  password: string,
  portalOrigin: string,
): string {
  const line = signIn.login ? `Логин: ${signIn.login}
` : signIn.email ? `Почта: ${signIn.email}
` : "";
  return `Здравствуйте! Пароль от вашего кабинета EVO сброшен: ${portalOrigin}/login
`
    + `${line}Временный пароль: ${password}
`
    + "При входе придумайте свой пароль.";
}

/** Сообщение для WhatsApp с логином и временным паролем. */
export function studentAccountMessage(account: Pick<StudentAccountResult, "firstName" | "login" | "password">, portalOrigin: string): string {
  return `Здравствуйте, ${account.firstName}! Ваш кабинет EVO: ${portalOrigin}/login\n`
    + `Логин: ${account.login}\nВременный пароль: ${account.password}\n`
    + "При первом входе придумайте свой пароль.";
}

/** Таблица для рассылки: «;» и BOM — Excel открывает кириллицу без настроек. */
export function studentAccountsCsv(accounts: readonly StudentAccountResult[], portalOrigin: string): string {
  const cell = (value: string) => `"${value.replace(/"/gu, '""')}"`;
  const rows = [["Фамилия", "Имя", "Логин", "Временный пароль", "Сообщение для WhatsApp"].map(cell).join(";")];
  for (const account of accounts) {
    rows.push([account.lastName, account.firstName, account.login, account.password, studentAccountMessage(account, portalOrigin)]
      .map(cell).join(";"));
  }
  return `﻿${rows.join("\r\n")}\r\n`;
}
