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
