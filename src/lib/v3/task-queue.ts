/**
 * Одна очередь «Задач» (25.09.2026): рабочие задачи и задачи по студентам в
 * одном списке по сроку.
 *
 * Только модель чтения: у каждого вида остаётся свой канонический путь записи.
 * Сервер отдаёт рабочие задачи уже отфильтрованными по виду и состоянию
 * (`staff_task_list`), а очередь задач по студентам (`staff_case_task_queue`)
 * — всё, что сотруднику разрешено, без параметров исполнителя и состояния.
 * Эти фильтры применяются здесь, внутри уже разрешённого чтения: доступ не
 * расширяется. Файл чистый — без React и сервера, его проверяет unit-тест.
 */
import type { PlatformAdmissionsTaskQueueRow, PlatformCaseTaskPriority, PlatformCaseTaskStatus } from "../platform-admissions-task-contract.ts";
import type { StaffTask } from "../platform-staff-task-contract.ts";
import { platformTaskDeadlineSortTime } from "../platform-task-deadline.ts";
import { DUE_BUCKETS, dueBucket, parseDueFilter, type DueBucket, type DueFilter } from "../../components/v3/queue/due-bucket.ts";

export const TASK_QUEUE_VIEWS = ["mine", "created", "all"] as const;
export type TaskQueueView = (typeof TASK_QUEUE_VIEWS)[number];
export type TaskQueueState = "open" | "done";
export type TaskQueueKind = "staff" | "case";
/** Окно чтения: 1 — обычный предел, 2 и 4 — «Показать больше задач». */
export const TASK_QUEUE_WINDOWS = [1, 2, 4] as const;
export type TaskQueueWindow = (typeof TASK_QUEUE_WINDOWS)[number];

export type TaskQueueFilters = Readonly<{
  view: TaskQueueView;
  state: TaskQueueState;
  /** null — оба вида. */
  type: TaskQueueKind | null;
  /** null — любой срок. У завершённых задач не применяется. */
  due: DueFilter | null;
  query: string;
  window: TaskQueueWindow;
}>;

export const TASK_QUEUE_QUERY_MAX = 200;

/**
 * Разбор адреса. Старые ссылки продолжают работать: `status=active|all` —
 * открытые, `status=completed` — завершённые, `status=overdue` — открытые с
 * фильтром «Просрочено». «Вся команда» без права на неё становится «Мои».
 */
export function parseTaskQueueFilters(
  read: (key: string) => string | undefined,
  options: Readonly<{ teamView: boolean }>,
): TaskQueueFilters {
  const rawView = read("view");
  const view: TaskQueueView = rawView === "created" ? "created"
    : rawView === "all" && options.teamView ? "all"
    : "mine";
  const status = read("status");
  const state: TaskQueueState = status === "done" || status === "completed" ? "done" : "open";
  const rawType = read("type");
  const type = rawType === "case" || rawType === "staff" ? rawType : null;
  const due = state === "open" ? parseDueFilter(read("due")) ?? (status === "overdue" ? "overdue" : null) : null;
  const query = (read("q") ?? "").trim().slice(0, TASK_QUEUE_QUERY_MAX);
  const rawWindow = Number(read("window"));
  const window = TASK_QUEUE_WINDOWS.find((value) => value === rawWindow) ?? 1;
  return Object.freeze({ view, state, type, due, query, window });
}

/** Параметры адреса для этого набора фильтров; значения по умолчанию опущены. */
export function taskQueueParams(filters: TaskQueueFilters): Record<string, string | null> {
  return {
    view: filters.view === "mine" ? null : filters.view,
    type: filters.type,
    status: filters.state === "done" ? "done" : null,
    due: filters.due,
    q: filters.query || null,
    window: filters.window === 1 ? null : String(filters.window),
  };
}

export type QueueTask = Readonly<{
  kind: TaskQueueKind;
  /** `staff:<id>` или `case:<id>` — один ключ на строку, панель и фокус. */
  key: string;
  id: string;
  title: string;
  description: string | null;
  status: PlatformCaseTaskStatus;
  priority: PlatformCaseTaskPriority;
  dueOn: string | null;
  dueAt: string | null;
  version: string;
  assigneeMembershipId: string;
  assigneeDisplayName: string;
  /** Автор есть только у рабочей задачи: очередь по студентам его не читает. */
  creatorMembershipId: string | null;
  studentCaseId: string | null;
  studentDisplayName: string | null;
  caseState: "active" | "closed" | null;
  studentVisible: boolean | null;
  fromChat: boolean;
  updatedAt: string;
}>;

export function queueTaskFromStaff(task: StaffTask): QueueTask {
  return Object.freeze({
    kind: "staff", key: `staff:${task.id}`, id: task.id, title: task.title, description: task.description,
    status: task.status, priority: task.priority, dueOn: task.dueOn, dueAt: task.dueAt, version: task.version,
    assigneeMembershipId: task.assigneeMembershipId, assigneeDisplayName: task.assigneeDisplayName,
    creatorMembershipId: task.creatorMembershipId, studentCaseId: null, studentDisplayName: null,
    caseState: null, studentVisible: null, fromChat: task.sourceMessageId !== null, updatedAt: task.updatedAt,
  });
}

