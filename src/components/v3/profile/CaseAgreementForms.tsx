"use client";
import { useActionState, useRef, useState, type ChangeEvent, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { btnGhostCls, inputCls, fieldLabelCls } from "@/components/ui";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "../queue/queue-buttons";
import {
  saveCaseTrancheAction,
  recordCasePaymentAction,
} from "@/lib/platform-case-agreement-actions";
import {
  financeMoney,
  type CaseAgreementState,
  type CaseAgreementTranche,
} from "@/lib/platform-case-agreement-contract";

// Same useActionState + requestId + frozen-retry pattern as
// FinanceEntryForms.tsx (pinned by tests/sales-finance-entry.test.mjs) —
// reused here deliberately, that file itself is not edited.
const MESSAGES: Record<CaseAgreementState["status"], string> = {
  idle: "",
  saved: "Сохранено.",
  invalid: "Проверьте поля, валюту и сумму.",
  forbidden: "Нет доступа для этого действия.",
  request_conflict: "Этот запрос уже использован. Проверьте историю перед новой попыткой.",
  unavailable: "Результат неизвестен. Ввод сохранён; повторите тот же запрос.",
  tranche_paid: "Транш уже оплачен — сумма и валюта фиксированы. Обновите карточку.",
};

function nowBishkekLocalInput(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

const UPLOAD_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const UPLOAD_ACCEPT = "application/pdf,image/jpeg,image/png";
/** Тихая кнопка-подпись: `enabled:hover` у QUEUE_SECONDARY подписи и `<summary>` не достаётся — наведение своё. */
const PICK_BUTTON = `${QUEUE_SECONDARY} hover:bg-surface-2 hover:text-fg`;

/**
 * Выбор файла — подпись-кнопка со скрытым полем: без «Choose File» браузера.
 * Поле остаётся в порядке Tab (фокус — рамка подписи), выбранное имя —
 * строкой рядом.
 */
function FilePick({
  inputRef,
  label,
  disabled,
  className,
  onPick,
}: Readonly<{
  inputRef: RefObject<HTMLInputElement | null>;
  label: string;
  disabled?: boolean;
  className?: string;
  onPick?: (event: ChangeEvent<HTMLInputElement>) => void;
}>) {
  const [name, setName] = useState<string | null>(null);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <label className={`${className ?? PICK_BUTTON} cursor-pointer has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus-ring ${disabled ? "pointer-events-none border-border bg-surface-2 text-fg-3" : ""}`}>
        <input
          ref={inputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          disabled={disabled}
          className="sr-only"
          onChange={(event) => { setName(event.target.files?.[0]?.name ?? null); onPick?.(event); }}
        />
        {label}
      </label>
      {name && !onPick ? <span className="min-w-0 break-all t-meta text-fg-2">{name}</span> : null}
    </span>
  );
}

// Ответы сервера загрузки договора (platform-case-agreement-storage-route-handlers):
// у каждого отказа — свои слова; неизвестный итог повторять не предлагаем —
// загрузка не идемпотентна, повтор создал бы вторую версию.
const CONTRACT_REJECTIONS: Record<string, string> = {
  file_too_large: "Файл пустой или больше 25 МБ. Выберите другой.",
  unsupported_mime_type: "Нужен PDF, JPEG или PNG.",
  file_signature_mismatch: "Содержимое файла не соответствует его формату. Выберите другой файл.",
  malware_detected: "Проверка безопасности отклонила файл. Выберите другой файл.",
  invalid_upload: "Выберите один файл договора.",
  invalid_multipart: "Не удалось прочитать файл. Выберите его заново.",
  multipart_required: "Не удалось прочитать файл. Выберите его заново.",
  case_agreement_forbidden: "Нет права загружать договор в это дело.",
};

/**
 * «Загрузить договор» (или «Заменить») — одна подпись-кнопка со скрытым
 * полем: файл уходит сразу после выбора, отдельной «Сохранить» нет.
 */
export function CaseAgreementUploadContract({
  studentCaseId,
  replace = false,
}: Readonly<{ studentCaseId: string; replace?: boolean }>) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "rejected" | "unknown">("idle");
  const [message, setMessage] = useState("");

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || status === "uploading") return;
    if (!UPLOAD_TYPES.has(file.type) || file.size < 1 || file.size > UPLOAD_MAX_BYTES) {
      event.target.value = "";
      setStatus("rejected");
      setMessage("Нужен непустой PDF, JPEG или PNG до 25 МБ.");
      return;
    }
    setStatus("uploading");
    setMessage("Загружаем договор…");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(`/api/v2/case-contract-files/${studentCaseId}`, {
        method: "POST",
        body,
      });
      if (response.ok) {
        if (inputRef.current) inputRef.current.value = "";
        setStatus("done");
        setMessage("Договор загружен.");
        router.refresh();
        return;
      }
      const result: unknown = await response.json().catch(() => null);
      const code = result && typeof result === "object" && "error" in result ? result.error : null;
      if (inputRef.current) inputRef.current.value = "";
      if (typeof code === "string" && CONTRACT_REJECTIONS[code]) {
        setStatus("rejected");
        setMessage(CONTRACT_REJECTIONS[code]);
        return;
      }
      setStatus("unknown");
      setMessage(response.status === 401
        ? "Войдите снова и проверьте, появился ли договор, прежде чем загружать его ещё раз."
        : "Загрузка не подтверждена. Обновите страницу и проверьте, появился ли договор, прежде чем загружать его ещё раз.");
    } catch {
      setStatus("unknown");
      setMessage("Связь прервалась. Обновите страницу и проверьте, появился ли договор, прежде чем загружать его ещё раз.");
    }
  }

  return (
    <div data-testid="v3-case-agreement-upload" className="flex max-w-72 flex-col items-end gap-1 text-end">
      <FilePick
        inputRef={inputRef}
        label={status === "uploading" ? "Загружаем…" : replace ? "Заменить" : "Загрузить договор"}
        disabled={status === "uploading" || status === "unknown"}
        className={replace ? "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg" : undefined}
        onPick={upload}
      />
      {status === "idle" && !replace ? <span className="t-meta text-fg-2">PDF, JPEG, PNG · до 25 МБ</span> : null}
      {message ? (
        <span role={status === "rejected" || status === "unknown" ? "alert" : "status"} className="t-meta text-fg-2">{message}</span>
      ) : null}
      {status === "unknown" ? (
        <button type="button" onClick={() => { router.refresh(); setStatus("idle"); setMessage(""); }} className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg">
          Обновить страницу
        </button>
      ) : null}
    </div>
  );
}

