"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useState, type ChangeEvent, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { fieldLabelCls, inputCls } from "@/components/ui";
import { recordCasePaymentAction, saveCaseTrancheAction } from "@/lib/platform-case-agreement-actions";
import {
  type CaseAgreement,
  type CaseAgreementState,
  type CaseAgreementTranche,
} from "@/lib/platform-case-agreement-contract";
import { caseMoneyWords } from "@/lib/v3/wording";

import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "../queue/queue-buttons";
import { moneyAmount } from "./case-money-view";

const words = caseMoneyWords.pay;
const UPLOAD_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const MESSAGES: Record<CaseAgreementState["status"], string> = {
  idle: "",
  saved: "Сохранено.",
  invalid: "Проверьте поля, валюту и сумму.",
  forbidden: "Нет доступа для этого действия.",
  request_conflict: "Этот запрос уже использован. Проверьте историю перед новой попыткой.",
  unavailable: "Результат неизвестен. Ввод сохранён; повторите тот же запрос.",
  tranche_paid: "Платёж уже оплачен — сумма и валюта фиксированы. Обновите карточку.",
};

function nowBishkekLocalInput(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function minorToAmount(minor: string): string {
  const value = BigInt(minor);
  const whole = value / BigInt(100);
  const fraction = value % BigInt(100);
  return fraction === BigInt(0) ? whole.toString() : `${whole}.${fraction.toString().padStart(2, "0")}`;
}

export type PaymentFormRequest = Readonly<{ mode: "paid" | "planned"; obligationId: string | null }>;

type DeskApi = Readonly<{
  agreement: CaseAgreement;
  canWrite: boolean;
  today: string;
  form: PaymentFormRequest | null;
  editingId: string | null;
  archivingId: string | null;
  openForm: (form: PaymentFormRequest) => void;
  edit: (id: string | null) => void;
  archive: (id: string | null) => void;
  close: () => void;
}>;

const DeskContext = createContext<DeskApi | null>(null);

export function usePaymentDesk(): DeskApi {
  const value = useContext(DeskContext);
  if (value === null) throw new Error("Payment desk is missing.");
  return value;
}

/** Состояние «+ Платёж», правки строки и удаления. Серверные команды — прежние. */
export function PaymentDesk({ agreement, canWrite, today, children }: Readonly<{
  agreement: CaseAgreement;
  canWrite: boolean;
  today: string;
  children: ReactNode;
}>) {
  const [form, setForm] = useState<PaymentFormRequest | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const close = () => { setForm(null); setEditingId(null); setArchivingId(null); };
  const api: DeskApi = {
    agreement, canWrite, today, form, editingId, archivingId, close,
    openForm: (next) => { setEditingId(null); setArchivingId(null); setForm(next); },
    edit: (id) => { setForm(null); setArchivingId(null); setEditingId(id); },
    archive: (id) => { setForm(null); setEditingId(null); setArchivingId(id); },
  };
  return <DeskContext.Provider value={api}>{children}</DeskContext.Provider>;
}

export function PaymentAddButton() {
  const desk = usePaymentDesk();
  if (!desk.canWrite) return null;
  const open = desk.form !== null && desk.form.obligationId === null;
  return (
    <Button type="button" variant="outline" aria-expanded={open} data-testid="v3-case-payment-add"
      onClick={() => (open ? desk.close() : desk.openForm({ mode: desk.agreement.tranches.length > 0 ? "paid" : "planned", obligationId: null }))}>
      {words.add}
    </Button>
  );
}

export function PaymentFormSlot() {
  const desk = usePaymentDesk();
  return (
    <div data-testid="v3-case-agreement-payment" className="empty:hidden">
      {desk.form ? <PaymentComposer key={`${desk.form.mode}:${desk.form.obligationId ?? "new"}`} request={desk.form} onClose={desk.close} /> : null}
    </div>
  );
}

function PaymentComposer({ request, onClose }: Readonly<{ request: PaymentFormRequest; onClose: () => void }>) {
  const desk = usePaymentDesk();
  const locked = desk.agreement.tranches.find((tranche) => tranche.id === request.obligationId) ?? null;
  const [mode, setMode] = useState<"paid" | "planned">(locked ? "paid" : request.mode);
  // «Уже оплачен»: день оплаты - сегодня. «Запланирован»: срок пуст, пока его не указали (как на main): подставленное «сегодня» завтра стало бы просрочкой.
  const [day, setDay] = useState(desk.today);
  const [due, setDue] = useState("");
  const [amount, setAmount] = useState(locked && BigInt(locked.outstandingMinor) > BigInt(0) ? minorToAmount(locked.outstandingMinor) : "");
  const root = useRef<HTMLDivElement>(null);
  // Форма, которая открылась, берёт фокус, и браузер показывает её: иначе после «Отметить оплаченным» у строки внизу длинной таблицы ничего не видно.
  useEffect(() => {
    // Открыта из меню строки: фокус отдаст меню, когда закроется (его ловушка фокуса вернула бы фокус в пункт, см. RowMenu).
    if (document.activeElement?.closest("[role=menu]")) return;
    root.current?.querySelector<HTMLElement>(locked ? "input[name=amount]" : "[role=radio][aria-checked=true]")?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при открытии формы
  }, []);
  return (
    <div ref={root} className="grid gap-3 rounded-ctl border border-border bg-surface-2 p-3">
      {locked ? <p className="t-body-compact text-fg">{locked.label}</p> : (
        <div role="radiogroup" aria-label={words.mode} className="inline-flex w-fit rounded-ctl border border-border bg-surface p-0.5">
          {(["paid", "planned"] as const).map((item) => (
            <button key={item} type="button" role="radio" aria-checked={mode === item}
              className={`inline-flex h-11 items-center rounded-nav px-3 t-label ${mode === item ? "bg-accent-weak font-semibold text-fg" : "text-fg-2 hover:text-fg"}`}
              onClick={() => setMode(item)}>
              {item === "paid" ? words.alreadyPaid : words.planned}
            </button>
          ))}
        </div>
      )}
      {mode === "paid"
        ? <PaidForm agreement={desk.agreement} locked={locked} day={day} amount={amount} setDay={setDay} setAmount={setAmount} onClose={onClose} />
        : <PlannedForm agreement={desk.agreement} due={due} amount={amount} setDue={setDue} setAmount={setAmount} onClose={onClose} />}
    </div>
  );
}

function FilePick({ inputRef, label }: Readonly<{ inputRef: RefObject<HTMLInputElement | null>; label: string }>) {
  const [name, setName] = useState<string | null>(null);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <label className={`${QUEUE_SECONDARY} cursor-pointer has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus-ring`}>
        <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only"
          onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.files?.[0]?.name ?? null)} />
        {label}
      </label>
      {name ? <span className="min-w-0 break-all t-meta text-fg-2">{name}</span> : null}
    </span>
  );
}

