"use client";

import { useActionState } from "react";

import {
  updatePlatformAdmissionsGateAction,
  type PlatformAdmissionsGateActionState,
} from "@/lib/platform-admissions-gate-actions";
import type {
  PlatformAdmissionsGate,
  PlatformAdmissionsGateAction,
  PlatformAdmissionsGateState,
} from "@/lib/platform-admissions-gate-contract";
import { Card, btnCls, cn, inputCls, labelCls } from "@/components/ui";

type Locale = "ru" | "ky" | "en";

type GateRequestIds = Readonly<{
  confirmContract: string;
  confirmFirstPayment: string;
  overrideGate: string;
}>;

type GateCopy = Readonly<{
  title: string;
  description: string;
  state: Record<PlatformAdmissionsGateState, string>;
  normalAllowed: string;
  exceptionalAllowed: string;
  contract: string;
  paymentExpectation: string;
  paymentReceived: string;
  override: string;
  confirmed: string;
  notConfirmed: string;
  notSet: string;
  version: string;
  updated: string;
  actor: string;
  amount: string;
  currency: string;
  dueDate: string;
  receivedDate: string;
  evidence: string;
  reason: string;
  confirmContract: string;
  confirmPayment: string;
  createOverride: string;
  noMutationAuthority: string;
  saved: string;
  invalid: string;
  forbidden: string;
  stale: string;
  requestConflict: string;
  unavailable: string;
  saving: string;
}>;

