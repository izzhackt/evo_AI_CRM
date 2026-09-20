"use client";

import { useActionState, useState } from "react";

import { btnCls, inputCls, labelCls } from "@/components/ui";
import {
  manageStudentPortalAccessAction,
  type StudentPortalAccessActionState,
} from "@/lib/student-portal-provisioning-actions";
import { studentPortalInviteFailure } from "@/lib/v3/wording";

type CuratorOption = Readonly<{
  membershipId: string;
  displayName: string;
}>;

const STATE_COPY: Readonly<Record<
  Exclude<NonNullable<StudentPortalAccessActionState>["status"], "blocked" | "forbidden" | "reissueAvailable"> | "blocked",
  string
>> = {
  invalid: "Проверьте обязательные поля и повторите действие.",
  unavailable: "Состояние доступа сейчас не подтверждено. Письмо не отправлено повторно.",
  blocked: "Операция остановлена безопасно. Письмо не отправлено повторно.",
  portalActivated: "Доступ к порталу активирован.",
  inviteIssued: "Приглашение уже выдано и ещё действует. Повторная отправка запрещена.",
  inviteFailed: "Провайдер подтвердил неуспешную отправку. Можно повторить подготовку.",
  reconciliationRequired: "Результат отправки неизвестен. Разрешена только проверка провайдера — без повторной отправки.",
  accountPending: "Приглашение принято; завершение authority ещё ожидается.",
};

function BindingFields({ state }: Readonly<{ state: NonNullable<StudentPortalAccessActionState> }>) {
  if (!("receiptId" in state)) return null;
  return (
    <>
      <input type="hidden" name="receipt_id" value={state.receiptId} />
      <input type="hidden" name="receipt_version" value={state.receiptVersion} />
      <input type="hidden" name="invite_generation" value={state.inviteGeneration} />
    </>
  );
}

type CaseShape = "normal_u6" | "legacy_pending" | "cabinet_pending";