export function queueTaskFromCase(row: PlatformAdmissionsTaskQueueRow): QueueTask {
  return Object.freeze({
    kind: "case", key: `case:${row.caseTaskId}`, id: row.caseTaskId, title: row.title, description: null,
    status: row.status, priority: row.priority, dueOn: row.dueOn, dueAt: row.dueAt, version: row.version,
    assigneeMembershipId: row.assigneeMembershipId, assigneeDisplayName: row.assigneeDisplayName,
    creatorMembershipId: null, studentCaseId: row.studentCaseId, studentDisplayName: row.studentDisplayName,
    caseState: row.caseState, studentVisible: row.studentVisible, fromChat: false, updatedAt: row.updatedAt,
  });
}

export function taskIsOpen(status: PlatformCaseTaskStatus): boolean {
  return status !== "done" && status !== "cancelled";
}

function inView(task: QueueTask, view: TaskQueueView, actorMembershipId: string): boolean {
  if (view === "mine") return task.assigneeMembershipId === actorMembershipId;
  if (view === "created") return task.kind === "staff" && task.creatorMembershipId === actorMembershipId;
  return true;
}

function matchesQuery(task: QueueTask, query: string): boolean {
  if (!query) return true;
  const needle = query.toLocaleLowerCase("ru");
  return [task.title, task.studentDisplayName, task.assigneeDisplayName]
    .some((value) => value !== null && value.toLocaleLowerCase("ru").includes(needle));
}

/** Открытые — по сроку, без срока в конце (как канонические очереди); закрытые — последние изменения сверху. */
export function compareQueueTasks(state: TaskQueueState) {
  return (left: QueueTask, right: QueueTask): number => {
    if (state === "open") {
      const due = platformTaskDeadlineSortTime(left.dueOn, left.dueAt) - platformTaskDeadlineSortTime(right.dueOn, right.dueAt);
      if (due !== 0) return due;
    } else if (left.updatedAt !== right.updatedAt) {
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    }
    if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  };
}

export type TaskQueueBand = Readonly<{ bucket: DueBucket; rows: readonly QueueTask[] }>;
export type TaskQueueCounts = Readonly<Record<TaskQueueView, number | null>>;

export type TaskQueue = Readonly<{
  rows: readonly QueueTask[];
  /** Открытые — группы по сроку в порядке `DUE_BUCKETS`; завершённые — одна группа. */
  bands: readonly TaskQueueBand[];
  /** Числа вкладок. null — чтение этого вида не выполнялось или неполное. */
  counts: TaskQueueCounts;
  complete: boolean;
}>;

/**
 * Слияние двух чтений в одну очередь. `complete` — оба чтения дошли до конца:
 * только тогда у групп и вкладок есть числа.
 */
export function buildTaskQueue(input: Readonly<{
  staff: readonly StaffTask[];
  cases: readonly PlatformAdmissionsTaskQueueRow[];
  filters: TaskQueueFilters;
  actorMembershipId: string;
  now: Date;
  complete: boolean;
}>): TaskQueue {
  const { filters, actorMembershipId, now } = input;
  const open = filters.state === "open";
  const seen = new Set<string>();
  const candidates = [...input.staff.map(queueTaskFromStaff), ...input.cases.map(queueTaskFromCase)].filter((task) => {
    if (seen.has(task.key)) throw new Error("Task queue received a duplicate task.");
    seen.add(task.key);
    return taskIsOpen(task.status) === open
      && (filters.type === null || task.kind === filters.type)
      && (filters.due === null || !open || dueBucket(task, now, true) === filters.due)
      && matchesQuery(task, filters.query);
  });
  const rows = candidates.filter((task) => inView(task, filters.view, actorMembershipId)).sort(compareQueueTasks(filters.state));
  const bands: TaskQueueBand[] = open
    ? DUE_BUCKETS.map((bucket) => ({ bucket, rows: rows.filter((task) => dueBucket(task, now, true) === bucket) }))
      .filter((band) => band.rows.length > 0)
    : rows.length ? [{ bucket: "past", rows }] : [];
  // Вся команда — надмножество «Моих» и «Поставил я»: их числа честно
  // выводятся из того же полного чтения. Обратное неверно.
  const count = (view: TaskQueueView) => candidates.filter((task) => inView(task, view, actorMembershipId)).length;
  const counts: TaskQueueCounts = !input.complete
    ? { mine: null, created: null, all: null }
    : filters.view === "all"
      ? { mine: count("mine"), created: count("created"), all: rows.length }
      : { mine: filters.view === "mine" ? rows.length : null, created: filters.view === "created" ? rows.length : null, all: null };
  return Object.freeze({ rows: Object.freeze(rows), bands: Object.freeze(bands), counts: Object.freeze(counts), complete: input.complete });
}
