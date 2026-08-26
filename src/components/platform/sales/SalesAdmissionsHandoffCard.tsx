"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  updatePlatformAdmissionsHandoffAction,
  type PlatformAdmissionsHandoffActionState,
} from "@/lib/platform-admissions-handoff-actions";
import type {
  PlatformAdmissionsHandoff,
  PlatformAdmissionsHandoffMode,
} from "@/lib/platform-admissions-handoff-contract";
import { Card, btnCls, cn, inputCls, labelCls } from "@/components/ui";

type Locale = "ru" | "ky" | "en";

type Copy = Readonly<{
  title: string;
  blocked: string;
  ready: string;
  completed: string;
  normal: string;
  exceptional: string;
  owner: string;
  reason: string;
  currentOwner: string;
  currentMode: string;
  currentReason: string;
  starterTasks: string;
  caseLink: string;
  noOwnerChoices: string;
  noSubmissionAuthority: string;
  submit: string;
  saved: string;
  invalid: string;
  forbidden: string;
  stale: string;
  requestConflict: string;
  unavailable: string;
  refresh: string;
  saving: string;
  notAvailable: string;
}>;

const COPY: Record<Locale, Copy> = {
  ru: {
    title: "Передача Sales → Admissions",
    blocked:
      "Передача пока заблокирована. База допускает handoff только после подтверждённого U5 gate или уже оформленного исключения.",
    ready:
      "Передача готова. Выберите активного Admissions owner и зафиксируйте причину handoff в аудируемой операции.",
    completed:
      "Передача уже завершена. Повтор создаёт не новый case, а возвращает существующий связанный результат.",
    normal: "Обычный handoff",
    exceptional: "Исключение по override",
    owner: "Admissions owner",
    reason: "Причина handoff",
    currentOwner: "Назначенный owner",
    currentMode: "Режим handoff",
    currentReason: "Зафиксированная причина",
    starterTasks: "Стартовые задачи",
    caseLink: "Открыть Admissions case",
    noOwnerChoices: "Нет доступных активных curator owner-ов в tenant-bound ответе.",
    noSubmissionAuthority:
      "Текущий сотрудник не может запустить handoff в этом состоянии. Карточка остаётся только для чтения.",
    submit: "Передать в Admissions",
    saved: "Handoff сохранён атомарно и записан в аудит.",
    invalid: "Проверьте owner, режим и причину.",
    forbidden: "База отклонила handoff по правам или tenant-bound ограничениям.",
    stale: "Состояние gate изменилось. Обновите страницу и повторите.",
    requestConflict: "Этот request id уже использован с другим payload.",
    unavailable: "Сохранение недоступно. Новый case не считается созданным.",
    refresh: "Обновить состояние gate",
    saving: "Сохраняется…",
    notAvailable: "Не доступно",
  },
  ky: {
    title: "Sales → Admissions өткөрүү",
    blocked:
      "Өткөрүү азыр бөгөттө. База handoff'ту U5 gate ырасталгандан кийин же буга чейин катталган өзгөчө уруксат болгондо гана кабыл алат.",
    ready:
      "Өткөрүү даяр. Активдүү Admissions owner'ди тандап, handoff себебин аудит операциясында каттаңыз.",
    completed:
      "Өткөрүү буга чейин аяктаган. Кайталоо жаңы case түзбөйт, учурдагы байланышты кайтарат.",
    normal: "Кадимки handoff",
    exceptional: "Override боюнча өзгөчө handoff",
    owner: "Admissions owner",
    reason: "Handoff себеби",
    currentOwner: "Дайындалган owner",
    currentMode: "Handoff режими",
    currentReason: "Катталган себеп",
    starterTasks: "Баштапкы тапшырмалар",
    caseLink: "Admissions case ачуу",
    noOwnerChoices: "Tenant-bound жоопто жеткиликтүү активдүү curator owner жок.",
    noSubmissionAuthority:
      "Учурдагы кызматкер бул абалда handoff баштай албайт. Карточка окуу үчүн гана калат.",
    submit: "Admissions'ке өткөрүү",
    saved: "Handoff атомдук түрдө сакталды жана аудитке жазылды.",
    invalid: "Owner, режим жана себепти текшериңиз.",
    forbidden: "База укук же tenant-bound чектөөлөр боюнча handoff'ту четке какты.",
    stale: "Gate абалы өзгөрдү. Баракты жаңыртып, кайра аракет кылыңыз.",
    requestConflict: "Бул request id башка payload менен колдонулган.",
    unavailable: "Сактоо жеткиликсиз. Жаңы case түзүлдү деп эсептелбейт.",
    refresh: "Gate абалын жаңыртуу",
    saving: "Сакталууда…",
    notAvailable: "Жеткиликсиз",
  },
  en: {
    title: "Sales to Admissions handoff",
    blocked:
      "Handoff is currently blocked. The database allows it only after a satisfied U5 gate or an already audited exception.",
    ready:
      "Handoff is ready. Pick an active Admissions owner and record the handoff reason in the audited operation.",
    completed:
      "Handoff is already complete. A repeat returns the existing linked case instead of creating a new one.",
    normal: "Normal handoff",
    exceptional: "Exceptional override",
    owner: "Admissions owner",
    reason: "Handoff reason",
    currentOwner: "Assigned owner",
    currentMode: "Handoff mode",
    currentReason: "Recorded reason",
    starterTasks: "Starter tasks",
    caseLink: "Open Admissions case",
    noOwnerChoices: "No active curator owners were returned by the tenant-bound response.",
    noSubmissionAuthority:
      "The current staff member cannot submit handoff in this state. The card remains read-only.",
    submit: "Send to Admissions",
    saved: "The handoff was saved atomically and recorded in audit.",
    invalid: "Check the owner, mode, and reason.",
    forbidden: "The database rejected the handoff due to authorization or tenant-bound rules.",
    stale: "The gate state changed. Refresh and try again.",
    requestConflict: "This request id was already used with a different payload.",
    unavailable: "Saving is unavailable. No new case is considered created.",
    refresh: "Refresh gate state",
    saving: "Saving…",
    notAvailable: "Unavailable",
  },
};

