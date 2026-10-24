import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";

/**
 * Кто может создать задачу из оболочки: те же условия, что у страницы «Задач».
 * Модуль без "use client": условия читает и серверная страница (кнопка «Сделать
 * задачей» под ответом ИИ-агента), и диалог оболочки, и палитра команд.
 */
export function taskComposerAccess(actor: ActivePlatformActor) {
  const preview = isStaffPreview(actor);
  return {
    staff: !preview && staffHasPermission(actor, "staff.task.create"),
    case: !preview && staffPresentationCan(actor, "admissions.read") && staffHasPermission(actor, "task.create"),
  };
}
