"use server";

import { isStaffPreview, staffHasPermission } from "../platform-access.ts";
import { requirePlatformStaffActor } from "../platform-guards";
import { listStaffTaskAssignees } from "../server/platform-staff-task-repository";

/**
 * Исполнители рабочей задачи для диалога «Новая задача» вне «Задач» (Э7):
 * оболочка, Ctrl+K, календарь, Lead 360. То же чтение и то же условие, что у
 * страницы «Задач» (`readStaffTaskWorkspace`: не просмотр роли и
 * `staff.task.create` → `staff_task_assignees` без задачи). Список —
 * подсказка формы: исполнителя проверяет сама команда `mutate_staff_task`.
 */
export async function readTaskComposerAssigneesAction() {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor) || !staffHasPermission(actor, "staff.task.create")) {
    return { status: "forbidden" as const, participants: [] };
  }
  try {
    return { status: "ready" as const, participants: await listStaffTaskAssignees(actor, null) };
  } catch {
    return { status: "unavailable" as const, participants: [] };
  }
}