function useAgreementAction(run: (previous: CaseAgreementState, form: FormData) => Promise<CaseAgreementState>, requestId: string) {
  const router = useRouter();
  const frozen = useRef<FormData | null>(null);
  return useActionState(async (previous: CaseAgreementState, form: FormData): Promise<CaseAgreementState> => {
    const submitted = frozen.current ?? form;
    frozen.current = submitted;
    try {
      const result = await run(previous, submitted);
      if (result.status !== "unavailable") frozen.current = null;
      if (result.status === "saved") router.refresh();
      return result;
    } catch {
      return { ...previous, status: "unavailable" };
    }
  }, { status: "idle", requestId, resourceId: null } as CaseAgreementState);
}

function PaidForm({ agreement, locked, day, amount, setDay, setAmount, onClose }: Readonly<{
  agreement: CaseAgreement;
  locked: CaseAgreementTranche | null;
  day: string;
  amount: string;
  setDay: (value: string) => void;
  setAmount: (value: string) => void;
  onClose: () => void;
}>) {
  const router = useRouter();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [now] = useState(nowBishkekLocalInput);
  const [obligationId, setObligationId] = useState(locked?.id ?? agreement.tranches.find((item) => item.outstandingMinor !== "0")?.id ?? agreement.tranches[0]?.id ?? "");
  const receiptRef = useRef<HTMLInputElement>(null);
  const retryRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState("");
  const [receiptStatus, setReceiptStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [retrying, setRetrying] = useState(false);
  const [state, action, pending] = useAgreementAction(async (previous, form) => {
    const file = receiptRef.current?.files?.[0];
    if (file && (!UPLOAD_TYPES.has(file.type) || file.size < 1 || file.size > UPLOAD_MAX_BYTES)) {
      setFileError("Нужен непустой PDF, JPEG или PNG до 25 МБ.");
      return { ...previous, status: "idle" };
    }
    setFileError("");
    const result = await recordCasePaymentAction(previous, form);
    if (result.status === "saved" && result.resourceId && file) {
      setReceiptStatus("uploading");
      try {
        const body = new FormData();
        body.set("file", file);
        const response = await fetch(`/api/v2/payment-receipts/${result.resourceId}`, { method: "POST", body });
        setReceiptStatus(response.ok ? "done" : "error");
      } catch {
        setReceiptStatus("error");
      }
    }
    return result;
  }, requestId);
  const obligation = agreement.tranches.find((item) => item.id === obligationId) ?? null;
  const lockedForm = pending || ["saved", "unavailable"].includes(state.status) || (state.status === "request_conflict" && requestId === state.requestId);
  const savedId = state.status === "saved" ? state.resourceId : null;

  async function retry(paymentEventId: string) {
    const file = retryRef.current?.files?.[0];
    if (!file) return;
    setRetrying(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(`/api/v2/payment-receipts/${paymentEventId}`, { method: "POST", body });
      if (response.ok) { setReceiptStatus("done"); router.refresh(); } else setReceiptStatus("error");
    } catch {
      setReceiptStatus("error");
    } finally {
      setRetrying(false);
    }
  }

  if (agreement.tranches.length === 0) {
    return <p className="t-body-compact text-fg-2">{words.needPlan}</p>;
  }
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="student_case_id" value={agreement.studentCaseId} />
      <input type="hidden" name="at" value={`${day}${now.slice(10)}`} />
      <input type="hidden" name="currency" value={obligation?.currency ?? ""} />
      <input type="hidden" name="note" value="" />
      {locked ? <input type="hidden" name="payment_obligation_id" value={locked.id} /> : null}
      <fieldset disabled={lockedForm} className="grid gap-3">
        {locked ? null : (
          <label className="block max-w-sm">
            <span className={fieldLabelCls}>{words.whichPlan}</span>
            <select name="payment_obligation_id" required value={obligationId} onChange={(event) => setObligationId(event.target.value)} className={inputCls}>
              {agreement.tranches.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.currency}</option>)}
            </select>
          </label>
        )}
        {obligation ? <p className="t-body-compact text-fg-2">{words.left}: {moneyAmount(obligation.outstandingMinor, obligation.currency)}</p> : null}
        <div className="grid gap-3 @2xl:grid-cols-[9.5rem_9.5rem_minmax(0,1fr)]">
          <label className="block">
            <span className={fieldLabelCls}>{words.date}</span>
            <input type="date" required value={day} max={now.slice(0, 10)} onChange={(event) => setDay(event.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>{words.amount}{obligation ? ` (${obligation.currency})` : ""}</span>
            <input name="amount" required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" value={amount} onChange={(event) => setAmount(event.target.value)} className={inputCls} />
          </label>
          <div>
            <span className={fieldLabelCls}>{words.receipt}</span>
            <FilePick inputRef={receiptRef} label={words.pickReceipt} />
          </div>
        </div>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={QUEUE_SECONDARY} onClick={onClose}>{words.cancel}</button>
        <button className={QUEUE_CONFIRM} disabled={lockedForm}>{pending ? words.saving : words.save}</button>
      </div>
      {fileError ? <p role="alert" className="t-body-compact text-danger">{fileError}</p> : null}
      {receiptStatus === "error" && savedId ? (
        <div className="grid gap-2 border-t border-border pt-2">
          <p role="alert" className="t-body-compact text-fg-2">Оплата сохранена; чек не загрузился.</p>
          <FilePick inputRef={retryRef} label={words.pickReceipt} />
          <button type="button" className={QUEUE_CONFIRM} disabled={retrying} onClick={() => void retry(savedId)}>{retrying ? "Загружаем…" : "Загрузить чек"}</button>
        </div>
      ) : null}
      <ActionStatus state={state} pending={pending} onContinue={() => setRequestId(crypto.randomUUID())} />
    </form>
  );
}

