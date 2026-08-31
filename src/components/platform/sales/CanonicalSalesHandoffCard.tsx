"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Card, btnCls, cn, inputCls, labelCls } from "@/components/ui";
import type { FixedRole } from "@/lib/fixed-role-policy";
import type { Locale } from "@/lib/i18n";
import {
  handoffCanonicalLeadToAdmissionsAction,
  type CanonicalSalesHandoffActionState,
} from "@/lib/server/canonical-sales-handoff-actions";
import type { CanonicalLeadGateSnapshot } from "@/lib/server/canonical-crm-repository";

const COPY = {
  ru: {
    title: "Передача в Admissions",
    blocked: "Сначала подтвердите договор и первый платёж.",
    adminBlocked:
      "Обычные условия не выполнены. Admin может провести исключение только с обязательной причиной.",
    ready:
      "Условия выполнены. Передача создаст один кейс Admissions и стартовые задачи.",
    completed: "Лид уже передан в Admissions.",
    normal: "Передать в Admissions",
    override: "Передать как исключение Admin",
    overrideReason: "Причина исключения",
    overrideReasonHint: "Почему кейс нужно передать без выполненных условий",
    saving: "Передаём…",
    saved: "Кейс Admissions создан.",
    invalid: "Проверьте данные передачи и обязательную причину исключения.",
    forbidden: "Эта роль не может выполнить выбранную передачу.",
    gateBlocked: "Передача отклонена: условия gate не выполнены.",
    stale: "Лид изменился. Обновите страницу перед передачей.",
    requestConflict:
      "Запрос уже использован с другими данными. Повторите передачу.",
    unavailable: "PostgreSQL недоступен. Кейс не создан.",
    openCase: "Открыть кейс Admissions",
    caseRecorded: "Кейс Admissions создан. Он открывается ролью Admissions.",
  },
  ky: {
    title: "Admissions бөлүмүнө өткөрүү",
    blocked: "Адегенде келишимди жана биринчи төлөмдү ырастоо керек.",
    adminBlocked:
      "Кадимки шарттар аткарылган жок. Admin милдеттүү себеп менен гана өзгөчө өткөрө алат.",
    ready:
      "Шарттар аткарылды. Өткөрүү бир Admissions кейсин жана баштапкы тапшырмаларды түзөт.",
    completed: "Лид Admissions бөлүмүнө өткөрүлгөн.",
    normal: "Admissions бөлүмүнө өткөрүү",
    override: "Admin өзгөчө чечими менен өткөрүү",
    overrideReason: "Өзгөчө чечимдин себеби",
    overrideReasonHint: "Шарттар аткарылбай туруп эмне үчүн өткөрүү керек",
    saving: "Өткөрүлүүдө…",
    saved: "Admissions кейси түзүлдү.",
    invalid: "Өткөрүү маалыматын жана милдеттүү себепти текшериңиз.",
    forbidden: "Бул роль тандалган өткөрүүнү аткара албайт.",
    gateBlocked: "Өткөрүү четке кагылды: gate шарттары аткарылган жок.",
    stale: "Лид өзгөрдү. Өткөрүүдөн мурун баракты жаңыртыңыз.",
    requestConflict: "Сурам башка маалымат үчүн колдонулган. Кайра өткөрүңүз.",
    unavailable: "PostgreSQL жеткиликсиз. Кейс түзүлгөн жок.",
    openCase: "Admissions кейсин ачуу",
    caseRecorded: "Admissions кейси түзүлдү. Аны Admissions ролу ачат.",
  },
  en: {
    title: "Handoff to Admissions",
    blocked: "Confirm the contract and first payment before handoff.",
    adminBlocked:
      "Normal conditions are not met. Admin may create an exception only with a required reason.",
    ready:
      "Requirements are satisfied. Handoff creates one Admissions case and starter tasks.",
    completed: "This lead has already been handed off to Admissions.",
    normal: "Hand off to Admissions",
    override: "Hand off as Admin exception",
    overrideReason: "Exception reason",
    overrideReasonHint:
      "Why this case must proceed without the normal requirements",
    saving: "Handing off…",
    saved: "Admissions case created.",
    invalid: "Check the handoff data and required exception reason.",
    forbidden: "This role cannot perform the selected handoff.",
    gateBlocked: "Handoff was rejected because the gate is not satisfied.",
    stale: "The lead changed. Refresh before handing it off.",
    requestConflict: "This request was used with different data. Submit again.",
    unavailable: "PostgreSQL is unavailable. No case was created.",
    openCase: "Open Admissions case",
    caseRecorded: "The Admissions case was created. The Admissions role opens it.",
  },
} as const;

