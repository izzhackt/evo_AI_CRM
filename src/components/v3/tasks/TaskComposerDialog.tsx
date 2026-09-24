"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import type { StaffParticipant } from "@/lib/platform-staff-task-contract";
import { mutateStaffTaskAction } from "@/lib/platform-staff-task-actions";
import { createPlatformAdmissionsTaskAction } from "@/lib/platform-admissions-task-actions";
import { PLATFORM_CASE_TASK_PRIORITIES, type PlatformCaseTaskPriority } from "@/lib/platform-admissions-task-contract";
import { readTaskCaseAssigneesAction } from "@/lib/v3/task-case-actions";
import { ComposerDeadlineField } from "./ComposerDeadlineField";
import { TaskCasePicker } from "./TaskCasePicker";
import type { CalendarCaseOption, Day } from "../calendar/types";

const CONTROL = "mt-1 min-h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:bg-surface-2";
const PRIMARY = "inline-flex min-h-11 items-center justify-center rounded-ctl bg-accent px-4 text-sm font-semibold text-on-accent hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55";
const SECONDARY = "inline-flex min-h-11 items-center justify-center rounded-ctl border border-control-edge bg-surface px-3 text-sm font-semibold text-fg-2 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-55";
const PRIORITY_LABEL: Record<PlatformCaseTaskPriority, string> = { low: "Низкий", normal: "Обычный", high: "Высокий", urgent: "Срочный" };

type ComposerStatus = "idle" | "saved" | "invalid" | "forbidden" | "stale" | "request_conflict" | "unavailable";
type ComposerState = Readonly<{ status: ComposerStatus; href: string | null }>;
type Draft = Readonly<{ title: string; description: string }>;

function draftStorageKey(context: string): string {
  return `evo-task-composer-draft:${context}`;
}
function readDraft(context: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(context));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (typeof parsed.title !== "string" || typeof parsed.description !== "string") return null;
    return { title: parsed.title, description: parsed.description };
  } catch { return null; }
}
function writeDraft(context: string, draft: Draft): void {
  try {
    if (!draft.title && !draft.description) { window.localStorage.removeItem(draftStorageKey(context)); return; }
    window.localStorage.setItem(draftStorageKey(context), JSON.stringify(draft));
  } catch { /* per-viewer convenience only; a blocked store must not break the form */ }
}
function clearDraft(context: string): void {
  try { window.localStorage.removeItem(draftStorageKey(context)); } catch { /* see writeDraft */ }
}

export function TaskComposerDialog({
  participants, actorMembershipId, actor, staffAllowed, caseAllowed, day,
  initialCase = null, initialCaseAssignees = [], sourceMessageId, sourceMessageVersion,
  sourceLeadId, sourceLeadVersion, triggerLabel = "+ Задача", triggerClassName, openIntent = null,
  hideTrigger = false, initialTitle = "", onClosed,
}: Readonly<{
  participants: readonly StaffParticipant[]; actorMembershipId: string; actor: ActivePlatformActor;
  staffAllowed: boolean; caseAllowed: boolean; day: Day;
  initialCase?: CalendarCaseOption | null;
  initialCaseAssignees?: readonly Readonly<{ membershipId: string; displayName: string }>[];
  sourceMessageId?: string; sourceMessageVersion?: string;
  sourceLeadId?: string; sourceLeadVersion?: string;
  triggerLabel?: string; triggerClassName?: string;
  /** A fresh, non-null value (e.g. a query-string uuid) reopens the dialog
   * even while already mounted -- the global AppShell "+" nav link and the
   * task-list header both rely on this to force-open across a same-page nav. */
  openIntent?: string | null;
  /** Без своей кнопки: диалог открывают адрес (`openIntent`) или строка «Новая задача…». */
  hideTrigger?: boolean;
  /** Название, набранное до открытия (строка «Новая задача…»); важнее черновика. */
  initialTitle?: string;
  /** Куда вернуть фокус, если своей кнопки нет. */
  onClosed?: () => void;
}>) {
  const [open, setOpen] = useState(openIntent !== null);
  const [seenIntent, setSeenIntent] = useState(openIntent);
  if (seenIntent !== openIntent) {
    setSeenIntent(openIntent);
    if (openIntent !== null) setOpen(true);
  }
  const trigger = useRef<HTMLButtonElement>(null);
  if ((!staffAllowed && !caseAllowed) || isStaffPreview(actor)) return null;
  return <>
    {!hideTrigger ? <button ref={trigger} type="button" aria-haspopup="dialog"
      className={triggerClassName ?? "min-h-11 rounded-ctl bg-accent px-4 text-sm font-semibold text-on-accent hover:opacity-90"}
      onClick={() => setOpen(true)}>{triggerLabel}</button> : null}
    {open ? <TaskComposerModal
      participants={participants} actorMembershipId={actorMembershipId} actor={actor} day={day}
      staffAllowed={staffAllowed} caseAllowed={caseAllowed && !sourceMessageId && !sourceLeadId}
      initialCase={initialCase} initialCaseAssignees={initialCaseAssignees}
      sourceMessageId={sourceMessageId} sourceMessageVersion={sourceMessageVersion}
      sourceLeadId={sourceLeadId} sourceLeadVersion={sourceLeadVersion}
      initialTitle={initialTitle}
      onClose={() => { setOpen(false); if (trigger.current) trigger.current.focus(); else onClosed?.(); }}
    /> : null}
  </>;
}