const COPY: Record<Locale, GateCopy> = {
  ru: {
    title: "Допуск к передаче в Admissions",
    description:
      "Обычная передача разрешена только после подтверждения договора и первого обязательного платежа. Исключение — отдельное решение уполномоченного Admin с причиной.",
    state: {
      blocked: "Передача заблокирована",
      satisfied: "Обычная передача разрешена",
      overridden: "Разрешено только как исключение",
    },
    normalAllowed: "Обычная передача",
    exceptionalAllowed: "Передача по исключению",
    contract: "Договор",
    paymentExpectation: "Первый обязательный платёж",
    paymentReceived: "Получение платежа",
    override: "Исключение",
    confirmed: "Подтверждено",
    notConfirmed: "Не подтверждено",
    notSet: "Нет",
    version: "Версия gate",
    updated: "Обновлено",
    actor: "membership",
    amount: "Сумма",
    currency: "Валюта (ISO, например USD)",
    dueDate: "Срок первого платежа",
    receivedDate: "Дата получения",
    evidence: "Ссылка или номер подтверждающего документа",
    reason: "Причина исключения",
    confirmContract: "Подтвердить договор и обязательство",
    confirmPayment: "Подтвердить первый платёж",
    createOverride: "Разрешить исключение",
    noMutationAuthority:
      "Карточка доступна только для чтения: у текущего сотрудника нет индивидуального права на следующее подтверждение.",
    saved: "Факт сохранён атомарно и записан в аудит.",
    invalid: "Проверьте обязательные поля и формат значений.",
    forbidden: "У текущего сотрудника нет права на это подтверждение.",
    stale: "Gate уже изменён в другой вкладке. Обновите страницу и повторите.",
    requestConflict: "Идентификатор запроса уже использован. Повторите отправку.",
    unavailable: "Сохранение недоступно. Gate не считается изменённым.",
    saving: "Сохраняем…",
  },
  ky: {
    title: "Admissions бөлүмүнө өткөрүүгө уруксат",
    description:
      "Кадимки өткөрүү келишим жана биринчи милдеттүү төлөм ырасталгандан кийин гана мүмкүн. Өзгөчө уруксатты ыйгарым укуктуу Admin себеп көрсөтүп берет.",
    state: {
      blocked: "Өткөрүү бөгөттөлгөн",
      satisfied: "Кадимки өткөрүүгө уруксат",
      overridden: "Өзгөчө тартипте гана уруксат",
    },
    normalAllowed: "Кадимки өткөрүү",
    exceptionalAllowed: "Өзгөчө өткөрүү",
    contract: "Келишим",
    paymentExpectation: "Биринчи милдеттүү төлөм",
    paymentReceived: "Төлөмдүн алынышы",
    override: "Өзгөчө уруксат",
    confirmed: "Ырасталды",
    notConfirmed: "Ырасталган жок",
    notSet: "Жок",
    version: "Gate версиясы",
    updated: "Жаңыртылды",
    actor: "membership",
    amount: "Сумма",
    currency: "Валюта (ISO, мисалы USD)",
    dueDate: "Биринчи төлөмдүн мөөнөтү",
    receivedDate: "Алынган күнү",
    evidence: "Ырастоочу документтин шилтемеси же номери",
    reason: "Өзгөчө уруксаттын себеби",
    confirmContract: "Келишимди жана милдеттенмени ырастоо",
    confirmPayment: "Биринчи төлөмдү ырастоо",
    createOverride: "Өзгөчө уруксат берүү",
    noMutationAuthority:
      "Карточка окуу үчүн гана: бул кызматкерде кийинки ырастоого жеке укук жок.",
    saved: "Факт атомдук түрдө сакталды жана аудитке жазылды.",
    invalid: "Милдеттүү талааларды жана маанилердин форматын текшериңиз.",
    forbidden: "Бул ырастоого укук жок.",
    stale: "Gate башка терезеде өзгөргөн. Баракты жаңыртып, кайталаңыз.",
    requestConflict: "Суроо идентификатору колдонулган. Кайра жөнөтүңүз.",
    unavailable: "Сактоо жеткиликсиз. Gate өзгөргөн деп эсептелбейт.",
    saving: "Сакталууда…",
  },
  en: {
    title: "Admissions handoff gate",
    description:
      "Normal handoff is allowed only after the contract and first mandatory payment are confirmed. An exception requires a separately authorized Admin and a reason.",
    state: {
      blocked: "Handoff blocked",
      satisfied: "Normal handoff allowed",
      overridden: "Exceptional handoff only",
    },
    normalAllowed: "Normal handoff",
    exceptionalAllowed: "Exceptional handoff",
    contract: "Contract",
    paymentExpectation: "First mandatory payment",
    paymentReceived: "Payment receipt",
    override: "Exception",
    confirmed: "Confirmed",
    notConfirmed: "Not confirmed",
    notSet: "None",
    version: "Gate version",
    updated: "Updated",
    actor: "membership",
    amount: "Amount",
    currency: "Currency (ISO, for example USD)",
    dueDate: "First-payment due date",
    receivedDate: "Receipt date",
    evidence: "Evidence document link or reference",
    reason: "Exception reason",
    confirmContract: "Confirm contract and obligation",
    confirmPayment: "Confirm first payment",
    createOverride: "Allow exception",
    noMutationAuthority:
      "This card is read-only: the current staff member has no individual permission for the next confirmation.",
    saved: "The fact was saved atomically and recorded in the audit log.",
    invalid: "Check the required fields and value formats.",
    forbidden: "The current staff member cannot make this confirmation.",
    stale: "The gate changed in another tab. Refresh and try again.",
    requestConflict: "The request identifier was already used. Submit again.",
    unavailable: "Saving is unavailable. The gate is not considered changed.",
    saving: "Saving…",
  },
};

const STATUS_TONE: Record<PlatformAdmissionsGateState, string> = {
  blocked: "bg-danger-weak text-danger",
  satisfied: "bg-ok-weak text-ok",
  overridden: "bg-warn-weak text-warn",
};

function yesNo(value: boolean, copy: GateCopy) {
  return value ? copy.confirmed : copy.notConfirmed;
}

function GateFact({
  label,
  children,
  testId,
}: Readonly<{
  label: string;
  children: React.ReactNode;
  testId?: string;
}>) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5" data-testid={testId}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">
        {label}
      </dt>
      <dd className="mt-1 text-[13px] leading-5 text-fg">{children}</dd>
    </div>
  );
}

function GateProvenance({
  actorId,
  occurredAt,
  copy,
}: Readonly<{
  actorId: string | null;
  occurredAt: string | null;
  copy: GateCopy;
}>) {
  if (!actorId || !occurredAt) return null;
  return (
    <span className="mt-1 block break-all font-mono text-[10.5px] leading-4 text-fg-3">
      {copy.actor}: {actorId} · <time dateTime={occurredAt}>{occurredAt}</time>
    </span>
  );
}

function actionMessage(
  state: PlatformAdmissionsGateActionState,
  copy: GateCopy,
) {
  if (state.status === "idle") return null;
  return {
    saved: copy.saved,
    invalid: copy.invalid,
    forbidden: copy.forbidden,
    stale: copy.stale,
    request_conflict: copy.requestConflict,
    unavailable: copy.unavailable,
  }[state.status];
}

