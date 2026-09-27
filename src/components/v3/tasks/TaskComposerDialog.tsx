"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import type { StaffParticipant } from "@/lib/platform-staff-task-contract";
import { mutateStaffTaskAction } from "@/lib/platform-staff-task-actions";
import { createPlatformAdmissionsTaskAction } from "@/lib/platform-admissions-task-actions";
import { PLATFORM_CASE_TASK_PRIORITIES, type PlatformCaseTaskPriority } from "@/lib/platform-admissions-task-contract";
import { readTaskCaseAssigneesAction } from "@/lib/v3/task-case-actions";
import { readTaskComposerAssigneesAction } from "@/lib/v3/task-composer-actions";
import { ComposerDeadlineField } from "./ComposerDeadlineField";
import { TaskCasePicker } from "./TaskCasePicker";
import { nextComposerRequestId } from "./composer-request-id";
import { QUEUE_SECONDARY } from "../queue/queue-buttons";
import type { CalendarCaseOption, Day } from "../calendar/types";

/** Поле диалога: 16 px (`t-body`) — без увеличения на iPhone, как у полей очереди. */
const CONTROL = "mt-1 min-h-11 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2.5 t-body text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:ring-2 focus:ring-accent/10 disabled:bg-surface-2";
/** Единственный сплошной красный — «Создать задачу» (и «Открыть задачу» после сохранения). */
const PRIMARY = "inline-flex min-h-11 items-center justify-center rounded-ctl bg-accent px-4 t-label text-on-accent hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55";
const SECONDARY = QUEUE_SECONDARY;
/** Подпись поля — роль `t-label`, как у окон массовых действий. */
const LABEL = "block t-label text-fg";
/** Тихая кнопка в строке контекста: «Убрать» дело, «Повторить» чтение. */
const QUIET = "inline-flex min-h-11 items-center rounded-ctl px-2 t-label text-fg-2 underline underline-offset-4 hover:text-fg";
/** Свёрнутые необязательные поля: без треугольника браузера, рисованная стрелка рядом с подписью (как у фильтров). */
const DISCLOSURE = "flex min-h-11 w-full cursor-pointer list-none items-center gap-1.5 t-label text-fg-2 hover:text-fg [&::-webkit-details-marker]:hidden";
const PRIORITY_LABEL: Record<PlatformCaseTaskPriority, string> = { low: "Низкий", normal: "Обычный", high: "Высокий", urgent: "Срочный" };

type ComposerStatus = "idle" | "saved" | "invalid" | "forbidden" | "stale" | "request_conflict" | "unavailable";
type ComposerState = Readonly<{ status: ComposerStatus; href: string | null }>;
type Draft = Readonly<{ title: string; description: string }>;
type CaseAssignee = Readonly<{ membershipId: string; displayName: string }>;
type StaffPeople = Readonly<{ status: "loading" | "ready" | "unavailable"; rows: readonly StaffParticipant[] }>;

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

/**
 * Единственный диалог создания задачи (Э7, «Один способ создать задачу»).
 * Его открывает каждый вход: «Создать задачу» оболочки и Ctrl+K
 * (`TaskComposerHost`), строка «Новая задача…» «Задач», «Новая задача»
 * календаря, «+ Задача» дела и «Быстрого просмотра», «Задача по лиду» Lead
 * 360. Вход заполняет контекст — дело, лид, сообщение, день срока, набранное
 * название; поля и команды одни: с делом — задача по студенту
 * (`create_case_task`), без дела — рабочая (`mutate_staff_task` create).
 */
