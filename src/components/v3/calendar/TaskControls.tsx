"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview } from "@/lib/platform-access";
import {
  changePlatformAdmissionsTaskAction,
  type PlatformAdmissionsTaskActionState,
} from "@/lib/platform-admissions-task-actions";
import {
  type PlatformCaseTaskDeadlineKind,
  type PlatformCaseTaskPriority,
  type PlatformCaseTaskStatus,
} from "@/lib/platform-admissions-task-contract";
import { taskStatus } from "@/lib/v3/wording";

import type {
  CalendarAssigneeOption,
  CalendarTask,
  CalendarCaseTask,
  CalendarTaskCapabilities,
  CalendarTaskRequestIds,
  Day,
} from "./types";
import { taskDeadlineInputDefaults } from "./types";

// h-11 без вертикальных отступов, как QUEUE_FIELD: поля t-body (16/24 px) и
// выпадающие списки одной высоты 44 px и стоят в ряд без ступеньки.
const CONTROL =
  "mt-1 h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 t-body text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:bg-surface-2 disabled:text-fg-3";
const DISABLED = "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-fg-3";
const SECONDARY =
  `v3-raised inline-flex min-h-11 items-center justify-center rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 enabled:hover:bg-surface-2 enabled:hover:text-fg ${DISABLED}`;
/** Подтверждение необратимого — тёмная нейтральная кнопка, не красная (красная — главное действие страницы). */
const CONFIRM =
  `v3-raised inline-flex min-h-11 items-center justify-center rounded-ctl border border-fg bg-fg px-4 t-label text-surface enabled:hover:border-fg-2 enabled:hover:bg-fg-2 ${DISABLED}`;
/** Тихое раскрытие: подчёркнутый текст, как ссылки панели. */
const QUIET_SUMMARY =
  "min-h-11 cursor-pointer py-3 t-label text-fg-2 underline underline-offset-4 hover:text-fg";

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
  stale: "Задачу уже изменили. Обновите страницу.",
  request_conflict: "Повторите сохранение.",
  unavailable: "Не удалось сохранить. Обновите страницу и повторите.",
};

function Feedback({ state }: Readonly<{ state: PlatformAdmissionsTaskActionState }>) {
  if (state.status === "idle") return null;
  const failed = state.status !== "saved";
  return (
    <p
      className={`t-body-compact ${failed ? "text-danger" : "text-ok"}`}
      role={failed ? "alert" : "status"}
      aria-live="polite"
    >
      {RESULT_COPY[state.status]}
    </p>
  );
}

function taskDeadlineKind(task: Pick<CalendarTask, "dueOn" | "dueAt">): PlatformCaseTaskDeadlineKind {
  if (task.dueOn !== null) return "all_day";
  if (task.dueAt !== null) return "timed";
  return "none";
}

export function DeadlineFields({
  day,
  task,
  defaultKind = "all_day",
}: Readonly<{
  day: Day;
  task?: Pick<CalendarTask, "dueOn" | "dueAt" | "day" | "minutes">;
  defaultKind?: PlatformCaseTaskDeadlineKind;
}>) {
  const [kind, setKind] = useState<PlatformCaseTaskDeadlineKind>(
    task ? taskDeadlineKind(task) : defaultKind,
  );
  const defaults = taskDeadlineInputDefaults(task, day);
  const [dueOn, setDueOn] = useState(defaults.dueOn);
  const [displayDueAt, setDisplayDueAt] = useState(defaults.dueAt);
  const [submittedDueAt, setSubmittedDueAt] = useState(
    task?.dueAt ?? defaults.dueAt,
  );
  return (
    <>
      <label className="t-label text-fg-2">
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
          <label className="t-label text-fg-2">
            Дата · Бишкек
            <input
              name="due_on"
              type="date"
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
              required
              className={CONTROL}
            />
          </label>
          <input type="hidden" name="due_at" value="" />
        </>
      ) : kind === "timed" ? (
        <>
          <input type="hidden" name="due_on" value="" />
          <label className="t-label text-fg-2">
            Дата и время · Бишкек
            <input
              type="datetime-local"
              value={displayDueAt}
              data-testid="v3-calendar-timed-deadline-input"
              onChange={(event) => {
                setDisplayDueAt(event.target.value);
                setSubmittedDueAt(event.target.value);
              }}
              required
              className={CONTROL}
            />
            <input type="hidden" name="due_at" value={submittedDueAt} />
          </label>
        </>
      ) : (
        <>
          <input type="hidden" name="due_on" value="" />
          <input type="hidden" name="due_at" value="" />
        </>
      )}
    </>
  );
}

