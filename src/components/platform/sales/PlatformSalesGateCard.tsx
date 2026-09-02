"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { Card, btnCls, cn, inputCls, labelCls } from "@/components/ui";
import type { FixedRole } from "@/lib/fixed-role-policy";
import type { Locale } from "@/lib/i18n";
import {
  mutatePlatformLeadAdmissionsGateAction,
  type PlatformLeadAdmissionsGateActionState,
} from "@/lib/platform-student-handoff-actions";
import type { PlatformLeadAdmissionsGateSnapshot } from "@/lib/platform-student-handoff";

type GateAction = "confirm_contract" | "confirm_first_payment" | "override_gate";

const COPY = {
  ru: {
    title: "Договор и первый платёж",
    description:
      "Supabase разрешит передачу только после подтверждения договора, ожидаемого первого платежа и его фактического получения.",
    state: {
      blocked: "Передача заблокирована",
      satisfied: "Условия выполнены",
      overridden: "Разрешено исключением Admin",
    },
    version: "Версия проверки",
    contract: "Договор и ожидание платежа",
    payment: "Получение первого платежа",
    confirmed: "Подтверждено",
    missing: "Ещё не подтверждено",
    evidence: "Ссылка или номер доказательства",
    amount: "Ожидаемая сумма",
    currency: "Валюта",
    dueDate: "Ожидаемая дата платежа",
    receivedDate: "Дата получения платежа",
    contractSave: "Подтвердить договор",
    paymentSave: "Подтвердить платёж",
    override: "Исключение Admin",
    overrideReason: "Обязательная причина исключения",
    overrideSave: "Разрешить передачу как исключение",
    saving: "Сохраняем…",
    saved: "Подтверждение записано в Supabase.",
    invalid: "Проверьте обязательные поля и формат значений.",
    forbidden: "Текущая роль не имеет права выполнить это действие.",
    gateBlocked: "Действие отклонено текущим состоянием проверки.",
    stale: "Состояние изменилось. Страница обновится.",
    requestConflict: "Этот идентификатор запроса уже использован с другими данными.",
    unavailable: "Supabase недоступен. Ничего не сохранено.",
  },
  ky: {
    title: "Келишим жана биринчи төлөм",
    description:
      "Supabase келишим, күтүлгөн биринчи төлөм жана анын чыныгы алынышы ырасталганда гана өткөрүүгө уруксат берет.",
    state: {
      blocked: "Өткөрүү бөгөттөлгөн",
      satisfied: "Шарттар аткарылды",
      overridden: "Admin өзгөчө уруксат берди",
    },
    version: "Текшерүү версиясы",
    contract: "Келишим жана төлөм күтүүсү",
    payment: "Биринчи төлөмдүн алынышы",
    confirmed: "Ырасталды",
    missing: "Азырынча ырастала элек",
    evidence: "Далилдин шилтемеси же номери",
    amount: "Күтүлгөн сумма",
    currency: "Валюта",
    dueDate: "Төлөмдүн күтүлгөн күнү",
    receivedDate: "Төлөм алынган күн",
    contractSave: "Келишимди ырастоо",
    paymentSave: "Төлөмдү ырастоо",
    override: "Admin өзгөчө чечими",
    overrideReason: "Өзгөчө чечимдин милдеттүү себеби",
    overrideSave: "Өзгөчө өткөрүүгө уруксат берүү",
    saving: "Сакталууда…",
    saved: "Ырастоо Supabase базасына жазылды.",
    invalid: "Милдеттүү талааларды жана маанилердин форматын текшериңиз.",
    forbidden: "Учурдагы роль бул аракетти аткара албайт.",
    gateBlocked: "Аракет текшерүүнүн учурдагы абалы менен четке кагылды.",
    stale: "Абалы өзгөрдү. Барак жаңыланат.",
    requestConflict: "Бул сурам идентификатору башка маалымат менен колдонулган.",
    unavailable: "Supabase жеткиликсиз. Эч нерсе сакталган жок.",
  },
  en: {
    title: "Contract and first payment",
    description:
      "Supabase allows handoff only after the contract, expected first payment, and actual receipt are confirmed.",
    state: {
      blocked: "Handoff blocked",
      satisfied: "Conditions satisfied",
      overridden: "Allowed by Admin exception",
    },
    version: "Gate version",
    contract: "Contract and payment expectation",
    payment: "First-payment receipt",
    confirmed: "Confirmed",
    missing: "Not confirmed yet",
    evidence: "Evidence reference or URL",
    amount: "Expected amount",
    currency: "Currency",
    dueDate: "Expected payment date",
    receivedDate: "Payment received date",
    contractSave: "Confirm contract",
    paymentSave: "Confirm payment",
    override: "Admin exception",
    overrideReason: "Required exception reason",
    overrideSave: "Allow exceptional handoff",
    saving: "Saving…",
    saved: "Confirmation saved in Supabase.",
    invalid: "Check the required fields and value formats.",
    forbidden: "The current role cannot perform this action.",
    gateBlocked: "The current gate state rejected this action.",
    stale: "The state changed. The page will refresh.",
    requestConflict: "This request ID was already used with different data.",
    unavailable: "Supabase is unavailable. Nothing was saved.",
  },
} as const;

