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
  | Readonly<{ status: "invalid" | "forbidden" | "email_taken" | "unavailable"; requestId: string }>;

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

/** Есть ли у пользователя Auth пометка временного пароля (app_metadata из сессии или токена). */
export function hasTemporaryPassword(appMetadata: unknown): boolean {
  return typeof appMetadata === "object" && appMetadata !== null
    && (appMetadata as Record<string, unknown>)[TEMPORARY_PASSWORD_FLAG] === true;
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
