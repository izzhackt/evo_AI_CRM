/**
 * Дело студента «сначала работа» (решение владельца 26.09.2026,
 * docs/PLAN_CHANGES.md): чистая логика вида дела без React — строки
 * «Обзора» из уже прочитанных данных. По ней работают страница, статический
 * рендер и unit-тест. Новых чтений и команд здесь нет.
 */
import type { PlatformAdmissionsTask } from "../../../lib/platform-admissions-task-contract.ts";
import type { PlatformApplicationQueueRow } from "../../../lib/platform-application-contract.ts";
import type { CaseChatMessage, CaseChatPage } from "../../../lib/platform-case-chat-contract.ts";
import type { StudentCaseChecklistCounts, StudentCaseQueueRow } from "../../../lib/platform-student-case-queue-contract.ts";
import type { StudentApplication } from "../../../lib/student-application-contract.ts";
import { dayInOrganizationTimezone } from "../../../lib/platform-task-deadline.ts";
import { compareQueueTasks, taskIsOpen, type QueueTask } from "../../../lib/v3/task-queue.ts";
import { formatQueueDay } from "../queue/due-bucket.ts";
import type { DocumentGroup } from "./document-types.ts";

/**
 * Строка дела из очереди 241 — этап, срок шага и версия для редактора шага.
 * `null` — строка не прочитана: этапа и редактора нет, шаг показывается из
 * самого дела без срока («нет чтения — нет числа»).
 */
export type CaseWorkRow = StudentCaseQueueRow | null;

/** Открытые задачи дела в порядке «Задач»; «недоступно» — это не «задач нет». */
export type CaseWorkTasks =
  | Readonly<{ kind: "ready"; tasks: readonly QueueTask[]; assignees: readonly Readonly<{ membershipId: string; displayName: string }>[] }>
  | Readonly<{ kind: "unavailable" }>;

/** Последнее сообщение переписки по делу и её отметка. */
export type CaseWorkChatLine = Readonly<{
  authorName: string;
  /** Сообщение этого сотрудника: вместо имени — «Вы». */
  mine: boolean;
  /** Одна строка, до 140 знаков; вложение без текста — его подпись. */
  text: string;
  createdAt: string;
}>;

export type CaseWorkChat =
  | Readonly<{ kind: "ready"; awaitState: CaseChatPage["thread"]["awaitState"]; last: CaseWorkChatLine | null }>
  | Readonly<{ kind: "forbidden" }>
  | Readonly<{ kind: "unavailable" }>;

/** Всё, что вид дела читает сверх профиля (`readProfileTarget`). */
export type CaseWorkRead = Readonly<{
  row: CaseWorkRow;
  tasks: CaseWorkTasks;
  chat: CaseWorkChat;
  /** Admin выбирает куратора (флаг `needs_curator` чтения 182). */
  needsCurator: boolean;
  /** Открытый запрос удаления аккаунта из портала (чтение 196, только Admin). */
  deletionRequested: boolean;
  /** Сегодня в Бишкеке. */
  today: string;
  /** Момент чтения: одинаковые сроки при рендере и гидрации. */
  nowIso: string;
}>;

/** Задача дела в строке «Задач» (`TaskQueueRow`): тот же вид, что даёт очередь задач по студентам. */
export function caseQueueTask(
  task: PlatformAdmissionsTask,
  studentDisplayName: string,
  caseState: "pending" | "active" | "closed",
): QueueTask {
  return Object.freeze({
    kind: "case", key: `case:${task.caseTaskId}`, id: task.caseTaskId, title: task.title, description: null,
    status: task.status, priority: task.priority, dueOn: task.dueOn, dueAt: task.dueAt, version: task.version,
    assigneeMembershipId: task.assigneeMembershipId, assigneeDisplayName: task.assigneeDisplayName,
    creatorMembershipId: null, studentCaseId: task.studentCaseId, studentDisplayName,
    caseState: caseState === "pending" ? null : caseState, studentVisible: task.studentVisible,
    fromChat: false, updatedAt: task.updatedAt,
  });
}

