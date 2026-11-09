/**
 * Чистые помощники экрана «Профиль» (PORT-5a, план §6 «Профиль», §13).
 * Серверный контракт — миграция 196. Файл клиент-безопасный.
 */

export type PortalLanguage = "ru" | "ky";

export type PortalProfile = Readonly<{
  displayName: string;
  email: string;
  portalLanguage: PortalLanguage;
  caseState: "pending" | "active" | "closed" | null;
  /** Открытый запрос удаления аккаунта; null — запроса нет. */
  deletionRequestedAt: string | null;
}>;

export type PortalLanguageActionResult =
  | Readonly<{ ok: true; portalLanguage: PortalLanguage }>
  | Readonly<{ ok: false }>;

export function isPortalLanguage(value: unknown): value is PortalLanguage {
  return value === "ru" || value === "ky";
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && !Number.isNaN(Date.parse(value))
  );
}

/** Строгий разбор get_own_portal_profile_v1: любое отклонение формы — null. */
export function parsePortalProfile(value: unknown): PortalProfile | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (
    keys.join(",")
    !== "caseState,deletionRequestedAt,displayName,email,portalLanguage"
  ) return null;
  if (
    typeof row.displayName !== "string" || row.displayName.trim().length === 0
    || typeof row.email !== "string" || row.email.trim().length === 0
    || !isPortalLanguage(row.portalLanguage)
    || !(row.caseState === null
      || row.caseState === "pending" || row.caseState === "active" || row.caseState === "closed")
    || !(row.deletionRequestedAt === null || timestamp(row.deletionRequestedAt))
  ) return null;
  return {
    displayName: row.displayName,
    email: row.email,
    portalLanguage: row.portalLanguage,
    caseState: row.caseState,
    deletionRequestedAt: row.deletionRequestedAt,
  };
}

/**
 * «Имя и фамилия» в «Профиле» (356, 09.11.2026): студент правит их сам, логин для входа не меняется. Те же правила, что
 * у команды базы: обрезка, пробелы внутри — один, 1–60 знаков, хотя бы одна буква, без управляющих символов.
 */
export const PORTAL_NAME_MAX = 60;

export type PortalNameState = Readonly<{
  status: "idle" | "done" | "invalid" | "unavailable";
  /** Новое имя в кабинете после записи (`done`). */
  displayName?: string;
}>;

export function normalizePortalNamePart(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/\s+/gu, " ");
  if (value.length < 1 || value.length > PORTAL_NAME_MAX) return null;
  if (!/\p{L}/u.test(value) || /\p{Cc}/u.test(value)) return null;
  return value;
}

/** Подстановка в форму: первое слово — имя, остальное — фамилия. «Student» — заглушка кабинета без фамилии. */
export function splitPortalDisplayName(displayName: string): Readonly<{ firstName: string; lastName: string }> {
  const [first = "", ...rest] = displayName.trim().split(/\s+/u);
  const last = rest.join(" ");
  return { firstName: first, lastName: last.toLowerCase() === "student" ? "" : last };
}
