import "server-only";

import type { ActivePlatformActor } from "../platform-auth.ts";
import { readStaffTaskContext, readStaffTaskLeadContext } from "../server/platform-staff-task-repository.ts";
import type { TodayQueue } from "./today-queue.ts";

/**
 * Чей лид у рабочей задачи («Телефония Beeline KG», срез T8: задача «Перезвонить клиенту» несёт лид).
 * Строка «Сегодня» и панель задачи называют клиента и дают позвонить — вместо слова «Рабочая». Читает
 * те же `staff_task_context` и `staff_task_lead_context`, что страница «Задач», каждую под сессией
 * сотрудника: чужой лид или закрытая задача не отдают имени. Любой сбой — задача остаётся как была.
 */
export type TaskLeadRef = Readonly<{ leadId: string; name: string; href: string }>;

/** Сколько задач «Сегодня» перечитывается за раз: у остальных всё остаётся как было. */
const TASK_LEAD_LIMIT = 12;

export function leadCardHref(leadId: string): string {
  return `/v3/profile?id=${encodeURIComponent(leadId)}`;
}

/** Имя лида под сессией сотрудника; null — лид закрыт, недоступен или чтение не удалось. */
export async function readLeadRef(actor: ActivePlatformActor, leadId: string): Promise<TaskLeadRef | null> {
  try {
    const lead = await readStaffTaskLeadContext(actor, leadId);
    return Object.freeze({ leadId: lead.leadId, name: lead.clientDisplayName, href: leadCardHref(lead.leadId) });
  } catch {
    return null;
  }
}

/** Лид одной рабочей задачи; null — задача лида не несёт или чтение не удалось. */
export async function readTaskLeadRef(actor: ActivePlatformActor, taskId: string): Promise<TaskLeadRef | null> {
  try {
    const context = await readStaffTaskContext(actor, taskId);
    return context.leadId === null ? null : await readLeadRef(actor, context.leadId);
  } catch {
    return null;
  }
}

/** Лиды рабочих задач «Сегодня» по ключу строки (`staff:<id>`): только у задач, которые несут лид. */
export async function readTodayTaskLeads(actor: ActivePlatformActor, queue: TodayQueue): Promise<Readonly<Record<string, TaskLeadRef>>> {
  const tasks = queue.bands
    .flatMap((band) => band.items)
    .filter((item) => item.task?.kind === "staff" && item.task.key === item.key)
    .slice(0, TASK_LEAD_LIMIT);
  const refs = await Promise.all(tasks.map(async (item) => [item.key, await readTaskLeadRef(actor, item.task!.id)] as const));
  return Object.freeze(Object.fromEntries(refs.filter((entry): entry is readonly [string, TaskLeadRef] => entry[1] !== null)));
}