function PlannedForm({ agreement, due, amount, setDue, setAmount, onClose }: Readonly<{
  agreement: CaseAgreement;
  due: string;
  amount: string;
  setDue: (value: string) => void;
  setAmount: (value: string) => void;
  onClose: () => void;
}>) {
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [currency, setCurrency] = useState(agreement.costCurrency ?? agreement.tranches[0]?.currency ?? "");
  const [label, setLabel] = useState("");
  const [state, action, pending] = useAgreementAction((previous, form) => saveCaseTrancheAction(previous, form), requestId);
  const lockedForm = pending || ["saved", "unavailable"].includes(state.status) || (state.status === "request_conflict" && requestId === state.requestId);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="student_case_id" value={agreement.studentCaseId} />
      <input type="hidden" name="payment_obligation_id" value="" />
      <input type="hidden" name="archive" value="false" />
      <fieldset disabled={lockedForm} className="grid gap-3">
        <div className="grid gap-3 @2xl:grid-cols-3">
          <label className="block">
            <span className={fieldLabelCls}>{words.date}</span>
            <input name="due_on" type="date" value={due} onChange={(event) => setDue(event.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>{words.amount}</span>
            <input name="amount" required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" value={amount} onChange={(event) => setAmount(event.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>{words.currency}</span>
            <input name="currency" required maxLength={3} pattern="[A-Za-z]{3}" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} className={inputCls} placeholder="USD" />
          </label>
        </div>
        <label className="block max-w-sm">
          <span className={fieldLabelCls}>{words.name}</span>
          <input name="label" maxLength={500} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Например, первый платёж" className={inputCls} />
        </label>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={QUEUE_SECONDARY} onClick={onClose}>{words.cancel}</button>
        <button className={QUEUE_CONFIRM} disabled={lockedForm}>{pending ? words.saving : words.save}</button>
      </div>
      <ActionStatus state={state} pending={pending} onContinue={() => setRequestId(crypto.randomUUID())} />
    </form>
  );
}

function ActionStatus({ state, pending, onContinue }: Readonly<{ state: CaseAgreementState; pending: boolean; onContinue: () => void }>) {
  if (state.status === "idle") return null;
  return (
    <div className="grid gap-1">
      <p role={state.status === "saved" ? "status" : "alert"} className="t-body-compact text-fg-2">{MESSAGES[state.status]}</p>
      {state.status === "unavailable" ? <button type="submit" disabled={pending} className="min-h-11 w-fit t-label underline underline-offset-4">Повторить тот же запрос</button> : null}
      {state.status === "request_conflict" ? <button type="button" onClick={onContinue} className="min-h-11 w-fit t-label underline underline-offset-4">Сверил историю, продолжить</button> : null}
    </div>
  );
}
