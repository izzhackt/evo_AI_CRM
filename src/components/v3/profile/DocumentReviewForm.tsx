"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";

import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import { reviewPlatformDocumentAction, type DocumentReviewOutcome } from "@/lib/platform-document-review-action";
import type { PlatformDocumentReviewDecision } from "@/lib/platform-private-documents";

import type { PresentDocumentItem } from "./document-types";

const MESSAGES: Record<DocumentReviewOutcome, string> = {
  saved: "Решение сохранено. Данные документа обновляются.",
  invalid: "Выберите решение и укажите причину до 2000 символов для исправления или отклонения.",
  forbidden: "Проверка недоступна: проверьте права на дело и выбранную роль.",
  stale: "Документ уже изменён или проверен. Обновите данные и проверьте актуальную версию.",
  request_conflict: "Этот запрос уже использован. Обновите данные перед новым решением.",
  file_unavailable: "Файл ещё недоступен для проверки. Обновите данные после завершения загрузки и проверки файла.",
  notification_unavailable: "Сервер не подтвердил решение: уведомление студента недоступно. Нужны активный доступ студента к делу и включённые уведомления кабинета.",
  unavailable: "Сервер не подтвердил результат. Повторите тот же запрос; решение и причина сохранены в форме.",
};

export function DocumentReviewForm({ item, studentCaseId }: Readonly<{
  item: PresentDocumentItem;
  studentCaseId: string;
}>) {
  const router = useRouter();
  const reasonId = useId();
  const messageId = useId();
  const sending = useRef(false);
  const [requestId] = useState(item.reviewRequestId);
  const [decision, setDecision] = useState<PlatformDocumentReviewDecision>(item.downloadReady ? "approved" : "correction_required");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<DocumentReviewOutcome | null>(null);
  const [attempt, setAttempt] = useState<{ decision: PlatformDocumentReviewDecision; reason: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const stale = outcome === "stale" || outcome === "request_conflict";
  const locked = pending || uncertain || stale || outcome === "saved";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || stale || outcome === "saved" || !requestId) return;
    sending.current = true;
    setPending(true);
    const submitted = uncertain && attempt ? attempt : { decision, reason };
    setAttempt(submitted);
    const form = new FormData();
    form.set("student_case_id", studentCaseId);
    form.set("document_slot_id", item.id);
    form.set("document_version_id", item.currentVersionId);
    form.set("request_id", requestId);
    form.set("decision", submitted.decision);
    form.set("reason", submitted.decision === "approved" ? "" : submitted.reason);
    try {
      const result = await reviewPlatformDocumentAction(form);
      setOutcome(result);
      if (result === "unavailable") setUncertain(true);
      if (result === "saved") router.refresh();
    } catch {
      setOutcome("unavailable");
      setUncertain(true);
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return (
    <details className="mt-3 rounded-card border border-border bg-surface-2 px-3 py-2">
      <summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-fg-2">Проверить документ</summary>
      <form onSubmit={submit} className="mt-2 grid min-w-0 gap-3" aria-busy={pending}>
        <p className="text-xs text-fg-3">Проверяется версия {item.currentVersionNumber}. Скачайте файл перед решением.</p>
        {!item.downloadReady ? <p className="text-xs text-fg-3">Принятие недоступно до завершения проверки файла. Его можно вернуть на исправление или отклонить.</p> : null}
        <label>
          <span className={labelCls}>Решение</span>
          <select className={`${inputCls} min-h-11`} value={decision} disabled={locked}
            onChange={event => setDecision(event.target.value as PlatformDocumentReviewDecision)}>
            <option value="approved" disabled={!item.downloadReady}>Принять</option>
            <option value="correction_required">Вернуть на исправление</option>
            <option value="rejected">Отклонить</option>
          </select>
        </label>
        {decision !== "approved" ? (
          <label htmlFor={reasonId}>
            <span className={labelCls}>Что нужно исправить</span>
            <textarea id={reasonId} className={`${inputCls} min-h-24 resize-y`} value={reason}
              required maxLength={2000} disabled={locked} aria-describedby={`${reasonId}-help`}
              onChange={event => setReason(event.target.value)} />
            <span id={`${reasonId}-help`} className="mt-1 block text-xs text-fg-3">Причина будет видна студенту. До 2000 символов.</span>
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={`${btnCls} min-h-11 max-w-full whitespace-normal`}
            disabled={pending || stale || outcome === "saved" || !requestId
              || (decision === "approved" && !item.downloadReady)}
            aria-describedby={outcome ? messageId : undefined}>
            {pending ? "Сохраняем…" : uncertain ? "Повторить тот же запрос" : "Сохранить решение"}
          </button>
          {stale || outcome === "file_unavailable" ? (
            <button type="button" className={`${btnGhostCls} min-h-11`} onClick={() => {
              // A deliberate stale-command recovery discards its identity. A normal
              // RSC refresh keeps the identity and draft for uncertain retries.
              if (stale) window.location.reload();
              else router.refresh();
            }}>Обновить данные</button>
          ) : null}
        </div>
        {outcome ? <p id={messageId} role="status" className={`break-words text-xs ${outcome === "saved" ? "text-ok" : "text-danger"}`}>{MESSAGES[outcome]}</p> : null}
      </form>
    </details>
  );
}
