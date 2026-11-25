// Порт двух чистых правил `src/lib/student-account-contract.ts` веба (342): служебная почта кабинета без почты и
// подсказка имени от администратора. Почему порт, а не импорт: модуль веба импортирует `type PossibleDuplicate` из
// v3/possible-duplicates.ts, а тот тянет серверные модули (platform-auth: next/headers, @supabase/ssr). Импорт типа стирается
// при сборке и проходит страж общих импортов, но `tsc` приложения обходит и такие ссылки и падает на серверном коде
// (так же устроен порт application-contract.ts). Совпадение с вебом держит __tests__/account-identity-parity.test.ts.

/** Имя и фамилия от администратора в user_metadata: анкета подставляет их сама. Только подсказка, не право. */
export const ACCOUNT_NAME_PREFILL_KEY = "evo_name_prefill";

/** Служебная почта кабинета без почты: зона .invalid (RFC 2606), никуда не доставляется и студенту не показывается. */
export const TECHNICAL_STUDENT_EMAIL_DOMAIN = "students.evoadmissions.invalid";

const NAME_MAX = 60;

export function isTechnicalStudentEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${TECHNICAL_STUDENT_EMAIL_DOMAIN}`);
}

/** Имя и фамилия, которые ввёл администратор, - из user_metadata; чужая форма - null. */
export function accountNamePrefill(userMetadata: unknown): Readonly<{ firstName: string; lastName: string }> | null {
  if (typeof userMetadata !== "object" || userMetadata === null) return null;
  const value = (userMetadata as Record<string, unknown>)[ACCOUNT_NAME_PREFILL_KEY];
  if (typeof value !== "object" || value === null) return null;
  const { firstName, lastName } = value as Record<string, unknown>;
  if (typeof firstName !== "string" || typeof lastName !== "string") return null;
  // Как parseStudentAccountInput веба: пробелы схлопываются, имя и фамилия обязательны, до 60 знаков, без управляющих знаков и <>.
  const first = firstName.trim().replace(/\s+/gu, " ");
  const last = lastName.trim().replace(/\s+/gu, " ");
  if (first.length === 0 || last.length === 0 || first.length > NAME_MAX || last.length > NAME_MAX) return null;
  // Управляющие знаки в имени недопустимы (как в вебе).
  if (/[\u0000-\u001f<>]/u.test(first + last)) return null;
  return { firstName: first, lastName: last };
}
