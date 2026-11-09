// Личная ссылка регистрации (решение владельца 07.11, миграция 341):
// https://app.evoadmissions.com/apply?invite=<32 символа>. Приложение открывается
// по universal link / App Link, по своей схеме evoadmissions://apply?invite=… и
// по ссылке или токену, вставленным вручную. Чистая логика без React.

/** Токен: ровно 32 символа base64url (src/lib/server/student-registration-link.ts). */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export const INVITE_WEB_HOST = "app.evoadmissions.com";
export const INVITE_APP_SCHEME = "evoadmissions";

export function isInviteToken(value: unknown): value is string {
  return typeof value === "string" && INVITE_TOKEN_PATTERN.test(value);
}

function queryInvite(query: string): string | null {
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    if (pair.slice(0, eq) !== "invite") continue;
    let value = pair.slice(eq + 1);
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
    return isInviteToken(value) ? value : null;
  }
  return null;
}

/**
 * Токен из того, что пришло: сам токен, ссылка https://app.evoadmissions.com/apply?invite=…,
 * evoadmissions://apply?invite=… или текст письма/WhatsApp, где ссылка стоит среди слов.
 * Любая другая страница и любой другой хост дают null: токен чужого сайта не принимается.
 */
export function parseInviteToken(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (text === "") return null;
  if (isInviteToken(text)) return text;
  const link = /(https?|evoadmissions):\/\/[^\s<>"')]+/i.exec(text);
  if (!link) return null;
  const match = /^([a-z]+):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i.exec(link[0]);
  if (!match) return null;
  const [, scheme, authority, path, query = ""] = match;
  const lower = scheme.toLowerCase();
  if (lower === "https") {
    if (authority.toLowerCase() !== INVITE_WEB_HOST) return null;
    if (path.replace(/\/+$/, "") !== "/apply") return null;
  } else if (lower === INVITE_APP_SCHEME) {
    // evoadmissions://apply?invite=… : «apply» стоит на месте хоста.
    const route = `${authority}${path}`.replace(/\/+$/, "");
    if (route !== "apply") return null;
  } else {
    return null;
  }
  return queryInvite(query);
}

/** Параметр маршрута expo-router (строка или массив) в токен. */
export function inviteFromParam(param: string | readonly string[] | undefined): string | null {
  const value = Array.isArray(param) ? param[0] : param;
  return typeof value === "string" && isInviteToken(value) ? value : null;
}
