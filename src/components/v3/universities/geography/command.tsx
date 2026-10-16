"use client";
import { unstable_rethrow, useRouter } from "next/navigation";
import { startTransition, useActionState, useId, useMemo, useRef, useState, useTransition } from "react";

import { draftSync, geographyMessage } from "@/lib/catalog-geography";
import { mutateCatalogGeographyAction, type GeographyActionState, type GeographyOperation } from "@/lib/catalog-geography-actions";

/*
 * Общие части редактора географии и стоимости (план 7.5): команда RPC с
 * безопасным повтором, слова итога и классы полей. Облик Э1.5: белый лист,
 * волосяные рамки, поля `inputCls`, подписи `t-label`; сплошной красный только
 * у главного действия страницы.
 */
export const FIELD = "mt-1 h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface px-3 t-body-compact text-fg placeholder:text-fg-3 hover:bg-surface-2 focus-visible:border-accent [&[readonly]]:bg-surface-2 [&[readonly]]:text-fg-2 aria-[invalid=true]:border-danger disabled:opacity-60";
export const AREA = "mt-1 min-h-20 w-full min-w-0 rounded-ctl border border-control-edge bg-surface px-3 py-2 t-body-compact text-fg placeholder:text-fg-3 hover:bg-surface-2 focus-visible:border-accent aria-[invalid=true]:border-danger disabled:opacity-60";
export const LABEL = "block t-label text-fg-2";
export const GHOST = "v3-raised inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";
export const PRIMARY = "v3-raised inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-ctl border border-accent bg-accent px-4 t-label text-on-accent hover:border-accent-2 hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-50";
/** Подтверждение в панели: тёмная нейтральная кнопка (сплошной красный на странице один). */
export const DARK = "v3-raised inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-ctl border border-fg bg-fg px-4 t-label text-surface hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
export const QUIET = "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 underline underline-offset-4 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline";

/**
 * Команда одной формы. Повтор после неподтверждённого ответа идёт с тем же
 * `request_id` и тем же входом (RPC вернёт ту же квитанцию); любой новый ввод
 * или определённый итог получает новый `request_id`. `dismiss` прячет
 * показанный итог (рядом виден только итог последнего действия, review CRM N1);
 * на повтор он не влияет.
 */
export function useGeographyCommand(operation: GeographyOperation) {
  const router = useRouter();
  const last = useRef<{ payload: string; requestId: string } | null>(null);
  const [dismissed, setDismissed] = useState<GeographyActionState | null>(null);
  const idle = useMemo<GeographyActionState>(() => ({ status: "idle", requestId: "", operation, reason: null }), [operation]);
  const [state, dispatch, pending] = useActionState(async (previous: GeographyActionState, payload: string): Promise<GeographyActionState> => {
    const retry = previous.status === "unavailable" && last.current?.payload === payload;
    const requestId = retry && last.current ? last.current.requestId : crypto.randomUUID();
    last.current = { payload, requestId };
    const form = new FormData();
    form.set("operation", operation);
    form.set("request_id", requestId);
    form.set("payload", payload);
    try {
      return await mutateCatalogGeographyAction({ ...previous, requestId, operation }, form);
    } catch (error) {
      unstable_rethrow(error);
      return { status: "unavailable", requestId, operation, reason: null };
    }
  }, { status: "idle", requestId: "", operation, reason: null });
  const run = (payload: unknown) => startTransition(() => dispatch(JSON.stringify(payload)));
  const refresh = () => router.refresh();
  return { state: state === dismissed ? idle : state, run, pending, refresh, dismiss: () => setDismissed(state) };
}

/**
 * Черновик формы и версия записи, от которой он начат (review CRM S1).
 * Сохранение отправляет именно эту версию: если запись успели изменить, база
 * отказывает «Запись уже изменили» и чужая правка не затирается. Новая версия
 * записи без своих правок (или равная черновику, как после своего сохранения)
 * сразу становится черновиком. Со своими правками черновик остаётся, пока
 * сотрудник не попросит сохранённую версию: «Обновить страницу» после
 * отказа (`reload`) или `showSaved`. Тогда черновик заменяется, а заменённые
 * поля (`replaced.notes`) можно скопировать.
 *
 * `saved`: итог команды сохранения. Подтверждённое сохранение значит, что
 * черновик уже в базе, даже если поверх успели записать чужую версию
 * (потерянный ответ и «Повторить», review CRM V4): тогда своих правок нет и
 * новая версия просто становится формой.
 */
