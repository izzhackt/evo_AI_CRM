"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import { btnCls, btnGhostCls, cn, inputCls } from "@/components/ui";
import { TopLayerMenu } from "@/components/v3/board/TopLayerMenu";
import {
  caseClosureAction,
  leadClosureAction,
  type CaseClosureActionState,
  type LeadClosureActionState,
} from "@/lib/platform-closure-actions";
import {
  CASE_CLOSE_OUTCOMES,
  CLOSURE_NOTE_MAX_LENGTH,
  LEAD_CLOSE_REASONS,
  closureNoteInput,
  type CaseClosureReceipt,
  type LeadClosureReceipt,
} from "@/lib/platform-closure-contract";
import { caseCloseOutcome, closureOutcome, closureWords, leadCloseReason } from "@/lib/v3/wording";

export type ClosureKind = "lead" | "case";
type Receipt<K extends ClosureKind> = K extends "lead" ? LeadClosureReceipt : CaseClosureReceipt;

const MENU_ITEM = "flex min-h-11 w-full items-center rounded-nav px-2 text-left t-body-compact text-fg hover:bg-surface-2";
const DATE = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Bishkek" });

function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/** Дата закрытия: плотная дата — моноширинная, с `<time>`. */
export function ClosureDate({ at }: Readonly<{ at: string }>) {
  return <time dateTime={at} className="font-mono tabular-nums">{DATE.format(new Date(at))}</time>;
}

/** «Не отвечает» / «Другое: текст» — причина или исход словами. */
export function closureReasonText(kind: ClosureKind, key: string | null, note: string | null): string | null {
  const word = kind === "lead" ? leadCloseReason(key) : caseCloseOutcome(key);
  if (word === null) return null;
  return key === "other" && note ? `${word}: ${note}` : word;
}

async function submitClosure<K extends ClosureKind>(
  kind: K,
  input: Readonly<{ id: string; version: string; closed: boolean; key: string; note: string; requestId: string }>,
): Promise<LeadClosureActionState | CaseClosureActionState> {
  const form = new FormData();
  form.set(kind === "lead" ? "lead_id" : "student_case_id", input.id);
  form.set("expected_version", input.version);
  form.set("closed", input.closed ? "true" : "false");
  form.set(kind === "lead" ? "reason" : "outcome", input.key);
  form.set("note", input.note);
  form.set("request_id", input.requestId);
  const idle = { status: "idle" as const, requestId: input.requestId, message: null, receipt: null };
  return kind === "lead" ? leadClosureAction(idle, form) : caseClosureAction(idle, form);
}

/**
 * Окно «Закрыть лид» / «Завершить дело». Действие обратимое, поэтому без
 * пугающего красного на странице: красная только кнопка подтверждения внутри
 * окна. Причина обязательна; «Другое» просит одну строку текста. «Закрыто» —
 * только по квитанции сервера; неизвестный исход повторяется тем же request
 * id (сервер не закроет дважды), конфликт версии предлагает «Обновить».
 */
