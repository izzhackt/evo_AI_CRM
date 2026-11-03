"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

const MAX_BYTES = 25 * 1024 * 1024;
const TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const REJECTIONS: Record<string, string> = {
  file_too_large: "Выберите непустой файл размером до 25 МБ.",
  unsupported_mime_type: "Выберите PDF, JPEG или PNG.",
  file_signature_mismatch: "Содержимое файла не соответствует его формату. Выберите другой файл.",
  malware_detected: "Проверка безопасности отклонила файл. Выберите другой файл.",
  invalid_upload: "Выберите один файл чека.",
  invalid_multipart: "Не удалось прочитать файл. Выберите его заново.",
  multipart_required: "Не удалось прочитать файл. Выберите его заново.",
};

/** Подчёркнутая подпись 44 px: действие строки оплаты, не кнопка с рамкой. */
const ROW_ACTION = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";

/**
 * «Загрузить чек» в строке оплаты: подпись со скрытым полем, файл уходит
 * сразу после выбора. Неизвестный итог не повторяется вслепую — сначала
 * обновить историю оплаты.
 */
export function CasePaymentReceiptUpload({ paymentEventId }: { paymentEventId: string }) {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const stopped = useRef(false);
  const [status, setStatus] = useState<"idle" | "pending" | "rejected" | "unknown" | "saved">("idle");
  const [message, setMessage] = useState("");

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    if (!hydrated || inFlight.current || stopped.current) return;
    const file = event.target.files?.[0];
    if (!file) return;
    if (!TYPES.has(file.type) || file.size < 1 || file.size > MAX_BYTES) {
      event.target.value = "";
      setStatus("rejected");
      setMessage("Выберите непустой PDF, JPEG или PNG размером до 25 МБ.");
      return;
    }
    inFlight.current = true;
    setStatus("pending");
    setMessage("Загружаем чек…");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(`/api/v2/payment-receipts/${paymentEventId}`, { method: "POST", body });
      if (response.status === 201) {
        stopped.current = true;
        setStatus("saved");
        setMessage("Чек загружен. Обновляем историю оплаты.");
        router.refresh();
        return;
      }
      const result: unknown = await response.json().catch(() => null);
      const code = result && typeof result === "object" && "error" in result ? result.error : null;
      if ([400, 413, 415, 422].includes(response.status) && typeof code === "string" && REJECTIONS[code]) {
        if (input.current) input.current.value = "";
        setStatus("rejected");
        setMessage(REJECTIONS[code]);
        return;
      }
      stopped.current = true;
      setStatus("unknown");
      setMessage(response.status === 401 ? "Войдите снова и проверьте историю оплаты перед повторной загрузкой."
        : response.status === 403 ? "Нет доступа к загрузке. Обновите историю и проверьте права."
          : response.status === 404 ? "Оплата не найдена. Обновите историю дела."
            : "Результат загрузки не подтверждён. Сначала обновите историю и проверьте, появился ли чек. Не отправляйте файл повторно до проверки.");
    } catch {
      stopped.current = true;
      setStatus("unknown");
      setMessage("Связь прервалась. Сначала обновите историю и проверьте, появился ли чек. Не отправляйте файл повторно до проверки.");
    } finally {
      inFlight.current = false;
    }
  }

  // До гидратации поле недоступно (выбор потерялся бы), но выглядит как обычно.
  const locked = status === "pending" || status === "saved" || status === "unknown";
  return <div className="flex min-w-0 max-w-72 flex-col items-end gap-1 text-end" aria-busy={!hydrated || status === "pending"}>
    <label className={`${ROW_ACTION} cursor-pointer has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus-ring ${locked ? "pointer-events-none text-fg-3 no-underline" : ""}`}>
      <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" disabled={!hydrated || locked} onChange={upload} className="sr-only" />
      {status === "pending" ? "Загружаем…" : "Загрузить чек"}
    </label>
    {message ? <p role={status === "rejected" || status === "unknown" ? "alert" : "status"} className="break-words t-meta text-fg-2">{message}</p> : null}
    {status === "unknown" ? <button type="button" className={ROW_ACTION} onClick={() => router.refresh()}>Обновить историю оплаты</button> : null}
  </div>;
}
