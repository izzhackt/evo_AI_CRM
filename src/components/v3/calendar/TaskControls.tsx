"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import type { FixedRole } from "@/lib/fixed-role-policy";
import {
  changePlatformAdmissionsTaskAction,
  createPlatformAdmissionsTaskAction,
  type PlatformAdmissionsTaskActionState,
} from "@/lib/platform-admissions-task-actions";
import {
  PLATFORM_CASE_TASK_PRIORITIES,
  type PlatformCaseTaskDeadlineKind,
  type PlatformCaseTaskPriority,
  type PlatformCaseTaskStatus,
} from "@/lib/platform-admissions-task-contract";
import { taskStatus } from "@/lib/v3/wording";

import type {
  CalendarAssigneeOption,
  CalendarCaseOption,
  CalendarTask,
  CalendarTaskRequestIds,
  Day,
} from "./types";

const CONTROL =
  "mt-1 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:bg-surface-2 disabled:text-fg-3";
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-ctl bg-accent px-4 text-sm font-semibold text-on-accent hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-ctl border border-control-edge bg-surface px-3 text-sm font-semibold text-fg-2 hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-55";
const DANGER =
  "inline-flex min-h-11 items-center justify-center rounded-ctl border border-control-edge bg-surface px-3 text-sm font-semibold text-fg-2 hover:border-danger hover:bg-danger-weak hover:text-danger disabled:cursor-not-allowed disabled:opacity-55";

const PRIORITY_OPTIONS: readonly Readonly<{
  value: PlatformCaseTaskPriority;
  label: string;
}>[] = [
  { value: "low", label: "Низкий" },
  { value: "normal", label: "Обычный" },
  { value: "high", label: "Высокий" },
  { value: "urgent", label: "Срочный" },
];

const ACTIVE_STATUS_OPTIONS: readonly PlatformCaseTaskStatus[] = [
  "open",
  "in_progress",
  "blocked",
];

function requiredTaskStatusLabel(status: PlatformCaseTaskStatus): string {
  const label = taskStatus(status);
  if (!label) throw new Error("V3 task status wording is unavailable.");
  return label;
}

const RESULT_COPY: Record<
  Exclude<PlatformAdmissionsTaskActionState["status"], "idle">,
  string
> = {
  saved: "Изменение сохранено.",
  invalid: "Проверьте обязательные поля задачи.",
  forbidden: "У вашей роли нет прав на это изменение.",
  stale: "Задача уже изменена. Обновите календарь перед повтором.",
  request_conflict: "Команда уже использована. Подготовлен новый безопасный повтор.",
  unavailable: "Supabase не подтвердил изменение. Задача не изменена.",
};

function Feedback({ state }: Readonly<{ state: PlatformAdmissionsTaskActionState }>) {
  if (state.status === "idle") return null;
  const failed = state.status !== "saved";
  return (
    <p
      className={`text-xs ${failed ? "text-danger" : "text-ok"}`}
      role={failed ? "alert" : "status"}
      aria-live="polite"
    >
      {RESULT_COPY[state.status]}
    </p>
  );
}

function taskDeadlineKind(task: CalendarTask): PlatformCaseTaskDeadlineKind {
  if (task.dueOn !== null) return "all_day";
  if (task.dueAt !== null) return "timed";
  return "none";
}

