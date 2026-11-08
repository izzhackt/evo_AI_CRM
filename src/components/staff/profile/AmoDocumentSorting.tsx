"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "@/components/staff/queue/queue-buttons";
import {
  CUSTOM_DOCUMENT_LABEL_MAX, DOCUMENT_KINDS, STAFF_EXTRA_KINDS, acceptKindLabel, acceptLabel, isAcceptKindKey, normalizeCustomDocumentLabel,
  type AcceptKindKey,
} from "@/lib/document-classification";
import { MAX_BULK_ACCEPT } from "@/lib/document-sorting-ids";
import {
  acceptConfidentDocumentKindsAction, acceptDocumentKindAction, type DocumentSortingOutcome,
} from "@/lib/platform-document-sorting-actions";

import { bulkConfirmText, confidentRows, type SortingMode, type SortingRow } from "./amo-sorting-view";
import { DocumentPreviewButton } from "./DocumentPreviewButton";

const OUTCOME_TEXT: Record<Exclude<DocumentSortingOutcome, "saved">, string> = {
  decision_not_recorded: "Файл принят, но отметка о решении не записалась. Обновите страницу.",
  invalid: "Не удалось отправить выбор. Обновите страницу и повторите.",
  forbidden: "Недостаточно прав, чтобы принять документ.",
  stale: "Файл уже изменили. Обновите страницу.",
  target_exists: "В чек-листе уже есть пункт с таким названием. Откройте его и решите, какой файл оставить: второй такой пункт не создаётся.",
  file_unavailable: "Файл не прошёл проверку безопасности, принять его нельзя.",
  partly_saved: "Файл перенесён в пункт, но не принят. Примите его в списке ниже.",
  unavailable: "Сервер не ответил. Повторите попытку.",
  finance_forbidden: "Нет права добавлять договоры и чеки в «Деньги». Файл не принят: попросите коллегу с этим правом.",
  finance_failed: "Не удалось передать файл в «Деньги». Файл остался в списке: повторите.",
};
/** Что произойдёт сверх приёма: договор и чек уходят в «Деньги», «Не нужное» убирает пункт в архив удалённых. */
const KIND_HINT: Partial<Record<AcceptKindKey, string>> = {
  contract: "Станет договором дела в «Деньги». Прежний договор уйдёт в историю.",
  payment_receipt: "Попадёт в «Деньги» как чек, который ждёт оплату: сумму вносят в «Оплаты и чеки».",
  not_needed: "Пункт уйдёт из чек-листа в архив удалённых пунктов. Файл не удаляется.",
};
const MODE_NOTE: Record<SortingMode, string> = {
  ai: "ИИ только подсказывает. Файл попадает в чек-лист, когда вы нажмёте «Принять».",
  manual: "Сейчас ИИ для этого студента отключён: файлы не отправлялись. Выберите, что это за документ, вручную.",
  unavailable: "Подсказки сейчас недоступны. Выберите, что это за документ, вручную.",
};

/** Миниатюра грузится, когда карточка вошла в экран: те же права и проверки, что у «Просмотреть» (маршрут скачивания версии). */
function Thumb({ versionId, filename, isPdf, ready }: Readonly<{ versionId: string; filename: string; isPdf: boolean; ready: boolean }>) {
  const holder = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (isPdf || !ready) return;
    const node = holder.current;
    if (!node) return;
    const controller = new AbortController();
    let url: string | null = null;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      fetch(`/api/v2/document-versions/${encodeURIComponent(versionId)}/download`, { cache: "no-store", credentials: "same-origin", referrerPolicy: "no-referrer", signal: controller.signal })
        .then(async (response) => {
          const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
          if (!response.ok || !["image/jpeg", "image/png"].includes(type)) throw new Error("no preview");
          url = URL.createObjectURL(await response.blob());
          setSrc(url);
        })
        .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    }, { rootMargin: "200px" });
    observer.observe(node);
    return () => { observer.disconnect(); controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [versionId, isPdf, ready]);
  return (
    <div ref={holder} className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-ctl border border-border bg-surface-2" data-testid="amo-sorting-thumb">
      {src ? (
        // Private, short-lived Blob URL: not for the image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`Предпросмотр: ${filename}`} className="h-full w-full object-contain" />
      ) : (
        <span className="t-meta text-fg-2">{isPdf ? "PDF" : !ready ? "Нет предпросмотра" : failed ? "Не открылся" : "Загружаем…"}</span>
      )}
    </div>
  );
}

