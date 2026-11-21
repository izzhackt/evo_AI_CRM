import "server-only";

import type { ActivePlatformActor } from "../platform-auth.ts";
import { readStaffTaskLeadContext, readStaffTaskLeadRefs, STAFF_TASK_LEAD_REFS_LIMIT, type StaffTaskLeadRef } from "../server/platform-staff-task-repository.ts";
import { isCallbackTaskTitle } from "./telephony-dial.ts";
import { callerDisplayName } from "./wording.ts";
import type { QueueTask } from "./task-queue.ts";
import { todayVisibleCount, type TodayItem, type TodayQueue } from "./today-queue.ts";

/**
 * Чей лид у рабочей задачи («Телефония Beeline KG», срез T8: задача «Перезвонить клиенту» несёт лид).
 * Строка «Сегодня» и «Задач» и панель задачи называют клиента и дают позвонить. Панель одной задачи читает
 * `staff_task_lead_context` под сессией сотрудника; строки списков — ОДНИМ чтением `staff_task_lead_refs_v1` (миграция 367),
 * которое внутри вызывает те же `staff_task_context` и `staff_task_lead_context`: чужой лид или закрытая задача не
 * отдают имени. Любой сбой — задача остаётся как была.
 */
export type TaskLeadRef = Readonly<{ leadId: string; name: string; href: string }>;

export function leadCardHref(leadId: string): string {
  return `/profile?id=${encodeURIComponent(leadId)}`;
}

/** Имя лида под сессией сотрудника; null — лид закрыт, недоступен или чтение не удалось. */
export async function readLeadRef(actor: ActivePlatformActor, leadId: string): Promise<TaskLeadRef | null> {
  try {
    const lead = await readStaffTaskLeadContext(actor, leadId);
    // Лид, которого завёл звонок с неизвестного номера, называется здесь так же, как в «Заявках» и в «Сегодня».
    return Object.freeze({ leadId: lead.leadId, name: callerDisplayName(lead.clientDisplayName), href: leadCardHref(lead.leadId) });
  } catch {
    return null;
  }
}

/**
 * Лиды рабочих задач по ключу строки одним чтением базы (не больше `STAFF_TASK_LEAD_REFS_LIMIT` задач); у задачи без лида
 * и у задачи или лида, которых сотрудник не читает, записи нет. Сбой чтения — пустой ответ: строки остаются без клиента.
 */
export async function readTaskLeadRefs(actor: ActivePlatformActor, tasks: readonly Readonly<{ key: string; id: string }>[]): Promise<Readonly<Record<string, TaskLeadRef>>> {
  if (tasks.length === 0) return Object.freeze({});
  try {
    // The database refuses repeated ids (22023): each task is asked once; a repeated row shares the answer.
    const ids = [...new Set(tasks.map((task) => task.id.toLowerCase()))].slice(0, STAFF_TASK_LEAD_REFS_LIMIT);
    const refs = await readStaffTaskLeadRefs(actor, ids);
    const byTask = new Map<string, StaffTaskLeadRef>(refs.map((ref) => [ref.taskId, ref]));
    return Object.freeze(Object.fromEntries(tasks.flatMap((task): [string, TaskLeadRef][] => {
      const ref = byTask.get(task.id.toLowerCase());
      return ref ? [[task.key, Object.freeze({ leadId: ref.leadId, name: callerDisplayName(ref.clientDisplayName), href: leadCardHref(ref.leadId) })]] : [];
    })));
  } catch {
    return Object.freeze({});
  }
}

/**
 * Лиды рабочих задач «Сегодня» по ключу строки (`staff:<id>`): только у задач-перезвонов самой телефонии
 * (`isCallbackTaskTitle`) — остальные рабочие задачи не читаются вовсе, на «Сегодня» это не лишние чтения базы.
 * Читаются только строки, видимые сразу (окно группы, `todayVisibleCount`), и не больше `TODAY_TASK_LEAD_CAP` по
 * порядку групп. Строки за «Показать ещё» и сверх предела читаются без клиента — это дальняя часть очереди, а не её начало.
 * Все они читаются ОДНИМ запросом к базе, а не двумя на задачу.
 */
