"use client";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview } from "@/lib/platform-access";


import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { btnCls, btnGhostCls, Card, cn, inputCls, fieldLabelCls } from "@/components/ui";
import { Pill, type PillTone } from "@/components/v3/Pill";
import {
  mutatePlatformLeadAdmissionsGateAction,
  type PlatformLeadAdmissionsGateActionState,
  type PlatformStudentHandoffActionStatus,
} from "@/lib/platform-student-handoff-actions";
import type {
  PlatformLeadAdmissionsGateAction,
  PlatformLeadAdmissionsGateSnapshot,
} from "@/lib/platform-student-handoff";

import type { HandoffAcknowledgement, HandoffDecision, SalesHandoffAcknowledgement } from "@/lib/platform-handoff-acknowledgement";
import { respondToHandoffAction, type HandoffResponseActionState } from "@/lib/platform-handoff-acknowledgement-actions";
import { handoffAcknowledgementLabel } from "@/lib/v3/wording";
import type {
  ProfileSalesRequestIds,
} from "./types";

const ACTION_MESSAGES: Record<
  Exclude<PlatformStudentHandoffActionStatus, "idle">,
  string
> = {
  saved: "Сохранено.",
  invalid: "Проверьте обязательные поля и формат значений.",
  forbidden: "У вашей роли нет права на это действие.",
  gate_blocked: "Текущее состояние проверки не разрешает это действие.",
  stale: "Данные уже изменились. Обновляем актуальное состояние.",
  request_conflict: "Этот запрос уже использован с другими данными. Повторите действие.",
  unavailable: "Данные сейчас недоступны. Ничего не сохранено.",
};

function actionEdge(status: PlatformStudentHandoffActionStatus): string {
  if (status === "saved") return "v3-edge-ok";
  if (status === "stale" || status === "request_conflict") return "v3-edge-warn";
  return "v3-edge-danger";
}

function ActionResult({ status }: { status: PlatformStudentHandoffActionStatus }) {
  if (status === "idle") return null;
  return (
    <p
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "border-s-2 ps-3 text-sm leading-5 text-fg-2",
        actionEdge(status),
      )}
      data-status={status}
    >
      {ACTION_MESSAGES[status]}
    </p>
  );
}

function Version({ value }: { value: string }) {
  return (
    <span className="t-meta text-fg-3">
      Версия проверки: <span className="font-mono text-fg-2">{value}</span>
    </span>
  );
}