function SortingCard({ row, studentCaseId, canAct, onDone }: Readonly<{ row: SortingRow; studentCaseId: string; canAct: boolean; onDone: () => void }>) {
  const [pending, setPending] = useState(false);
  const [chosen, setChosen] = useState<string>("");
  const [customLabel, setCustomLabel] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { file } = row;

  async function accept(kind: AcceptKindKey, label = "") {
    if (pending) return;
    setPending(true); setMessage(null);
    const form = new FormData();
    form.set("student_case_id", studentCaseId); form.set("document_slot_id", file.slotId);
    form.set("document_version_id", file.versionId); form.set("kind_key", kind); form.set("custom_label", label);
    try {
      const result = await acceptDocumentKindAction(form);
      if (result.outcome === "saved") { onDone(); return; }
      if (result.outcome === "decision_not_recorded") onDone();
      setMessage(OUTCOME_TEXT[result.outcome]);
      if (result.outcome === "partly_saved") onDone();
    } catch { setMessage(OUTCOME_TEXT.unavailable); }
    finally { setPending(false); }
  }

  const pickedKind: AcceptKindKey | null = isAcceptKindKey(chosen) ? chosen : null;
  const normalizedLabel = normalizeCustomDocumentLabel(customLabel);
  const hint = pickedKind ? (KIND_HINT[pickedKind] ?? null) : row.kind ? (KIND_HINT[row.kind] ?? null) : null;
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface p-3" data-testid="amo-sorting-card" data-band={row.band}>
      <Thumb versionId={file.versionId} filename={file.filename} isPdf={file.isPdf} ready={file.downloadReady} />
      <div className="min-w-0">
        <p className="truncate t-meta text-fg-2" title={file.filename}>{file.filename}</p>
        {row.text ? <p className="t-item text-fg" data-testid="amo-sorting-suggestion">{row.text}</p>
          : <p className="t-body-compact text-fg-2" data-testid="amo-sorting-none">Вид не определён</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {file.downloadReady ? <DocumentPreviewButton versionId={file.versionId} filename={file.filename} versionNumber={1} /> : null}
      </div>
      {canAct ? (
        <div className="flex min-w-0 flex-col gap-2">
          {row.kind ? (
            <button type="button" className={`${QUEUE_CONFIRM} w-full`} disabled={pending || !file.downloadReady} onClick={() => void accept(row.kind!)} data-testid="amo-sorting-accept">
              {pending ? "Принимаем…" : acceptLabel(row.kind)}
            </button>
          ) : null}
          <div className="flex min-w-0 items-center gap-2">
            <label className="sr-only" htmlFor={`amo-kind-${file.versionId}`}>Это</label>
            <select id={`amo-kind-${file.versionId}`} className="h-11 min-w-0 flex-1 rounded-ctl border border-control-edge bg-surface px-3 t-body text-fg"
              value={chosen} disabled={pending} onChange={(event) => { setChosen(event.target.value); setConfirmRemove(false); }} data-testid="amo-sorting-pick">
              <option value="">{row.kind ? "Другой пункт…" : "Это: выберите пункт…"}</option>
              {DOCUMENT_KINDS.map((kind) => <option key={kind.key} value={kind.key}>{kind.label}</option>)}
              {STAFF_EXTRA_KINDS.map((kind) => <option key={kind.key} value={kind.key}>{kind.label}</option>)}
            </select>
            {pickedKind && pickedKind !== "other" && pickedKind !== "not_needed" ? (
              <button type="button" className={QUEUE_SECONDARY} disabled={pending || !file.downloadReady}
                onClick={() => void accept(pickedKind)} data-testid="amo-sorting-accept-picked">
                Принять как {acceptKindLabel(pickedKind)}
              </button>
            ) : null}
          </div>
          {pickedKind === "other" ? (
            <div className="flex min-w-0 items-center gap-2">
              <label className="sr-only" htmlFor={`amo-label-${file.versionId}`}>Название документа</label>
              <input id={`amo-label-${file.versionId}`} type="text" maxLength={CUSTOM_DOCUMENT_LABEL_MAX} value={customLabel} disabled={pending}
                placeholder="Название документа" onChange={(event) => setCustomLabel(event.target.value)}
                className="h-11 min-w-0 flex-1 rounded-ctl border border-control-edge bg-surface px-3 t-body text-fg" data-testid="amo-sorting-custom-label" />
              <button type="button" className={QUEUE_SECONDARY} disabled={pending || !file.downloadReady || normalizedLabel === null}
                onClick={() => normalizedLabel && void accept("other", normalizedLabel)} data-testid="amo-sorting-accept-picked">
                Принять
              </button>
            </div>
          ) : null}
          {pickedKind === "not_needed" ? (
            confirmRemove ? (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={QUEUE_SECONDARY} disabled={pending} onClick={() => void accept("not_needed")} data-testid="amo-sorting-accept-picked">
                  {pending ? "Убираем…" : "Убрать из списка"}
                </button>
                <button type="button" className={QUEUE_SECONDARY} disabled={pending} onClick={() => setConfirmRemove(false)}>Отмена</button>
              </div>
            ) : (
              <button type="button" className={QUEUE_SECONDARY} disabled={pending} onClick={() => setConfirmRemove(true)} data-testid="amo-sorting-not-needed">
                Не нужное
              </button>
            )
          ) : null}
          {hint ? <p className="t-meta text-fg-2" data-testid="amo-sorting-hint">{hint}</p> : null}
        </div>
      ) : null}
      <p className="t-meta text-danger" role="status" aria-live="polite" data-testid="amo-sorting-message">{message}</p>
    </li>
  );
}