/** Раскрытие правки в строке транша: подчёркнутая подпись 44 px без маркера; открытое — на всю ширину строки. */
const ROW_SUMMARY = "inline-flex min-h-11 cursor-pointer list-none items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg [&::-webkit-details-marker]:hidden";
/** Раскрытие новой записи под списком («Добавить транш», «Добавить оплату»): тихая кнопка с рамкой. */
const ADD_SUMMARY = `${PICK_BUTTON} w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden`;

export function CaseAgreementTrancheEditor({
  studentCaseId,
  tranche,
  canArchive,
  addLabel = "Добавить транш",
}: Readonly<{
  studentCaseId: string;
  tranche: CaseAgreementTranche | null;
  canArchive: boolean;
  /** Подпись новой записи: «Разбить на транши», пока траншей нет. */
  addLabel?: string;
}>) {
  const router = useRouter();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  return (
    <TrancheEditor
      key={requestId}
      studentCaseId={studentCaseId}
      tranche={tranche}
      canArchive={canArchive}
      addLabel={addLabel}
      requestId={requestId}
      router={router}
      onAnother={() => setRequestId(crypto.randomUUID())}
    />
  );
}

function TrancheEditor({
  studentCaseId,
  tranche,
  canArchive,
  addLabel,
  requestId,
  router,
  onAnother,
}: Readonly<{
  studentCaseId: string;
  tranche: CaseAgreementTranche | null;
  canArchive: boolean;
  addLabel: string;
  requestId: string;
  router: ReturnType<typeof useRouter>;
  onAnother: () => void;
}>) {
  const frozen = useRef<FormData | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState(requestId);
  const [archive, setArchive] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: CaseAgreementState, form: FormData): Promise<CaseAgreementState> => {
      const submitted = frozen.current ?? form;
      frozen.current = submitted;
      try {
        const result = await saveCaseTrancheAction(previous, submitted);
        if (result.status !== "unavailable") frozen.current = null;
        if (result.status === "saved") router.refresh();
        return result;
      } catch {
        return { ...previous, status: "unavailable" };
      }
    },
    { status: "idle", requestId, resourceId: null } as CaseAgreementState,
  );
  const locked = pending || ["saved", "unavailable"].includes(state.status) ||
    (state.status === "request_conflict" && currentRequestId === state.requestId);

  return (
    <details className={tranche ? "open:basis-full @2xl:justify-self-end @2xl:open:col-span-full @2xl:open:justify-self-stretch" : "mt-2"}>
      <summary className={tranche ? ROW_SUMMARY : ADD_SUMMARY}
        aria-label={tranche ? `Изменить транш: ${tranche.label}` : undefined}>
        {tranche ? "Изменить" : addLabel}
      </summary>
      <form action={action} className="mt-2 max-w-xl space-y-3 pb-2">
        <input type="hidden" name="request_id" value={currentRequestId} />
        <input type="hidden" name="student_case_id" value={studentCaseId} />
        <input type="hidden" name="payment_obligation_id" value={tranche?.id ?? ""} />
        <input type="hidden" name="archive" value={archive ? "true" : "false"} />
        <fieldset disabled={locked} className="space-y-3">
          <label className="block">
            <span className={fieldLabelCls}>Название</span>
            <input
              name="label"
              maxLength={500}
              defaultValue={tranche?.label ?? ""}
              placeholder={tranche ? undefined : "Транш"}
              className={inputCls}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className={fieldLabelCls}>Сумма</span>
              <input
                name="amount"
                inputMode="decimal"
                pattern="[0-9]+([.,][0-9]{1,2})?"
                defaultValue={tranche ? (Number(tranche.amountMinor) / 100).toString() : ""}
                // readOnly (not disabled) once paid: the field must still be
                // submitted with its unchanged value — the RPC only blocks an
                // actual CHANGE, not the value simply round-tripping through
                // the form (a disabled input is dropped from FormData
                // entirely, which would break editing label/due on a paid
                // tranche).
                readOnly={tranche !== null && tranche.totalPaidMinor !== "0"}
                className={inputCls}
              />
            </label>
            <label>
              <span className={fieldLabelCls}>Валюта</span>
              <input
                name="currency"
                pattern="[A-Za-z]{3}"
                maxLength={3}
                placeholder="USD"
                defaultValue={tranche?.currency ?? ""}
                readOnly={tranche !== null && tranche.totalPaidMinor !== "0"}
                className={inputCls}
              />
            </label>
          </div>
          <label className="block">
            <span className={fieldLabelCls}>Срок</span>
            <input name="due_on" type="date" defaultValue={tranche?.dueOn ?? ""} className={inputCls} />
          </label>
          {tranche && canArchive ? (
            <label className="flex min-h-11 items-center gap-2 t-body-compact text-fg-2">
              <input
                type="checkbox"
                checked={archive}
                onChange={(event) => setArchive(event.target.checked)}
              />
              Архивировать транш
            </label>
          ) : null}
          <button className={QUEUE_CONFIRM} disabled={locked}>
            {pending ? "Сохраняем…" : "Сохранить"}
          </button>
        </fieldset>
        {state.status !== "idle" ? (
          <p role={state.status === "saved" ? "status" : "alert"} className="t-body-compact text-fg-2">
            {MESSAGES[state.status]}
          </p>
        ) : null}
        {state.status === "unavailable" ? (
          <button type="submit" disabled={pending} className={btnGhostCls}>Повторить тот же запрос</button>
        ) : null}
        {state.status === "saved" ? (
          // FIX 9 (adversarial review): "Ещё транш" only reads right after a
          // CREATE; an edit's natural follow-up is "do it again", not "add
          // another".
          <button type="button" onClick={onAnother} className="min-h-11 t-label underline underline-offset-4">
            {tranche ? "Изменить ещё раз" : "Ещё транш"}
          </button>
        ) : null}
        {state.status === "request_conflict" && currentRequestId === state.requestId ? (
          <button
            type="button"
            onClick={() => setCurrentRequestId(crypto.randomUUID())}
            className="min-h-11 t-label underline underline-offset-4"
          >
            Сверил историю, продолжить
          </button>
        ) : null}
      </form>
    </details>
  );
}

