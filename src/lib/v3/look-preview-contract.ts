import { isStaffPreview } from "../platform-access.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";

/**
 * Предпросмотр нового облика (Э1.1 плана редизайна 25.09.2026) — временное
 * сосуществование двух обликов до решения владельца (Э1.5). Включается только
 * Admin вне просмотра роли; для всех остальных cookie ничего не значит.
 * Это настройка вида одного браузера, а не данные.
 */
export const LOOK_PREVIEW_COOKIE = "evo_look_preview";
export const LOOK_PREVIEW_VALUE = "next";

/** Включать и выключать предпросмотр может только Admin вне просмотра роли. */
export function lookPreviewAllowed(actor: Pick<ActivePlatformActor, "systemRole" | "presentationRole">): boolean {
  return actor.systemRole === "admin" && !isStaffPreview(actor);
}

/**
 * Кто видит включённый предпросмотр: Admin — и вне просмотра роли, и в нём
 * (Э1.2, 26.09.2026: владелец смотрит меню и вкладки каждой роли в новом
 * облике). Осознанное обратимое изменение правила #1062: вернуть прежнее —
 * заменить эту проверку на `lookPreviewAllowed`.
 */
export function lookPreviewVisible(actor: Pick<ActivePlatformActor, "systemRole" | "presentationRole">): boolean {
  return actor.systemRole === "admin";
}

/** Новый облик включён: право Admin проверяется раньше cookie, и у остальных cookie ничего не значит. */
export function lookPreviewEnabled(actor: Pick<ActivePlatformActor, "systemRole" | "presentationRole">, cookieValue: string | undefined): boolean {
  return lookPreviewVisible(actor) && cookieValue === LOOK_PREVIEW_VALUE;
}
