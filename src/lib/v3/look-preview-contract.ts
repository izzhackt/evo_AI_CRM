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

export function lookPreviewAllowed(actor: Pick<ActivePlatformActor, "systemRole" | "presentationRole">): boolean {
  return actor.systemRole === "admin" && !isStaffPreview(actor);
}

/** Новый облик включён: право Admin проверяется раньше cookie, и у остальных cookie ничего не значит. */
export function lookPreviewEnabled(actor: Pick<ActivePlatformActor, "systemRole" | "presentationRole">, cookieValue: string | undefined): boolean {
  return lookPreviewAllowed(actor) && cookieValue === LOOK_PREVIEW_VALUE;
}
