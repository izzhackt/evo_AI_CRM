"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Icon } from "@/components/icons";

import { shiftDay } from "../calendar/types";
import { bulkSummary, bulkSummaryText, keysToKeep, plural, runBulk, type BulkCommand, type BulkItem, type BulkOutcome } from "./bulk-run";
import { formatQueueDay, nextFriday } from "./due-bucket";
import { QUEUE_CONFIRM, QUEUE_FIELD, QUEUE_SECONDARY } from "./queue-buttons";

export type BulkNoun = Readonly<{ one: string; few: string; many: string }>;

/**
 * Выбор строк очереди для массовых действий. Выбор живёт, пока строки на
 * странице: строка, ушедшая после обновления, из выбора выпадает.
 */
export function useBulkSelection(keys: readonly string[]) {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const present = new Set(keys);
  const live = selected.filter((key) => present.has(key));
  return {
    keys: live,
    count: live.length,
    has: (key: string) => live.includes(key),
    toggle: (key: string) => setSelected((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]),
    set: (next: readonly string[]) => setSelected([...next]),
    clear: () => setSelected([]),
  };
}
export type BulkSelection = ReturnType<typeof useBulkSelection>;

/**
 * Ключ запроса строки: один на попытку. Ответ «не подтверждено» оставляет
 * ключ — повтор той же строки повторяет тот же запрос, а не делает второй.
 */
export function useBulkRequestIds() {
  const ids = useRef(new Map<string, string>());
  return {
    idFor(key: string): string {
      const existing = ids.current.get(key);
      if (existing) return existing;
      const next = crypto.randomUUID();
      ids.current.set(key, next);
      return next;
    },
    settle(key: string, keep: boolean): void {
      if (!keep) ids.current.delete(key);
    },
  };
}

/**
 * Отметка строки для действий. Нейтральная (не красная): «выбрано» — не
 * тревога. Зона нажатия 44 px поверх ссылки строки; клавиша «x» делает то же.
 */
export function RowSelect({ label, checked, onToggle }: Readonly<{ label: string; checked: boolean; onToggle: () => void }>) {
  return (
    <label className="relative z-10 grid size-11 shrink-0 cursor-pointer place-items-center rounded-nav hover:bg-surface-2">
      <input
        type="checkbox"
        data-queue-select=""
        checked={checked}
        onChange={onToggle}
        aria-label={`Выбрать: ${label}`}
        className="size-[18px] cursor-pointer accent-fg"
      />
    </label>
  );
}

/**
 * Строка действий над выбранным — у нижнего края списка, пока что-то
 * выбрано. Число — из самого выбора; кнопки действий — нейтральные
 * (сплошной красный на странице один).
 */
export function BulkBar({
  selection,
  allKeys,
  noun,
  keep = false,
  children,
}: Readonly<{
  selection: BulkSelection;
  /** Все выбираемые строки этой страницы — для «Выбрать все». */
  allKeys: readonly string[];
  noun: BulkNoun;
  /** Окно действия открыто: строка остаётся, даже если выбор опустел (итог ещё на экране). */
  keep?: boolean;
  children: ReactNode;
}>) {
  if (selection.count === 0 && !keep) return null;
  const all = selection.count === allKeys.length;
  return (
    <div
      role="region"
      aria-label="Действия с выбранными"
      data-testid="queue-bulk-bar"
      className="v3-bulk-bar sticky z-30 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-ctl border border-border bg-surface px-3 py-2 shadow-evo-lg"
    >
      <p className="t-item text-fg" aria-live="polite">
        Выбрано <span className="tabular-nums">{selection.count}</span> {plural(selection.count, noun)}
      </p>
      {/* На телефоне первая строка короче — «Все · N», действия встают строкой ниже. */}
      {!all ? (
        <button type="button" onClick={() => selection.set(allKeys)} className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">
          <span className="sm:hidden"><span className="sr-only">Выбрать </span>Все<span className="sr-only"> на странице</span></span><span className="hidden sm:inline">Выбрать все на странице</span>{" · "}<span className="tabular-nums">{allKeys.length}</span>
        </button>
      ) : null}
      <button type="button" onClick={selection.clear} className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">
        Снять выбор
      </button>
      <div className="flex w-full flex-wrap items-center gap-2 sm:ms-auto sm:w-auto">{children}</div>
    </div>
  );
}