export function StudentPortalAccessControls({
  organizationId,
  studentCaseId,
  email,
  displayName,
  caseState,
  isCabinetCase,
  requestId,
  curatorOptions,
  curatorOptionsAvailable,
}: Readonly<{
  organizationId: string;
  studentCaseId: string;
  email: string | null;
  displayName: string;
  caseState: "pending" | "active" | "closed";
  /** Unified workflow S8: source_key-derived (184's lead-cabinet origin), NOT caseState — a legacy pending case and a cabinet-pending case share caseState==='pending'. */
  isCabinetCase: boolean;
  requestId: string;
  curatorOptions: readonly CuratorOption[];
  curatorOptionsAvailable: boolean;
}>) {
  const [state, action, pending] = useActionState(
    manageStudentPortalAccessAction,
    null,
  );
  // Three-way discriminator (S8): 'active'/'closed' is always normal_u6 (the
  // only shape that ever reaches those states here); a 'pending' case is
  // cabinet_pending when it originates from 184's lead cabinet, else the
  // pre-pivot legacy_pending shape. NEVER derived from caseState alone.
  const caseShape: CaseShape = caseState !== "pending"
    ? "normal_u6"
    : isCabinetCase
      ? "cabinet_pending"
      : "legacy_pending";
  const legacyPending = caseShape === "legacy_pending";
  const cabinetPending = caseShape === "cabinet_pending";
  const [legacyCuratorMembershipId, setLegacyCuratorMembershipId] = useState("");
  const prepareUnavailable =
    caseState === "closed" ||
    email === null ||
    (legacyPending && (!curatorOptionsAvailable || curatorOptions.length === 0));
  const canPrepare =
    !prepareUnavailable &&
    (!legacyPending ||
      (curatorOptionsAvailable &&
        curatorOptions.length > 0 &&
        legacyCuratorMembershipId.length > 0));
  const canReissue = state?.status === "reissueAvailable" && "receiptId" in state;
  const canReconcile =
    state?.status === "reconciliationRequired" &&
    "receiptId" in state &&
    Boolean(state.attemptId && state.inviteKind);
  const forbiddenCopy = cabinetPending
    ? "Только Admin или Sales с действующим доступом к лиду может управлять доступом."
    : "Только Admin с действующей authority может управлять доступом.";
  const reissueAvailableCopy = cabinetPending
    ? "Срок приглашения истёк. Новую отправку должен явно подтвердить Admin или Sales."
    : "Срок приглашения истёк. Новую отправку должен явно подтвердить Admin.";

  return (
    <div className="space-y-4 p-4 text-sm text-fg-2" data-testid="student-portal-access-controls">
      <p className="max-w-prose">
        Проверьте доступ студента. Если нужно приглашение, оно будет отправлено
        на email из карточки. Действующее приглашение повторно не отправляется.
      </p>
      {cabinetPending ? (
        <p>
          Подготовка доступа не меняет куратора и не отмечает продажу.
        </p>
      ) : null}

      {caseState === "closed" ? (
        <p role="status">Закрытое дело нельзя подключить к порталу.</p>
      ) : email === null ? (
        <p role="status">Сначала добавьте студенту подтверждённый рабочий email.</p>
      ) : legacyPending && !curatorOptionsAvailable ? (
        <p role="status">Список активных кураторов недоступен. Доступ не подготовлен.</p>
      ) : legacyPending && curatorOptions.length === 0 ? (
        <p role="status">Для pending-дела сначала нужен активный Curator.</p>
      ) : null}

      {state ? (
        <p role="status" className="rounded-ctl border border-border bg-surface-2 px-3 py-2">
          {state.status === "forbidden"
            ? forbiddenCopy
            : state.status === "reissueAvailable"
              ? reissueAvailableCopy
              : state.status === "inviteFailed" && state.code
                ? studentPortalInviteFailure(state.code) ?? STATE_COPY[state.status]
                : STATE_COPY[state.status]}
          {state.code ? ` Код: ${state.code}.` : ""}
        </p>
      ) : null}

      <form action={action} className="grid gap-3 md:grid-cols-2">
        <input type="hidden" name="operation" value="prepare" />
        <input type="hidden" name="organization_id" value={organizationId} />
        <input type="hidden" name="student_case_id" value={studentCaseId} />
        <input type="hidden" name="email" value={email ?? ""} />
        <input type="hidden" name="display_name" value={displayName} />
        <input type="hidden" name="case_shape" value={caseShape} />
        <input type="hidden" name="request_id" value={requestId} />
        {legacyPending ? (
          <label>
            <span className={labelCls}>Ответственный Curator</span>
            <select
              className={inputCls}
              name="legacy_curator_membership_id"
              required
              disabled={prepareUnavailable || pending}
              value={legacyCuratorMembershipId}
              onChange={(event) => setLegacyCuratorMembershipId(event.target.value)}
            >
              <option value="" disabled>Выберите куратора</option>
              {curatorOptions.map((option) => (
                <option key={option.membershipId} value={option.membershipId}>
                  {option.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input type="hidden" name="legacy_curator_membership_id" value="" />
        )}
        <label className={legacyPending ? "" : "md:col-span-2"}>
          <span className={labelCls}>Причина</span>
          <input
            className={inputCls}
            name="reason"
            required
            minLength={1}
            maxLength={1000}
            defaultValue="Предоставление студенту доступа к порталу"
            disabled={prepareUnavailable || pending}
          />
        </label>
        <button className={btnCls} type="submit" disabled={!canPrepare || pending}>
          {pending ? "Проверяем…" : "Проверить и подготовить доступ"}
        </button>
      </form>

      {canReissue && state ? (
        <form action={action} className="space-y-3 rounded-ctl border border-border p-3">
          <input type="hidden" name="operation" value="reissue" />
          <input type="hidden" name="organization_id" value={organizationId} />
          <input type="hidden" name="case_shape" value={caseShape} />
          <BindingFields state={state} />
          <label>
            <span className={labelCls}>Причина повторного приглашения</span>
            <input
              className={inputCls}
              name="reason"
              required
              maxLength={1000}
              defaultValue="Истёкшее приглашение не было принято студентом"
            />
          </label>
          <button className={btnCls} type="submit" disabled={pending}>
            Явно подтвердить новое приглашение
          </button>
        </form>
      ) : null}

      {canReconcile && state && "receiptId" in state ? (
        <form action={action}>
          <input type="hidden" name="operation" value="reconcile" />
          <input type="hidden" name="organization_id" value={organizationId} />
          <input type="hidden" name="student_case_id" value={studentCaseId} />
          <input type="hidden" name="email" value={email ?? ""} />
          <input type="hidden" name="display_name" value={displayName} />
          <input type="hidden" name="case_shape" value={caseShape} />
          <input
            type="hidden"
            name="legacy_curator_membership_id"
            value={legacyPending ? legacyCuratorMembershipId : ""}
          />
          <input type="hidden" name="request_id" value={requestId} />
          <BindingFields state={state} />
          <input type="hidden" name="attempt_id" value={state.attemptId ?? ""} />
          <input type="hidden" name="invite_kind" value={state.inviteKind ?? ""} />
          <input
            type="hidden"
            name="reissue_request_id"
            value={state.reissueRequestId ?? ""}
          />
          <button className={btnCls} type="submit" disabled={pending}>
            Проверить результат у провайдера
          </button>
        </form>
      ) : null}
    </div>
  );
}