function gateInitialState(
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
  requestId,
}: {
  actionName: PlatformLeadAdmissionsGateAction;
  gate: PlatformLeadAdmissionsGateSnapshot;
  requestId: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    mutatePlatformLeadAdmissionsGateAction,
    gateInitialState(requestId, gate),
  );
  const gateVersion = state.gateVersion ?? gate.gateVersion;
  const locked = pending || state.status === "saved" || state.status === "stale";

  useEffect(() => {
    if (state.status === "saved" || state.status === "stale") router.refresh();
  }, [router, state.changedAt, state.status]);

  const contract = actionName === "confirm_contract";
  const payment = actionName === "confirm_first_payment";
  const override = actionName === "override_gate";

  return (
    <form
      action={action}
      className="space-y-3 border-t border-border pt-3"
      data-testid={`v3-gate-${contract ? "contract" : payment ? "payment" : "override"}-form`}
    >
      <input type="hidden" name="lead_id" value={gate.leadId} />
      <input type="hidden" name="expected_gate_version" value={gateVersion} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <input type="hidden" name="action" value={actionName} />

      {contract ? (
        <div className="grid gap-3 @4xl:grid-cols-[minmax(0,1fr)_7rem_10rem]">
          <label>
            <span className={fieldLabelCls}>Ожидаемая сумма</span>
            <input
              name="amount"
              inputMode="decimal"
              pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?"
              required
              disabled={locked}
              className={inputCls}
              autoComplete="off"
            />
          </label>
          <label>
            <span className={fieldLabelCls}>Валюта</span>
            <input
              name="currency"
              pattern="[A-Za-z]{3}"
              minLength={3}
              maxLength={3}
              required
              disabled={locked}
              placeholder="KGS"
              className={cn(inputCls, "uppercase")}
              autoComplete="off"
            />
          </label>
          <label>
            <span className={fieldLabelCls}>Ожидаемая дата</span>
            <input
              type="date"
              name="due_date"
              required
              disabled={locked}
              className={cn(inputCls, "font-mono text-sm")}
            />
          </label>
        </div>
      ) : (
        <>
          <input type="hidden" name="amount" value="" />
          <input type="hidden" name="currency" value="" />
          <input type="hidden" name="due_date" value="" />
        </>
      )}

      {payment ? (
        <label className="block max-w-60">
          <span className={fieldLabelCls}>Дата получения</span>
          <input
            type="date"
            name="received_date"
            required
            disabled={locked}
            className={cn(inputCls, "font-mono text-sm")}
          />
        </label>
      ) : (
        <input type="hidden" name="received_date" value="" />
      )}

      {override ? (
        <label>
          <span className={fieldLabelCls}>Причина исключения</span>
          <textarea
            name="reason"
            required
            maxLength={1000}
            rows={3}
            disabled={locked}
            className={cn(inputCls, "h-auto resize-y py-2")}
          />
        </label>
      ) : (
        <input type="hidden" name="reason" value="" />
      )}

      {override ? (
        <input type="hidden" name="evidence_reference" value="" />
      ) : (
        <label>
          <span className={fieldLabelCls}>Доказательство</span>
          <input
            name="evidence_reference"
            required
            maxLength={2048}
            disabled={locked}
            placeholder="Ссылка или номер документа"
            className={inputCls}
            autoComplete="off"
          />
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={locked} className={btnCls}>
          {pending
            ? "Сохраняем…"
            : contract
              ? "Подтвердить договор"
              : payment
                ? "Подтвердить платёж"
                : "Разрешить исключение"}
        </button>
        <Version value={gateVersion} />
      </div>
      <ActionResult status={state.status} />
    </form>
  );
}

function Evidence({ value }: { value: string | null }) {
  return value ? (
    <p className="t-meta mt-1 break-all text-fg-3">{value}</p>
  ) : null;
}

function GateCard({
  actor,
  gate,
  requestIds,
}: {
  actor: ActivePlatformActor;
  gate: PlatformLeadAdmissionsGateSnapshot;
  requestIds: ProfileSalesRequestIds;
}) {
  const gateStatus: Readonly<{ label: string; tone: PillTone }> =
    gate.normalHandoffAllowed
      ? { label: "готово к передаче", tone: "ok" }
      : gate.exceptionalHandoffAllowed
        ? { label: "исключение разрешено", tone: "warn" }
        : { label: "ожидает условий", tone: "danger" };
  const canOverride =
    !isStaffPreview(actor) && gate.canOverrideGate && !gate.normalHandoffAllowed;

  return (
    <Card
      eyebrow
      title="Договор и оплата"
      aside={<Pill tone={gateStatus.tone}>{gateStatus.label}</Pill>}
    >
      <div className="grid gap-0 @5xl:grid-cols-2" data-testid="v3-sales-gate">
        <section className="space-y-3 p-4 @5xl:border-e @5xl:border-border">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="t-item text-fg">Договор</h4>
            <Pill tone={gate.contractConfirmed ? "ok" : "neutral"}>
              {gate.contractConfirmed ? "подтверждён" : "не подтверждён"}
            </Pill>
          </div>
          {gate.contractConfirmed ? (
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm">
              <dt className="text-fg-3">Первый платёж</dt>
              <dd className="text-right text-fg">
                {gate.firstPaymentAmount} {gate.firstPaymentCurrency}
              </dd>
              <dt className="text-fg-3">Ожидается</dt>
              <dd className="font-mono text-xs text-fg">{gate.firstPaymentDueDate}</dd>
            </dl>
          ) : null}
          <Evidence value={gate.contractEvidenceReference} />
          {!isStaffPreview(actor) && !gate.contractConfirmed && gate.canConfirmContract ? (
            <GateActionForm
              key={`contract:${gate.gateVersion}`}
              actionName="confirm_contract"
              gate={gate}
              requestId={requestIds.contract}
            />
          ) : null}
        </section>

        <section className="space-y-3 border-t border-border p-4 @5xl:border-t-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="t-item text-fg">Первый платёж</h4>
            <Pill tone={gate.firstPaymentReceivedDate ? "ok" : "neutral"}>
              {gate.firstPaymentReceivedDate ? "получен" : "не получен"}
            </Pill>
          </div>
          {gate.firstPaymentReceivedDate ? (
            <p className="font-mono text-xs text-fg-2">
              {gate.firstPaymentReceivedDate}
            </p>
          ) : null}
          <Evidence value={gate.firstPaymentEvidenceReference} />
          {gate.contractConfirmed &&
          !gate.firstPaymentReceivedDate &&
          !isStaffPreview(actor) && gate.canConfirmFirstPayment ? (
            <GateActionForm
              key={`payment:${gate.gateVersion}`}
              actionName="confirm_first_payment"
              gate={gate}
              requestId={requestIds.firstPayment}
            />
          ) : null}
        </section>
      </div>

      {canOverride ? (
        <div className="border-t border-border p-4">
          <h4 className="t-item text-fg">Исключение Admin</h4>
          <GateActionForm
            key={`override:${gate.gateVersion}`}
            actionName="override_gate"
            gate={gate}
            requestId={requestIds.override}
          />
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Unified workflow S2 (plan §6, §13): the card-side «Передача в Admissions»
 * bypass is retired here. The only curator handoff trigger left is a saved
 * Sales report (platform.create_sales_report_handoff); the lead card shows
 * that outcome through LeadSaleConditions' linked-register block instead of
 * a second, form-driven path to the same result.
 */
export function ProfileSalesTransition({
  actor,
  gate,
  requestIds,
}: {
  actor: ActivePlatformActor;
  gate: PlatformLeadAdmissionsGateSnapshot;
  requestIds: ProfileSalesRequestIds;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="v3-sales-transition">
      <GateCard actor={actor} gate={gate} requestIds={requestIds} />
    </div>
  );
}

/**
 * The current owner's response lives alongside the original, completed handoff.
 * Also the «Приём дела» fact on the case «Обзор»: whoever cannot answer still
 * sees the decision, the curator's text and the agreed contact date.
 */
export function HandoffResponseSummary({ current }: { current: SalesHandoffAcknowledgement["current"] }) {
  const dateText = current?.agreedContactDate
    ? current.agreedContactDate.split("-").reverse().join(".") : null;
  return <>
    <p className="text-sm font-medium text-fg">
      {current ? handoffAcknowledgementLabel(current.decision) : "Ожидает ответа куратора"}
    </p>
    {current?.clarification ? <p className="whitespace-pre-wrap break-words text-sm text-fg-2">{current.clarification}</p> : null}
    {dateText ? <p className="text-sm text-fg-2">Согласованный контакт: {dateText}</p> : null}
  </>;
}

export function ProfileSalesHandoffAcknowledgement({ snapshot }: { snapshot: SalesHandoffAcknowledgement }) {
  return <Card eyebrow title="Приём дела" id="handoff-acknowledgement">
    <div className="flex flex-col gap-3 p-4" data-testid="v3-sales-handoff-acknowledgement">
      <HandoffResponseSummary current={snapshot.current} />
    </div>
  </Card>;
}

export function ProfileHandoffAcknowledgement({ snapshot, onSaved }: {
  snapshot: HandoffAcknowledgement & Readonly<{ requestId: string }>;
  /**
   * Ответ записан сервером. Панель очереди убирает блок после «принято»
   * (перечитанный снимок больше не ждёт ответа) и называет итог сама.
   */
  onSaved?: (decision: HandoffDecision) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<HandoffDecision>("accepted");
  const [clarification, setClarification] = useState("");
  const [contactDate, setContactDate] = useState(snapshot.current?.agreedContactDate ?? "");
  const [state, action, pending] = useActionState<HandoffResponseActionState, FormData>(
    async (previous, formData) => {
      const next = await respondToHandoffAction(previous, formData);
      if (next.status === "saved") onSaved?.(formData.get("decision") as HandoffDecision);
      return next;
    },
    { status: "idle", requestId: snapshot.requestId, acknowledgementId: null, submittedContext: null },
  );
  const saved = state.status === "saved";
  const currentContext = `${snapshot.assignmentEventId ?? ""}:${snapshot.current?.acknowledgementId ?? ""}`;
  const needsRefresh = state.status === "stale" && state.submittedContext === currentContext;
  const message = state.status === "invalid" ? "Проверьте уточнение и дату."
    : state.status === "forbidden" ? "Ответить может только текущий назначенный куратор."
    : needsRefresh ? "Назначение или ответ изменились. Обновите карточку перед повтором."
    : state.status === "stale" ? "Карточка обновлена. Проверьте введённые данные и сохраните снова."
    : state.status === "request_conflict" ? "Этот запрос уже использован. Проверьте карточку перед повтором."
    : state.status === "unavailable" ? "Не удалось подтвердить сохранение. Введённые данные оставлены."
    : saved ? "Ответ сохранён." : null;
  const showResult = pending || message !== null;
  const current = snapshot.current;
  const declining = decision === "declined";
  const unchanged = current?.decision === decision
    && current.clarification === (decision === "accepted" ? null : clarification.trim())
    && (declining || current.agreedContactDate === (contactDate || null));
  return (
    <Card eyebrow title="Приём дела" id="handoff-acknowledgement">
      <div className="flex flex-col gap-3 p-4" data-testid="v3-handoff-acknowledgement">
        <HandoffResponseSummary current={current} />
        {snapshot.canRespond && !open ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={cn(btnCls, "min-h-11")} onClick={() => { setDecision("accepted"); setOpen(true); }}>
              Принять дело
            </button>
            <button type="button" className={cn(btnGhostCls, "min-h-11")} onClick={() => { setDecision("clarification_requested"); setOpen(true); }}>
              Нужно уточнить
            </button>
            <button type="button" className={cn(btnGhostCls, "min-h-11")} onClick={() => { setDecision("declined"); setOpen(true); }}>
              Отклонить
            </button>
          </div>
        ) : null}
        {snapshot.canRespond && open && snapshot.assignmentEventId ? (
          <form action={action} className="flex flex-col gap-3" aria-busy={pending}>
            <input type="hidden" name="student_case_id" value={snapshot.studentCaseId} />
            <input type="hidden" name="assignment_event_id" value={snapshot.assignmentEventId} />
            <input type="hidden" name="expected_acknowledgement_id" value={current?.acknowledgementId ?? ""} />
            <input type="hidden" name="request_id" value={state.requestId} />
            <input type="hidden" name="decision" value={decision} />
            {declining ? (
              <p className="text-sm text-fg-2">
                Отклоняется назначение, а не студент: продажа и данные сохранятся.
              </p>
            ) : null}
            {decision === "clarification_requested" ? (
              <label className={fieldLabelCls}>
                Что нужно уточнить у Sales
                <textarea name="clarification" required maxLength={2000} rows={3}
                  className={cn(inputCls, "mt-1 min-h-24 resize-y")} value={clarification}
                  onChange={(event) => setClarification(event.target.value)} disabled={pending}
                  aria-invalid={state.status === "invalid" || undefined} />
              </label>
            ) : declining ? (
              <label className={fieldLabelCls}>
                Причина отклонения
                <textarea name="clarification" required maxLength={1000} rows={3}
                  className={cn(inputCls, "mt-1 min-h-24 resize-y")} value={clarification}
                  onChange={(event) => setClarification(event.target.value)} disabled={pending}
                  aria-invalid={state.status === "invalid" || undefined} />
              </label>
            ) : <input type="hidden" name="clarification" value="" />}
            {declining ? (
              <input type="hidden" name="agreed_contact_date" value="" />
            ) : (
              <label className={fieldLabelCls}>
                Согласованная дата контакта · необязательно
                <input type="date" name="agreed_contact_date" className={cn(inputCls, "mt-1 min-h-11")}
                  min="0001-01-01" max="9999-12-31" value={contactDate}
                  onChange={(event) => setContactDate(event.target.value)} disabled={pending} />
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={pending || needsRefresh || unchanged} className={cn(btnCls, "min-h-11")}>
                {pending ? "Сохраняем…" : unchanged ? "Уже сохранено"
                  : decision === "accepted" ? "Подтвердить приём"
                  : declining ? "Отклонить назначение" : "Сохранить уточнение"}
              </button>
              <button type="button" disabled={pending} className={cn(btnGhostCls, "min-h-11")}
                onClick={() => setOpen(false)}>Отмена</button>
            </div>
          </form>
        ) : null}
        {showResult ? <p role={saved || pending ? "status" : "alert"} className="text-sm text-fg-2">
          {pending ? "Сохраняем ответ…" : message}
        </p> : null}
        {state.status === "stale" || state.status === "request_conflict" ? (
          <button type="button" className={cn(btnGhostCls, "min-h-11 self-start")} onClick={() => router.refresh()}>
            Обновить карточку
          </button>
        ) : null}
      </div>
    </Card>
  );
}