const STATUS_TONE = {
  blocked: "bg-danger-weak text-danger",
  ready: "bg-ok-weak text-ok",
  completed: "bg-info-weak text-info",
} as const;

function Fact({
  label,
  children,
  testId,
}: Readonly<{
  label: string;
  children: React.ReactNode;
  testId?: string;
}>) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-fg-3">
        {label}
      </dt>
      <dd className="mt-1.5 break-words text-[12.5px] text-fg-2">{children}</dd>
    </div>
  );
}

function actionMessage(
  state: PlatformAdmissionsHandoffActionState,
  copy: Copy,
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

function modeLabel(mode: PlatformAdmissionsHandoffMode, copy: Copy): string {
  return mode === "normal" ? copy.normal : copy.exceptional;
}

export function SalesAdmissionsHandoffCard({
  handoff,
  locale,
  requestId: initialRequestId,
}: Readonly<{
  handoff: PlatformAdmissionsHandoff;
  locale: Locale;
  requestId: string;
}>) {
  const copy = COPY[locale];
  const initialState: PlatformAdmissionsHandoffActionState = {
    status: "idle",
    requestId: initialRequestId,
    gateVersion: null,
    caseId: null,
    handoffMode: null,
    changedAt: null,
  };
  const [state, formAction, pending] = useActionState(
    updatePlatformAdmissionsHandoffAction,
    initialState,
  );
  const message = actionMessage(state, copy);
  const requestId = state.requestId;
  const caseId = state.caseId ?? handoff.caseId;
  const displayStatus = caseId ? "completed" : handoff.status;
  const requiresRefresh = state.status === "stale";
  const canSubmit =
    caseId === null &&
    (handoff.canSubmitNormal || handoff.canSubmitExceptional);
  const mode = handoff.canSubmitExceptional ? "exceptional_override" : "normal";

  return (
    <section data-testid="admissions-handoff-card">
      <Card title={copy.title}>
      <div className="space-y-4">
        <p className="text-[13px] leading-6 text-fg-3">
          {{
            blocked: copy.blocked,
            ready: copy.ready,
            completed: copy.completed,
          }[displayStatus]}
        </p>
        <div
          className={cn(
            "inline-flex rounded-full px-3 py-1 text-[12px] font-semibold",
            STATUS_TONE[displayStatus],
          )}
          data-testid="admissions-handoff-state"
        >
          {displayStatus === "blocked"
            ? copy.blocked
            : displayStatus === "ready"
              ? `${copy.ready} · ${modeLabel(mode, copy)}`
              : copy.completed}
        </div>

        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label={copy.currentOwner} testId="admissions-handoff-owner-state">
            {handoff.admissionsOwnerDisplayName ?? copy.notAvailable}
          </Fact>
          <Fact label={copy.currentMode} testId="admissions-handoff-mode-state">
            {handoff.handoffMode ? modeLabel(handoff.handoffMode, copy) : copy.notAvailable}
          </Fact>
          <Fact label={copy.currentReason} testId="admissions-handoff-reason-state">
            {handoff.handoffReason ?? copy.notAvailable}
          </Fact>
          <Fact label={copy.starterTasks} testId="admissions-handoff-task-count">
            {String(handoff.starterTaskCount)}
          </Fact>
        </dl>

        {caseId ? (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/clients/${caseId}`}
              className={btnCls}
              data-testid="admissions-handoff-case-link"
            >
              {copy.caseLink}
            </Link>
          </div>
        ) : null}

        {message ? (
          <p
            className="text-[12px] text-fg-3"
            data-testid="admissions-handoff-message"
            role={state.status === "saved" ? "status" : "alert"}
            aria-live={state.status === "saved" ? "polite" : "assertive"}
          >
            {message}
          </p>
        ) : null}

        {requiresRefresh ? (
          <button
            type="button"
            className={btnCls}
            onClick={() => window.location.reload()}
            data-testid="admissions-handoff-refresh"
          >
            {copy.refresh}
          </button>
        ) : canSubmit ? (
          handoff.eligibleAdmissionsOwners.length > 0 ? (
            <form
              action={formAction}
              className="space-y-3 rounded-lg border border-border p-4"
              data-testid="admissions-handoff-form"
            >
              <input type="hidden" name="lead_id" value={handoff.leadId} />
              <input
                type="hidden"
                name="expected_gate_version"
                value={String(state.gateVersion ?? handoff.gateVersion)}
              />
              <input type="hidden" name="handoff_mode" value={mode} />
              <input type="hidden" name="request_id" value={requestId} />
              <label className={labelCls}>
                {copy.owner}
                <select
                  name="admissions_owner_membership_id"
                  required
                  className={cn(inputCls, "mt-1")}
                  data-testid="admissions-handoff-owner"
                >
                  <option value="">{copy.notAvailable}</option>
                  {handoff.eligibleAdmissionsOwners.map((owner) => (
                    <option key={owner.membershipId} value={owner.membershipId}>
                      {owner.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelCls}>
                {copy.reason}
                <textarea
                  name="reason"
                  required
                  maxLength={1000}
                  rows={3}
                  className={cn(inputCls, "mt-1 resize-y py-2")}
                  data-testid="admissions-handoff-reason"
                />
              </label>
              <button
                type="submit"
                className={btnCls}
                disabled={pending}
                data-testid="admissions-handoff-submit"
              >
                {pending ? copy.saving : `${copy.submit} · ${modeLabel(mode, copy)}`}
              </button>
            </form>
          ) : (
            <p
              className="text-[12px] text-danger"
              data-testid="admissions-handoff-no-owners"
            >
              {copy.noOwnerChoices}
            </p>
          )
        ) : (
          <p
            className="text-[12px] text-fg-3"
            data-testid="admissions-handoff-readonly"
          >
            {copy.noSubmissionAuthority}
          </p>
        )}
      </div>
      </Card>
    </section>
  );
}
