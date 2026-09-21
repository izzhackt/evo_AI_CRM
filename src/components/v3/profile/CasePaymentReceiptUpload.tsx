"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { btnCls, btnGhostCls, labelCls } from "@/components/ui";

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

export function CasePaymentReceiptUpload({ paymentEventId }: { paymentEventId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const stopped = useRef(false);
  const [status, setStatus] = useState<"idle" | "pending" | "rejected" | "unknown" | "saved">("idle");
  const [message, setMessage] = useState("");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || stopped.current) return;
    const file = input.current?.files?.[0];
    if (!file || !TYPES.has(file.type) || file.size < 1 || file.size > MAX_BYTES) {
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

  return <details className="w-full min-w-0 py-1">
    <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">Загрузить чек</summary>
    <form onSubmit={upload} className="min-w-0 space-y-3 pt-2" aria-busy={status === "pending"}>
      <label className="block min-w-0">
        <span className={labelCls}>Чек · PDF, JPEG или PNG, до 25 МБ</span>
        <input ref={input} type="file" required accept="application/pdf,image/jpeg,image/png" disabled={status === "pending" || status === "saved" || status === "unknown"} className="block w-full min-w-0 max-w-full text-sm text-fg-2" />
      </label>
      <button type="submit" className={btnCls} disabled={status === "pending" || status === "saved" || status === "unknown"}>{status === "pending" ? "Загружаем…" : "Загрузить чек"}</button>
      {message ? <p role={status === "rejected" || status === "unknown" ? "alert" : "status"} className="break-words text-sm text-fg-2">{message}</p> : null}
      {status === "unknown" ? <button type="button" className={btnGhostCls} onClick={() => router.refresh()}>Обновить историю оплаты</button> : null}
    </form>
  </details>;
}
