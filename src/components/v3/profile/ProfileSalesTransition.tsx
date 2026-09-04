"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { btnCls, btnGhostCls, cn, inputCls, labelCls } from "@/components/ui";
import { Pill, type PillTone } from "@/components/v3/Pill";
import {
  handoffPlatformLeadToAdmissionsAction,
  mutatePlatformLeadAdmissionsGateAction,
  type PlatformLeadAdmissionsGateActionState,
  type PlatformLeadAdmissionsHandoffActionState,
  type PlatformStudentHandoffActionStatus,
} from "@/lib/platform-student-handoff-actions";
import type {
  PlatformLeadAdmissionsGateAction,
  PlatformLeadAdmissionsGateSnapshot,
  PlatformLeadAdmissionsHandoffSnapshot,
  PlatformStudentHandoffMode,
} from "@/lib/platform-student-handoff";

import { Card } from "./Card";
import type {
  ProfileSalesActorRole,
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
    <span className="text-2xs text-fg-3">
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
            <span className={labelCls}>Ожидаемая сумма</span>
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
            <span className={labelCls}>Валюта</span>
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
            <span className={labelCls}>Ожидаемая дата</span>
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
          <span className={labelCls}>Дата получения</span>
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
          <span className={labelCls}>Причина исключения</span>
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
          <span className={labelCls}>Доказательство</span>
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
    <p className="mt-1 break-all text-2xs leading-5 text-fg-3">{value}</p>
  ) : null;
}

