"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { mutateStaffTaskAction } from "@/lib/platform-staff-task-actions";
import { PLATFORM_CASE_TASK_STATUSES, type PlatformCaseTaskPriority, type PlatformCaseTaskStatus } from "@/lib/platform-admissions-task-contract";
import type { StaffParticipant, StaffTask, StaffTaskActionState } from "@/lib/platform-staff-task-contract";
import { projectPlatformTaskDeadline } from "@/lib/platform-task-deadline";
import { taskStatus } from "@/lib/v3/wording";
import { DeadlineFields } from "../calendar/TaskControls";

const CONTROL = "mt-1 min-h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2.5 text-sm text-fg focus:ring-2 focus:ring-accent/20 disabled:bg-surface-2";
const PRIMARY = "inline-flex min-h-11 items-center justify-center rounded-ctl bg-accent px-4 text-sm font-semibold text-on-accent disabled:opacity-55";
const COPY = {
  saved: "Сохранено.", invalid: "Проверьте название, исполнителя и срок.",
  forbidden: "Нет доступа к изменению или назначению этому сотруднику. Обновите страницу.",
  stale: "Задача уже изменилась. Обновите страницу и сверите изменения перед повтором.",
  request_conflict: "Этот запрос уже использован. Проверьте сохранённую задачу перед новой отправкой.",
  unavailable: "Сохранение пока не подтверждено. Можно повторить тот же запрос; введённое сохранено в форме.",
} satisfies Record<Exclude<StaffTaskActionState["status"], "idle">, string>;
function Feedback({ state }: { state: StaffTaskActionState }) {
  if (state.status === "idle") return null;
  return <p role={state.status === "saved" ? "status" : "alert"} className={`text-sm ${state.status === "saved" ? "text-ok" : "text-danger"}`}>{COPY[state.status]}</p>;
}
function initial(requestId: string): StaffTaskActionState { return { status: "idle", requestId, taskId: null, version: null }; }