type Copy = (typeof COPY)[Locale];

function actionMessage(state: PlatformLeadAdmissionsGateActionState, copy: Copy) {
  if (state.status === "idle") return null;
  return {
    saved: copy.saved,
    invalid: copy.invalid,
    forbidden: copy.forbidden,
    gate_blocked: copy.gateBlocked,
    stale: copy.stale,
    request_conflict: copy.requestConflict,
    unavailable: copy.unavailable,
  }[state.status];
}

function initialState(
  requestId: string,
  gate: PlatformLeadAdmissionsGateSnapshot,
): PlatformLeadAdmissionsGateActionState {
  return {
    status: "idle",
    requestId,
    leadId: gate.leadId,
    gateVersion: gate.gateVersion,
    changedAt: null,
  };
}

function GateActionForm({
  actionName,
  gate,
  locale,
  requestId,
}: Readonly<{
  actionName: GateAction;
  gate: PlatformLeadAdmissionsGateSnapshot;
  locale: Locale;
  requestId: string;
}>) {
  const copy = COPY[locale];
  const router = useRouter();
  const [state, action, pending] = useActionState(
    mutatePlatformLeadAdmissionsGateAction,
    initialState(requestId, gate),
  );
  const message = actionMessage(state, copy);

  useEffect(() => {
    if (state.status === "saved" || state.status === "stale") router.refresh();
  }, [router, state.changedAt, state.status]);

  const isContract = actionName === "confirm_contract";
  const isPayment = actionName === "confirm_first_payment";
  const isOverride = actionName === "override_gate";

  return (
    <form
      action={action}
      className="space-y-3"
      data-testid={
        isContract
          ? "platform-gate-contract-form"
          : isPayment
            ? "platform-gate-payment-form"
            : "platform-gate-override-form"
      }
    >
      <input type="hidden" name="lead_id" value={gate.leadId} />
      <input
        type="hidden"
        name="expected_gate_version"
        value={gate.gateVersion}
      />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="action" value={actionName} />

      {isContract ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <label>
              <span className={labelCls}>{copy.amount}</span>
              <input
                name="amount"
                type="number"
                min="0.01"
                max="999999999999.99"
                step="0.01"
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
            <label>
              <span className={labelCls}>{copy.dueDate}</span>
              <input
                name="due_date"
                type="date"
                required
                className={inputCls}
              />
            </label>
          </div>
          <input type="hidden" name="received_date" value="" />
        </>
      ) : null}

      {isPayment ? (
        <>
          <input type="hidden" name="amount" value="" />
          <input type="hidden" name="currency" value="" />
          <input type="hidden" name="due_date" value="" />
          <label>
            <span className={labelCls}>{copy.receivedDate}</span>
            <input
              name="received_date"
              type="date"
              required
              className={inputCls}
            />
          </label>
        </>
      ) : null}

      {!isOverride ? (
        <label>
          <span className={labelCls}>{copy.evidence}</span>
          <input
            name="evidence_reference"
            required
            maxLength={2048}
            className={inputCls}
          />
        </label>
      ) : (
        <input type="hidden" name="evidence_reference" value="" />
      )}

      {isOverride ? (
        <label>
          <span className={labelCls}>{copy.overrideReason}</span>
          <textarea
            name="reason"
            required
            maxLength={1000}
            rows={3}
            className={cn(inputCls, "h-auto resize-y py-2")}
          />
        </label>
      ) : (
        <input type="hidden" name="reason" value="" />
      )}

      {isOverride ? (
        <>
          <input type="hidden" name="amount" value="" />
          <input type="hidden" name="currency" value="" />
          <input type="hidden" name="due_date" value="" />
          <input type="hidden" name="received_date" value="" />
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={btnCls}>
          {pending
            ? copy.saving
            : isContract
              ? copy.contractSave
              : isPayment
                ? copy.paymentSave
                : copy.overrideSave}
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

function ConfirmationState({
  confirmed,
  evidenceReference,
  copy,
}: Readonly<{
  confirmed: boolean;
  evidenceReference: string | null;
  copy: Copy;
}>) {
  return (
    <div className="rounded-ctl border border-border bg-surface-2 p-3 text-sm">
      <p className={confirmed ? "font-semibold text-ok" : "text-fg-3"}>
        {confirmed ? copy.confirmed : copy.missing}
      </p>
      {evidenceReference ? (
        <p className="mt-1 break-all text-xs text-fg-3">{evidenceReference}</p>
      ) : null}
    </div>
  );
}

export function PlatformSalesGateCard({
  actorRole,
  gate,
  locale,
  requestIds,
}: Readonly<{
  actorRole: FixedRole;
  gate: PlatformLeadAdmissionsGateSnapshot;
  locale: Locale;
  requestIds: Readonly<{
    contract: string;
    firstPayment: string;
    override: string;
  }>;
}>) {
  const copy = COPY[locale];
  const canOverride =
    actorRole === "admin" &&
    gate.canOverrideGate &&
    gate.gateState === "blocked";

  return (
    <Card title={copy.title} className="shadow-none">
      <div className="space-y-5" data-testid="platform-sales-gate-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-[56ch] text-sm leading-5 text-fg-3">
            {copy.description}
          </p>
          <div className="text-right text-xs text-fg-3">
            <p className="font-semibold text-fg">{copy.state[gate.gateState]}</p>
            <p>
              {copy.version}: {gate.gateVersion}
            </p>
          </div>
        </div>

        {gate.gateState === "overridden" && gate.overrideReason ? (
          <div className="rounded-ctl border border-border bg-surface-2 p-3 text-sm">
            <p className="text-xs font-semibold text-fg-3">
              {copy.overrideReason}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-fg">
              {gate.overrideReason}
            </p>
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-fg">{copy.contract}</h3>
            <ConfirmationState
              confirmed={gate.contractConfirmed}
              evidenceReference={gate.contractEvidenceReference}
              copy={copy}
            />
            {gate.contractConfirmed ? (
              <dl className="grid grid-cols-2 gap-2 text-xs text-fg-3">
                <dt>{copy.amount}</dt>
                <dd className="text-right font-semibold text-fg">
                  {gate.firstPaymentAmount ?? "—"} {gate.firstPaymentCurrency ?? ""}
                </dd>
                <dt>{copy.dueDate}</dt>
                <dd className="text-right font-semibold text-fg">
                  {gate.firstPaymentDueDate ?? "—"}
                </dd>
              </dl>
            ) : null}
            {!gate.contractConfirmed && gate.canConfirmContract ? (
              <GateActionForm
                actionName="confirm_contract"
                gate={gate}
                locale={locale}
                requestId={requestIds.contract}
              />
            ) : null}
          </section>

          <section className="space-y-3 lg:border-l lg:border-border lg:pl-5">
            <h3 className="text-sm font-semibold text-fg">{copy.payment}</h3>
            <ConfirmationState
              confirmed={gate.firstPaymentReceivedDate !== null}
              evidenceReference={gate.firstPaymentEvidenceReference}
              copy={copy}
            />
            {gate.firstPaymentReceivedDate ? (
              <dl className="grid grid-cols-2 gap-2 text-xs text-fg-3">
                <dt>{copy.receivedDate}</dt>
                <dd className="text-right font-semibold text-fg">
                  {gate.firstPaymentReceivedDate}
                </dd>
              </dl>
            ) : null}
            {gate.contractConfirmed &&
            gate.firstPaymentReceivedDate === null &&
            gate.canConfirmFirstPayment ? (
              <GateActionForm
                actionName="confirm_first_payment"
                gate={gate}
                locale={locale}
                requestId={requestIds.firstPayment}
              />
            ) : null}
          </section>
        </div>

        {canOverride ? (
          <section className="space-y-3 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-fg">{copy.override}</h3>
            <GateActionForm
              actionName="override_gate"
              gate={gate}
              locale={locale}
              requestId={requestIds.override}
            />
          </section>
        ) : null}
      </div>
    </Card>
  );
}