/**
 * Файлы из amoCRM без разбора: крупная миниатюра, подсказка ИИ («Похоже на: Паспорт (уверенно)»), «Принять как …» или выбор
 * другого пункта, «Принять все уверенные» с подтверждением и числом. Без согласия студента подсказок нет вовсе, остаётся
 * ручной выбор. Само действие (перенос, одобрение, право) выполняют существующие команды на сервере.
 */
export function AmoDocumentSorting({ studentCaseId, rows, mode, canAct }: Readonly<{ studentCaseId: string; rows: readonly SortingRow[]; mode: SortingMode; canAct: boolean }>) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const confident = confidentRows(rows);
  if (rows.length === 0) return null;
  const refresh = () => startTransition(() => router.refresh());

  async function acceptAll() {
    if (bulkPending) return;
    setBulkPending(true); setBulkMessage(null);
    const ids = confident.map((row) => row.file.versionId);
    let accepted = 0; let failed = 0; let skipped = 0; let unrecorded = 0; let stopped: string | null = null;
    try {
      // Порциями: один вызов сервера не больше MAX_BULK_ACCEPT файлов, после каждой порции виден ход.
      for (let start = 0; start < ids.length && stopped === null; start += MAX_BULK_ACCEPT) {
        const form = new FormData();
        form.set("student_case_id", studentCaseId);
        form.set("version_ids", ids.slice(start, start + MAX_BULK_ACCEPT).join(","));
        const result = await acceptConfidentDocumentKindsAction(form);
        if (result.outcome !== "done") { stopped = OUTCOME_TEXT[result.outcome === "invalid" ? "invalid" : result.outcome === "forbidden" ? "forbidden" : "unavailable"]; break; }
        accepted += result.accepted; failed += result.failed; skipped += result.skipped; unrecorded += result.unrecorded;
        setBulkMessage(`Принято ${accepted} из ${ids.length}…`);
      }
    } catch { stopped = OUTCOME_TEXT.unavailable; }
    // Сбой посередине не прячет уже принятое: панель перечитывается в любом случае.
    setBulkMessage(`Принято: ${accepted} из ${ids.length}.${failed > 0 ? ` Не удалось: ${failed}.` : ""}${skipped > 0 ? ` Пропущено: ${skipped}.` : ""}${unrecorded > 0 ? ` Без отметки о решении: ${unrecorded}.` : ""}${stopped ? ` ${stopped}` : ""}`);
    setConfirming(false);
    setBulkPending(false);
    refresh();
  }

  return (
    <section aria-labelledby="amo-sorting-title" className="min-w-0 space-y-3" data-testid="amo-document-sorting" data-mode={mode}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 id="amo-sorting-title" className="t-section text-fg">Разобрать файлы из amoCRM · {rows.length}</h3>
          <p className="t-body-compact text-fg-2" data-testid="amo-sorting-note">{MODE_NOTE[mode]}</p>
        </div>
        {canAct && confident.length > 0 && !confirming ? (
          <button type="button" className={QUEUE_CONFIRM} onClick={() => setConfirming(true)} data-testid="amo-sorting-bulk">
            Принять все уверенные · {confident.length}
          </button>
        ) : null}
      </div>
      {confirming ? (
        <div role="alertdialog" aria-labelledby="amo-bulk-text" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface-2 p-3" data-testid="amo-sorting-confirm">
          <p id="amo-bulk-text" className="min-w-0 flex-1 t-body-compact text-fg">{bulkConfirmText(confident.length)}</p>
          <div className="flex gap-2">
            <button type="button" className={QUEUE_CONFIRM} disabled={bulkPending} onClick={() => void acceptAll()} data-testid="amo-sorting-bulk-confirm">
              {bulkPending ? "Принимаем…" : `Принять ${confident.length}`}
            </button>
            <button type="button" className={QUEUE_SECONDARY} disabled={bulkPending} onClick={() => setConfirming(false)}>Отмена</button>
          </div>
        </div>
      ) : null}
      <p className="t-body-compact text-fg-2" role="status" aria-live="polite" data-testid="amo-sorting-bulk-message">{bulkMessage}</p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => <SortingCard key={row.file.versionId} row={row} studentCaseId={studentCaseId} canAct={canAct} onDone={refresh} />)}
      </ul>
    </section>
  );
}
