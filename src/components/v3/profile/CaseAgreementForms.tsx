"use client";
import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btnCls, btnGhostCls, inputCls, fieldLabelCls } from "@/components/ui";
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

export function CaseAgreementUploadContract({
  studentCaseId,
}: Readonly<{ studentCaseId: string }>) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");

  return (
    <form
      data-testid="v3-case-agreement-upload"
      onSubmit={async (event) => {
        event.preventDefault();
        const file = inputRef.current?.files?.[0];
        if (!file) return;
        setStatus("uploading");
        try {
          const body = new FormData();
          body.set("file", file);
          const response = await fetch(`/api/v2/case-contract-files/${studentCaseId}`, {
            method: "POST",
            body,
          });
          setStatus(response.ok ? "done" : "error");
          if (response.ok) {
            if (inputRef.current) inputRef.current.value = "";
            router.refresh();
          }
        } catch {
          setStatus("error");
        }
      }}
      className="flex flex-wrap items-center gap-3"
    >
      <input
        ref={inputRef}
        type="file"
        name="file"
        accept="application/pdf,image/jpeg,image/png"
        required
        className="min-w-0 max-w-full text-sm text-fg-2"
      />
      <button type="submit" disabled={status === "uploading"} className={btnCls}>
        {status === "uploading" ? "Загружаем…" : "Загрузить договор"}
      </button>
      {status === "error" ? (
        <span role="alert" className="text-sm text-fg-2">Не удалось загрузить файл.</span>
      ) : null}
    </form>
  );
}

export function CaseAgreementTrancheEditor({
  studentCaseId,
  tranche,
  canArchive,
}: Readonly<{
  studentCaseId: string;
  tranche: CaseAgreementTranche | null;
  canArchive: boolean;
}>) {
  const router = useRouter();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  return (
    <TrancheEditor
      key={requestId}
      studentCaseId={studentCaseId}
      tranche={tranche}
      canArchive={canArchive}
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
  requestId,
  router,
  onAnother,
}: Readonly<{
  studentCaseId: string;
  tranche: CaseAgreementTranche | null;
  canArchive: boolean;
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
    <details className="border-t border-border py-2">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        aria-label={tranche ? `Изменить транш: ${tranche.label}` : undefined}>
        {tranche ? "Изменить транш" : "Разбить на транши"}
      </summary>
      <form action={action} className="mt-2 space-y-3">
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
            <label className="flex items-center gap-2 text-sm text-fg-2">
              <input
                type="checkbox"
                checked={archive}
                onChange={(event) => setArchive(event.target.checked)}
              />
              Архивировать транш
            </label>
          ) : null}
          <button className={btnCls} disabled={locked}>
            {pending ? "Сохраняем…" : "Сохранить"}
          </button>
        </fieldset>
        {state.status !== "idle" ? (
          <p role={state.status === "saved" ? "status" : "alert"} className="text-sm text-fg-2">
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
          <button type="button" onClick={onAnother} className="min-h-11 text-sm underline">
            {tranche ? "Изменить ещё раз" : "Ещё транш"}
          </button>
        ) : null}
        {state.status === "request_conflict" && currentRequestId === state.requestId ? (
          <button
            type="button"
            onClick={() => setCurrentRequestId(crypto.randomUUID())}
            className="min-h-11 text-sm underline"
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
    <details className="border-t border-border py-2">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-accent-text">
        Добавить оплату
      </summary>
      <form action={action} className="mt-2 space-y-3">
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
            <p className="text-sm text-fg-2">
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
          <label className="block">
            <span className={fieldLabelCls}>Чек</span>
            <input
              ref={receiptInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="text-sm text-fg-2"
            />
          </label>
          <input type="hidden" name="note" value="" />
          <button className={btnCls} disabled={locked}>
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
            <p role="alert" className="text-sm text-fg-2">Оплата сохранена; чек не загрузился.</p>
            <input
              ref={retryInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="text-sm text-fg-2"
            />
            <button
              type="button"
              onClick={() => retryReceiptUpload(savedPaymentEventId)}
              disabled={retryUploading}
              className={btnCls}
            >
              {retryUploading ? "Загружаем…" : "Загрузить чек"}
            </button>
          </div>
        ) : null}
        {state.status !== "idle" ? (
          <p role={state.status === "saved" ? "status" : "alert"} className="text-sm text-fg-2">
            {MESSAGES[state.status]}
          </p>
        ) : null}
        {state.status === "unavailable" ? (
          <button type="submit" disabled={pending} className={btnGhostCls}>Повторить тот же запрос</button>
        ) : null}
        {state.status === "saved" ? (
          <button type="button" onClick={onAnother} className="min-h-11 text-sm underline">Ещё оплата</button>
        ) : null}
        {state.status === "request_conflict" && currentRequestId === state.requestId ? (
          <button
            type="button"
            onClick={() => setCurrentRequestId(crypto.randomUUID())}
            className="min-h-11 text-sm underline"
          >
            Сверил историю, продолжить
          </button>
        ) : null}
      </form>
    </details>
  );
}
