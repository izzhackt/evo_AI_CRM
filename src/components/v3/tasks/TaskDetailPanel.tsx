"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { useRouter } from "next/navigation";
import { mutateStaffTaskAction } from "@/lib/platform-staff-task-actions";
import { changePlatformAdmissionsTaskAction } from "@/lib/platform-admissions-task-actions";
import type { StaffParticipant, StaffTask } from "@/lib/platform-staff-task-contract";
import { projectPlatformTaskDeadline } from "@/lib/platform-task-deadline";
import { taskStatus } from "@/lib/v3/wording";
import { DeadlineFields } from "../calendar/TaskControls";
import type { CalendarCaseTask, CalendarTaskCapabilities, Day } from "../calendar/types";
import { queueDue } from "../queue/due-bucket";
import { QUEUE_CONFIRM, QUEUE_FIELD, QUEUE_SECONDARY } from "../queue/queue-buttons";
import { QueueDetailPanel } from "../queue/QueueDetailPanel";
import { CASE_ERROR_COPY, STAFF_ERROR_COPY, caseChangeForm, staffEditForm, staffStatusForm, type DeadlineFieldValues } from "./task-commands";

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
      kind: "case"; task: CalendarCaseTask; caseId: string;
      assignees: readonly Readonly<{ membershipId: string; displayName: string }>[];
      capabilities: CalendarTaskCapabilities;
    }>;

function Feedback({ text, tone }: Readonly<{ text: string | null; tone: "ok" | "danger" }>) {
  if (!text) return null;
  return <p role={tone === "ok" ? "status" : "alert"} className={`t-body-compact ${tone === "ok" ? "text-ok" : "text-danger"}`}>{text}</p>;
}

function deadlineFields(form: FormData): DeadlineFieldValues {
  const kind = String(form.get("deadline_kind") ?? "");
  return {
    deadlineKind: kind === "all_day" || kind === "timed" ? kind : "none",
    dueOn: String(form.get("due_on") ?? ""),
    dueAt: String(form.get("due_at") ?? ""),
  };
}

const SECTION = "space-y-2 border-t border-border pt-4";
const SECTION_TITLE = "t-item text-fg";
const LINK = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";

/**
 * Подробности задачи в правой панели очереди. Заголовок — название, у задачи
 * по студенту «Открыть дело», срок и исполнитель; тело: завершение →
 * описание → результаты → свёрнутое «Перенести или передать» с прежней
 * формой. Каждая команда — существующее действие, сервер проверяет права.
 */