function GateCard({
  actorRole,
  gate,
  requestIds,
}: {
  actorRole: ProfileSalesActorRole;
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
    actorRole === "admin" && gate.canOverrideGate && !gate.normalHandoffAllowed;

  return (
    <Card
      title="Договор и первый платёж"
      aside={<Pill tone={gateStatus.tone}>{gateStatus.label}</Pill>}
    >
      <div className="grid gap-0 @5xl:grid-cols-2" data-testid="v3-sales-gate">
        <section className="space-y-3 p-4 @5xl:border-e @5xl:border-border">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-fg">Договор</h4>
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
          {!gate.contractConfirmed && gate.canConfirmContract ? (
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
            <h4 className="text-sm font-semibold text-fg">Первый платёж</h4>
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
          gate.canConfirmFirstPayment ? (
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
          <h4 className="text-sm font-semibold text-fg">Исключение Admin</h4>
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

function handoffInitialState(
  requestId: string,
  handoff: PlatformLeadAdmissionsHandoffSnapshot,
): PlatformLeadAdmissionsHandoffActionState {
  return {
    status: "idle",
    requestId,
    leadId: handoff.leadId,
    gateVersion: handoff.gateVersion,
    studentCaseId: handoff.caseId,
    changedAt: null,
  };
}

function HandoffCard({
  actorRole,
  handoff,
  requestId,
}: {
  actorRole: ProfileSalesActorRole;
  handoff: PlatformLeadAdmissionsHandoffSnapshot;
  requestId: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    handoffPlatformLeadToAdmissionsAction,
    handoffInitialState(requestId, handoff),
  );
  const normalAvailable = handoff.canSubmitNormal;
  const exceptionalAvailable =
    actorRole === "admin" && handoff.canSubmitExceptional;
  const firstMode: PlatformStudentHandoffMode = normalAvailable
    ? "normal"
    : "exceptional_override";
  const [mode, setMode] = useState<PlatformStudentHandoffMode>(firstMode);
  const effectiveMode =
    (mode === "normal" && normalAvailable) ||
    (mode === "exceptional_override" && exceptionalAvailable)
      ? mode
      : firstMode;
  const gateVersion = state.gateVersion ?? handoff.gateVersion;
  const caseId = state.studentCaseId ?? handoff.caseId;
  const locked = pending || state.status === "stale";

  useEffect(() => {
    if (state.status === "saved" || state.status === "stale") router.refresh();
  }, [router, state.changedAt, state.status]);

  if (caseId) {
    const refreshed = handoff.caseId !== null;
    return (
      <Card title="Передача в Admissions" aside={<Pill tone="ok">передан</Pill>}>
        <div className="space-y-3 p-4" data-testid="v3-sales-handoff-completed">
          {refreshed ? (
            <>
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm">
                <dt className="text-fg-3">Ответственный</dt>
                <dd className="text-right text-fg">
                  {handoff.admissionsOwnerDisplayName}
                </dd>
                <dt className="text-fg-3">Стартовых задач</dt>
                <dd className="text-right text-fg">{handoff.starterTaskCount}</dd>
              </dl>
              {handoff.handoffReason ? (
                <p className="text-sm leading-6 text-fg-2">{handoff.handoffReason}</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-fg-2">Передача подтверждена. Обновляем дело.</p>
          )}
          {actorRole === "admin" ? (
            <Link
              href={`/v3/profile?case=${caseId}&tab=overview`}
              className={btnGhostCls}
            >
              Открыть дело
            </Link>
          ) : (
            <p className="text-sm text-fg-3">
              Полное дело доступно Admissions и Admin.
            </p>
          )}
          <ActionResult status={state.status} />
        </div>
      </Card>
    );
  }

  const canSubmit = normalAvailable || exceptionalAvailable;
  const handoffStatus: Readonly<{ label: string; tone: PillTone }> = normalAvailable
    ? { label: "доступна", tone: "ok" }
    : exceptionalAvailable
      ? { label: "только исключение", tone: "warn" }
      : { label: "заблокирована", tone: "neutral" };

  return (
    <Card
      title="Передача в Admissions"
      aside={<Pill tone={handoffStatus.tone}>{handoffStatus.label}</Pill>}
    >
      <div className="space-y-4 p-4" data-testid="v3-sales-handoff">
        {canSubmit ? (
          <form
            action={action}
            className="space-y-4"
            data-testid="v3-sales-handoff-form"
          >
            <input type="hidden" name="lead_id" value={handoff.leadId} />
            <input
              type="hidden"
              name="expected_gate_version"
              value={gateVersion}
            />
            <input type="hidden" name="request_id" value={state.requestId} />

            <div className="grid gap-3 @4xl:grid-cols-2">
              <label>
                <span className={labelCls}>Ответственный Admissions</span>
                <select
                  name="admissions_owner_membership_id"
                  required
                  defaultValue=""
                  disabled={locked || handoff.eligibleAdmissionsOwners.length === 0}
                  className={inputCls}
                >
                  <option value="" disabled>
                    {handoff.eligibleAdmissionsOwners.length === 0
                      ? "Нет доступного сотрудника"
                      : "Выберите сотрудника"}
                  </option>
                  {handoff.eligibleAdmissionsOwners.map((owner) => (
                    <option key={owner.membershipId} value={owner.membershipId}>
                      {owner.displayName}
                    </option>
                  ))}
                </select>
              </label>

              {normalAvailable && exceptionalAvailable ? (
                <label>
                  <span className={labelCls}>Режим</span>
                  <select
                    name="handoff_mode"
                    value={effectiveMode}
                    onChange={(event) => {
                      setMode(event.target.value as PlatformStudentHandoffMode);
                    }}
                    disabled={locked}
                    className={inputCls}
                  >
                    <option value="normal">Обычная передача</option>
                    <option value="exceptional_override">Исключение Admin</option>
                  </select>
                </label>
              ) : (
                <input type="hidden" name="handoff_mode" value={effectiveMode} />
              )}
            </div>

            <label>
              <span className={labelCls}>
                {effectiveMode === "exceptional_override"
                  ? "Причина исключения"
                  : "Комментарий для Admissions"}
              </span>
              <textarea
                name="reason"
                required
                maxLength={1000}
                rows={3}
                disabled={locked}
                className={cn(inputCls, "h-auto resize-y py-2")}
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={locked || handoff.eligibleAdmissionsOwners.length === 0}
                className={btnCls}
              >
                {pending
                  ? "Передаём…"
                  : effectiveMode === "exceptional_override"
                    ? "Передать как исключение"
                    : "Передать в Admissions"}
              </button>
              <Version value={gateVersion} />
            </div>
            <ActionResult status={state.status} />
          </form>
        ) : (
          <p className="text-sm text-fg-3">
            Сначала подтвердите договор и получение первого платежа.
          </p>
        )}
      </div>
    </Card>
  );
}

export function ProfileSalesTransition({
  actorRole,
  gate,
  handoff,
  requestIds,
}: {
  actorRole: ProfileSalesActorRole;
  gate: PlatformLeadAdmissionsGateSnapshot;
  handoff: PlatformLeadAdmissionsHandoffSnapshot;
  requestIds: ProfileSalesRequestIds;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="v3-sales-transition">
      <GateCard actorRole={actorRole} gate={gate} requestIds={requestIds} />
      <HandoffCard
        key={`${handoff.gateVersion}:${handoff.caseId ?? "pending"}`}
        actorRole={actorRole}
        handoff={handoff}
        requestId={requestIds.handoff}
      />
    </div>
  );
}
