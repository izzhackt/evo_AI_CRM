"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import {
  changePlatformAdmissionsTaskAction,
  createPlatformAdmissionsTaskAction,
  type PlatformAdmissionsTaskActionState,
} from "@/lib/platform-admissions-task-actions";
import type { FixedRole } from "@/lib/fixed-role-policy";

import type {
  CalendarAssigneeOption,
  CalendarCaseOption,
  CalendarTask,
  Day,
} from "./types";

const CONTROL =
  "mt-1 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:bg-surface-2 disabled:text-fg-3";
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-ctl bg-accent px-4 text-sm font-semibold text-on-accent hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-ctl border border-control-edge bg-surface px-3 text-sm font-semibold text-fg-2 hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-55";

const RESULT_COPY: Record<
  Exclude<PlatformAdmissionsTaskActionState["status"], "idle">,
  string
> = {
  saved: "Изменение сохранено.",
  invalid: "Проверьте обязательные поля задачи.",
  forbidden: "У вашей роли нет прав на это изменение.",
  stale: "Задача уже изменена. Календарь обновлён.",
  request_conflict: "Команда уже использована. Можно безопасно повторить.",
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

function createInitialState(requestId: string): PlatformAdmissionsTaskActionState {
  return {
    status: "idle",
    requestId,
    caseTaskId: null,
    version: null,
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
    createInitialState(requestId),
  );

  useEffect(() => {
    if (state.status === "saved" || state.status === "stale") router.refresh();
  }, [router, state.status, state.version]);

  if (presentationRole !== "admin" && presentationRole !== "admissions") {
    return null;
  }

  const availableAssignees = presentationRole === "admin"
    ? assignees
    : assignees.filter(
        (assignee) => assignee.membershipId === actorMembershipId,
      );
  const locked = pending || state.status === "saved" || state.status === "stale";

  if (cases.length === 0) {
    return (
      <p className="text-sm text-fg-2" role="status">
        Нет активного Student 360: задача не может быть создана без
        канонического кейса.
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
    <details className="rounded-card border border-border bg-surface p-4">
      <summary className="cursor-pointer text-sm font-semibold text-fg">
        Создать задачу
      </summary>
      <form action={action} className="mt-4 space-y-3">
        <input type="hidden" name="task_type" value="follow_up" />
        <input type="hidden" name="priority" value="normal" />
        <input type="hidden" name="status" value="open" />
        <input type="hidden" name="student_visible" value="false" />
        <input type="hidden" name="expected_version" value="0" />
        <input type="hidden" name="request_id" value={state.requestId} />

        <fieldset
          disabled={locked}
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
        >
          <legend className="sr-only">Новая задача Admissions</legend>
          <label className="text-xs font-medium text-fg-2">
            Student 360
            <select
              name="student_case_id"
              required
              defaultValue={cases[0].id}
              className={CONTROL}
            >
              {cases.map((studentCase) => (
                <option key={studentCase.id} value={studentCase.id}>
                  {studentCase.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-fg-2">
            Ответственный
            <select
              name="assignee_membership_id"
              required
              defaultValue={availableAssignees[0].membershipId}
              className={CONTROL}
            >
              {availableAssignees.map((assignee) => (
                <option
                  key={assignee.membershipId}
                  value={assignee.membershipId}
                >
                  {assignee.displayName}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-fg-2">
            Срок
            <input
              type="datetime-local"
              name="due_at"
              required
              defaultValue={`${day}T09:00`}
              className={CONTROL}
            />
          </label>

          <label className="text-xs font-medium text-fg-2 md:col-span-2">
            Что нужно сделать
            <input
              type="text"
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
            <button type="submit" className={`${PRIMARY} w-full`}>
              {pending ? "Создаём…" : "Создать задачу"}
            </button>
          </div>
        </fieldset>

        {casesHaveMore ? (
          <p className="text-xs text-fg-3" role="status">
            Показаны первые 100 активных Student 360. Для остальных используйте
            поиск в Student 360.
          </p>
        ) : null}
        <Feedback state={state} />
      </form>
    </details>
  );
}

function completeInitialState(
  task: CalendarTask,
  requestId: string,
): PlatformAdmissionsTaskActionState {
  return {
    status: "idle",
    requestId,
    caseTaskId: task.id,
    version: task.version,
  };
}

export function CalendarCompleteTaskForm({
  task,
  requestId,
}: Readonly<{
  task: CalendarTask;
  requestId: string;
}>) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    changePlatformAdmissionsTaskAction,
    completeInitialState(task, requestId),
  );

  useEffect(() => {
    if (state.status === "saved" || state.status === "stale") router.refresh();
  }, [router, state.status, state.version]);

  const locked = pending || state.status === "saved" || state.status === "stale";

  return (
    <form
      action={action}
      className="mt-4 space-y-2 border-t border-border pt-4"
      data-testid="v3-calendar-task-complete-form"
    >
      <input type="hidden" name="student_case_id" value={task.studentCaseId} />
      <input type="hidden" name="case_task_id" value={task.id} />
      <input type="hidden" name="status" value="done" />
      <input
        type="hidden"
        name="assignee_membership_id"
        value={task.assigneeMembershipId}
      />
      <input type="hidden" name="priority" value={task.priority} />
      <input type="hidden" name="due_at" value={task.dueAt ?? ""} />
      <input
        type="hidden"
        name="student_visible"
        value={String(task.studentVisible)}
      />
      <input
        type="hidden"
        name="expected_version"
        value={state.version ?? task.version}
      />
      <input type="hidden" name="request_id" value={state.requestId} />

      <button type="submit" disabled={locked} className={SECONDARY}>
        {pending ? "Сохраняем…" : "Отметить выполненной"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