function GateActionForm({
  action,
  gate,
  requestId,
  copy,
}: Readonly<{
  action: PlatformAdmissionsGateAction;
  gate: PlatformAdmissionsGate;
  requestId: string;
  copy: GateCopy;
}>) {
  const initialState: PlatformAdmissionsGateActionState = {
    status: "idle",
    requestId,
    gateVersion: null,
    gateState: null,
    changedAt: null,
  };
  const [state, formAction, pending] = useActionState(
    updatePlatformAdmissionsGateAction,
    initialState,
  );
  const message = actionMessage(state, copy);
  const expectedVersion = state.gateVersion ?? gate.gateVersion;
  const buttonLabel = {
    confirm_contract: copy.confirmContract,
    confirm_first_payment: copy.confirmPayment,
    override_gate: copy.createOverride,
  }[action];

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-lg border border-border p-4"
      data-testid={`admissions-gate-form-${action}`}
    >
      <input type="hidden" name="lead_id" value={gate.leadId} />
      <input type="hidden" name="expected_gate_version" value={expectedVersion} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="action" value={action} />

      {action === "confirm_contract" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <label>
              <span className={labelCls}>{copy.amount}</span>
              <input
                className={cn(inputCls, "font-mono")}
                name="amount"
                inputMode="decimal"
                pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?"
                required
                data-testid="admissions-gate-contract-amount"
              />
            </label>
            <label>
              <span className={labelCls}>{copy.currency}</span>
              <input
                className={cn(inputCls, "font-mono uppercase")}
                name="currency"
                pattern="[A-Z]{3}"
                maxLength={3}
                required
                data-testid="admissions-gate-contract-currency"
              />
            </label>
            <label>
              <span className={labelCls}>{copy.dueDate}</span>
              <input
                className={cn(inputCls, "font-mono")}
                name="due_date"
                type="date"
                required
                data-testid="admissions-gate-contract-due-date"
              />
            </label>
          </div>
          <label>
            <span className={labelCls}>{copy.evidence}</span>
            <input
              className={inputCls}
              name="evidence_reference"
              maxLength={500}
              required
              data-testid="admissions-gate-contract-evidence"
            />
          </label>
          <input type="hidden" name="received_date" value="" />
          <input type="hidden" name="reason" value="" />
        </>
      ) : null}

      {action === "confirm_first_payment" ? (
        <>
          <label>
            <span className={labelCls}>{copy.receivedDate}</span>
            <input
              className={cn(inputCls, "font-mono")}
              name="received_date"
              type="date"
              required
              data-testid="admissions-gate-payment-received-date"
            />
          </label>
          <label>
            <span className={labelCls}>{copy.evidence}</span>
            <input
              className={inputCls}
              name="evidence_reference"
              maxLength={500}
              required
              data-testid="admissions-gate-payment-evidence"
            />
          </label>
          <input type="hidden" name="amount" value="" />
          <input type="hidden" name="currency" value="" />
          <input type="hidden" name="due_date" value="" />
          <input type="hidden" name="reason" value="" />
        </>
      ) : null}

      {action === "override_gate" ? (
        <>
          <label>
            <span className={labelCls}>{copy.reason}</span>
            <textarea
              className={cn(inputCls, "min-h-24 resize-y py-2")}
              name="reason"
              maxLength={1000}
              required
              data-testid="admissions-gate-override-reason"
            />
          </label>
          <input type="hidden" name="amount" value="" />
          <input type="hidden" name="currency" value="" />
          <input type="hidden" name="due_date" value="" />
          <input type="hidden" name="received_date" value="" />
          <input type="hidden" name="evidence_reference" value="" />
        </>
      ) : null}

      <button
        type="submit"
        className={btnCls}
        disabled={pending}
        data-testid={`admissions-gate-submit-${action}`}
      >
        {pending ? copy.saving : buttonLabel}
      </button>
      {message ? (
        <p
          className={state.status === "saved" ? "text-sm text-ok" : "text-sm text-warn"}
          role="status"
          data-testid={`admissions-gate-${state.status}`}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}

export function SalesAdmissionsGateCard({
  gate,
  locale,
  requestIds,
}: Readonly<{
  gate: PlatformAdmissionsGate;
  locale: Locale;
  requestIds: GateRequestIds;
}>) {
  const copy = COPY[locale];
  const hasAvailableAction =
    gate.canConfirmContract || gate.canConfirmFirstPayment || gate.canOverrideGate;

  return (
    <Card
      title={copy.title}
      action={
        <span
          className={cn(
            "inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold",
            STATUS_TONE[gate.gateState],
          )}
          data-testid="admissions-gate-state"
        >
          {copy.state[gate.gateState]}
        </span>
      }
      className="border-l-4 border-l-accent"
    >
      <div className="space-y-5" data-testid="admissions-gate-card">
        <p className="max-w-4xl text-[13px] leading-5 text-fg-3">{copy.description}</p>

        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <GateFact label={copy.contract} testId="admissions-gate-contract-state">
            {yesNo(gate.contractConfirmed, copy)}
            {gate.contractEvidenceReference ? (
              <span className="mt-1 block break-words text-[11px] text-fg-3">
                {gate.contractEvidenceReference}
              </span>
            ) : null}
            <GateProvenance
              actorId={gate.contractConfirmedByMembershipId}
              occurredAt={gate.contractConfirmedAt}
              copy={copy}
            />
          </GateFact>
          <GateFact label={copy.paymentExpectation} testId="admissions-gate-payment-expectation">
            {gate.firstPaymentAmount !== null && gate.firstPaymentCurrency
              ? `${gate.firstPaymentAmount.toFixed(2)} ${gate.firstPaymentCurrency}`
              : copy.notSet}
            {gate.firstPaymentDueDate ? (
              <span className="mt-1 block font-mono text-[11px] text-fg-3">
                {gate.firstPaymentDueDate}
              </span>
            ) : null}
          </GateFact>
          <GateFact label={copy.paymentReceived} testId="admissions-gate-payment-state">
            {yesNo(gate.firstPaymentConfirmed, copy)}
            {gate.firstPaymentReceivedDate ? (
              <span className="mt-1 block font-mono text-[11px] text-fg-3">
                {gate.firstPaymentReceivedDate}
              </span>
            ) : null}
            {gate.firstPaymentEvidenceReference ? (
              <span className="mt-1 block break-words text-[11px] text-fg-3">
                {gate.firstPaymentEvidenceReference}
              </span>
            ) : null}
            <GateProvenance
              actorId={gate.firstPaymentConfirmedByMembershipId}
              occurredAt={gate.firstPaymentConfirmedAt}
              copy={copy}
            />
          </GateFact>
          <GateFact label={copy.override} testId="admissions-gate-override-state">
            {gate.overrideReason ?? copy.notSet}
            <GateProvenance
              actorId={gate.overriddenByMembershipId}
              occurredAt={gate.overriddenAt}
              copy={copy}
            />
          </GateFact>
          <GateFact label={copy.normalAllowed} testId="admissions-gate-normal-handoff">
            {yesNo(gate.normalHandoffAllowed, copy)}
          </GateFact>
          <GateFact label={copy.exceptionalAllowed} testId="admissions-gate-exceptional-handoff">
            {yesNo(gate.exceptionalHandoffAllowed, copy)}
          </GateFact>
          <GateFact label={copy.version}>
            <span className="font-mono">{gate.gateVersion}</span>
          </GateFact>
          <GateFact label={copy.updated}>
            <time className="font-mono text-[11px]" dateTime={gate.updatedAt}>
              {gate.updatedAt}
            </time>
          </GateFact>
        </dl>

        <div className="grid gap-4 xl:grid-cols-2">
          {gate.canConfirmContract ? (
            <GateActionForm
              action="confirm_contract"
              gate={gate}
              requestId={requestIds.confirmContract}
              copy={copy}
            />
          ) : null}
          {gate.canConfirmFirstPayment ? (
            <GateActionForm
              action="confirm_first_payment"
              gate={gate}
              requestId={requestIds.confirmFirstPayment}
              copy={copy}
            />
          ) : null}
          {gate.canOverrideGate ? (
            <GateActionForm
              action="override_gate"
              gate={gate}
              requestId={requestIds.overrideGate}
              copy={copy}
            />
          ) : null}
        </div>

        {!hasAvailableAction ? (
          <p className="text-[13px] leading-5 text-fg-3" data-testid="admissions-gate-read-only">
            {copy.noMutationAuthority}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