export function TaskComposerDialog({
  participants = null, actorMembershipId, actor, staffAllowed, caseAllowed, day,
  defaultDueDay = null, initialCase = null, initialCaseAssignees = [], initialCases = [], casesHaveMore = false,
  caseRemovable = false, sourceMessageId, sourceMessageVersion, sourceLeadId, sourceLeadVersion, sourceLeadName = null,
  triggerLabel = "+ Задача", triggerClassName, triggerChildren, triggerTitle, triggerTestId, openIntent = null,
  hideTrigger = false, initialTitle = "", onClosed,
}: Readonly<{
  /** Исполнители рабочей задачи; null — диалог прочитает их сам при открытии. */
  participants?: readonly StaffParticipant[] | null;
  actorMembershipId: string; actor: ActivePlatformActor;
  staffAllowed: boolean; caseAllowed: boolean;
  /** Сегодня в Бишкеке: от него считаются «Сегодня», «Завтра», «Пт». */
  day: Day;
  /** День срока по умолчанию (выбранный день календаря); null — сегодня. */
  defaultDueDay?: Day | null;
  initialCase?: CalendarCaseOption | null;
  initialCaseAssignees?: readonly CaseAssignee[];
  /** Первая страница активных дел для поиска (календарь уже прочитал её). */
  initialCases?: readonly CalendarCaseOption[];
  casesHaveMore?: boolean;
  /** Дело пришло из контекста страницы, а не из входа дела: его можно убрать и поставить рабочую задачу. */
  caseRemovable?: boolean;
  sourceMessageId?: string; sourceMessageVersion?: string;
  sourceLeadId?: string; sourceLeadVersion?: string;
  /** Имя лида для строки контекста в диалоге. */
  sourceLeadName?: string | null;
  triggerLabel?: string; triggerClassName?: string;
  /** Содержимое своей кнопки (значок и подпись); по умолчанию — `triggerLabel`. */
  triggerChildren?: ReactNode;
  triggerTitle?: string;
  triggerTestId?: string;
  /** A fresh, non-null value (e.g. a query-string uuid) reopens the dialog
   * even while already mounted -- the tasks page URL intent (`?create=…&open=…`)
   * and the «Новая задача…» row both rely on this to force-open. */
  openIntent?: string | null;
  /** Без своей кнопки: диалог открывают адрес (`openIntent`), строка «Новая задача…» или оболочка. */
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
    {!hideTrigger ? <button ref={trigger} type="button" aria-haspopup="dialog" title={triggerTitle} data-testid={triggerTestId}
      className={triggerClassName ?? "min-h-11 rounded-ctl bg-accent px-4 text-sm font-semibold text-on-accent hover:opacity-90"}
      onClick={() => setOpen(true)}>{triggerChildren ?? triggerLabel}</button> : null}
    {open ? <TaskComposerModal
      participants={participants} actorMembershipId={actorMembershipId} actor={actor} day={day}
      defaultDueDay={defaultDueDay}
      staffAllowed={staffAllowed} caseAllowed={caseAllowed && !sourceMessageId && !sourceLeadId}
      initialCase={initialCase} initialCaseAssignees={initialCaseAssignees}
      initialCases={initialCases} casesHaveMore={casesHaveMore} caseRemovable={caseRemovable}
      sourceMessageId={sourceMessageId} sourceMessageVersion={sourceMessageVersion}
      sourceLeadId={sourceLeadId} sourceLeadVersion={sourceLeadVersion} sourceLeadName={sourceLeadName}
      initialTitle={initialTitle}
      onClose={() => { setOpen(false); if (trigger.current) trigger.current.focus(); else onClosed?.(); }}
    /> : null}
  </>;
}

function TaskComposerModal({
  participants, actorMembershipId, actor, staffAllowed, caseAllowed, day, defaultDueDay,
  initialCase, initialCaseAssignees, initialCases, casesHaveMore, caseRemovable,
  sourceMessageId, sourceMessageVersion, sourceLeadId, sourceLeadVersion, sourceLeadName, initialTitle, onClose,
}: Readonly<{
  participants: readonly StaffParticipant[] | null; actorMembershipId: string; actor: ActivePlatformActor;
  staffAllowed: boolean; caseAllowed: boolean; day: Day; defaultDueDay: Day | null;
  initialCase: CalendarCaseOption | null;
  initialCaseAssignees: readonly CaseAssignee[];
  initialCases: readonly CalendarCaseOption[]; casesHaveMore: boolean; caseRemovable: boolean;
  sourceMessageId?: string; sourceMessageVersion?: string;
  sourceLeadId?: string; sourceLeadVersion?: string; sourceLeadName: string | null;
  initialTitle: string;
  onClose: () => void;
}>) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  // Дело входа (дело студента, «Быстрый просмотр», контекст страницы) стоит
  // строкой, а не поиском; из контекста страницы его можно убрать.
  const [attachedCase, setAttachedCase] = useState(caseAllowed ? initialCase : null);
  const [caseSectionOpen, setCaseSectionOpen] = useState(Boolean(attachedCase) || !staffAllowed);
  const [caseId, setCaseId] = useState(attachedCase?.id ?? "");
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
  const [studentVisible, setStudentVisible] = useState(false);
  const [staffAssignee, setStaffAssignee] = useState(actorMembershipId);
  const [caseAssignee, setCaseAssignee] = useState(actorMembershipId);
  const [caseCandidates, setCaseCandidates] = useState<Readonly<{
    caseId: string; status: "ready" | "unavailable"; assignees: readonly CaseAssignee[];
  }>>(attachedCase && initialCaseAssignees.length > 0
    ? { caseId: attachedCase.id, status: "ready", assignees: initialCaseAssignees }
    : { caseId: "", status: "unavailable", assignees: [] });
  // Исполнители дела входа уже прочитаны страницей — второе чтение не нужно.
  const knownCaseId = attachedCase && initialCaseAssignees.length > 0 ? attachedCase.id : null;
  // Исполнители рабочей задачи: страница «Задач» передаёт прочитанных, другие
  // входы читают тем же чтением при открытии.
  const [staffPeople, setStaffPeople] = useState<StaffPeople>(participants ? { status: "ready", rows: participants } : { status: "loading", rows: [] });
  const [staffRead, setStaffRead] = useState(0);
  const [state, setState] = useState<ComposerState>({ status: "idle", href: null });
  const [pending, setPending] = useState(false);
  // Каждая новая задача («Создать ещё») — свой срок по умолчанию и свой ключ формы.
  const [attempt, setAttempt] = useState(0);
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
    if (!caseId || knownCaseId === caseId) return;
    // No synchronous "loading" setState here: candidatesReady already reads
    // as false for any caseId the last-landed caseCandidates doesn't match.
    void readTaskCaseAssigneesAction(caseId).then((result) => {
      if (!cancelled) setCaseCandidates({ caseId, status: result.status === "ready" ? "ready" : "unavailable", assignees: result.assignees });
    }).catch(() => { if (!cancelled) setCaseCandidates({ caseId, status: "unavailable", assignees: [] }); });
    return () => { cancelled = true; };
  }, [caseId, knownCaseId]);

  useEffect(() => {
    let cancelled = false;
    if (participants || !staffAllowed) return;
    void readTaskComposerAssigneesAction().then((result) => {
      if (!cancelled) setStaffPeople(result.status === "ready" ? { status: "ready", rows: result.participants } : { status: "unavailable", rows: [] });
    }).catch(() => { if (!cancelled) setStaffPeople({ status: "unavailable", rows: [] }); });
    return () => { cancelled = true; };
  }, [participants, staffAllowed, staffRead]);

  const caseMode = caseAllowed && (caseSectionOpen || !staffAllowed);
  const candidatesReady = caseCandidates.caseId === caseId && caseCandidates.status === "ready";
  // Without "task.assign" the actor may only assign a case task to
  // themselves -- the same guard the case task command enforces.
  const canAssignCaseTask = staffHasPermission(actor, "task.assign");
  // «Видимость студенту» — только с отдельным правом; иначе задача скрыта от студента.
  const canChangeVisibility = staffHasPermission(actor, "task.visibility.manage");
  const caseAssigneeOptions = candidatesReady
    ? (canAssignCaseTask ? caseCandidates.assignees : caseCandidates.assignees.filter((person) => person.membershipId === actorMembershipId))
    : [];
  // A selection left over from a previously selected case must not submit
  // once the case switches and the new candidate list no longer contains it.
  const eligibleCaseAssignee = caseAssigneeOptions.some((person) => person.membershipId === caseAssignee);
  const locked = pending || state.status === "saved";
  const submitBlocked = locked || (caseMode
    ? !caseId || !candidatesReady || !eligibleCaseAssignee
    : !staffAllowed || staffPeople.status !== "ready");

  // Окно закрывается до возврата фокуса: пока модальное окно открыто,
  // страница под ним инертна и фокус на её кнопку не встанет.
  function close() {
    dialogRef.current?.close();
    onClose();
  }

  function detachCase() {
    setAttachedCase(null);
    setCaseId("");
    setCaseSectionOpen(false);
  }

  function createAnother() {
    setState({ status: "idle", href: null });
    // Дело, найденное поиском, выбирается заново: поиск после сохранения пуст.
    if (!attachedCase) setCaseId("");
    setTitle("");
    setDescription("");
    setAttempt((value) => value + 1);
    requestId.current = crypto.randomUUID();
    requestAnimationFrame(() => titleInputRef.current?.focus());
  }

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
        form.set("student_visible", canChangeVisibility && studentVisible ? "true" : "false");
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
          const shown = result.status === "saved" ? "unavailable" : result.status;
          setState({ status: shown, href: null });
          // Не подтверждено — тот же ключ: повтор вернёт уже сохранённую задачу, а не создаст вторую.
          requestId.current = nextComposerRequestId(shown, requestId.current);
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
          const shown = result.status === "saved" ? "unavailable" : result.status;
          setState({ status: shown, href: null });
          // Не подтверждено — тот же ключ: повтор вернёт уже сохранённую задачу, а не создаст вторую.
          requestId.current = nextComposerRequestId(shown, requestId.current);
        }
      }
    } catch {
      // Ответ потерян — ключ остаётся прежним (см. nextComposerRequestId).
      setState({ status: "unavailable", href: null });
    } finally {
      setPending(false);
    }
  }

  const errorCopy: Partial<Record<ComposerStatus, string>> = {
    invalid: "Проверьте название, исполнителя и срок.",
    forbidden: "Нет доступа к созданию такой задачи. Обновите страницу.",
    stale: "Данные устарели. Обновите данные и повторите.",
    request_conflict: "Этот запрос уже использован. Проверьте список задач перед повтором.",
    unavailable: "Сохранение пока не подтверждено. Повторите отправку.",
  };
  const extrasLabel = caseMode ? (canChangeVisibility ? "Приоритет и видимость" : "Приоритет") : "Описание и приоритет";

  return <dialog ref={dialogRef} aria-labelledby={titleId} className="m-auto w-[min(40rem,calc(100vw-2rem))] max-w-none rounded-card border border-border bg-surface p-0 text-fg backdrop:bg-black/45"
    onCancel={(event) => { event.preventDefault(); close(); }} data-testid="v3-task-composer-dialog">
    <div className="flex max-h-[85dvh] flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border p-4">
        <h2 id={titleId} className="t-section">Новая задача</h2>
        <button type="button" onClick={close} className={SECONDARY}>Закрыть</button>
      </header>
      {state.status === "saved" ? <div className="space-y-4 p-4">
        <p role="status" className="t-body-compact text-ok">Задача создана.</p>
        <div className="flex flex-wrap gap-3">
          {state.href ? <a href={state.href} className={PRIMARY}>Открыть задачу</a> : null}
          <button type="button" className={SECONDARY} onClick={createAnother}>Создать ещё</button>
          <button type="button" className={SECONDARY} onClick={close}>Готово</button>
        </div>
      </div> : <form onSubmit={submit} className="flex min-h-0 flex-col" data-composer-mode={caseMode ? "case" : "staff"}>
        {/* Поля прокручиваются, «Создать задачу» — в закреплённом низу окна:
            на телефоне с открытыми «Дата» и «Время» главная кнопка остаётся видна. */}
        <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4">
          <label className={LABEL}>Название
            <input ref={titleInputRef} name="title" required maxLength={1000} autoFocus value={title}
              onChange={(event) => setTitle(event.target.value)} disabled={locked} autoComplete="off" className={CONTROL} />
          </label>

          {sourceLeadId ? <p className="t-body-compact" data-composer-context="lead">
            <span className="text-fg-2">Лид: </span>{sourceLeadName ?? "Имя клиента не указано"}
          </p> : null}

          {/* «Без дела» — рядом с именем; перенесённое на телефоне — по левому краю полей (-ms-2 снимает отступ зоны нажатия). */}
          {caseAllowed ? (attachedCase ? <div className="flex flex-wrap items-center gap-x-4 t-body-compact" data-composer-context="case">
            <span><span className="text-fg-2">Студент/дело: </span>{attachedCase.name}</span>
            {caseRemovable && staffAllowed ? <button type="button" className={`${QUIET} -ms-2`} disabled={locked} onClick={detachCase}>
              Без дела
            </button> : null}
          </div> : <details open={caseSectionOpen} onToggle={(event) => setCaseSectionOpen(event.currentTarget.open)} className="group">
            <summary className={DISCLOSURE}>
              Студент/дело · необязательно
              <Icon name="chevron-down" size={16} className="shrink-0 text-fg-3 group-open:rotate-180" />
            </summary>
            <div className="grid gap-3 pt-2 sm:grid-cols-2">
              <TaskCasePicker initialCases={initialCases} initialHasMore={casesHaveMore} onCaseChange={setCaseId} disabled={locked || !caseMode} />
            </div>
          </details>) : null}

          <label className={LABEL}>Исполнитель
            {caseMode
              ? <select required disabled={locked || !candidatesReady} value={caseAssignee}
                  onChange={(event) => setCaseAssignee(event.target.value)} className={CONTROL}>
                  {!eligibleCaseAssignee ? <option value={caseAssignee} disabled>Выберите исполнителя</option> : null}
                  {caseAssigneeOptions.map((person) => <option key={person.membershipId} value={person.membershipId}>{person.displayName}</option>)}
                </select>
              : <select required disabled={locked || staffPeople.status !== "ready"} value={staffAssignee} onChange={(event) => setStaffAssignee(event.target.value)} className={CONTROL}>
                  {!staffPeople.rows.some((person) => person.membershipId === staffAssignee) ? <option value={staffAssignee} disabled>{staffPeople.status === "loading" ? "Загружаем сотрудников…" : "Выберите сотрудника"}</option> : null}
                  {staffPeople.rows.map((person) => <option key={person.membershipId} value={person.membershipId}>{person.displayName}</option>)}
                </select>}
            {caseMode && !candidatesReady ? <span className="mt-1 block t-meta text-fg-2">{!caseId ? "Выберите дело студента." : caseCandidates.caseId === caseId && caseCandidates.status === "unavailable" ? "Не удалось проверить исполнителей. Обновите страницу." : "Проверяем исполнителей выбранного дела…"}</span> : null}
            {caseMode && candidatesReady && caseAssigneeOptions.length === 0 ? <span role="alert" className="mt-1 block t-body-compact text-danger">Нет доступного исполнителя для этого дела.</span> : null}
          </label>
          {!caseMode && staffPeople.status === "unavailable" ? <p role="alert" className="flex flex-wrap items-center gap-x-2 t-body-compact text-danger">
            Не удалось загрузить сотрудников.
            <button type="button" className={QUIET} onClick={() => { setStaffPeople({ status: "loading", rows: [] }); setStaffRead((value) => value + 1); }}>Повторить</button>
          </p> : null}

          <ComposerDeadlineField key={attempt} day={day} defaultDay={defaultDueDay} disabled={locked} />

          <details className="group">
            <summary className={DISCLOSURE}>
              {extrasLabel}
              <Icon name="chevron-down" size={16} className="shrink-0 text-fg-3 group-open:rotate-180" />
            </summary>
            <div className="grid gap-3 pt-2 sm:grid-cols-2">
              {!caseMode ? <label className={`${LABEL} sm:col-span-2`}>Описание
                <textarea maxLength={10000} rows={3} value={description} disabled={locked}
                  onChange={(event) => setDescription(event.target.value)} className={CONTROL} />
              </label> : null}
              <label className={LABEL}>Приоритет
                <select name="priority" value={priority} disabled={locked} onChange={(event) => setPriority(event.target.value as PlatformCaseTaskPriority)} className={CONTROL}>
                  {PLATFORM_CASE_TASK_PRIORITIES.map((value) => <option key={value} value={value}>{PRIORITY_LABEL[value]}</option>)}
                </select>
              </label>
              {caseMode && canChangeVisibility ? <label className={LABEL}>Видимость студенту
                <select name="student_visible" value={studentVisible ? "true" : "false"} disabled={locked}
                  onChange={(event) => setStudentVisible(event.target.value === "true")} className={CONTROL}>
                  <option value="false">Скрыта</option>
                  <option value="true">Видна</option>
                </select>
              </label> : null}
            </div>
          </details>
        </div>

        <div className="shrink-0 space-y-2 border-t border-border p-4">
          {state.status !== "idle" && errorCopy[state.status] ? <p role="alert" className="flex flex-wrap items-center gap-x-2 t-body-compact text-danger">
            {errorCopy[state.status]}
            {state.status === "stale" ? <button type="button" className={QUIET} onClick={() => router.refresh()}>Обновить данные</button> : null}
          </p> : null}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={submitBlocked} className={PRIMARY}>
              {pending ? "Создаём…" : "Создать задачу"}
            </button>
            <button type="button" className={SECONDARY} onClick={close}>Отмена</button>
          </div>
        </div>
      </form>}
    </div>
  </dialog>;
}
