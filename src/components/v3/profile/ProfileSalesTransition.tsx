"use client";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview } from "@/lib/platform-access";


import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { btnCls, btnGhostCls, Card, cn, inputCls, fieldLabelCls } from "@/components/ui";
import { Icon } from "@/components/icons";
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
import { handoffFootnote, type HandoffStripItem, type HandoffStripView, type StripText } from "./handoff-strip-view";
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
      className="mt-3 space-y-3"
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
        {/* Спокойная кнопка: подтверждение — доказательство передачи, а не
            главное действие страницы (Э2). */}
        <button type="submit" disabled={locked} className={cn(btnGhostCls, "min-h-11")}>
          {pending
            ? "Сохраняем…"
            : contract
              ? "Подтвердить договор"
              : payment
                ? "Подтвердить платёж"
                : "Разрешить исключение"}
        </button>
      </div>
      <ActionResult status={state.status} />
    </form>
  );
}

/**
 * Текст полосы: слова — Golos, даты — JetBrains Mono (один формат даты,
 * DESIGN.md). Слово перед датой не отрывается от неё переносом («принято 19.09»).
 */
function StripLine({ text }: { text: StripText }) {
  return <>{text.map((part, index) => typeof part === "string"
    ? typeof text[index + 1] === "object" && part.endsWith(" ") ? `${part.slice(0, -1)}\u00a0` : part
    : <span key={index} className="whitespace-nowrap font-mono tabular-nums">{part.date}</span>)}</>;
}

/**
 * Одно доказательство полосы: есть (галочка и дата), нет (прочерк), есть с
 * оговоркой словами или лежит в отчёте, который роль не читает (только слова).
 */
function StripValue({ item }: { item: HandoffStripItem }) {
  // Знак и слова — одна строка текста: длинные слова переносятся за галочкой,
  // а не уводят её на отдельную строку. Дата — отдельно и не рвётся.
  const gap = item.text ? "me-1.5" : null;
  const mark = item.state === "done" ? (
    <>
      <Icon name="check" size={16} className={cn("inline-block align-[-3px] text-ok", gap)} />
      <span className="sr-only">есть </span>
    </>
  ) : item.state === "missing" ? (
    <>
      <span aria-hidden="true" className={cn("text-fg-3", gap)}>—</span>
      <span className="sr-only">нет </span>
    </>
  ) : null;
  const tone = item.state === "attention" ? "text-warn" : item.state === "done" ? "text-fg" : "text-fg-2";
  return (
    <>
      {mark || item.text ? <span className={cn("min-w-0 break-words text-end @2xl:text-start", tone)}>{mark}{item.text}</span> : null}
      {item.date ? <span className="whitespace-nowrap font-mono tabular-nums text-fg-2">{item.date}</span> : null}
    </>
  );
}

/**
 * «Передача» (Э2 «Честные числа», решения владельца 26.09.2026) — вместо
 * красного «Договор и оплата: ожидает условий», который ничего не запрещал.
 * Условие передачи — доказательство, не запрет: до передачи полоса
 * нейтральна; после — строка «Передано ДД.ММ · куратор · принято ДД.ММ», а
 * нехватка доказательства названа словами в тоне предупреждения. Формы
 * подтверждения договора и платежа прежние и спокойные: сплошной красный
 * остаётся главному действию страницы.
 */