function DeadlineFields({
  day,
  task,
}: Readonly<{
  day: Day;
  task?: CalendarTask;
}>) {
  const [kind, setKind] = useState<PlatformCaseTaskDeadlineKind>(
    task ? taskDeadlineKind(task) : "all_day",
  );
  return (
    <>
      <label className="text-xs font-medium text-fg-2">
        Тип срока
        <select
          name="deadline_kind"
          value={kind}
          onChange={(event) =>
            setKind(event.target.value as PlatformCaseTaskDeadlineKind)}
          className={CONTROL}
        >
          <option value="none">Без срока</option>
          <option value="all_day">Весь день</option>
          <option value="timed">Точное время</option>
        </select>
      </label>
      {kind === "all_day" ? (
        <>
          <label className="text-xs font-medium text-fg-2">
            Дата · Бишкек
            <input
              name="due_on"
              type="date"
              defaultValue={task?.dueOn ?? day}
              required
              className={CONTROL}
            />
          </label>
          <input type="hidden" name="due_at" value="" />
        </>
      ) : kind === "timed" ? (
        <>
          <input type="hidden" name="due_on" value="" />
          <label className="text-xs font-medium text-fg-2">
            Дата и время · Бишкек
            <input
              name="due_at"
              type="datetime-local"
              defaultValue={task ? dueInputValue(task) || `${day}T09:00` : `${day}T09:00`}
              required
              className={CONTROL}
            />
          </label>
        </>
      ) : (
        <>
          <input type="hidden" name="due_on" value="" />
          <input type="hidden" name="due_at" value="" />
          <p className="self-end pb-2.5 text-xs text-fg-3">
            Задача останется в разделе «Без срока».
          </p>
        </>
      )}
    </>
  );
}

function initialState(
  requestId: string,
  task?: CalendarTask,
): PlatformAdmissionsTaskActionState {
  return {
    status: "idle",
    requestId,
    caseTaskId: task?.id ?? null,
    version: task?.version ?? null,
    changedAt: null,
  };
}

