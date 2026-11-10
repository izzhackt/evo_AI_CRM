"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { WidgetCard } from "@/components/kit";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "@/components/staff/queue/queue-buttons";
import { fieldLabelCls, inputCls } from "@/components/ui";
import type { PaymentDetailsRead } from "@/lib/v3/student-receipts-source";

const ERRORS: Readonly<Record<string, string>> = {
  file_too_large: "QR больше 5 МБ или пустой.",
  unsupported_mime_type: "QR должен быть картинкой PNG или JPG.",
  file_signature_mismatch: "Файл не похож на PNG или JPG. Выберите другой.",
  malware_detected: "Файл не прошёл проверку безопасности.",
  payment_details_invalid: "Проверьте текст (до 4000 знаков) и файл.",
  payment_details_forbidden: "Менять реквизиты может только администратор.",
};

/**
 * «Реквизиты для оплаты» (миграция 358): текст и QR, одни на всех студентов; видны вверху «Оплаты» в кабинете и в приложении.
 * Пока пусто, блока у студента нет. Каждое сохранение - новая версия с записью в журнале (кто и когда), текст реквизитов в журнал не
 * попадает. QR можно оставить, заменить или убрать.
 */
export function PaymentDetailsNext({ read, readOnly, requestId }: Readonly<{ read: PaymentDetailsRead; readOnly: boolean; requestId: string }>) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const attempt = useRef(requestId);
  const [qrMode, setQrMode] = useState<"keep" | "replace" | "remove">("keep");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [qrName, setQrName] = useState("");
  if (read.status !== "ok") {
    return (
      <WidgetCard headingLevel={3} title="Реквизиты для оплаты" bodyClassName="grid gap-3">
        <p role="alert" className="t-body-compact text-fg">
          {read.status === "forbidden" ? "Реквизиты меняет только администратор." : "Не удалось прочитать реквизиты. Обновите страницу."}
        </p>
      </WidgetCard>
    );
  }
  const details = read.details;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "saving" || readOnly) return;
    const form = new FormData(event.currentTarget);
    form.set("request_id", attempt.current);
    form.set("qr_mode", qrMode);
    if (qrMode !== "replace") form.delete("file");
    if (qrMode === "replace" && !fileRef.current?.files?.[0]) {
      setState("error");
      setMessage("Выберите файл QR или оставьте прежний.");
      return;
    }
    setState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/v3/settings/payment-details", { method: "POST", body: form });
      if (response.ok) {
        attempt.current = crypto.randomUUID();
        setState("saved");
        setQrMode("keep");
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
        return;
      }
      const result: unknown = await response.json().catch(() => null);
      const code = result && typeof result === "object" && "error" in result ? String((result as { error: unknown }).error) : "";
      if (response.status < 500) attempt.current = crypto.randomUUID();
      setMessage(ERRORS[code] ?? "Не удалось сохранить. Повторите: повтор безопасен.");
      setState("error");
    } catch {
      setMessage("Связь прервалась. Повторите: повтор безопасен.");
      setState("error");
    }
  }

  return (
    <WidgetCard headingLevel={3} title="Реквизиты для оплаты" bodyClassName="grid gap-4" data-testid="v3-settings-payment-details">
      <p className="t-body-compact text-fg-2">
        Одни реквизиты для всех студентов. Они показываются вверху «Оплаты» в кабинете и в приложении. Пока здесь пусто, блока у студентов нет.
      </p>
      <form onSubmit={save} className="grid max-w-2xl gap-4" aria-busy={state === "saving"}>
        <label className="block">
          <span className={fieldLabelCls}>Текст реквизитов</span>
          <textarea name="text" rows={7} maxLength={4000} defaultValue={details.text} disabled={readOnly || state === "saving"}
            className={`${inputCls} h-auto py-2`} placeholder={"Получатель, банк, счёт, назначение платежа"} />
        </label>
        <div className="grid gap-2">
          <span className={fieldLabelCls}>QR для оплаты</span>
          {details.hasQr ? (
            // eslint-disable-next-line @next/next/no-img-element -- закрытый файл: адрес отвечает перенаправлением на подписанную ссылку
            <img src={`/api/v3/settings/payment-details/qr?v=${details.versionNo}`} alt="Текущий QR для оплаты" width={160} height={160}
              className="size-40 rounded-ctl border border-border bg-white object-contain p-2" />
          ) : <p className="t-body-compact text-fg-3">QR не загружен.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <label className={`${QUEUE_SECONDARY} cursor-pointer has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus-ring`}>
              <input ref={fileRef} type="file" name="file" accept="image/png,image/jpeg" className="sr-only" disabled={readOnly || state === "saving"}
                onChange={(event) => { setQrMode(event.target.files?.length ? "replace" : "keep"); setQrName(event.target.files?.[0]?.name ?? ""); }} />
              {details.hasQr ? "Заменить QR" : "Загрузить QR"}
            </label>
            {qrMode === "replace" ? <span className="t-meta text-fg-2">{qrName}</span> : null}
            {details.hasQr && qrMode !== "replace" ? (
              <label className="inline-flex min-h-11 items-center gap-2 t-label text-fg-2">
                <input type="checkbox" checked={qrMode === "remove"} onChange={(event) => setQrMode(event.target.checked ? "remove" : "keep")} disabled={readOnly || state === "saving"} />
                Убрать QR
              </label>
            ) : null}
          </div>
          <p className="t-meta text-fg-3">PNG или JPG до 5 МБ.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className={QUEUE_CONFIRM} disabled={readOnly || state === "saving"}>{state === "saving" ? "Сохраняем…" : "Сохранить"}</button>
          {state === "saved" ? <p role="status" className="t-body-compact text-fg">Сохранено. Студенты видят новые реквизиты.</p> : null}
          {state === "error" ? <p role="alert" className="t-body-compact text-danger">{message}</p> : null}
        </div>
        {details.updatedAt ? (
          <p className="t-meta text-fg-3">
            Версия {details.versionNo}, изменено {new Date(details.updatedAt).toLocaleString("ru-RU", { timeZone: "Asia/Bishkek" })}
            {details.updatedByDisplayName ? ` · ${details.updatedByDisplayName}` : ""}. История изменений - в «Журнале действий».
          </p>
        ) : null}
        {readOnly ? <p className="t-meta text-fg-3">В режиме просмотра роли реквизиты не меняются.</p> : null}
      </form>
    </WidgetCard>
  );
}