function TaskComposerModal({
  participants, actorMembershipId, actor, staffAllowed, caseAllowed, day,
  initialCase, initialCaseAssignees, sourceMessageId, sourceMessageVersion,
  sourceLeadId, sourceLeadVersion, initialTitle, onClose,
}: Readonly<{
  participants: readonly StaffParticipant[]; actorMembershipId: string; actor: ActivePlatformActor;
  staffAllowed: boolean; caseAllowed: boolean; day: Day;
  initialCase: CalendarCaseOption | null;
  initialCaseAssignees: readonly Readonly<{ membershipId: string; displayName: string }>[];
  sourceMessageId?: string; sourceMessageVersion?: string;
  sourceLeadId?: string; sourceLeadVersion?: string;
  initialTitle: string;
  onClose: () => void;
}>) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [caseSectionOpen, setCaseSectionOpen] = useState(Boolean(initialCase) || !staffAllowed);
  const [caseId, setCaseId] = useState(initialCase?.id ?? "");
  // Keyed by the CURRENTLY SELECTED case (state), not the initialCase prop:
  // the case picker can change caseId within one open dialog (TaskCasePicker
  // -> onCaseChange), and a draft typed with case A selected must not leak
  // into a later case-B or general session under a stale key.
  const draftContext = caseId ? `case:${caseId}` : sourceMessageId ? `chat:${sourceMessageId}` : sourceLeadId ? `lead:${sourceLeadId}` : "general";
  // Lazy initializers hydrate synchronously from the one draft this exact
  // dialog instance owns -- an effect would set state right after mount for
  // no benefit, since the dialog is freshly created per open() anyway.
  const [title, setTitle] = useState(() => initialTitle.trim() || readDraft(draftContext)?.title || "");
  const [description, setDescription] = useState(() => readDraft(draftContext)?.description ?? "");
  const [priority, setPriority] = useState<PlatformCaseTaskPriority>("normal");
  const [staffAssignee, setStaffAssignee] = useState(actorMembershipId);
  const [caseAssignee, setCaseAssignee] = useState(actorMembershipId);
  const [caseCandidates, setCaseCandidates] = useState<Readonly<{
    caseId: string; status: "ready" | "unavailable"; assignees: readonly Readonly<{ membershipId: string; displayName: string }>[];
  }>>(initialCase ? { caseId: initialCase.id, status: "ready", assignees: initialCaseAssignees } : { caseId: "", status: "unavailable", assignees: [] });
  const [state, setState] = useState<ComposerState>({ status: "idle", href: null });
  const [pending, setPending] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const previousDraftContext = useRef(draftContext);

  useEffect(() => {
    if (state.status === "saved") return;
    if (previousDraftContext.current !== draftContext) {
      // Case switched since the last run: move the in-progress draft to its
      // previous key instead of leaking it under the new one on the next
      // keystroke, then hydrate from whatever the new key already holds.
      writeDraft(previousDraftContext.current, { title, description });
      const next = readDraft(draftContext);
      setTitle(next?.title ?? "");
      setDescription(next?.description ?? "");
      previousDraftContext.current = draftContext;
      return;
    }
    writeDraft(draftContext, { title, description });
  }, [draftContext, title, description, state.status]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    // A field inside a <dialog> is not a focusable area until the dialog is
    // actually shown -- React's own autoFocus commit can land before that,
    // so focus the title explicitly once showModal() has run.
    titleInputRef.current?.focus();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!caseId || initialCase?.id === caseId) return;
    // No synchronous "loading" setState here: candidatesReady already reads
    // as false for any caseId the last-landed caseCandidates doesn't match,
    // exactly like CalendarCreateTaskForm's own candidateState effect.
    void readTaskCaseAssigneesAction(caseId).then((result) => {
      if (!cancelled) setCaseCandidates({ caseId, status: result.status === "ready" ? "ready" : "unavailable", assignees: result.assignees });
    }).catch(() => { if (!cancelled) setCaseCandidates({ caseId, status: "unavailable", assignees: [] }); });
    return () => { cancelled = true; };
  }, [caseId, initialCase?.id]);

  const caseMode = caseAllowed && (caseSectionOpen || !staffAllowed);
  const candidatesReady = caseCandidates.caseId === caseId && caseCandidates.status === "ready";
  // Mirrors CalendarCreateTaskForm's own availableAssignees guard
  // (../calendar/TaskControls.tsx:245-247): without "task.assign" the actor
  // may only assign a case task to themselves.
  const canAssignCaseTask = staffHasPermission(actor, "task.assign");
  const caseAssigneeOptions = candidatesReady
    ? (canAssignCaseTask ? caseCandidates.assignees : caseCandidates.assignees.filter((person) => person.membershipId === actorMembershipId))
    : [];
  // Mirrors CalendarCreateTaskForm's own eligibleAssignee guard
  // (../calendar/TaskControls.tsx:249,278): a selection left over from a
  // previously selected case must not submit once the case switches and the
  // new case's candidate list no longer contains it.
  const eligibleCaseAssignee = caseAssigneeOptions.some((person) => person.membershipId === caseAssignee);
  const locked = pending || state.status === "saved";
  const submitBlocked = locked || (caseMode
    ? !caseId || !candidatesReady || !eligibleCaseAssignee
    : !staffAllowed);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitBlocked) return;
    const raw = new FormData(event.currentTarget);
    const text = (name: string) => String(raw.get(name) ?? "").trim();
    setPending(true);
    try {
      if (caseMode) {
        const form = new FormData();
        form.set("student_case_id", caseId);
        form.set("task_type", "follow_up");
        form.set("title", title.trim());
        form.set("assignee_membership_id", caseAssignee);
        form.set("priority", priority);
        form.set("deadline_kind", text("deadline_kind"));
        form.set("due_on", text("due_on"));
        form.set("due_at", text("due_at"));
        form.set("status", "open");
        form.set("student_visible", "false");
        form.set("request_id", requestId.current);
        form.set("expected_version", "0");
        const result = await createPlatformAdmissionsTaskAction(
          { status: "idle", requestId: requestId.current, caseTaskId: null, version: null, changedAt: null }, form,
        );
        if (result.status === "saved" && result.caseTaskId) {
          setState({ status: "saved", href: `/v3/tasks?task=${result.caseTaskId}&kind=case&case=${caseId}` });
          clearDraft(draftContext);
          router.refresh();
        } else {
          setState({ status: result.status === "saved" ? "unavailable" : result.status, href: null });
          requestId.current = crypto.randomUUID();
        }
      } else {
        const form = new FormData();
        form.set("operation", "create");
        form.set("request_id", requestId.current);
        form.set("expected_version", "0");
        form.set("task_id", "");
        form.set("title", title.trim());
        form.set("assignee_membership_id", staffAssignee);
        form.set("description", description.trim());
        form.set("status", "open");
        form.set("priority", priority);
        form.set("deadline_kind", text("deadline_kind"));
        form.set("due_on", text("due_on"));
        form.set("due_at", text("due_at"));
        form.set("source_message_id", sourceMessageId ?? "");
        form.set("source_message_version", sourceMessageVersion ?? "");
        form.set("source_lead_id", sourceLeadId ?? "");
        form.set("source_lead_version", sourceLeadVersion ?? "");
        form.set("completion_note", "");
        const result = await mutateStaffTaskAction({ status: "idle", requestId: requestId.current, taskId: null, version: null }, form);
        if (result.status === "saved" && result.taskId) {
          setState({ status: "saved", href: `/v3/tasks?task=${result.taskId}` });
          clearDraft(draftContext);
          router.refresh();
        } else {
          setState({ status: result.status === "saved" ? "unavailable" : result.status, href: null });
          requestId.current = crypto.randomUUID();
        }
      }
    } catch {
      setState({ status: "unavailable", href: null });
    } finally {
      setPending(false);
    }
  }

  const errorCopy: Partial<Record<ComposerStatus, string>> = {
    invalid: "Проверьте название, исполнителя и срок.",
    forbidden: "Нет доступа к созданию такой задачи. Обновите страницу.",
    stale: "Данные устарели. Обновите страницу и повторите.",
    request_conflict: "Этот запрос уже использован. Проверьте список задач перед повтором.",
    unavailable: "Сохранение пока не подтверждено. Повторите отправку.",
  };

  return <dialog ref={dialogRef} aria-labelledby={titleId} className="m-auto w-[min(40rem,calc(100vw-2rem))] max-w-none rounded-card border border-border bg-surface p-0 text-fg backdrop:bg-black/45"
    onCancel={(event) => { event.preventDefault(); onClose(); }} data-testid="v3-task-composer-dialog">
    <div className="flex max-h-[85dvh] flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border p-4">
        <h2 id={titleId} className="t-section">Новая задача</h2>
        <button type="button" onClick={onClose} className={SECONDARY}>Закрыть</button>
      </header>
      {state.status === "saved" ? <div className="space-y-4 p-4">
        <p role="status" className="text-sm text-ok">Задача создана.</p>
        <div className="flex flex-wrap gap-3">
          {state.href ? <a href={state.href} className={PRIMARY}>Открыть задачу</a> : null}
          <button type="button" className={SECONDARY} onClick={onClose}>Готово</button>
        </div>
      </div> : <form onSubmit={submit} className="space-y-4 overflow-y-auto p-4">
        <label className="block text-sm font-medium">Название
          <input ref={titleInputRef} name="title" required maxLength={1000} autoFocus value={title}
            onChange={(event) => setTitle(event.target.value)} disabled={locked} autoComplete="off" className={CONTROL} />
        </label>

        {caseAllowed ? (initialCase ? <div className="text-sm">
          <span className="text-fg-2">Студент/дело: </span>{initialCase.name}
        </div> : <details open={caseSectionOpen} onToggle={(event) => setCaseSectionOpen(event.currentTarget.open)}>
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-fg-2">Студент/дело · необязательно</summary>
          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            <TaskCasePicker initialCases={[]} initialHasMore={false} onCaseChange={setCaseId} disabled={locked || !caseMode} />
          </div>
        </details>) : null}

        <label className="block text-sm font-medium">Исполнитель
          {caseMode
            ? <select required disabled={locked || !candidatesReady} value={caseAssignee}
                onChange={(event) => setCaseAssignee(event.target.value)} className={CONTROL}>
                {!eligibleCaseAssignee ? <option value={caseAssignee} disabled>Выберите исполнителя</option> : null}
                {caseAssigneeOptions.map((person) => <option key={person.membershipId} value={person.membershipId}>{person.displayName}</option>)}
              </select>
            : <select required disabled={locked} value={staffAssignee} onChange={(event) => setStaffAssignee(event.target.value)} className={CONTROL}>
                {!participants.some((person) => person.membershipId === staffAssignee) ? <option value={staffAssignee} disabled>Выберите сотрудника</option> : null}
                {participants.map((person) => <option key={person.membershipId} value={person.membershipId}>{person.displayName}</option>)}
              </select>}
          {caseMode && !candidatesReady ? <span className="mt-1 block text-xs text-fg-2">{!caseId ? "Выберите дело студента." : caseCandidates.caseId === caseId && caseCandidates.status === "unavailable" ? "Не удалось проверить исполнителей. Обновите страницу." : "Проверяем исполнителей выбранного дела…"}</span> : null}
        </label>

        <ComposerDeadlineField day={day} disabled={locked} />

        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-fg-2">Описание и приоритет</summary>
          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            {!caseMode ? <label className="text-sm font-medium sm:col-span-2">Описание
              <textarea maxLength={10000} rows={3} value={description} disabled={locked}
                onChange={(event) => setDescription(event.target.value)} className={CONTROL} />
            </label> : null}
            <label className="text-sm font-medium">Приоритет
              <select value={priority} disabled={locked} onChange={(event) => setPriority(event.target.value as PlatformCaseTaskPriority)} className={CONTROL}>
                {PLATFORM_CASE_TASK_PRIORITIES.map((value) => <option key={value} value={value}>{PRIORITY_LABEL[value]}</option>)}
              </select>
            </label>
          </div>
        </details>

        {state.status !== "idle" && errorCopy[state.status] ? <p role="alert" className="text-sm text-danger">{errorCopy[state.status]}</p> : null}
        <div className="flex flex-wrap gap-3 border-t border-border pt-4">
          <button type="submit" disabled={submitBlocked} className={PRIMARY}>
            {pending ? "Создаём…" : "Создать задачу"}
          </button>
          <button type="button" className={SECONDARY} onClick={onClose}>Отмена</button>
        </div>
      </form>}
    </div>
  </dialog>;
}