function actionMessage(
  state: CanonicalSalesHandoffActionState,
  copy: (typeof COPY)[Locale],
) {
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

export function CanonicalSalesHandoffCard({
  actorRole,
  expectedVersion,
  gate,
  canOpenAdmissionsCase,
  locale,
  requestId,
}: Readonly<{
  actorRole: FixedRole;
  canOpenAdmissionsCase: boolean;
  expectedVersion: number;
  gate: CanonicalLeadGateSnapshot;
  locale: Locale;
  requestId: string;
}>) {
  const copy = COPY[locale];
  const initialState: CanonicalSalesHandoffActionState = {
    status: "idle",
    requestId,
    studentCaseId: null,
    isOverride: null,
    changedAt: null,
  };
  const [state, action, pending] = useActionState(
    handoffCanonicalLeadToAdmissionsAction,
    initialState,
  );
  const completedCaseId =
    state.studentCaseId ?? gate.handoff?.studentCaseId ?? null;
  const canSubmitNormal = gate.normalHandoffAllowed && !completedCaseId;
  const canSubmitOverride =
    actorRole === "admin" && gate.exceptionalHandoffAllowed && !completedCaseId;
  const isOverride = canSubmitOverride && !canSubmitNormal;
  const message = actionMessage(state, copy);

  return (
    <Card title={copy.title} className="shadow-none">
      <div className="space-y-4" data-testid="canonical-sales-handoff-card">
        <p className="text-sm leading-5 text-fg-3">
          {completedCaseId
            ? copy.completed
            : canSubmitNormal
              ? copy.ready
              : canSubmitOverride
                ? copy.adminBlocked
                : copy.blocked}
        </p>

        {completedCaseId ? (
          canOpenAdmissionsCase ? (
            <Link
              href={`/clients/${completedCaseId}`}
              className={btnCls}
              data-testid="canonical-admissions-case-link"
            >
              {copy.openCase}
            </Link>
          ) : (
            <p
              className="text-sm leading-5 text-fg-2"
              data-testid="canonical-admissions-case-reference"
            >
              {copy.caseRecorded}{" "}
              <span className="font-mono text-xs text-fg-3">
                {completedCaseId}
              </span>
            </p>
          )
        ) : canSubmitNormal || canSubmitOverride ? (
          <form
            action={action}
            className="space-y-3"
            data-testid="canonical-sales-handoff-form"
          >
            <input type="hidden" name="lead_id" value={gate.leadId} />
            <input type="hidden" name="request_id" value={state.requestId} />
            <input
              type="hidden"
              name="expected_version"
              value={expectedVersion}
            />
            <input
              type="hidden"
              name="is_override"
              value={String(isOverride)}
            />

            {isOverride ? (
              <label>
                <span className={labelCls}>{copy.overrideReason}</span>
                <textarea
                  name="override_reason"
                  required
                  maxLength={2000}
                  rows={3}
                  placeholder={copy.overrideReasonHint}
                  className={cn(inputCls, "h-auto resize-y py-2")}
                />
              </label>
            ) : (
              <input type="hidden" name="override_reason" value="" />
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={pending} className={btnCls}>
                {pending
                  ? copy.saving
                  : isOverride
                    ? copy.override
                    : copy.normal}
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
        ) : null}
      </div>
    </Card>
  );
}