type StaffTaskFormProps = Readonly<{
  task?: StaffTask; participants: readonly StaffParticipant[]; actorMembershipId: string; day: string; requestId: string; initialTitle?: string;
  sourceMessageId?: string; sourceMessageVersion?: string;
}>;
export function StaffTaskForm(props: StaffTaskFormProps) {
  const [requestId, setRequestId] = useState(props.requestId);
  return <StaffTaskEditor key={requestId} {...props} requestId={requestId} onAnother={() => setRequestId(crypto.randomUUID())} />;
}
function StaffTaskEditor({ task, participants, actorMembershipId, day, requestId, initialTitle = "", sourceMessageId, sourceMessageVersion, onAnother }: StaffTaskFormProps & { onAnother: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(mutateStaffTaskAction, initial(requestId));
  const [title, setTitle] = useState(task?.title ?? initialTitle);
  const [assignee, setAssignee] = useState(task?.assigneeMembershipId ?? actorMembershipId);
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<PlatformCaseTaskPriority>(task?.priority ?? "normal");
  const locked = pending || ["saved", "stale", "request_conflict"].includes(state.status);
  const projection = task ? projectPlatformTaskDeadline(task.dueOn, task.dueAt, new Date()) : null;
  useEffect(() => { if (state.status === "saved") router.refresh(); }, [router, state]);
  return <form action={action} className="space-y-4" data-testid="v3-staff-task-form">
    <input type="hidden" name="operation" value={task ? "edit" : "create"} />
    <input type="hidden" name="request_id" value={state.requestId} />
    <input type="hidden" name="expected_version" value={task?.version ?? "0"} />
    <input type="hidden" name="task_id" value={task?.id ?? ""} />
    <input type="hidden" name="status" value={task?.status ?? "open"} />
    <input type="hidden" name="source_message_id" value={task ? "" : sourceMessageId ?? ""} />
    <input type="hidden" name="source_message_version" value={task ? "" : sourceMessageVersion ?? ""} />
    <fieldset disabled={locked} className="grid min-w-0 gap-4 md:grid-cols-2">
      <legend className="sr-only">{task ? "Изменить рабочую задачу" : "Новая рабочая задача"}</legend>
      <label className="text-sm font-medium md:col-span-2">Название
        <input name="title" required maxLength={1000} value={title} onChange={(event) => setTitle(event.target.value)} className={CONTROL} autoComplete="off" />
      </label>
      <label className="text-sm font-medium">Исполнитель
        <select name="assignee_membership_id" required value={assignee} onChange={(event) => setAssignee(event.target.value)} className={CONTROL}>
          {!participants.some((person) => person.membershipId === assignee) ? <option value={assignee} disabled>{task?.assigneeDisplayName ?? "Выберите сотрудника"} · назначение недоступно</option> : null}
          {participants.map((person) => <option key={person.membershipId} value={person.membershipId}>{person.displayName}</option>)}
        </select>
      </label>
      <DeadlineFields day={day} task={task && projection ? { dueOn: task.dueOn, dueAt: task.dueAt, day: projection.day, minutes: projection.minutes } : undefined} defaultKind="none" />
      <details className="md:col-span-2" open={task ? true : undefined}>
        <summary className="min-h-11 cursor-pointer py-3 text-sm text-fg-2">Описание и приоритет</summary>
        <div className="grid gap-4 pt-2">
          <label className="text-sm font-medium">Описание
            <textarea name="description" maxLength={10000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} className={CONTROL} />
          </label>
          <label className="text-sm font-medium">Приоритет
            <select name="priority" value={priority} onChange={(event) => setPriority(event.target.value as PlatformCaseTaskPriority)} className={CONTROL}>
              <option value="low">Низкий</option><option value="normal">Обычный</option><option value="high">Высокий</option><option value="urgent">Срочный</option>
            </select>
          </label>
        </div>
      </details>
      <div className="md:col-span-2"><button type="submit" disabled={locked || participants.length === 0} className={PRIMARY}>{pending ? "Сохраняем…" : task ? "Сохранить изменения" : "Создать задачу"}</button></div>
    </fieldset>
    <p className="text-sm text-fg-2">Задачу видят создатель, исполнитель и администратор.</p>
    <Feedback state={state} />
    {state.status === "saved" && state.taskId ? <Link href={`/v3/tasks?task=${state.taskId}`} className="inline-flex min-h-11 items-center text-sm text-accent-text underline">Открыть задачу</Link> : null}
    {state.status === "saved" && !task && !sourceMessageId ? <button type="button" onClick={onAnother} className="ml-4 min-h-11 text-sm text-accent-text underline">Создать ещё</button> : null}
    {["stale", "request_conflict"].includes(state.status) ? <button type="button" onClick={() => router.refresh()} className="min-h-11 text-sm underline">Обновить задачу</button> : null}
  </form>;
}

export function StaffTaskStatusForm({ task, requestId }: Readonly<{ task: StaffTask; requestId: string }>) {
  const router = useRouter();
  const [state, action, pending] = useActionState(mutateStaffTaskAction, initial(requestId));
  const [status, setStatus] = useState<PlatformCaseTaskStatus>(task.status);
  useEffect(() => { if (state.status === "saved") router.refresh(); }, [router, state]);
  const locked = pending || ["saved", "stale", "request_conflict"].includes(state.status);
  return <form action={action} className="space-y-3" data-testid="v3-staff-task-status-form">
    <input type="hidden" name="operation" value="status" />
    <input type="hidden" name="request_id" value={state.requestId} />
    <input type="hidden" name="expected_version" value={task.version} />
    <input type="hidden" name="task_id" value={task.id} />
    {["title", "assignee_membership_id", "description", "priority", "deadline_kind", "due_on", "due_at", "source_message_id", "source_message_version"].map((name) => <input key={name} type="hidden" name={name} value="" />)}
    <fieldset disabled={locked} className="flex flex-wrap items-end gap-3">
      <legend className="sr-only">Статус задачи</legend>
      <label className="min-w-0 flex-1 text-sm font-medium">Статус
        <select name="status" value={status} onChange={(event) => setStatus(event.target.value as PlatformCaseTaskStatus)} className={CONTROL}>
          {PLATFORM_CASE_TASK_STATUSES.map((value) => <option key={value} value={value}>{taskStatus(value)}</option>)}
        </select>
      </label>
      <button type="submit" disabled={locked || status === task.status} className={PRIMARY}>{pending ? "Сохраняем…" : "Изменить статус"}</button>
    </fieldset>
    <Feedback state={state} />
    {state.status === "stale" || state.status === "request_conflict" ? <button type="button" onClick={() => router.refresh()} className="min-h-11 text-sm underline">Обновить задачу</button> : null}
  </form>;
}