export function ClosureDialog<K extends ClosureKind>({
  kind,
  subjectId,
  subjectName,
  expectedVersion,
  onClose,
  onDone,
}: Readonly<{
  kind: K;
  subjectId: string;
  subjectName: string;
  expectedVersion: string;
  onClose: () => void;
  onDone: (receipt: Receipt<K>) => void;
}>) {
  const router = useRouter();
  const words = kind === "lead" ? closureWords.lead : closureWords.case;
  const keys: readonly string[] = kind === "lead" ? LEAD_CLOSE_REASONS : CASE_CLOSE_OUTCOMES;
  const titleId = useId();
  const noteId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Readonly<{ text: string; field: "choice" | "note" | null; stale: boolean }> | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // Поле внутри <dialog> становится фокусируемым только после showModal().
    firstRef.current?.focus();
    return () => dialog.close();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const checked = closureNoteInput(choice, note);
    if (!checked.ok) {
      setError(checked.error === "key"
        ? { text: kind === "lead" ? "Выберите причину." : "Выберите исход.", field: "choice", stale: false }
        : checked.error === "note_required"
          ? { text: "Напишите, что случилось.", field: "note", stale: false }
          : { text: `Одна строка до ${CLOSURE_NOTE_MAX_LENGTH} символов.`, field: "note", stale: false });
      (checked.error === "key" ? firstRef : noteRef).current?.focus();
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const state = await submitClosure(kind, {
        id: subjectId, version: expectedVersion, closed: true, key: choice ?? "", note: checked.note ?? "", requestId,
      });
      setRequestId(state.requestId);
      if (state.status === "saved" && state.receipt) {
        onDone(state.receipt as Receipt<K>);
        return;
      }
      setError({ text: state.message ?? closureOutcome("unavailable", kind, true) ?? "", field: null, stale: state.status === "stale" });
    } catch {
      // Ответа нет — исход неизвестен: тот же request id повторит запись, а не создаст вторую.
      setError({ text: closureOutcome("unavailable", kind, true) ?? "", field: null, stale: false });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-testid={kind === "lead" ? "v3-close-lead-dialog" : "v3-close-case-dialog"}
      onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] max-w-none rounded-card border border-border bg-surface p-0 text-fg shadow-evo-lg backdrop:bg-black/45"
    >
      <form onSubmit={submit} noValidate aria-busy={pending} className="flex max-h-[85dvh] flex-col">
        <header className="border-b border-border px-4 py-3">
          <h2 id={titleId} className="t-section text-fg">{words.action}</h2>
          <p className="t-body-compact break-words text-fg-2">{subjectName}</p>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <fieldset className="min-w-0" disabled={pending}
            aria-invalid={error?.field === "choice" ? true : undefined}
            aria-describedby={error?.field === "choice" ? errorId : undefined}>
            <legend className="t-label text-fg">{words.legend}</legend>
            <div className="mt-1 flex flex-col">
              {keys.map((key, index) => (
                <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-nav px-2 t-body text-fg hover:bg-surface-2">
                  <input
                    ref={index === 0 ? firstRef : undefined}
                    type="radio"
                    name="closure_choice"
                    value={key}
                    checked={choice === key}
                    onChange={() => { setChoice(key); if (error?.field === "choice") setError(null); }}
                    className="size-4 shrink-0 accent-fg"
                  />
                  {kind === "lead" ? leadCloseReason(key) : caseCloseOutcome(key)}
                </label>
              ))}
            </div>
          </fieldset>
          {choice === "other" ? (
            <div>
              <label htmlFor={noteId} className="block t-label text-fg">{closureWords.noteLabel}</label>
              <input
                ref={noteRef}
                id={noteId}
                type="text"
                value={note}
                maxLength={CLOSURE_NOTE_MAX_LENGTH}
                autoComplete="off"
                required
                disabled={pending}
                onChange={(event) => { setNote(event.target.value); if (error?.field === "note") setError(null); }}
                aria-invalid={error?.field === "note" ? true : undefined}
                aria-describedby={error?.field === "note" ? errorId : undefined}
                className={cn(inputCls, "mt-1 aria-[invalid=true]:border-danger")}
              />
            </div>
          ) : null}
          {error ? <p id={errorId} role="alert" className="t-body-compact text-danger">{error.text}</p> : null}
        </div>
        {/* Телефон: кнопки во всю ширину одна под другой, подтверждение сверху; шире — в ряд справа. */}
        <footer className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end">
          {error?.stale ? (
            <button type="button" className={cn(btnGhostCls, "whitespace-nowrap")} onClick={() => { router.refresh(); onClose(); }}>
              Обновить
            </button>
          ) : null}
          <button type="button" className={cn(btnGhostCls, "whitespace-nowrap")} disabled={pending} onClick={onClose}>
            {closureWords.cancel}
          </button>
          <button type="submit" className={cn(btnCls, "whitespace-nowrap")} disabled={pending || Boolean(error?.stale)}>
            {pending ? words.pending : words.action}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

/**
 * «⋯» записи: одно действие закрытия. Лид, который закрыть нельзя (передан в
 * поступление), показывает недоступный пункт и причину — не прячет её.
 */
export function CloseRecordMenu<K extends ClosureKind>({
  kind,
  subjectId,
  subjectName,
  expectedVersion,
  blockedReason = null,
  onClosed,
  triggerClassName,
}: Readonly<{
  kind: K;
  subjectId: string;
  subjectName: string;
  expectedVersion: string;
  /** Почему закрыть нельзя; null — можно. */
  blockedReason?: string | null;
  /** После квитанции; по умолчанию страница перечитывается. */
  onClosed?: (receipt: Receipt<K>) => void;
  triggerClassName?: string;
}>) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const hintId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const words = kind === "lead" ? closureWords.lead : closureWords.case;
  // Окно закрыто без действия — фокус возвращается на «⋯» (пункт меню уже скрыт).
  const cancel = () => {
    setDialogOpen(false);
    anchorRef.current?.querySelector<HTMLButtonElement>("button[popovertarget]")?.focus();
  };
  return (
    <div ref={anchorRef} className="contents">
      <TopLayerMenu
        label={closureWords.more}
        trigger={<Icon name="more-horizontal" size={20} />}
        triggerClassName={triggerClassName ?? "flex size-11 shrink-0 items-center justify-center rounded-nav text-fg-2 hover:bg-surface-2 hover:text-fg"}
        menuClassName="w-72 max-w-[calc(100vw-2rem)] rounded-ctl border border-border bg-surface p-1 shadow-evo-lg"
        testId={kind === "lead" ? "v3-lead-actions-menu" : "v3-case-actions-menu"}
      >
        {(close) => blockedReason ? (
          <div className="px-2 py-1">
            <button type="button" aria-disabled="true" aria-describedby={hintId}
              className="flex min-h-11 w-full cursor-not-allowed items-center text-left t-body-compact text-fg-3">
              {words.action}
            </button>
            <p id={hintId} className="t-meta pb-1 text-fg-2">{blockedReason}</p>
          </div>
        ) : (
          <button type="button" className={MENU_ITEM} onClick={() => { close(); setDialogOpen(true); }}>
            {words.action}…
          </button>
        )}
      </TopLayerMenu>
      {dialogOpen ? (
        <ClosureDialog
          kind={kind}
          subjectId={subjectId}
          subjectName={subjectName}
          expectedVersion={expectedVersion}
          onClose={cancel}
          onDone={(receipt) => {
            setDialogOpen(false);
            if (onClosed) onClosed(receipt);
            else router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Тихая строка закрытого: «Закрыт · причина · дата · Вернуть в работу».
 * «Вернуть в работу» — настоящая обратная команда (тот же RPC), без окна:
 * возврат сам обратим. После квитанции страница перечитывается или
 * вызывающий решает сам (`onReopened`).
 */
export function ClosedLine<K extends ClosureKind>({
  kind,
  subjectId,
  expectedVersion,
  reasonKey,
  note,
  closedAt,
  canReopen,
  subject,
  onReopened,
  className,
}: Readonly<{
  kind: K;
  subjectId: string;
  expectedVersion: string;
  reasonKey: string | null;
  note: string | null;
  closedAt: string | null;
  canReopen: boolean;
  /** Кто закрыт — в строке-уведомлении списка («Лид «Имя»»). */
  subject?: ReactNode;
  onReopened?: (receipt: Receipt<K>) => void;
  className?: string;
}>) {
  const router = useRouter();
  const [requestId, setRequestId] = useState(newRequestId);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Readonly<{ ok: boolean; text: string }> | null>(null);
  const busy = useRef(false);
  const words = kind === "lead" ? closureWords.lead : closureWords.case;
  const reason = closureReasonText(kind, reasonKey, note);

  async function reopen() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setResult(null);
    try {
      const state = await submitClosure(kind, { id: subjectId, version: expectedVersion, closed: false, key: "", note: "", requestId });
      setRequestId(state.requestId);
      if (state.status === "saved" && state.receipt) {
        setResult({ ok: true, text: state.message ?? "" });
        if (onReopened) onReopened(state.receipt as Receipt<K>);
        else router.refresh();
        return;
      }
      setResult({ ok: false, text: state.message ?? closureOutcome("unavailable", kind, false) ?? "" });
    } catch {
      setResult({ ok: false, text: closureOutcome("unavailable", kind, false) ?? "" });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const parts: ReactNode[] = [<span key="state" className="font-medium text-fg">{subject ? <>{subject} {words.closed.toLowerCase()}</> : words.closed}</span>];
  if (reason) parts.push(<span key="reason" className="min-w-0 break-words">{reason}</span>);
  if (closedAt) parts.push(<ClosureDate key="date" at={closedAt} />);
  else if (kind === "lead") parts.push(<span key="date">{closureWords.lead.noDate}</span>);
  // Точка-разделитель переносится вместе со своей частью: строка не кончается «·».
  const dot = <span aria-hidden="true" className="text-fg-3">·</span>;
  // Возвращено: строка закрытого больше не правда — остаётся только итог.
  if (result?.ok) {
    return (
      <div className={cn("space-y-1", className)} data-testid={kind === "lead" ? "v3-lead-closed-line" : "v3-case-closed-line"}>
        <p role="status" className="flex min-h-11 items-center t-body-compact text-ok">
          {subject ? <span>{subject} снова в работе.</span> : result.text}
        </p>
      </div>
    );
  }
  return (
    <div className={cn("space-y-1", className)} data-testid={kind === "lead" ? "v3-lead-closed-line" : "v3-case-closed-line"}>
      <p className="flex flex-wrap items-center gap-x-2 t-body-compact text-fg-2">
        {parts.map((part, index) => index === 0 ? part : (
          <span key={`part-${index}`} className="inline-flex min-w-0 items-center gap-x-2">{dot}{part}</span>
        ))}
        {canReopen ? (
          <span className="inline-flex items-center gap-x-2">
            {dot}
            <button type="button" onClick={() => void reopen()} disabled={pending} aria-busy={pending}
              className="inline-flex min-h-11 items-center whitespace-nowrap t-label text-fg underline underline-offset-4 hover:text-fg-2 disabled:cursor-wait disabled:text-fg-3">
              {pending ? closureWords.reopening : closureWords.reopen}
            </button>
          </span>
        ) : null}
      </p>
      {result ? <p role="alert" className="t-body-compact text-danger">{result.text}</p> : null}
    </div>
  );
}

/**
 * Та же команда кнопкой, без «⋯» — для панели «Быстрого просмотра», где у
 * шапки уже стоит крестик панели.
 */
export function CloseRecordButton<K extends ClosureKind>({
  kind,
  subjectId,
  subjectName,
  expectedVersion,
  onClosed,
  className,
}: Readonly<{
  kind: K;
  subjectId: string;
  subjectName: string;
  expectedVersion: string;
  onClosed: (receipt: Receipt<K>) => void;
  className: string;
}>) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const words = kind === "lead" ? closureWords.lead : closureWords.case;
  return (
    <>
      <button ref={triggerRef} type="button" className={className} onClick={() => setDialogOpen(true)}
        data-testid={kind === "lead" ? "v3-close-lead" : "v3-close-case"}>
        {words.action}…
      </button>
      {dialogOpen ? (
        <ClosureDialog
          kind={kind}
          subjectId={subjectId}
          subjectName={subjectName}
          expectedVersion={expectedVersion}
          onClose={() => { setDialogOpen(false); triggerRef.current?.focus(); }}
          onDone={(receipt) => { setDialogOpen(false); onClosed(receipt); }}
        />
      ) : null}
    </>
  );
}