function initialState(
  requestId: string,
  task?: CalendarCaseTask,
): PlatformAdmissionsTaskActionState {
  return {
    status: "idle",
    requestId,
    caseTaskId: task?.id ?? null,
    version: task?.version ?? null,
    changedAt: null,
  };
}

function CanonicalTaskFields({
  task,
  status,
  requestId,
}: Readonly<{
  task: CalendarCaseTask;
  status: PlatformCaseTaskStatus;
  requestId: string;
}>) {
  // Причину («Результат» или «Причина отмены») вводит сотрудник в поле `reason` самой формы.
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

/**
 * «Завершить» и «Отменить задачу» — те же правила, что у «Задач»: задача по студенту завершается с «Результатом»,
 * а отмена необратима, поэтому лежит под раскрытием и просит причину и подтверждение.
 */
function CalendarTerminalTaskForm({
  task,
  requestId,
  status,
}: Readonly<{
  task: CalendarCaseTask;
  requestId: string;
  status: "done" | "cancelled";
}>) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState(
    changePlatformAdmissionsTaskAction,
    initialState(requestId, task),
  );

  useEffect(() => {
    if (state.status === "saved" || state.status === "stale") router.refresh();
  }, [router, state.status, state.version]);
  const locked = pending || state.status === "saved" || state.status === "stale";
  const done = status === "done";
  const form = (
    <form action={action} data-testid={`v3-calendar-task-${status}-form`} className="grid gap-3">
      <CanonicalTaskFields task={task} status={status} requestId={state.requestId} />
      <label className="t-label text-fg-2">
        {done ? "Результат" : "Причина отмены"}
        <input
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          maxLength={1000}
          autoComplete="off"
          placeholder={done ? "Что сделано" : undefined}
          disabled={locked}
          className={CONTROL}
        />
      </label>
      <div>
        <button type="submit" disabled={locked || !reason.trim()} className={CONFIRM}>
          {pending ? "Сохраняем…" : done ? "Завершить" : "Отменить задачу"}
        </button>
      </div>
    </form>
  );
  return (
    <div className="space-y-2">
      {done ? form : (
        <details className="border-t border-border pt-1">
          <summary className={QUIET_SUMMARY}>Отменить задачу</summary>
          <div className="pt-1">{form}</div>
        </details>
      )}
      <Feedback state={state} />
    </div>
  );
}