export const TODAY_TASK_LEAD_CAP = 15;

/** Задача-перезвон телефонии, которую строка «Сегодня» несёт сама (`staff:<id>`). */
function callbackTask(item: Pick<TodayItem, "key" | "task">): boolean {
  return item.task?.kind === "staff" && item.task.key === item.key && isCallbackTaskTitle(item.task.title);
}

/**
 * Лиды, начатые заранее: страница стартует чтение, как только прочитан источник задач, не дожидаясь остальных источников и
 * сборки групп. Группы ещё не известны, поэтому берутся задачи-перезвоны источника по порядку (не больше
 * `TODAY_TASK_LEAD_PREFETCH_CAP`); `readTodayTaskLeads` потом оставляет из них ровно те, что видны, и дочитывает недостающие.
 */
export type TodayTaskLeadPrefetch = Readonly<{
  /** Ключи строк, для которых чтение начато. */
  keys: ReadonlySet<string>;
  /** Никогда не отклоняется: сбой — пустой ответ. */
  refs: Promise<Readonly<Record<string, TaskLeadRef>>>;
}>;

export const TODAY_TASK_LEAD_PREFETCH_CAP = 30;

export function prefetchTodayTaskLeads(actor: ActivePlatformActor, items: readonly TodayItem[]): TodayTaskLeadPrefetch {
  const tasks = items.filter(callbackTask).slice(0, TODAY_TASK_LEAD_PREFETCH_CAP).map((item) => ({ key: item.key, id: item.task!.id }));
  return Object.freeze({ keys: new Set(tasks.map((task) => task.key)), refs: readTaskLeadRefs(actor, tasks) });
}

export async function readTodayTaskLeads(
  actor: ActivePlatformActor,
  queue: Pick<TodayQueue, "bands">,
  prefetch: TodayTaskLeadPrefetch | null = null,
): Promise<Readonly<Record<string, TaskLeadRef>>> {
  const tasks = queue.bands
    .flatMap((band) => band.items.slice(0, todayVisibleCount(band.items.length, false)))
    .filter(callbackTask)
    .slice(0, TODAY_TASK_LEAD_CAP);
  const early = prefetch ? await prefetch.refs : {};
  const late = await readTaskLeadRefs(actor, tasks.filter((item) => !prefetch?.keys.has(item.key)).map((item) => ({ key: item.key, id: item.task!.id })));
  const found = { ...early, ...late };
  return Object.freeze(Object.fromEntries(tasks.flatMap((item): [string, TaskLeadRef][] => (item.key in found ? [[item.key, found[item.key]]] : []))));
}

/**
 * Сколько задач списка «Задач» перечитывается за раз: первые по порядку списка; у остальных строка остаётся без клиента.
 * Как у «Сегодня» (`TODAY_TASK_LEAD_CAP`): одно чтение базы на весь список; больше 15 строк с клиентом не нужно.
 */
const QUEUE_LEAD_LIMIT = TODAY_TASK_LEAD_CAP;

/**
 * Лиды задач-перезвонов в списке «Задач» по ключу строки (`staff:<id>`): строка называет клиента и даёт
 * позвонить, как на «Сегодня». Читаются только задачи самой телефонии (`isCallbackTaskTitle`), первые по порядку списка.
 */
export async function readQueueTaskLeads(actor: ActivePlatformActor, tasks: readonly QueueTask[]): Promise<Readonly<Record<string, TaskLeadRef>>> {
  const callbacks = tasks
    .filter((task) => task.kind === "staff" && isCallbackTaskTitle(task.title))
    .slice(0, QUEUE_LEAD_LIMIT);
  return readTaskLeadRefs(actor, callbacks);
}