/** Открытые задачи дела по сроку, как в «Задачах»: просроченные первыми, без срока — в конце. */
export function caseOpenTasks(
  tasks: readonly PlatformAdmissionsTask[],
  studentDisplayName: string,
  caseState: "pending" | "active" | "closed",
): readonly QueueTask[] {
  return Object.freeze(tasks
    .filter((task) => taskIsOpen(task.status))
    .map((task) => caseQueueTask(task, studentDisplayName, caseState))
    .sort(compareQueueTasks("open")));
}

/** Сколько открытых задач «Обзор» показывает сразу; остальные — по «Показать ещё». */
export const CASE_TASKS_SHOWN = 6;

/**
 * Числа чек-листа из уже прочитанных документов дела — те же, что строка
 * очереди 241 считает по `document_slots` (удалённые пункты не входят).
 */
export function caseChecklistCounts(groups: readonly DocumentGroup[]): StudentCaseChecklistCounts {
  const counts = { total: 0, submitted: 0, correctionRequired: 0, rejected: 0, approved: 0, missing: 0 };
  for (const group of groups) {
    if (group.kind !== "active") continue;
    for (const item of group.items) {
      counts.total += 1;
      if (item.status === "submitted") counts.submitted += 1;
      else if (item.status === "correction_required") counts.correctionRequired += 1;
      else if (item.status === "rejected") counts.rejected += 1;
      else if (item.status === "approved") counts.approved += 1;
      else counts.missing += 1;
    }
  }
  return Object.freeze(counts);
}

function oneLine(value: string, limit: number): string {
  const text = value.replace(/\s+/gu, " ").trim();
  return Array.from(text).length > limit ? `${Array.from(text).slice(0, limit - 1).join("")}…` : text;
}

/**
 * Строка «Переписки» из страницы чтения `case_chat_read_page_v1`: последнее
 * сообщение и отметка. Чтение страницы ничего не пишет — отметку о
 * прочтении ставит только открытая переписка.
 */
export function caseChatWork(page: CaseChatPage, actorMembershipId: string): CaseWorkChat {
  const last: CaseChatMessage | null = page.messages.reduce<CaseChatMessage | null>(
    (latest, message) => latest === null || BigInt(message.sequenceId) > BigInt(latest.sequenceId) ? message : latest,
    null,
  );
  return Object.freeze({
    kind: "ready",
    awaitState: page.thread.awaitState,
    last: last === null ? null : Object.freeze({
      authorName: last.authorName,
      mine: last.authorMembershipId === actorMembershipId,
      text: oneLine(last.body || last.attachmentLabel || "Вложение", 140),
      createdAt: last.createdAt,
    }),
  });
}

const BISHKEK_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bishkek", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Момент в плотной строке: «22.09 14:30» по Бишкеку; год — только не текущий («03.01.27 09:00»). */
export function caseMomentLabel(iso: string, today: string): string {
  const moment = new Date(iso);
  return `${formatQueueDay(dayInOrganizationTimezone(moment), today)} ${BISHKEK_TIME.format(moment)}`;
}

/** Заявка «Обзора» одной строкой: вуз · программа, статус, основной вариант и дедлайн. */
export type CaseApplicationLine = Readonly<{
  id: string;
  title: string;
  status: string;
  primary: boolean;
  deadlineOn: string | null;
}>;

/** Основной вариант первым, остальные — в порядке чтения. */
export function caseApplicationLines(applications: readonly PlatformApplicationQueueRow[]): readonly CaseApplicationLine[] {
  return Object.freeze([...applications]
    .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary))
    .map((application) => Object.freeze({
      id: application.universityApplicationId,
      title: application.programName ? `${application.institutionName} · ${application.programName}` : application.institutionName,
      status: application.status,
      primary: application.isPrimary,
      deadlineOn: application.universityDeadlineOn,
    })));
}

/**
 * Состояние «Доступа к порталу» одним словом. Сам доступ проверяет только
 * кнопка в «Настроить»: без анкеты состояние не прочитано, и строка это
 * называет, а не угадывает.
 */
export function casePortalStatus(application: StudentApplication | null): Readonly<{ text: string; tone: "muted" | "warn" | "ok" }> {
  if (application === null) return { text: "не проверен", tone: "muted" };
  if (application.status === "approved") return { text: "анкета одобрена", tone: "ok" };
  if (application.status === "rejected") return { text: "анкета отклонена", tone: "muted" };
  return { text: "анкета ждёт решения", tone: "warn" };
}