function CalendarChangeTaskForm({
  task,
  day,
  assignees,
  actor,
  capabilities,
  requestId,
}: Readonly<{
  task: CalendarCaseTask;
  day: Day;
  assignees: readonly CalendarAssigneeOption[];
  actor: ActivePlatformActor;
  capabilities: CalendarTaskCapabilities;
  requestId: string;
}>) {
  const router = useRouter();
  // Controlled inputs survive a rejected Action's automatic form reset.
  // https://react.dev/reference/react/useActionState
  const [status, setStatus] = useState(task.state);
  const [priority, setPriority] = useState(task.priority);
  const [assigneeId, setAssigneeId] = useState(task.assigneeMembershipId);
  const [studentVisible, setStudentVisible] = useState(String(task.studentVisible));
  const [reason, setReason] = useState("");
  const [expectedVersion, setExpectedVersion] = useState(task.version);
  const [staleAcknowledged, setStaleAcknowledged] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: PlatformAdmissionsTaskActionState, form: FormData) => {
      setStaleAcknowledged(false);
      const next = await changePlatformAdmissionsTaskAction(previous, form);
      if (next.status === "saved" && next.version) setExpectedVersion(next.version);
      return next;
    },
    initialState(requestId, task),
  );
  useEffect(() => {
    if (state.status === "saved" || state.status === "stale") router.refresh();
  }, [router, state]);
  const locked = pending ||
    (state.status === "saved" && task.version !== state.version) ||
    (state.status === "stale" && !staleAcknowledged);
  const canAssign = !isStaffPreview(actor) && capabilities.canAssign;
  const canChangeVisibility = !isStaffPreview(actor) && capabilities.canChangeVisibility;
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
      {/* Раскрытие — текстовое действие: тёмный акцент, подчёркнут, как ссылки панели (DESIGN.md). */}
      <summary className="min-h-11 cursor-pointer py-3 t-label text-accent-text underline underline-offset-4 hover:text-fg">
        Изменить задачу
      </summary>
      {/* Одна колонка: панель узкая (22rem), и поля 16 px в две колонки
          обрезали имя ответственного и время срока. */}
      <form
        action={action}
        className="grid gap-3 pt-3"
        data-testid="v3-calendar-task-change-form"
        aria-busy={pending}
      >
        <input type="hidden" name="student_case_id" value={task.studentCaseId} />
        <input type="hidden" name="case_task_id" value={task.id} />
        <input type="hidden" name="expected_version" value={expectedVersion} />
        <input type="hidden" name="request_id" value={state.requestId} />
        <fieldset disabled={locked} className="contents">
        <label className="t-label text-fg-2">
          Состояние
          <select
            name="status"
            value={status}
            onChange={(event) => setStatus(event.target.value as PlatformCaseTaskStatus)}
            className={CONTROL}
          >
            {ACTIVE_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {requiredTaskStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>

        {canAssign ? (
          <label className="t-label text-fg-2">
            Исполнитель
            <select
              name="assignee_membership_id"
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
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

        <label className="t-label text-fg-2">
          Приоритет
          <select name="priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value as PlatformCaseTaskPriority)}
            className={CONTROL}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <DeadlineFields day={task.day ?? day} task={task} />
        {canChangeVisibility ? (
            <label className="t-label text-fg-2">
              Видимость студенту
              <select
                name="student_visible"
                value={studentVisible}
                onChange={(event) => setStudentVisible(event.target.value)}
                className={CONTROL}
              >
                <option value="false">Скрыта</option>
                <option value="true">Видна</option>
              </select>
            </label>
        ) : (
            <input
              type="hidden"
              name="student_visible"
              value={String(task.studentVisible)}
            />
        )}
        <label className="t-label text-fg-2">
          Причина изменения
          <input name="reason" value={reason}
            onChange={(event) => setReason(event.target.value)}
            required maxLength={1000} className={CONTROL} autoComplete="off"
          />
        </label>
        <div>
          <button type="submit" disabled={locked} className={SECONDARY}>
            {pending ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
        </fieldset>
        <div>
          <Feedback state={state} />
          {state.status === "stale" && !staleAcknowledged ? (
            <div className="mt-3 space-y-2">
              <p className="t-body-compact text-fg-2">
                Задачу уже изменили. Проверьте поля и сохраните ещё раз.
              </p>
              <button type="button" className={SECONDARY}
                disabled={task.version === expectedVersion}
                onClick={() => { setExpectedVersion(task.version); setStaleAcknowledged(true); }}
              >
                Продолжить
              </button>
            </div>
          ) : null}
        </div>
      </form>
    </details>
  );
}

export function CalendarTaskControls({
  task,
  day,
  assignees,
  actor,
  capabilities,
  requestIds,
}: Readonly<{
  task: CalendarCaseTask;
  day: Day;
  assignees: readonly CalendarAssigneeOption[];
  actor: ActivePlatformActor;
  capabilities: CalendarTaskCapabilities;
  requestIds: CalendarTaskRequestIds;
}>) {
  return (
    <div className="mt-4 space-y-3" data-testid="v3-calendar-task-controls">
      <div className="border-t border-border pt-4">
        <CalendarTerminalTaskForm
          key={`${task.id}:${task.version}:done`}
          task={task}
          requestId={requestIds.complete}
          status="done"
        />
      </div>
      <CalendarChangeTaskForm
        task={task}
        day={day}
        assignees={assignees}
        actor={actor}
        capabilities={capabilities}
        requestId={requestIds.change}
      />
      <CalendarTerminalTaskForm
        key={`${task.id}:${task.version}:cancelled`}
        task={task}
        requestId={requestIds.cancel}
        status="cancelled"
      />
    </div>
  );
}
