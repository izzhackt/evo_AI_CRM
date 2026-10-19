/**
 * Разделы кабинета студента, чьи данные лёгкий опрос сверяет по версии
 * (A4, docs/PLAN_CHANGES.md 19.10.2026), и адрес опроса. Один модуль для
 * клиента (какой раздел опрашивать) и для сервера (какие значения принимать).
 */
export const STUDENT_PORTAL_UPDATES_PATH = "/api/portal/updates";

export const PORTAL_POLL_SECTIONS = ["home", "admission", "documents", "payments", "notifications", "messages"] as const;
export type PortalPollSection = (typeof PORTAL_POLL_SECTIONS)[number];

export function isPortalPollSection(value: unknown): value is PortalPollSection {
  return typeof value === "string" && (PORTAL_POLL_SECTIONS as readonly string[]).includes(value);
}

/** Раздел страницы, версию которого опрос сверяет; null — только колокольчик. */
export function portalPollSectionForPath(pathname: string): PortalPollSection | null {
  if (pathname === "/portal/home") return "home";
  if (pathname === "/portal") return "admission";
  if (pathname === "/portal/documents") return "documents";
  if (pathname === "/portal/payments") return "payments";
  if (pathname === "/portal/messages") return "messages";
  if (pathname === "/portal/notifications" || pathname.startsWith("/portal/notifications/")) return "notifications";
  return null;
}

export function portalPollUrl(section: PortalPollSection | null): string {
  return section === null ? STUDENT_PORTAL_UPDATES_PATH : `${STUDENT_PORTAL_UPDATES_PATH}?s=${section}`;
}

/** Событие страницы: версия переписки изменилась, тред читает свою страницу. */
export const PORTAL_MESSAGES_CHANGED_EVENT = "evo:portal-messages-changed";
