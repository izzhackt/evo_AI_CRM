"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutateStaffTaskAction } from "@/lib/platform-staff-task-actions";
import { changePlatformAdmissionsTaskAction } from "@/lib/platform-admissions-task-actions";
import type { StaffParticipant, StaffTask } from "@/lib/platform-staff-task-contract";
import { projectPlatformTaskDeadline } from "@/lib/platform-task-deadline";
import { taskStatus } from "@/lib/v3/wording";
import { DeadlineFields } from "../calendar/TaskControls";
import type { CalendarTask, CalendarTaskCapabilities, Day } from "../calendar/types";

const CONTROL = "mt-1 min-h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2 text-sm text-fg disabled:bg-surface-2";
const PRIMARY = "inline-flex min-h-11 items-center justify-center rounded-ctl bg-accent px-4 text-sm font-semibold text-on-accent hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55";
const SECONDARY = "inline-flex min-h-11 items-center justify-center rounded-ctl border border-control-edge bg-surface px-3 text-sm font-semibold text-fg-2 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-55";

type StaffTaskExtra = Readonly<{
  leadHref: string | null;
  sourceHref: string | null;
  sourceUnavailable: boolean;
  outcomes: readonly Readonly<{ requestId: string; note: string; author: string; createdAt: string }>[];
  outcomesUnavailable: boolean;
}>;
type PanelData =
  | Readonly<{ kind: "staff"; task: StaffTask; participants: readonly StaffParticipant[]; extra?: StaffTaskExtra }>
  | Readonly<{
      kind: "case"; task: CalendarTask; caseId: string;
      assignees: readonly Readonly<{ membershipId: string; displayName: string }>[];
      capabilities: CalendarTaskCapabilities;
    }>;

function Feedback({ text, tone }: Readonly<{ text: string | null; tone: "ok" | "danger" }>) {
  if (!text) return null;
  return <p role={tone === "ok" ? "status" : "alert"} className={`text-sm ${tone === "ok" ? "text-ok" : "text-danger"}`}>{text}</p>;
}

function deadlineKindOf(task: Pick<CalendarTask, "dueOn" | "dueAt">): "none" | "all_day" | "timed" {
  if (task.dueOn !== null) return "all_day";
  if (task.dueAt !== null) return "timed";
  return "none";
}

function buildStaffForm(input: Readonly<{
  operation: "status" | "edit"; task: StaffTask; status: string;
  assigneeMembershipId?: string; deadlineKind?: string; dueOn?: string; dueAt?: string;
  completionNote?: string;
}>): FormData {
  const form = new FormData();
  form.set("operation", input.operation);
  form.set("request_id", crypto.randomUUID());
  form.set("expected_version", input.task.version);
  form.set("task_id", input.task.id);
  form.set("status", input.status);
  form.set("source_message_id", "");
  form.set("source_message_version", "");
  form.set("source_lead_id", "");
  form.set("source_lead_version", "");
  form.set("completion_note", input.operation === "status" && input.status === "done" ? (input.completionNote ?? "").trim() : "");
  if (input.operation === "edit") {
    form.set("title", input.task.title);
    form.set("assignee_membership_id", input.assigneeMembershipId ?? input.task.assigneeMembershipId);
    form.set("description", input.task.description ?? "");
    form.set("priority", input.task.priority);
    form.set("deadline_kind", input.deadlineKind ?? "none");
    form.set("due_on", input.dueOn ?? "");
    form.set("due_at", input.dueAt ?? "");
  } else {
    form.set("title", ""); form.set("assignee_membership_id", ""); form.set("description", "");
    form.set("priority", ""); form.set("deadline_kind", ""); form.set("due_on", ""); form.set("due_at", "");
  }
  return form;
}