export function CalendarCreateTaskForm({
  cases,
  casesHaveMore,
  assignees,
  actorMembershipId,
  presentationRole,
  day,
  requestId,
}: Readonly<{
  cases: readonly CalendarCaseOption[];
  casesHaveMore: boolean;
  assignees: readonly CalendarAssigneeOption[];
  actorMembershipId: string;
  presentationRole: FixedRole;
  day: Day;
  requestId: string;
}>) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    createPlatformAdmissionsTaskAction,
    initialState(requestId),
  );

  useEffect(() => {
    if (state.status === "saved" || state.status === "stale") router.refresh();
  }, [router, state.status, state.version]);

  if (presentationRole !== "admin" && presentationRole !== "admissions") {
    return null;
  }

  const availableAssignees = presentationRole === "admin"
    ? assignees
    : assignees.filter((assignee) => assignee.membershipId === actorMembershipId);
  const locked = pending || state.status === "saved" || state.status === "stale";

  if (cases.length === 0) {
    return (
      <p className="text-sm text-fg-2" role="status">
        Нет активного Student 360: задача не может быть создана без канонического кейса.
      </p>
    );
  }
  if (availableAssignees.length === 0) {
    return (
      <p className="text-sm text-danger" role="alert">
        Нет доступного сотрудника Admissions. Задача не создана.
      </p>
    );
  }

  return (
    <details className="rounded-card border border-border bg-surface px-4 py-2">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-fg">
        Создать задачу
      </summary>
      <form
        action={action}
        className="grid gap-3 border-t border-border pb-2 pt-4 md:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_minmax(11rem,0.8fr)_minmax(11rem,0.8fr)]"
        data-testid="v3-calendar-task-create-form"
      >
        <input type="hidden" name="task_type" value="follow_up" />
        <input type="hidden" name="status" value="open" />
        <input type="hidden" name="expected_version" value="0" />
        <input type="hidden" name="request_id" value={state.requestId} />

        <fieldset disabled={locked} className="contents">
          <legend className="sr-only">Новая задача Admissions</legend>
          <label className="text-xs font-medium text-fg-2">
            Студент
            <select name="student_case_id" required className={CONTROL}>
              {cases.map((studentCase) => (
                <option key={studentCase.id} value={studentCase.id}>
                  {studentCase.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-fg-2">
            Ответственный
            <select name="assignee_membership_id" required className={CONTROL}>
              {availableAssignees.map((assignee) => (
                <option key={assignee.membershipId} value={assignee.membershipId}>
                  {assignee.displayName}
                </option>
              ))}
            </select>
          </label>

          <DeadlineFields day={day} />

          <label className="text-xs font-medium text-fg-2">
            Приоритет
            <select name="priority" defaultValue="normal" className={CONTROL}>
              {PLATFORM_CASE_TASK_PRIORITIES.map((priority) => {
                const option = PRIORITY_OPTIONS.find((item) => item.value === priority);
                if (!option) throw new Error("V3 task priority wording is unavailable.");
                return (
                  <option key={priority} value={priority}>
                    {option.label}
                  </option>
                );
              })}
            </select>
          </label>

          <label className="text-xs font-medium text-fg-2">
            Видимость студенту
            <select name="student_visible" defaultValue="false" className={CONTROL}>
              <option value="false">Скрыта</option>
              <option value="true">Видна</option>
            </select>
          </label>

          <label className="text-xs font-medium text-fg-2 md:col-span-2 xl:col-span-2">
            Задача
            <input
              name="title"
              required
              minLength={1}
              maxLength={1_000}
              autoComplete="off"
              className={CONTROL}
              placeholder="Например, проверить перевод аттестата"
            />
          </label>

          <div className="flex items-end">
            <button type="submit" disabled={locked} className={`${PRIMARY} w-full`}>
              {pending ? "Создаём…" : "Создать задачу"}
            </button>
          </div>
        </fieldset>

        <div className="space-y-1 md:col-span-2 xl:col-span-3">
          {casesHaveMore ? (
            <p className="text-xs text-fg-3" role="status">
              Показаны первые 100 активных Student 360. Для остальных используйте
              поиск в Student 360.
            </p>
          ) : null}
          <Feedback state={state} />
        </div>
      </form>
    </details>
  );
}

function dueInputValue(task: CalendarTask): string {
  if (task.day === null || task.minutes === null) return "";
  const hour = String(Math.floor(task.minutes / 60)).padStart(2, "0");
  const minute = String(task.minutes % 60).padStart(2, "0");
  return `${task.day}T${hour}:${minute}`;
}

function CanonicalTaskFields({
  task,
  status,
  requestId,
}: Readonly<{
  task: CalendarTask;
  status: PlatformCaseTaskStatus;
  requestId: string;
}>) {
  return (
    <>
      <input type="hidden" name="student_case_id" value={task.studentCaseId} />
      <input type="hidden" name="case_task_id" value={task.id} />
      <input type="hidden" name="status" value={status} />
      <input
        type="hidden"
        name="assignee_membership_id"
        value={task.assigneeMembershipId}
      />
      <input type="hidden" name="priority" value={task.priority} />
      <input type="hidden" name="deadline_kind" value={taskDeadlineKind(task)} />
      <input type="hidden" name="due_on" value={task.dueOn ?? ""} />
      <input type="hidden" name="due_at" value={task.dueAt ?? ""} />
      <input type="hidden" name="student_visible" value={String(task.studentVisible)} />
      <input type="hidden" name="expected_version" value={task.version} />
      <input type="hidden" name="request_id" value={requestId} />
    </>
  );
}

function CalendarTerminalTaskForm({
  task,
  requestId,
  status,
}: Readonly<{
  task: CalendarTask;
  requestId: string;
  status: "done" | "cancelled";
}>) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    changePlatformAdmissionsTaskAction,
    initialState(requestId, task),
  );

  useEffect(() => {
    if (state.status === "saved" || state.status === "stale") router.refresh();
  }, [router, state.status, state.version]);
  const locked = pending || state.status === "saved" || state.status === "stale";

  return (
    <div className="space-y-2">
      <form action={action} data-testid={`v3-calendar-task-${status}-form`}>
        <CanonicalTaskFields task={task} status={status} requestId={state.requestId} />
        <button
          type="submit"
          disabled={locked}
          className={status === "cancelled" ? DANGER : SECONDARY}
        >
          {pending
            ? "Сохраняем…"
            : status === "done"
              ? "Выполнить"
              : "Отменить задачу"}
        </button>
      </form>
      <Feedback state={state} />
    </div>
  );
}

function CalendarChangeTaskForm({
  task,
  day,
  assignees,
  presentationRole,
  requestId,
}: Readonly<{
  task: CalendarTask;
  day: Day;
  assignees: readonly CalendarAssigneeOption[];
  presentationRole: FixedRole;
  requestId: string;
}>) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    changePlatformAdmissionsTaskAction,
    initialState(requestId, task),
  );
  useEffect(() => {
    if (state.status === "saved" || state.status === "stale") router.refresh();
  }, [router, state.status, state.version]);
  const locked = pending || state.status === "saved" || state.status === "stale";
  const adminView = presentationRole === "admin";
  const canonicalAssignees = assignees.some(
    (assignee) => assignee.membershipId === task.assigneeMembershipId,
  )
    ? assignees
    : [
        {
          membershipId: task.assigneeMembershipId,
          displayName: task.assigneeDisplayName,
        },
        ...assignees,
      ];

  return (
    <details className="border-t border-border pt-3">
      <summary className="min-h-10 cursor-pointer py-2 text-xs font-semibold text-accent">
        Изменить задачу
      </summary>
      <form
        action={action}
        className="grid gap-3 pt-3 sm:grid-cols-2"
        data-testid="v3-calendar-task-change-form"
      >
        <input type="hidden" name="student_case_id" value={task.studentCaseId} />
        <input type="hidden" name="case_task_id" value={task.id} />
        <input type="hidden" name="expected_version" value={task.version} />
        <input type="hidden" name="request_id" value={state.requestId} />

        <label className="text-xs font-medium text-fg-2">
          Состояние
          <select name="status" defaultValue={task.state} className={CONTROL}>
            {ACTIVE_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {requiredTaskStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>

        {adminView ? (
          <label className="text-xs font-medium text-fg-2">
            Ответственный
            <select
              name="assignee_membership_id"
              defaultValue={task.assigneeMembershipId}
              className={CONTROL}
            >
              {canonicalAssignees.map((assignee) => (
                <option key={assignee.membershipId} value={assignee.membershipId}>
                  {assignee.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input
            type="hidden"
            name="assignee_membership_id"
            value={task.assigneeMembershipId}
          />
        )}

        {adminView ? (
          <>
            <label className="text-xs font-medium text-fg-2">
              Приоритет
              <select name="priority" defaultValue={task.priority} className={CONTROL}>
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority.value} value={priority.value}>
                    {priority.label}
                  </option>
                ))}
              </select>
            </label>
            <DeadlineFields day={task.day ?? day} task={task} />
            <label className="text-xs font-medium text-fg-2">
              Видимость студенту
              <select
                name="student_visible"
                defaultValue={String(task.studentVisible)}
                className={CONTROL}
              >
                <option value="false">Скрыта</option>
                <option value="true">Видна</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <input type="hidden" name="priority" value={task.priority} />
            <input
              type="hidden"
              name="deadline_kind"
              value={taskDeadlineKind(task)}
            />
            <input type="hidden" name="due_on" value={task.dueOn ?? ""} />
            <input type="hidden" name="due_at" value={task.dueAt ?? ""} />
            <input
              type="hidden"
              name="student_visible"
              value={String(task.studentVisible)}
            />
          </>
        )}

        <div className="flex items-end">
          <button type="submit" disabled={locked} className={PRIMARY}>
            {pending ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
        <div className="sm:col-span-2">
          <Feedback state={state} />
        </div>
      </form>
    </details>
  );
}

export function CalendarTaskControls({
  task,
  day,
  assignees,
  presentationRole,
  requestIds,
}: Readonly<{
  task: CalendarTask;
  day: Day;
  assignees: readonly CalendarAssigneeOption[];
  presentationRole: FixedRole;
  requestIds: CalendarTaskRequestIds;
}>) {
  return (
    <div className="mt-4 space-y-3" data-testid="v3-calendar-task-controls">
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <CalendarTerminalTaskForm
          task={task}
          requestId={requestIds.complete}
          status="done"
        />
        <CalendarTerminalTaskForm
          task={task}
          requestId={requestIds.cancel}
          status="cancelled"
        />
      </div>
      <CalendarChangeTaskForm
        task={task}
        day={day}
        assignees={assignees}
        presentationRole={presentationRole}
        requestId={requestIds.change}
      />
    </div>
  );
}
