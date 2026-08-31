"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { Card, btnCls, cn, inputCls, labelCls } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import {
  recordCanonicalSalesGateEvidenceAction,
  type CanonicalSalesGateActionState,
} from "@/lib/server/canonical-sales-gate-actions";
import type {
  CanonicalLeadGateEvidenceSnapshot,
  CanonicalLeadGateSnapshot,
} from "@/lib/server/canonical-crm-repository";

type Copy = Readonly<{
  title: string;
  description: string;
  state: Record<CanonicalLeadGateSnapshot["state"], string>;
  contract: string;
  payment: string;
  missing: string;
  confirmed: string;
  rejected: string;
  reference: string;
  occurredAt: string;
  reason: string;
  amountMinor: string;
  currency: string;
  decision: string;
  save: string;
  saving: string;
  saved: string;
  invalid: string;
  forbidden: string;
  stale: string;
  requestConflict: string;
  unavailable: string;
  evidenceHint: string;
  reasonHint: string;
}>;

const COPY: Record<Locale, Copy> = {
  ru: {
    title: "Договор и первый платёж",
    description:
      "Передача в Admissions откроется только после двух подтверждений в PostgreSQL: договора и первого платежа.",
    state: {
      blocked: "Передача заблокирована",
      satisfied: "Условия выполнены",
      overridden: "Передано по исключению Admin",
    },
    contract: "Договор",
    payment: "Первый платёж",
    missing: "Подтверждение ещё не записано",
    confirmed: "Подтверждено",
    rejected: "Отклонено",
    reference: "Ссылка на доказательство",
    occurredAt: "Время события (ISO, с часовым поясом)",
    reason: "Причина",
    amountMinor: "Сумма в минимальных единицах",
    currency: "Валюта",
    decision: "Решение",
    save: "Записать доказательство",
    saving: "Сохраняем…",
    saved: "Сохранено в EVO V2.",
    invalid: "Проверьте поля. Для отклонения обязательна причина.",
    forbidden: "У этой роли нет права менять условия передачи.",
    stale: "Данные изменились. Обновите страницу.",
    requestConflict:
      "Запрос уже использован с другими данными. Повторите сохранение.",
    unavailable: "PostgreSQL недоступен. Ничего не сохранено.",
    evidenceHint: "Номер договора, квитанции или внутренней записи",
    reasonHint: "Обязательно, если решение — отклонено",
  },
  ky: {
    title: "Келишим жана биринчи төлөм",
    description:
      "Admissions бөлүмүнө өткөрүү PostgreSQL базасында келишим жана биринчи төлөм ырасталгандан кийин гана ачылат.",
    state: {
      blocked: "Өткөрүү жабык",
      satisfied: "Шарттар аткарылды",
      overridden: "Admin өзгөчө чечими менен өткөрүлдү",
    },
    contract: "Келишим",
    payment: "Биринчи төлөм",
    missing: "Ырастоо азырынча жазылган жок",
    confirmed: "Ырасталды",
    rejected: "Четке кагылды",
    reference: "Далил шилтемеси",
    occurredAt: "Окуя убактысы (ISO, убакыт алкагы менен)",
    reason: "Себеп",
    amountMinor: "Эң кичине бирдиктеги сумма",
    currency: "Валюта",
    decision: "Чечим",
    save: "Далилди жазуу",
    saving: "Сакталууда…",
    saved: "EVO V2 базасына сакталды.",
    invalid: "Талааларды текшериңиз. Четке кагууда себеп милдеттүү.",
    forbidden: "Бул роль өткөрүү шарттарын өзгөртө албайт.",
    stale: "Маалымат өзгөрдү. Баракты жаңыртыңыз.",
    requestConflict: "Сурам башка маалымат үчүн колдонулган. Кайра сактаңыз.",
    unavailable: "PostgreSQL жеткиликсиз. Эч нерсе сакталган жок.",
    evidenceHint: "Келишим, квитанция же ички жазуу номери",
    reasonHint: "Чечим четке кагуу болсо милдеттүү",
  },
  en: {
    title: "Contract and first payment",
    description:
      "Admissions handoff opens only after PostgreSQL records both the contract and first-payment confirmations.",
    state: {
      blocked: "Handoff blocked",
      satisfied: "Requirements satisfied",
      overridden: "Handed off by Admin exception",
    },
    contract: "Contract",
    payment: "First payment",
    missing: "No evidence recorded yet",
    confirmed: "Confirmed",
    rejected: "Rejected",
    reference: "Evidence reference",
    occurredAt: "Event time (ISO with time zone)",
    reason: "Reason",
    amountMinor: "Amount in minor units",
    currency: "Currency",
    decision: "Decision",
    save: "Record evidence",
    saving: "Saving…",
    saved: "Saved in EVO V2.",
    invalid: "Check the fields. A rejected decision requires a reason.",
    forbidden: "This role cannot change the handoff gate.",
    stale: "The data changed. Refresh the page.",
    requestConflict: "This request was used with different data. Save again.",
    unavailable: "PostgreSQL is unavailable. Nothing was saved.",
    evidenceHint: "Contract, receipt, or internal record number",
    reasonHint: "Required when the decision is rejected",
  },
};