const STAFF_ERROR_COPY: Record<string, string> = {
  invalid: "Проверьте исполнителя и срок.",
  forbidden: "Нет доступа к изменению этой задачи. Обновите страницу.",
  stale: "Задача уже изменена. Обновите страницу перед повтором.",
  request_conflict: "Этот запрос уже использован. Обновите страницу.",
  unavailable: "Сохранение пока не подтверждено. Повторите.",
};
const CASE_ERROR_COPY: Record<string, string> = {
  invalid: "Проверьте исполнителя, срок и причину.",
  forbidden: "Нет доступа к изменению этой задачи. Обновите страницу.",
  stale: "Задача уже изменена. Обновите страницу перед повтором.",
  request_conflict: "Этот запрос уже использован. Обновите страницу.",
  unavailable: "Сохранение пока не подтверждено. Повторите.",
};

export function TaskDetailPanel({ data, closeHref, day }: Readonly<{ data: PanelData; closeHref: string; day: Day }>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [completionNote, setCompletionNote] = useState("");
  const [completeReason, setCompleteReason] = useState("");
  const [editReason, setEditReason] = useState("");
  const [assignee, setAssignee] = useState(data.task.assigneeMembershipId);

  const title = data.task.title;
  const status = data.kind === "staff" ? data.task.status : data.task.state;
  const isDone = status === "done" || status === "cancelled";
  const description = data.kind === "staff" ? data.task.description : data.task.details;
  const dueOn = data.task.dueOn;
  const dueAt = data.task.dueAt;
  const projection = projectPlatformTaskDeadline(dueOn, dueAt, new Date());
  const overdue = projection.overdue && !isDone;
  const assigneeOptions = data.kind === "staff" ? data.participants : data.assignees;
  const currentAssigneeName = data.task.assigneeDisplayName;

  useEffect(() => {
    // Skip while a field is focused: an in-progress edit (assignee/due/reason)
    // must survive an accidental Escape, and a stray Escape while typing is
    // more often meant for the field itself (e.g. clearing autocomplete).
    const editing = (target: EventTarget | null) => target instanceof HTMLElement
      && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !editing(event.target)) router.push(closeHref); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, closeHref]);

  async function completeStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (data.kind !== "staff" || pending) return;
    setPending(true); setError(null);
    try {
      const result = await mutateStaffTaskAction(
        { status: "idle", requestId: crypto.randomUUID(), taskId: null, version: null },
        buildStaffForm({ operation: "status", task: data.task, status: "done", completionNote }),
      );
      if (result.status === "saved") { setNotice("Задача завершена."); router.refresh(); }
      else setError(STAFF_ERROR_COPY[result.status] ?? "Не удалось сохранить.");
    } catch { setError("Не удалось сохранить. Повторите."); }
    finally { setPending(false); }
  }

  async function completeCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (data.kind !== "case" || pending) return;
    const trimmed = completeReason.trim();
    if (!trimmed) { setError("Укажите причину."); return; }
    setPending(true); setError(null);
    try {
      const request = new FormData();
      request.set("student_case_id", data.caseId);
      request.set("case_task_id", data.task.id);
      request.set("status", "done");
      request.set("assignee_membership_id", data.task.assigneeMembershipId);
      request.set("priority", data.task.priority);
      request.set("deadline_kind", deadlineKindOf(data.task));
      request.set("due_on", dueOn ?? "");
      request.set("due_at", dueAt ?? "");
      request.set("student_visible", String(data.task.studentVisible));
      request.set("expected_version", data.task.version);
      request.set("request_id", crypto.randomUUID());
      request.set("reason", trimmed);
      const result = await changePlatformAdmissionsTaskAction(
        { status: "idle", requestId: crypto.randomUUID(), caseTaskId: null, version: null, changedAt: null }, request,
      );
      if (result.status === "saved") { setNotice("Задача завершена."); setCompleteReason(""); router.refresh(); }
      else setError(CASE_ERROR_COPY[result.status] ?? "Не удалось сохранить.");
    } catch { setError("Не удалось сохранить. Повторите."); }
    finally { setPending(false); }
  }

  async function saveStaffAssigneeDue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (data.kind !== "staff" || pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true); setError(null);
    try {
      const result = await mutateStaffTaskAction(
        { status: "idle", requestId: crypto.randomUUID(), taskId: null, version: null },
        buildStaffForm({
          operation: "edit", task: data.task, status: data.task.status, assigneeMembershipId: assignee,
          deadlineKind: String(form.get("deadline_kind") ?? ""),
          dueOn: String(form.get("due_on") ?? ""), dueAt: String(form.get("due_at") ?? ""),
        }),
      );
      if (result.status === "saved") { setNotice("Сохранено."); router.refresh(); }
      else setError(STAFF_ERROR_COPY[result.status] ?? "Не удалось сохранить.");
    } catch { setError("Не удалось сохранить. Повторите."); }
    finally { setPending(false); }
  }

  async function saveCaseAssigneeDue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (data.kind !== "case" || pending) return;
    const form = new FormData(event.currentTarget);
    const trimmed = editReason.trim();
    if (!trimmed) { setError("Укажите причину изменения."); return; }
    setPending(true); setError(null);
    try {
      const request = new FormData();
      request.set("student_case_id", data.caseId);
      request.set("case_task_id", data.task.id);
      request.set("status", data.task.state);
      request.set("assignee_membership_id", assignee);
      request.set("priority", data.task.priority);
      request.set("deadline_kind", String(form.get("deadline_kind") ?? ""));
      request.set("due_on", String(form.get("due_on") ?? ""));
      request.set("due_at", String(form.get("due_at") ?? ""));
      request.set("student_visible", String(data.task.studentVisible));
      request.set("expected_version", data.task.version);
      request.set("request_id", crypto.randomUUID());
      request.set("reason", trimmed);
      const result = await changePlatformAdmissionsTaskAction(
        { status: "idle", requestId: crypto.randomUUID(), caseTaskId: null, version: null, changedAt: null }, request,
      );
      if (result.status === "saved") { setNotice("Сохранено."); setEditReason(""); router.refresh(); }
      else setError(CASE_ERROR_COPY[result.status] ?? "Не удалось сохранить.");
    } catch { setError("Не удалось сохранить. Повторите."); }
    finally { setPending(false); }
  }

  return <>
    <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" aria-hidden onClick={() => router.push(closeHref)} />
    <aside aria-label="Задача" data-testid="v3-task-detail-panel"
      className="fixed inset-0 z-50 flex w-full flex-col overflow-y-auto bg-surface lg:inset-y-0 lg:end-0 lg:start-auto lg:w-[26rem] lg:border-s lg:border-border lg:shadow-evo-lg">
      <header className="flex items-center justify-between gap-3 border-b border-border p-4">
        <Link href={closeHref} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-fg-2 hover:text-fg" data-testid="v3-task-detail-close">
          ← К списку
        </Link>
      </header>
      <div className="space-y-5 p-4">
        <div>
          <h2 className="break-words text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-fg-2">{taskStatus(status) ?? status}{overdue ? " · Просрочено" : ""}</p>
        </div>
        {description ? <p className="whitespace-pre-wrap break-words text-sm leading-6 text-fg-2">{description}</p> : null}

        {data.kind === "case" ? (
          <Link href={`/v3/messages?case=${data.caseId}&attach=case_task:${data.task.id}`} className="inline-flex min-h-11 items-center text-sm text-fg-2 underline decoration-transparent hover:decoration-inherit">
            Обсудить
          </Link>
        ) : null}

        {data.kind === "staff" && data.extra ? <div className="space-y-2 text-sm">
          {data.extra.leadHref ? <Link href={data.extra.leadHref} className="inline-flex min-h-11 items-center underline">Открыть связанного лида</Link> : null}
          {data.extra.sourceHref ? <Link href={data.extra.sourceHref} className="inline-flex min-h-11 items-center underline">Открыть исходное обсуждение</Link>
            : data.extra.sourceUnavailable ? <p className="text-fg-3">Исходное обсуждение недоступно для вашей роли или обновите страницу.</p> : null}
          {data.extra.outcomes.length ? <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-semibold text-fg-2">Результаты выполнения</p>
            {data.extra.outcomes.map((outcome) => <article key={outcome.requestId} className="border-l-2 border-border pl-3">
              <p className="whitespace-pre-wrap break-words text-sm">{outcome.note}</p>
              <p className="mt-1 text-xs text-fg-2">{outcome.author} · {new Date(outcome.createdAt).toLocaleDateString("ru-RU", { timeZone: "Asia/Bishkek" })}</p>
            </article>)}
          </div> : null}
          {data.extra.outcomesUnavailable ? <p className="text-fg-3">Не удалось загрузить связь с лидом и результаты. Обновите страницу.</p> : null}
        </div> : null}

        {!isDone ? <form onSubmit={data.kind === "staff" ? completeStaff : completeCase} className="space-y-2 border-y border-border py-4">
          {data.kind === "staff"
            ? <label className="block text-xs font-medium text-fg-2">Результат работы · необязательно
                <textarea value={completionNote} onChange={(event) => setCompletionNote(event.target.value)} maxLength={4000} rows={2} disabled={pending} className={CONTROL} placeholder="Что сделано и какой следующий шаг?" />
              </label>
            : <label className="block text-xs font-medium text-fg-2">Причина
                <input value={completeReason} onChange={(event) => setCompleteReason(event.target.value)} required maxLength={1000} disabled={pending} className={CONTROL} />
              </label>}
          <button type="submit" disabled={pending} className={PRIMARY}>{pending ? "Сохраняем…" : "Завершить"}</button>
        </form> : null}

        {/* Per the current rule (migration 156_platform_scoped_staff_consumers.sql,
            e.g. :925-931's task.assign/task.manage split; mirrored live by
            CalendarChangeTaskForm, TaskControls.tsx:405-470), only the
            ASSIGNEE control is gated by 'task.assign' -- due, priority and
            status stay editable for any 'task.manage' holder reaching this
            panel. The form itself must always render; only the assignee
            field inside it switches between an editable select and static
            text per capabilities.canAssign, exactly like CalendarChangeTaskForm's
            own canAssign branch (TaskControls.tsx:492-514). */}
        <form onSubmit={data.kind === "staff" ? saveStaffAssigneeDue : saveCaseAssigneeDue} className="space-y-3 border-t border-border pt-4">
          <label className="block text-sm font-medium">Исполнитель
            {data.kind === "case" && !data.capabilities.canAssign
              ? <span className="mt-1 block text-sm font-normal">{currentAssigneeName}</span>
              : <select value={assignee} disabled={pending} onChange={(event) => setAssignee(event.target.value)} className={CONTROL}>
                  {!assigneeOptions.some((person) => person.membershipId === assignee) ? <option value={assignee} disabled>{currentAssigneeName}</option> : null}
                  {assigneeOptions.map((person) => <option key={person.membershipId} value={person.membershipId}>{person.displayName}</option>)}
                </select>}
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <DeadlineFields day={day} task={{ dueOn, dueAt, day: projection.day, minutes: projection.minutes }} defaultKind="none" />
          </div>
          {data.kind === "case" ? <label className="block text-xs font-medium text-fg-2">Причина изменения
            <input value={editReason} onChange={(event) => setEditReason(event.target.value)} required maxLength={1000} disabled={pending} className={CONTROL} />
          </label> : null}
          <button type="submit" disabled={pending} className={SECONDARY}>{pending ? "Сохраняем…" : "Сохранить"}</button>
        </form>

        <Feedback text={notice} tone="ok" />
        <Feedback text={error} tone="danger" />
      </div>
    </aside>
  </>;
}