type Phase =
  | Readonly<{ kind: "form" }>
  | Readonly<{ kind: "running"; done: number; total: number }>
  | Readonly<{ kind: "done"; outcomes: readonly BulkOutcome[] }>;

/**
 * Окно массового действия (верхний слой): что именно изменится и у скольких
 * строк, строки, к которым действие не подходит, — до отправки; затем
 * «Сохраняем N из M» и итог по каждой строке. Несохранённые остаются
 * выбранными для повтора.
 */
export function BulkActionDialog<Item extends BulkItem>({
  title,
  triggerLabel,
  items,
  skipped,
  noun,
  selection,
  disabled = false,
  validate,
  command,
  onFinished,
  onOpenChange,
  children,
  testId,
}: Readonly<{
  title: string;
  triggerLabel: string;
  /** Строки, к которым действие подходит. */
  items: readonly Item[];
  /** Выбранные строки, к которым действие не подходит, с причиной. */
  skipped: readonly Readonly<{ key: string; label: string; reason: string }>[];
  noun: BulkNoun;
  selection: BulkSelection;
  disabled?: boolean;
  /** Ошибка полей формы до отправки; null — можно отправлять. */
  validate: () => string | null;
  command: BulkCommand<Item>;
  /** После итога (обновить список). */
  onFinished: (outcomes: readonly BulkOutcome[]) => void;
  /** Окно открыто или закрыто — строка действий держится, пока оно открыто. */
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  testId: string;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button[type=submit]")?.focus();
  }, [open]);

  // Итог пришёл: кнопка отправки ушла вместе с формой — фокус на «Готово», в окне.
  useEffect(() => {
    if (phase.kind === "done") doneRef.current?.focus();
  }, [phase.kind]);

  function close() {
    if (phase.kind === "running") return;
    setOpen(false);
    onOpenChange(false);
    dialogRef.current?.close();
    setPhase({ kind: "form" });
    setError(null);
    triggerRef.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase.kind !== "form" || items.length === 0) return;
    const invalid = validate();
    if (invalid) { setError(invalid); return; }
    setError(null);
    setPhase({ kind: "running", done: 0, total: items.length });
    const outcomes = await runBulk(items, command, (done) => setPhase({ kind: "running", done, total: items.length }));
    const all = [...outcomes, ...skipped.map((row) => ({ ...row, status: "skipped" as const }))];
    setPhase({ kind: "done", outcomes: all });
    selection.set(keysToKeep(all));
    onFinished(all);
  }

  const summary = phase.kind === "done" ? bulkSummary(phase.outcomes) : null;
  const problems = phase.kind === "done" ? phase.outcomes.filter((outcome) => outcome.status !== "saved") : [];

  return (
    <>
      <button ref={triggerRef} type="button" aria-haspopup="dialog" disabled={disabled || items.length === 0}
        onClick={() => { setOpen(true); onOpenChange(true); }} className={QUEUE_SECONDARY} data-testid={`${testId}-trigger`}>
        {triggerLabel}
        {items.length ? <span className="tabular-nums text-fg-3">· {items.length}</span> : null}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        data-testid={testId}
        onCancel={(event) => { event.preventDefault(); close(); }}
        className="m-auto w-[min(34rem,calc(100vw-2rem))] max-w-none rounded-card border border-border bg-surface p-0 text-fg shadow-evo-lg backdrop:bg-black/45"
      >
        {open ? <div className="flex max-h-[85dvh] flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-border p-4">
            <h2 id={titleId} className="t-section">{title}</h2>
            <button type="button" onClick={close} disabled={phase.kind === "running"} className={QUEUE_SECONDARY}>Закрыть</button>
          </header>
          {phase.kind === "done" && summary ? (
            <div className="space-y-3 overflow-y-auto p-4" data-bulk-result="">
              <p role="status" className="t-item text-fg">
                {bulkSummaryText(summary, noun)}
              </p>
              {problems.length ? (
                <ul className="divide-y divide-border border-y border-border" aria-label="Не сохранено">
                  {problems.map((outcome) => (
                    <li key={outcome.key} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 py-2 t-body-compact" data-bulk-outcome={outcome.status}>
                      {/* Отказ команды — знак проблемы; неподошедшее — нейтральный знак: его и не отправляли. */}
                      <Icon name={outcome.status === "failed" ? "alert" : "x"} size={16} className={`mt-0.5 ${outcome.status === "failed" ? "text-danger" : "text-fg-3"}`} />
                      <span className="min-w-0">
                        <span className="block break-words font-medium text-fg">{outcome.label}</span>
                        <span className="block text-fg-2">{outcome.status === "failed" ? "Не сохранено: " : "Не отправлено: "}{outcome.reason}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {summary.failed ? <p className="t-body-compact text-fg-2">Несохранённые остались выбранными: их можно повторить.</p> : null}
              <div className="flex flex-wrap gap-3 border-t border-border pt-4">
                <button ref={doneRef} type="button" onClick={close} className={QUEUE_CONFIRM}>Готово</button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4 overflow-y-auto p-4" aria-busy={phase.kind === "running"}>
              <p className="t-body-compact text-fg">
                Изменим: {items.length} {plural(items.length, noun)}. Каждая строка сохраняется отдельно.
              </p>
              <fieldset disabled={phase.kind === "running"} className="space-y-4">{children}</fieldset>
              {skipped.length ? (
                <details className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 t-label text-fg-2 hover:text-fg [&::-webkit-details-marker]:hidden">
                    Не подходят: <span className="tabular-nums">{skipped.length}</span> — их не трогаем
                    <Icon name="chevron-down" size={16} className="shrink-0 text-fg-3 group-open:rotate-180" />
                  </summary>
                  <ul className="mt-1 divide-y divide-border border-y border-border">
                    {skipped.map((row) => (
                      <li key={row.key} className="py-2 t-body-compact"><span className="font-medium text-fg">{row.label}</span> <span className="text-fg-2">— {row.reason}</span></li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {error ? <p role="alert" className="t-body-compact text-danger">{error}</p> : null}
              {phase.kind === "running" ? <p role="status" className="t-body-compact text-fg-2">Сохраняем <span className="tabular-nums">{phase.done}</span> из <span className="tabular-nums">{phase.total}</span>…</p> : null}
              <div className="flex flex-wrap gap-3 border-t border-border pt-4">
                <button type="submit" disabled={phase.kind === "running" || items.length === 0} className={QUEUE_CONFIRM}>{title}</button>
                <button type="button" onClick={close} disabled={phase.kind === "running"} className={QUEUE_SECONDARY}>Отмена</button>
              </div>
            </form>
          )}
        </div> : null}
      </dialog>
    </>
  );
}

export type BulkDueChoice = "today" | "tomorrow" | "friday" | "date" | "none";

/** День нового срока; null — «Без срока»; "" — дата не выбрана. */
export function bulkDueDay(choice: BulkDueChoice, date: string, today: string): string | null {
  switch (choice) {
    case "today": return today;
    case "tomorrow": return shiftDay(today, 1);
    case "friday": return nextFriday(today);
    case "date": return date;
    case "none": return null;
  }
}

const CHIP = "v3-choice inline-flex min-h-11 items-center rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg";

/**
 * Новый срок для выбранных — те же быстрые варианты, что в диалоге задачи и в
 * редакторе шага: «Сегодня», «Завтра», ближайшая пятница, «Дата…», «Без срока».
 */
export function BulkDueField({ today, choice, date, onChoice, onDate, legend = "Новый срок" }: Readonly<{
  today: string;
  choice: BulkDueChoice;
  date: string;
  onChoice: (choice: BulkDueChoice) => void;
  onDate: (date: string) => void;
  legend?: string;
}>) {
  const friday = nextFriday(today);
  const chips: readonly (readonly [BulkDueChoice, string])[] = [
    ["today", "Сегодня"],
    ["tomorrow", "Завтра"],
    ...(friday !== shiftDay(today, 1) ? [["friday", `Пт ${formatQueueDay(friday, today)}`] as const] : []),
    ["date", "Дата…"],
    ["none", "Без срока"],
  ];
  return (
    <fieldset className="min-w-0">
      <legend className="t-label text-fg">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {chips.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={choice === value} onClick={() => onChoice(value)} className={CHIP}>{label}</button>
        ))}
      </div>
      {choice === "date" ? (
        <label className="mt-3 block t-label text-fg-2">
          Дата
          <input type="date" required value={date} onChange={(event) => onDate(event.target.value)} className={QUEUE_FIELD} />
        </label>
      ) : null}
    </fieldset>
  );
}