function formatTimestamp(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function EvidenceSummary({
  evidence,
  locale,
  copy,
}: Readonly<{
  evidence: CanonicalLeadGateEvidenceSnapshot | null;
  locale: Locale;
  copy: Copy;
}>) {
  if (!evidence)
    return <p className="text-sm text-fg-3">{copy.missing}</p>;
  return (
    <dl className="grid gap-2 text-sm text-fg-2 sm:grid-cols-2">
      <div>
        <dt className="text-2xs font-semibold uppercase tracking-wide text-fg-3">
          {copy.decision}
        </dt>
        <dd className="mt-1 font-medium text-fg">
          {evidence.decision === "confirmed" ? copy.confirmed : copy.rejected}
        </dd>
      </div>
      <div>
        <dt className="text-2xs font-semibold uppercase tracking-wide text-fg-3">
          {copy.occurredAt}
        </dt>
        <dd className="mt-1">{formatTimestamp(evidence.occurredAt, locale)}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-2xs font-semibold uppercase tracking-wide text-fg-3">
          {copy.reference}
        </dt>
        <dd className="mt-1 break-words font-mono text-xs">
          {evidence.evidenceReference}
        </dd>
      </div>
      {evidence.amountMinor !== null && evidence.currency ? (
        <div>
          <dt className="text-2xs font-semibold uppercase tracking-wide text-fg-3">
            {copy.payment}
          </dt>
          <dd className="mt-1 font-mono">
            {evidence.amountMinor} {evidence.currency}
          </dd>
        </div>
      ) : null}
      {evidence.reason ? (
        <div className="sm:col-span-2">
          <dt className="text-2xs font-semibold uppercase tracking-wide text-fg-3">
            {copy.reason}
          </dt>
          <dd className="mt-1 whitespace-pre-wrap">{evidence.reason}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function actionMessage(state: CanonicalSalesGateActionState, copy: Copy) {
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

function EvidenceForm({
  evidenceType,
  leadId,
  occurredAt,
  requestId,
  locale,
}: Readonly<{
  evidenceType: "contract" | "first_payment";
  leadId: string;
  occurredAt: string;
  requestId: string;
  locale: Locale;
}>) {
  const copy = COPY[locale];
  const router = useRouter();
  const initialState: CanonicalSalesGateActionState = {
    status: "idle",
    requestId,
    gate: null,
    changedAt: null,
  };
  const [state, action, pending] = useActionState(
    recordCanonicalSalesGateEvidenceAction,
    initialState,
  );
  const message = actionMessage(state, copy);

  useEffect(() => {
    if (state.status === "saved") router.refresh();
  }, [router, state.status, state.changedAt]);

  return (
    <form
      action={action}
      className="space-y-3"
      data-testid={`canonical-${evidenceType}-evidence-form`}
    >
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="evidence_type" value={evidenceType} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={labelCls}>{copy.decision}</span>
          <select name="decision" defaultValue="confirmed" className={inputCls}>
            <option value="confirmed">{copy.confirmed}</option>
            <option value="rejected">{copy.rejected}</option>
          </select>
        </label>
        <label>
          <span className={labelCls}>{copy.occurredAt}</span>
          <input
            name="occurred_at"
            defaultValue={occurredAt}
            required
            maxLength={40}
            className={inputCls}
          />
        </label>
      </div>

      <label>
        <span className={labelCls}>{copy.reference}</span>
        <input
          name="evidence_reference"
          required
          maxLength={255}
          placeholder={copy.evidenceHint}
          className={inputCls}
        />
      </label>

      {evidenceType === "first_payment" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className={labelCls}>{copy.amountMinor}</span>
            <input
              name="amount_minor"
              type="number"
              min={1}
              step={1}
              required
              className={inputCls}
            />
          </label>
          <label>
            <span className={labelCls}>{copy.currency}</span>
            <input
              name="currency"
              defaultValue="KGS"
              pattern="[A-Za-z]{3}"
              maxLength={3}
              required
              className={inputCls}
            />
          </label>
        </div>
      ) : (
        <>
          <input type="hidden" name="amount_minor" value="" />
          <input type="hidden" name="currency" value="" />
        </>
      )}

      <label>
        <span className={labelCls}>{copy.reason}</span>
        <textarea
          name="reason"
          maxLength={2000}
          rows={2}
          placeholder={copy.reasonHint}
          className={cn(inputCls, "h-auto resize-y py-2")}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={btnCls}>
          {pending ? copy.saving : copy.save}
        </button>
        {message ? (
          <p
            className={cn(
              "text-xs",
              state.status === "saved" ? "text-ok" : "text-danger",
            )}
            role="status"
          >
            {message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function CanonicalSalesGateCard({
  gate,
  locale,
  occurredAt,
  requestIds,
}: Readonly<{
  gate: CanonicalLeadGateSnapshot;
  locale: Locale;
  occurredAt: string;
  requestIds: Readonly<{ contract: string; firstPayment: string }>;
}>) {
  const copy = COPY[locale];
  const tone =
    gate.state === "satisfied"
      ? "bg-ok-weak text-ok"
      : gate.state === "overridden"
        ? "bg-warn-weak text-warn"
        : "bg-danger-weak text-danger";

  return (
    <Card title={copy.title} bodyClassName="space-y-5" className="shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[60ch] text-sm leading-5 text-fg-3">
          {copy.description}
        </p>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-semibold",
            tone,
          )}
        >
          {copy.state[gate.state]}
        </span>
      </div>

      <div className="grid gap-5 border-y border-border py-4 lg:grid-cols-2">
        <section
          className="space-y-3"
          data-testid="canonical-contract-evidence"
        >
          <h3 className="text-sm font-semibold text-fg">{copy.contract}</h3>
          <EvidenceSummary
            evidence={gate.contractEvidence}
            locale={locale}
            copy={copy}
          />
          {!gate.handoff ? (
            <EvidenceForm
              evidenceType="contract"
              leadId={gate.leadId}
              occurredAt={occurredAt}
              requestId={requestIds.contract}
              locale={locale}
            />
          ) : null}
        </section>

        <section
          className="space-y-3 lg:border-l lg:border-border lg:pl-5"
          data-testid="canonical-first-payment-evidence"
        >
          <h3 className="text-sm font-semibold text-fg">{copy.payment}</h3>
          <EvidenceSummary
            evidence={gate.firstPaymentEvidence}
            locale={locale}
            copy={copy}
          />
          {!gate.handoff ? (
            <EvidenceForm
              evidenceType="first_payment"
              leadId={gate.leadId}
              occurredAt={occurredAt}
              requestId={requestIds.firstPayment}
              locale={locale}
            />
          ) : null}
        </section>
      </div>
    </Card>
  );
}