function HandoffCard({
  actor,
  gate,
  view,
  requestIds,
}: {
  actor: ActivePlatformActor;
  gate: PlatformLeadAdmissionsGateSnapshot;
  /** null — полоса не прочитана: ни этапа, ни галочек наугад. */
  view: HandoffStripView | null;
  requestIds: ProfileSalesRequestIds;
}) {
  const router = useRouter();
  const preview = isStaffPreview(actor);
  const contractForm = !preview && !gate.contractConfirmed && gate.canConfirmContract;
  const paymentForm = !preview && gate.contractConfirmed && !gate.firstPaymentReceivedDate && gate.canConfirmFirstPayment;
  const canOverride = !preview && gate.canOverrideGate && !gate.normalHandoffAllowed;
  const footnote = handoffFootnote(gate, { now: new Date() });
  // Линия над полосой — только когда над ней есть строка передачи или
  // предупреждение; иначе она удваивает линию под заголовком карточки.
  const ruleAbove = view !== null && (view.summary !== null || view.warnings.length > 0);

  return (
    <Card eyebrow title="Передача">
      <div className="space-y-3 p-4" data-testid="v3-sales-gate">
        {view === null ? (
          <div role="alert" className="t-body-compact text-fg-2">
            <p>Не удалось загрузить передачу.</p>
            <button type="button" className={cn(btnGhostCls, "mt-2 min-h-11")} onClick={() => router.refresh()}>
              Повторить
            </button>
          </div>
        ) : (
          <>
            {view.summary ? (
              <p className="t-body-compact text-fg" data-testid="v3-handoff-summary"><StripLine text={view.summary} /></p>
            ) : null}
            {view.warnings.length > 0 ? (
              <ul className="space-y-1" data-testid="v3-handoff-warnings">
                {view.warnings.map((warning, index) => (
                  <li key={index} className="flex flex-wrap items-start gap-x-1.5 gap-y-1 t-body-compact text-warn">
                    <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                    <span className="min-w-0 flex-[1_1_16rem]"><StripLine text={warning.text} /></span>
                    {warning.href ? (
                      // 44 px цели без лишней высоты строки: поле касания выходит за строку.
                      <a href={warning.href} className="-my-3 inline-flex min-h-11 items-center text-fg-2 underline underline-offset-4 hover:text-fg">
                        Открыть запись
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <dl
              className={cn(
                "grid divide-y divide-border @2xl:grid-cols-5 @2xl:divide-x @2xl:divide-y-0",
                ruleAbove && "border-t border-border",
                footnote && "border-b border-border",
              )}
              data-testid="v3-handoff-strip"
            >
              {view.items.map((item) => (
                <div
                  key={item.key}
                  data-handoff-item={item.key}
                  data-state={item.state}
                  className="flex min-h-11 min-w-0 items-center justify-between gap-x-4 gap-y-1 py-2 @2xl:flex-col @2xl:items-start @2xl:justify-start @2xl:px-3 @2xl:py-2.5 @2xl:first:ps-0"
                >
                  <dt className="shrink-0 t-caption text-fg-3">{item.label}</dt>
                  <dd className="flex min-w-0 flex-wrap items-center justify-end gap-x-1.5 t-body-compact @2xl:justify-start">
                    <StripValue item={item} />
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
        {footnote ? (
          <p className="t-meta break-words text-fg-3" data-testid="v3-handoff-footnote"><StripLine text={footnote} /></p>
        ) : null}
      </div>

      {contractForm ? (
        <div className="border-t border-border p-4">
          <h4 className="t-item text-fg">Подтвердить договор</h4>
          <GateActionForm key={`contract:${gate.gateVersion}`} actionName="confirm_contract" gate={gate} requestId={requestIds.contract} />
        </div>
      ) : null}
      {paymentForm ? (
        <div className="border-t border-border p-4">
          <h4 className="t-item text-fg">Подтвердить первый платёж</h4>
          <GateActionForm key={`payment:${gate.gateVersion}`} actionName="confirm_first_payment" gate={gate} requestId={requestIds.firstPayment} />
        </div>
      ) : null}
      {canOverride ? (
        // Редкий инструмент Admin — свёрнут: он не должен занимать карточку каждого лида.
        <details className="group border-t border-border px-4 py-1">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-nav t-item text-fg [&::-webkit-details-marker]:hidden">
            <Icon name="chevron-right" size={16} className="shrink-0 text-fg-3 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
            Исключение Admin
          </summary>
          <div className="pb-3">
            <GateActionForm key={`override:${gate.gateVersion}`} actionName="override_gate" gate={gate} requestId={requestIds.override} />
          </div>
        </details>
      ) : null}
    </Card>
  );
}

/**
 * Unified workflow S2 (plan §6, §13): the card-side «Передача в Admissions»
 * bypass is retired here. The only curator handoff trigger left is a saved
 * Sales report (platform.create_sales_report_handoff); the lead card shows
 * that outcome through the «Передача» strip (Э2) and LeadSaleConditions'
 * linked-register block instead of a second, form-driven path to the same
 * result.
 */
export function ProfileSalesTransition({
  actor,
  gate,
  view,
  requestIds,
}: {
  actor: ActivePlatformActor;
  gate: PlatformLeadAdmissionsGateSnapshot;
  view: HandoffStripView | null;
  requestIds: ProfileSalesRequestIds;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="v3-sales-transition">
      <HandoffCard actor={actor} gate={gate} view={view} requestIds={requestIds} />
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