export function TaskDetailPanel({
  data,
  closeHref,
  day,
  nowIso,
  moveOpen = false,
  readOnly = false,
}: Readonly<{
  data: PanelData;
  closeHref: string;
  day: Day;
  /** Момент чтения сервера: одинаковый срок при рендере и гидрации. */
  nowIso: string;
  /** Открыть сразу «Перенести или передать» (пункт «Передать…» строки). */
  moveOpen?: boolean;
  /** Просмотр интерфейса роли: команды недоступны. */
  readOnly?: boolean;
}>) {
  const router = useRouter();
  const headingId = useId();
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
  const now = new Date(nowIso);
  const projection = projectPlatformTaskDeadline(dueOn, dueAt, now);
  const due = queueDue({ dueOn, dueAt }, now, !isDone);
  const assigneeOptions = data.kind === "staff" ? data.participants : data.assignees;
  const currentAssigneeName = data.task.assigneeDisplayName;
  const exception = status === "blocked" || isDone ? taskStatus(status) : null;
  const caseTask = data.kind === "case" ? {
    id: data.task.id, version: data.task.version, studentCaseId: data.caseId, priority: data.task.priority,
    status: data.task.state, assigneeMembershipId: data.task.assigneeMembershipId, studentVisible: data.task.studentVisible,
    dueOn, dueAt,
  } : null;

  async function run(action: () => Promise<{ status: string }>, copy: Readonly<Record<string, string>>, saved: string, reset?: () => void) {
    setPending(true); setError(null); setNotice(null);
    try {
      const result = await action();
      if (result.status === "saved") { setNotice(saved); reset?.(); router.refresh(); }
      else setError(copy[result.status] ?? "Не удалось сохранить.");
    } catch { setError("Не удалось сохранить. Повторите."); }
    finally { setPending(false); }
  }

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (data.kind === "staff") {
      await run(() => mutateStaffTaskAction(
        { status: "idle", requestId: crypto.randomUUID(), taskId: null, version: null },
        staffStatusForm(data.task, "done", completionNote),
      ), STAFF_ERROR_COPY, "Задача завершена.");
      return;
    }
    if (!completeReason.trim()) { setError("Напишите результат: без него задача по студенту не завершается."); return; }
    await run(() => changePlatformAdmissionsTaskAction(
      { status: "idle", requestId: crypto.randomUUID(), caseTaskId: null, version: null, changedAt: null },
      caseChangeForm(caseTask!, { status: "done", reason: completeReason }),
    ), CASE_ERROR_COPY, "Задача завершена.", () => setCompleteReason(""));
  }

  async function saveAssigneeDue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const deadline = deadlineFields(new FormData(event.currentTarget));
    if (data.kind === "staff") {
      await run(() => mutateStaffTaskAction(
        { status: "idle", requestId: crypto.randomUUID(), taskId: null, version: null },
        staffEditForm(data.task, { assigneeMembershipId: assignee, deadline }),
      ), STAFF_ERROR_COPY, "Сохранено.");
      return;
    }
    if (!editReason.trim()) { setError("Укажите причину изменения."); return; }
    await run(() => changePlatformAdmissionsTaskAction(
      { status: "idle", requestId: crypto.randomUUID(), caseTaskId: null, version: null, changedAt: null },
      caseChangeForm(caseTask!, { assigneeMembershipId: assignee, deadline, reason: editReason }),
    ), CASE_ERROR_COPY, "Сохранено.", () => setEditReason(""));
  }

  return (
    <QueueDetailPanel closeHref={closeHref} backLabel="К задачам" headingId={headingId}>
      <div className="space-y-5" data-testid="v3-task-detail-panel">
        <header className="space-y-2">
          <h2 id={headingId} tabIndex={-1} data-queue-heading="" className="t-record-title break-words text-fg xl:pe-10">{title}</h2>
          {data.kind === "case" ? (
            <p className="flex flex-wrap items-center gap-x-3 t-body-compact text-fg-2">
              <span>{data.task.person ?? "Студент"}{data.task.caseState === "closed" ? " · дело закрыто" : ""}</span>
              <Link href={`/v3/profile?case=${encodeURIComponent(data.caseId)}`} className={LINK}>Открыть дело</Link>
            </p>
          ) : <p className="t-body-compact text-fg-2">Рабочая задача{data.task.sourceMessageId ? " · из чата" : ""}</p>}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1">
            <dt className="t-caption text-fg-3">Срок</dt>
            <dd className="t-body-compact text-fg">
              {due ? <>
                <time dateTime={due.dateTime} className={due.overdue ? "font-mono tabular-nums text-danger" : "font-mono tabular-nums"}>{due.text}</time>
                {due.word ? <span className={due.overdue ? "text-danger" : "text-fg-2"}> · {due.word}</span> : null}
              </> : <span className="text-fg-2">Без срока</span>}
            </dd>
            <dt className="t-caption text-fg-3">Исполнитель</dt>
            <dd className="break-words t-body-compact text-fg">{currentAssigneeName}</dd>
            {exception ? <>
              <dt className="t-caption text-fg-3">Состояние</dt>
              <dd className={`t-body-compact ${status === "blocked" ? "text-warn" : "text-fg-2"}`}>{exception}</dd>
            </> : null}
          </dl>
        </header>

        {!isDone && !readOnly ? (
          <form onSubmit={complete} className="space-y-3 border-t border-border pt-4">
            {data.kind === "staff"
              ? <label className="block t-label text-fg-2">Результат работы · необязательно
                  <textarea value={completionNote} onChange={(event) => setCompletionNote(event.target.value)} maxLength={4000} rows={2} disabled={pending}
                    className={`${QUEUE_FIELD} h-auto min-h-20 py-2`} placeholder="Что сделано и какой следующий шаг" />
                </label>
              : <label className="block t-label text-fg-2">Результат
                  <input value={completeReason} onChange={(event) => setCompleteReason(event.target.value)} required maxLength={1000} disabled={pending}
                    className={QUEUE_FIELD} placeholder="Что сделано" />
                </label>}
            <button type="submit" disabled={pending} className={QUEUE_CONFIRM}>{pending ? "Сохраняем…" : "Завершить"}</button>
          </form>
        ) : null}

        {description ? (
          <section className={SECTION} aria-label="Описание">
            <h3 className={SECTION_TITLE}>Описание</h3>
            <p className="whitespace-pre-wrap break-words t-body-compact text-fg-2">{description}</p>
          </section>
        ) : null}

        {data.kind === "staff" && data.extra && (data.extra.outcomes.length || data.extra.outcomesUnavailable) ? (
          <section className={SECTION} aria-label="Результаты">
            <h3 className={SECTION_TITLE}>Результаты</h3>
            {data.extra.outcomes.map((outcome) => <article key={outcome.requestId} className="border-t border-border pt-2 first-of-type:border-t-0 first-of-type:pt-0">
              <p className="whitespace-pre-wrap break-words t-body-compact text-fg">{outcome.note}</p>
              <p className="mt-1 t-meta text-fg-2">{outcome.author} · {new Date(outcome.createdAt).toLocaleDateString("ru-RU", { timeZone: "Asia/Bishkek" })}</p>
            </article>)}
            {data.extra.outcomesUnavailable ? <p className="t-body-compact text-fg-3">Не удалось загрузить связь с лидом и результаты. Обновите страницу.</p> : null}
          </section>
        ) : null}

        <div className="flex flex-wrap gap-x-5">
          {data.kind === "case" ? (
            <Link href={`/v3/messages?case=${data.caseId}&attach=case_task:${data.task.id}`} className={LINK}>
              Обсудить
            </Link>
          ) : null}
          {data.kind === "staff" && data.extra?.leadHref ? <Link href={data.extra.leadHref} className={LINK}>Открыть связанного лида</Link> : null}
          {data.kind === "staff" && data.extra?.sourceHref ? <Link href={data.extra.sourceHref} className={LINK}>Открыть исходное обсуждение</Link> : null}
        </div>
        {data.kind === "staff" && data.extra && !data.extra.sourceHref && data.extra.sourceUnavailable
          ? <p className="t-body-compact text-fg-3">Исходное обсуждение недоступно для вашей роли или обновите страницу.</p> : null}

        {/* Per the current rule (migration 156_platform_scoped_staff_consumers.sql,
            e.g. :925-931's task.assign/task.manage split; mirrored live by
            CalendarChangeTaskForm, TaskControls.tsx:405-470), only the
            ASSIGNEE control is gated by 'task.assign' -- due, priority and
            status stay editable for any 'task.manage' holder reaching this
            panel. The form itself must always render; only the assignee
            field inside it switches between an editable select and static
            text per capabilities.canAssign, exactly like CalendarChangeTaskForm's
            own canAssign branch (TaskControls.tsx:492-514). */}
        {!readOnly ? (
          <details open={moveOpen} className="group border-t border-border pt-2">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 t-item text-fg [&::-webkit-details-marker]:hidden">
              Перенести или передать
              <Icon name="chevron-down" size={18} className="shrink-0 text-fg-3 group-open:rotate-180" />
            </summary>
            <form onSubmit={saveAssigneeDue} className="space-y-3 pt-2">
              <label className="block t-label text-fg-2">Исполнитель
                {data.kind === "case" && !data.capabilities.canAssign
                  ? <span className="mt-1 block t-body-compact text-fg">{currentAssigneeName}</span>
                  : <select value={assignee} disabled={pending} onChange={(event) => setAssignee(event.target.value)} className={QUEUE_FIELD}>
                      {!assigneeOptions.some((person) => person.membershipId === assignee) ? <option value={assignee} disabled>{currentAssigneeName}</option> : null}
                      {assigneeOptions.map((person) => <option key={person.membershipId} value={person.membershipId}>{person.displayName}</option>)}
                    </select>}
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <DeadlineFields day={day} task={{ dueOn, dueAt, day: projection.day, minutes: projection.minutes }} defaultKind="none" />
              </div>
              {data.kind === "case" ? <label className="block t-label text-fg-2">Причина изменения
                <input value={editReason} onChange={(event) => setEditReason(event.target.value)} required maxLength={1000} disabled={pending} className={QUEUE_FIELD} />
              </label> : null}
              <button type="submit" disabled={pending} className={QUEUE_SECONDARY}>{pending ? "Сохраняем…" : "Сохранить"}</button>
            </form>
          </details>
        ) : null}

        <Feedback text={notice} tone="ok" />
        <Feedback text={error} tone="danger" />
      </div>
    </QueueDetailPanel>
  );
}