export function CaseAgreementPaymentForm({
  studentCaseId,
  tranches,
}: Readonly<{ studentCaseId: string; tranches: readonly CaseAgreementTranche[] }>) {
  const router = useRouter();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  return (
    <PaymentForm
      key={requestId}
      studentCaseId={studentCaseId}
      tranches={tranches}
      requestId={requestId}
      router={router}
      onAnother={() => setRequestId(crypto.randomUUID())}
    />
  );
}

function PaymentForm({
  studentCaseId,
  tranches,
  requestId,
  router,
  onAnother,
}: Readonly<{
  studentCaseId: string;
  tranches: readonly CaseAgreementTranche[];
  requestId: string;
  router: ReturnType<typeof useRouter>;
  onAnother: () => void;
}>) {
  const frozen = useRef<FormData | null>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  // FIX 5 (adversarial review): a separate file input + status for the
  // retry block, which renders OUTSIDE the disabled fieldset once the
  // payment saved but the receipt upload failed.
  const retryInputRef = useRef<HTMLInputElement>(null);
  const [retryUploading, setRetryUploading] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState(requestId);
  const [obligationId, setObligationId] = useState(tranches[0]?.id ?? "");
  const [receiptStatus, setReceiptStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const obligation = tranches.find((item) => item.id === obligationId);

  async function retryReceiptUpload(paymentEventId: string) {
    const file = retryInputRef.current?.files?.[0];
    if (!file) return;
    setRetryUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(`/api/v2/payment-receipts/${paymentEventId}`, {
        method: "POST",
        body,
      });
      if (response.ok) {
        setReceiptStatus("done");
        router.refresh();
      } else {
        setReceiptStatus("error");
      }
    } catch {
      setReceiptStatus("error");
    } finally {
      setRetryUploading(false);
    }
  }

  const [state, action, pending] = useActionState(
    async (previous: CaseAgreementState, form: FormData): Promise<CaseAgreementState> => {
      const submitted = frozen.current ?? form;
      frozen.current = submitted;
      try {
        const result = await recordCasePaymentAction(previous, submitted);
        if (result.status !== "unavailable") frozen.current = null;
        if (result.status === "saved" && result.resourceId) {
          const file = receiptInputRef.current?.files?.[0];
          if (file) {
            setReceiptStatus("uploading");
            try {
              const body = new FormData();
              body.set("file", file);
              const receiptResponse = await fetch(
                `/api/v2/payment-receipts/${result.resourceId}`,
                { method: "POST", body },
              );
              setReceiptStatus(receiptResponse.ok ? "done" : "error");
            } catch {
              setReceiptStatus("error");
            }
          }
          router.refresh();
        }
        return result;
      } catch {
        return { ...previous, status: "unavailable" };
      }
    },
    { status: "idle", requestId, resourceId: null } as CaseAgreementState,
  );
  const locked = pending || ["saved", "unavailable"].includes(state.status) ||
    (state.status === "request_conflict" && currentRequestId === state.requestId);
  const savedPaymentEventId = state.status === "saved" ? state.resourceId : null;

  return (
    <details className="mt-2">
      <summary className={ADD_SUMMARY}>
        Добавить оплату
      </summary>
      <form action={action} className="mt-2 max-w-xl space-y-3 pb-2">
        <input type="hidden" name="request_id" value={currentRequestId} />
        <input type="hidden" name="student_case_id" value={studentCaseId} />
        <input type="hidden" name="at" value={nowBishkekLocalInput()} />
        <input type="hidden" name="currency" value={obligation?.currency ?? ""} />
        <fieldset disabled={locked} className="space-y-3">
          <label className="block">
            <span className={fieldLabelCls}>Транш</span>
            <select
              name="payment_obligation_id"
              required
              value={obligationId}
              onChange={(event) => setObligationId(event.target.value)}
              className={inputCls}
            >
              {tranches.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} · {item.currency}
                </option>
              ))}
            </select>
          </label>
          {obligation ? (
            <p className="t-body-compact text-fg-2">
              Осталось: {financeMoney(obligation.outstandingMinor, obligation.currency)}
            </p>
          ) : null}
          <label className="block">
            <span className={fieldLabelCls}>Сумма{obligation ? ` (${obligation.currency})` : ""}</span>
            <input
              name="amount"
              inputMode="decimal"
              pattern="[0-9]+([.,][0-9]{1,2})?"
              required
              className={inputCls}
            />
          </label>
          <div>
            <span className={fieldLabelCls}>Чек · PDF, JPEG, PNG до 25 МБ, необязательно</span>
            <FilePick inputRef={receiptInputRef} label="Выбрать чек" />
          </div>
          <input type="hidden" name="note" value="" />
          <button className={QUEUE_CONFIRM} disabled={locked}>
            {pending ? "Сохраняем…" : "Сохранить оплату"}
          </button>
        </fieldset>
        {receiptStatus === "error" && savedPaymentEventId ? (
          // FIX 5 (adversarial review): a working retry, not just a message
          // asking the user to do something the form has no control for.
          // Deliberately outside <fieldset disabled={locked}> — by the time
          // receiptStatus can be "error" the payment already saved and the
          // fieldset is locked, so a control bound to the retry must live
          // outside it.
          <div className="space-y-2 border-t border-border pt-2">
            <p role="alert" className="t-body-compact text-fg-2">Оплата сохранена; чек не загрузился.</p>
            <FilePick inputRef={retryInputRef} label="Выбрать чек" disabled={retryUploading} />
            <button
              type="button"
              onClick={() => retryReceiptUpload(savedPaymentEventId)}
              disabled={retryUploading}
              className={QUEUE_CONFIRM}
            >
              {retryUploading ? "Загружаем…" : "Загрузить чек"}
            </button>
          </div>
        ) : null}
        {state.status !== "idle" ? (
          <p role={state.status === "saved" ? "status" : "alert"} className="t-body-compact text-fg-2">
            {MESSAGES[state.status]}
          </p>
        ) : null}
        {state.status === "unavailable" ? (
          <button type="submit" disabled={pending} className={btnGhostCls}>Повторить тот же запрос</button>
        ) : null}
        {state.status === "saved" ? (
          <button type="button" onClick={onAnother} className="min-h-11 t-label underline underline-offset-4">Ещё оплата</button>
        ) : null}
        {state.status === "request_conflict" && currentRequestId === state.requestId ? (
          <button
            type="button"
            onClick={() => setCurrentRequestId(crypto.randomUUID())}
            className="min-h-11 t-label underline underline-offset-4"
          >
            Сверил историю, продолжить
          </button>
        ) : null}
      </form>
    </details>
  );
}
