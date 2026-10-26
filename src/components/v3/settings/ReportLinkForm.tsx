"use client";
import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";

import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import { removeReportLinkAction, saveReportLinkAction } from "@/lib/platform-report-link-actions";
import { REPORT_FORM_MESSAGE, type ReportKey, type ReportLinkFormState } from "@/lib/report-link-contract";

const TEXTAREA = "mt-1 block min-h-28 w-full min-w-0 rounded-ctl border border-control-edge bg-surface px-3 py-2.5 font-mono text-base text-fg placeholder:text-fg-3 hover:bg-surface-2 focus-visible:border-accent disabled:bg-surface-2 disabled:text-fg-3";
const GOOD = new Set<ReportLinkFormState["status"]>(["saved", "unchanged", "removed"]);

/**
 * Одна ссылка «Настройки → Отчёты»: поле для кода (или ссылки) встраивания, «Сохранить», «Убрать отчёт» с
 * подтверждением. Отправка не через `<form action>`: React 19 сбрасывает такую форму после любого ответа, а введённое
 * должно остаться в поле, пока ссылка не сохранена. Id запроса меняется после определённого ответа (записано,
 * конфликт, отказ) и остаётся прежним при неизвестном результате: повтор вернёт прежнюю квитанцию, а не вторую запись.
 * Версию строки (0 — строки ещё нет) страница читает из базы; чужое изменение даёт «Обновите страницу».
 */
export function ReportLinkForm({
  reportKey, version, connected, requestId, removeRequestId,
}: Readonly<{ reportKey: ReportKey; version: number; connected: boolean; requestId: string; removeRequestId: string }>) {
  const id = useId();
  const [embed, setEmbed] = useState("");
  const [saveId, setSaveId] = useState(requestId);
  const [dropId, setDropId] = useState(removeRequestId);
  const [confirming, setConfirming] = useState(false);
  const [lastRemove, setLastRemove] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const [saveState, saveAction, saving] = useActionState(async (previous: ReportLinkFormState, form: FormData): Promise<ReportLinkFormState> => {
    try {
      const result = await saveReportLinkAction(previous, form);
      if (GOOD.has(result.status)) setEmbed("");
      if (result.status !== "unavailable") setSaveId(crypto.randomUUID());
      return result;
    } catch { return { ...previous, status: "unavailable" }; }
  }, { status: "idle", requestId } as ReportLinkFormState);
  const [dropState, dropAction, dropping] = useActionState(async (previous: ReportLinkFormState, form: FormData): Promise<ReportLinkFormState> => {
    try {
      const result = await removeReportLinkAction(previous, form);
      if (result.status !== "unavailable") { setDropId(crypto.randomUUID()); setConfirming(false); }
      return result;
    } catch { return { ...previous, status: "unavailable" }; }
  }, { status: "idle", requestId: removeRequestId } as ReportLinkFormState);

  // Фокус на «Да, убрать», когда вопрос появился: иначе клавиатура остаётся на кнопке, которой уже нет.
  useEffect(() => { if (confirming) confirmRef.current?.focus(); }, [confirming]);

  const shown = lastRemove ? dropState : saveState;
  const message = REPORT_FORM_MESSAGE[shown.status];
  const failed = shown.status !== "idle" && !GOOD.has(shown.status);
  const busy = saving || dropping;
  const submit = (action: (form: FormData) => void) => (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => action(form));
  };
  const hidden = (request: string) => (
    <>
      <input type="hidden" name="request_id" value={request} />
      <input type="hidden" name="report_key" value={reportKey} />
      <input type="hidden" name="expected_version" value={version} />
    </>
  );

  return (
    <div className="space-y-3">
      <form onSubmit={(event) => { setLastRemove(false); submit(saveAction)(event); }} aria-busy={saving} className="space-y-3" data-testid={`v3-report-link-form-${reportKey}`}>
        {hidden(saveId)}
        <div>
          <label htmlFor={`${id}-embed`} className="block t-label text-fg-2">Код или ссылка для встраивания из Looker Studio</label>
          <textarea
            id={`${id}-embed`} name="embed" value={embed} onChange={(event) => setEmbed(event.target.value)}
            rows={4} spellCheck={false} autoComplete="off" autoCapitalize="off" aria-describedby={`${id}-hint`}
            aria-invalid={failed && !lastRemove ? true : undefined} className={TEXTAREA}
          />
          <p id={`${id}-hint`} className="mt-1 t-meta text-fg-3">
            Looker Studio → Файл → Встроить отчёт → Включить встраивание → скопировать код.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="submit" className={QUEUE_CONFIRM} disabled={busy || embed.trim() === ""}>
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
          {connected && !confirming ? (
            <button type="button" className={QUEUE_SECONDARY} disabled={busy} onClick={() => setConfirming(true)}>Убрать отчёт</button>
          ) : null}
        </div>
      </form>

      {confirming ? (
        <form onSubmit={(event) => { setLastRemove(true); submit(dropAction)(event); }} aria-busy={dropping}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-ctl border border-border bg-surface-2 px-3 py-2.5"
          data-testid={`v3-report-link-remove-${reportKey}`}>
          {hidden(dropId)}
          <p className="t-body-compact text-fg">Убрать отчёт? Окно отчёта из раздела исчезнет, доступ в Google не изменится.</p>
          <button ref={confirmRef} type="submit" className={QUEUE_CONFIRM} disabled={busy}>{dropping ? "Убираем…" : "Да, убрать"}</button>
          <button type="button" className={QUEUE_SECONDARY} disabled={busy} onClick={() => setConfirming(false)}>Отмена</button>
        </form>
      ) : null}

      <p role={failed ? "alert" : "status"} className={`t-body-compact ${failed ? "text-danger" : "text-fg-2"}`} data-testid={`v3-report-link-status-${reportKey}`}>
        {message}
      </p>
    </div>
  );
}