export function useVersionedDraft<Row extends Readonly<{ version: number }>, Draft>(row: Row | null, rules: Readonly<{
  draft: (row: Row | null) => Draft;
  changed: (draft: Draft, row: Row | null) => boolean;
  notes: (draft: Draft, base: Row | null) => string;
}>, saved?: GeographyActionState) {
  const [draft, setDraft] = useState<Draft>(() => rules.draft(row));
  const [base, setBase] = useState<Row | null>(row);
  const [reloadRequested, setReloadRequested] = useState(false);
  const [replaced, setReplaced] = useState<Readonly<{ version: number; notes: string }> | null>(null);
  const [stored, setStored] = useState<Readonly<{ result: GeographyActionState; draft: Draft }> | null>(null);
  const [refreshing, startRefresh] = useTransition();
  // Поля во время запроса заблокированы, поэтому черновик в момент подтверждения и есть записанный.
  if (saved?.status === "saved" && stored?.result !== saved) setStored({ result: saved, draft });
  const adopt = (next: Row) => { setBase(next); setDraft(rules.draft(next)); setReloadRequested(false); };
  const replace = (next: Row) => { setReplaced({ version: next.version, notes: rules.notes(draft, base) }); adopt(next); };
  // Более старая версия (например, из кэша навигации) черновик не трогает: база всё равно решает по версии.
  if (row !== null && row.version > (base?.version ?? 0)) {
    const ownEdits = stored?.draft === draft ? false : rules.changed(draft, base);
    const sync = draftSync({ ownEdits, matchesSaved: !rules.changed(draft, row), reloadRequested });
    if (sync === "adopt") adopt(row);
    else if (sync === "replace") replace(row);
  } else if (reloadRequested && !refreshing) {
    // Перечитанная страница не принесла новой версии (например, повтор запроса): ждать нечего.
    setReloadRequested(false);
  }
  const behind = row !== null && row.version > (base?.version ?? 0);
  return {
    draft,
    setDraft,
    /** Версия, от которой начат черновик: её и только её отправляет сохранение. */
    baseVersion: base?.version ?? 0,
    /** Сохранена более новая версия, а в черновике свои правки: сохранить поверх нельзя. */
    behind,
    reloading: reloadRequested,
    replaced,
    reload: (refresh: () => void) => { setReloadRequested(true); startRefresh(refresh); },
    showSaved: () => { if (row !== null) replace(row); },
    closeReplaced: () => setReplaced(null),
  };
}

/**
 * Подпись кнопки, которая не меняет размер на время запроса (review CRM V2):
 * место держит более длинная из двух подписей, поэтому соседние кнопки и
 * ссылки не съезжают под указатель при двойном щелчке.
 */
export function BusyLabel({ busy, label, busyLabel = "Сохраняем…" }: Readonly<{ busy: boolean; label: string; busyLabel?: string }>) {
  return (
    <span className="inline-grid justify-items-center">
      <span className={`col-start-1 row-start-1${busy ? " invisible" : ""}`}>{label}</span>
      <span className={`col-start-1 row-start-1${busy ? "" : " invisible"}`}>{busyLabel}</span>
    </span>
  );
}

/** Черновик заменён сохранённой версией: сказать об этом и дать скопировать свой текст (review CRM S1). */
export function ReplacedDraft({ replaced, onClose }: Readonly<{ replaced: Readonly<{ version: number; notes: string }>; onClose: () => void }>) {
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const [open, setOpen] = useState(false);
  const id = useId();
  const copyNotes = () => {
    const write = typeof navigator !== "undefined" ? navigator.clipboard?.writeText(replaced.notes) : undefined;
    if (!write) { setCopy("failed"); setOpen(true); return; }
    write.then(() => setCopy("done"), () => { setCopy("failed"); setOpen(true); });
  };
  return (
    <div role="status" className="space-y-2 rounded-card bg-warn-weak px-4 py-3 text-warn" data-testid="draft-replaced">
      <p className="t-body-compact">Запись изменили после начала вашей правки: форма показывает сохранённую версию {replaced.version}. Ваш несохранённый текст заменён, его можно скопировать и внести снова.</p>
      <div className="flex flex-wrap items-center gap-x-4">
        {replaced.notes ? <button type="button" className={QUIET} onClick={copyNotes}>{copy === "done" ? "Скопировано" : "Скопировать мой текст"}</button> : null}
        {replaced.notes ? <button type="button" className={QUIET} aria-expanded={open} aria-controls={`${id}-notes`} onClick={() => setOpen(!open)}>{open ? "Скрыть мой текст" : "Показать мой текст"}</button> : null}
        <button type="button" className={QUIET} onClick={onClose}>Закрыть</button>
      </div>
      {copy === "failed" ? <p className="t-meta">Скопировать не удалось: выделите текст ниже и скопируйте его.</p> : null}
      {open ? <textarea id={`${id}-notes`} readOnly aria-label="Мой несохранённый текст" className={AREA} rows={Math.min(8, replaced.notes.split("\n").length + 1)} value={replaced.notes} onFocus={(event) => event.currentTarget.select()} /> : null}
    </div>
  );
}

/** Итог команды словами операции и причины (review CRM R7); у «stale» и «request_conflict» ещё «Обновить страницу». */
export function CommandResult({ state, saved, refresh }: Readonly<{ state: GeographyActionState; saved?: string; refresh: () => void }>) {
  if (state.status === "idle") return null;
  if (state.status === "saved") return saved ? <p role="status" className="t-body-compact text-ok">{saved}</p> : null;
  return (
    <p role="alert" className="flex flex-wrap items-center gap-x-3 t-body-compact text-danger">
      {geographyMessage(state.operation, state.status, state.reason)}
      {(state.status === "stale" || state.status === "request_conflict") && state.reason === null ? <button type="button" className={QUIET} onClick={refresh}>Обновить страницу</button> : null}
    </p>
  );
}

/** После неудачной проверки фокус уходит на первое неверное поле (DESIGN «Добавить студента»). */
export function focusFirstInvalid(form: HTMLFormElement) {
  setTimeout(() => form.querySelector<HTMLElement>("[aria-invalid=\"true\"]")?.focus(), 0);
}

/** Ошибка поля: под полем, словами (DESIGN «Добавить студента»). */
export function FieldError({ id, text }: Readonly<{ id: string; text: string | null }>) {
  return text ? <p id={id} className="mt-1 t-meta text-danger">{text}</p> : null;
}
