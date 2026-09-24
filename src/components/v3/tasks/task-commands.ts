/**
 * Формы существующих команд задач: `mutate_staff_task` (через
 * `mutateStaffTaskAction`) и `change_case_task` (через
 * `changePlatformAdmissionsTaskAction`). Новых команд нет — строка очереди и
 * панель собирают ровно те поля, которые эти действия уже принимают. Файл
 * чистый (только FormData), его проверяет unit-тест.
 */
import type { PlatformCaseTaskPriority, PlatformCaseTaskStatus } from "../../../lib/platform-admissions-task-contract.ts";
import { dayInOrganizationTimezone, projectPlatformTaskDeadline } from "../../../lib/platform-task-deadline.ts";
import { shiftDay } from "../calendar/types.ts";

export type DeadlineKind = "none" | "all_day" | "timed";
export type DeadlineFieldValues = Readonly<{ deadlineKind: DeadlineKind; dueOn: string; dueAt: string }>;

type StaffTaskFields = Readonly<{
  id: string;
  version: string;
  title: string;
  description: string | null;
  priority: PlatformCaseTaskPriority;
  status: PlatformCaseTaskStatus;
  assigneeMembershipId: string;
}>;

type CaseTaskFields = Readonly<{
  id: string;
  version: string;
  studentCaseId: string;
  priority: PlatformCaseTaskPriority;
  status: PlatformCaseTaskStatus;
  assigneeMembershipId: string;
  studentVisible: boolean;
  dueOn: string | null;
  dueAt: string | null;
}>;

export function deadlineKindOf(task: Readonly<{ dueOn: string | null; dueAt: string | null }>): DeadlineKind {
  if (task.dueOn !== null) return "all_day";
  if (task.dueAt !== null) return "timed";
  return "none";
}

/** Текущий срок задачи в полях формы, без изменений. */
export function currentDeadline(task: Readonly<{ dueOn: string | null; dueAt: string | null }>): DeadlineFieldValues {
  return { deadlineKind: deadlineKindOf(task), dueOn: task.dueOn ?? "", dueAt: task.dueAt ?? "" };
}

/**
 * «Перенести на завтра»: завтрашний день по Бишкеку. Срок на весь день и
 * задача без срока получают завтрашний день целиком, срок со временем —
 * то же время завтра (местное значение, сервер добавит +06:00).
 */
export function tomorrowDeadline(task: Readonly<{ dueOn: string | null; dueAt: string | null }>, now: Date): DeadlineFieldValues {
  const tomorrow = shiftDay(dayInOrganizationTimezone(now), 1);
  const deadline = projectPlatformTaskDeadline(task.dueOn, task.dueAt, now);
  if (task.dueAt === null || deadline.minutes === null) return { deadlineKind: "all_day", dueOn: tomorrow, dueAt: "" };
  const hours = String(Math.floor(deadline.minutes / 60)).padStart(2, "0");
  const minutes = String(deadline.minutes % 60).padStart(2, "0");
  return { deadlineKind: "timed", dueOn: "", dueAt: `${tomorrow}T${hours}:${minutes}` };
}

/** Уже стоит на завтра — «Перенести на завтра» ничего бы не изменил. */
export function dueTomorrow(task: Readonly<{ dueOn: string | null; dueAt: string | null }>, now: Date): boolean {
  const tomorrow = shiftDay(dayInOrganizationTimezone(now), 1);
  return projectPlatformTaskDeadline(task.dueOn, task.dueAt, now).day === tomorrow;
}

function staffForm(task: Pick<StaffTaskFields, "id" | "version">, operation: "status" | "edit"): FormData {
  const form = new FormData();
  form.set("operation", operation);
  form.set("request_id", crypto.randomUUID());
  form.set("expected_version", task.version);
  form.set("task_id", task.id);
  form.set("source_message_id", "");
  form.set("source_message_version", "");
  form.set("source_lead_id", "");
  form.set("source_lead_version", "");
  return form;
}

/** Смена состояния рабочей задачи: завершение (с необязательным результатом) и отмена завершения. */
export function staffStatusForm(task: Pick<StaffTaskFields, "id" | "version">, status: PlatformCaseTaskStatus, completionNote = ""): FormData {
  const form = staffForm(task, "status");
  form.set("status", status);
  form.set("completion_note", status === "done" ? completionNote.trim() : "");
  for (const name of ["title", "assignee_membership_id", "description", "priority", "deadline_kind", "due_on", "due_at"]) form.set(name, "");
  return form;
}

/** Правка рабочей задачи: исполнитель и срок; название, описание и приоритет — как есть. */
export function staffEditForm(task: StaffTaskFields, change: Readonly<{ assigneeMembershipId?: string; deadline: DeadlineFieldValues }>): FormData {
  const form = staffForm(task, "edit");
  form.set("status", task.status);
  form.set("completion_note", "");
  form.set("title", task.title);
  form.set("assignee_membership_id", change.assigneeMembershipId ?? task.assigneeMembershipId);
  form.set("description", task.description ?? "");
  form.set("priority", task.priority);
  form.set("deadline_kind", change.deadline.deadlineKind);
  form.set("due_on", change.deadline.dueOn);
  form.set("due_at", change.deadline.dueAt);
  return form;
}

/**
 * Изменение задачи по студенту — одна команда на всё: состояние, исполнитель,
 * срок. Сервер требует причину; при завершении это «Результат».
 */
export function caseChangeForm(task: CaseTaskFields, change: Readonly<{
  status?: PlatformCaseTaskStatus;
  assigneeMembershipId?: string;
  deadline?: DeadlineFieldValues;
  reason: string;
}>): FormData {
  const deadline = change.deadline ?? currentDeadline(task);
  const form = new FormData();
  form.set("student_case_id", task.studentCaseId);
  form.set("case_task_id", task.id);
  form.set("status", change.status ?? task.status);
  form.set("assignee_membership_id", change.assigneeMembershipId ?? task.assigneeMembershipId);
  form.set("priority", task.priority);
  form.set("deadline_kind", deadline.deadlineKind);
  form.set("due_on", deadline.dueOn);
  form.set("due_at", deadline.dueAt);
  form.set("student_visible", String(task.studentVisible));
  form.set("expected_version", task.version);
  form.set("request_id", crypto.randomUUID());
  form.set("reason", change.reason.trim());
  return form;
}

export const STAFF_ERROR_COPY: Readonly<Record<string, string>> = {
  invalid: "Проверьте исполнителя и срок.",
  forbidden: "Нет доступа к изменению этой задачи. Обновите страницу.",
  stale: "Задача уже изменена. Обновите страницу перед повтором.",
  request_conflict: "Этот запрос уже использован. Обновите страницу.",
  unavailable: "Сохранение пока не подтверждено. Повторите.",
};

export const CASE_ERROR_COPY: Readonly<Record<string, string>> = {
  invalid: "Проверьте исполнителя, срок и причину.",
  forbidden: "Нет доступа к изменению этой задачи. Обновите страницу.",
  stale: "Задача уже изменена. Обновите страницу перед повтором.",
  request_conflict: "Этот запрос уже использован. Обновите страницу.",
  unavailable: "Сохранение пока не подтверждено. Повторите.",
};
