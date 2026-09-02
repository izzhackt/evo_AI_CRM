"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Card, btnCls, cn, inputCls, labelCls } from "@/components/ui";
import type { FixedRole } from "@/lib/fixed-role-policy";
import type { Locale } from "@/lib/i18n";
import {
  handoffPlatformLeadToAdmissionsAction,
  type PlatformLeadAdmissionsHandoffActionState,
} from "@/lib/platform-student-handoff-actions";
import type { PlatformLeadAdmissionsHandoffSnapshot } from "@/lib/platform-student-handoff";

type HandoffMode = "normal" | "exceptional_override";

const COPY = {
  ru: {
    title: "Передача в Admissions",
    blocked: "Supabase пока не разрешает передачу. Сначала выполните условия выше.",
    ready:
      "Условия выполнены. Выберите ответственного Admissions и подтвердите одну передачу.",
    exceptional:
      "Admin может выполнить только разрешённую базой исключительную передачу с объяснением.",
    completed: "Передача зафиксирована в Supabase.",
    gateState: "Состояние проверки",
    gateVersion: "Версия проверки",
    states: {
      blocked: "заблокировано",
      satisfied: "условия выполнены",
      overridden: "исключение разрешено",
    },
    owner: "Ответственный Admissions",
    noOwners: "Нет доступного сотрудника Admissions",
    mode: "Режим передачи",
    normal: "Обычная передача",
    override: "Исключительная передача Admin",
    normalReason: "Комментарий к передаче",
    overrideReason: "Обязательная причина исключения",
    normalReasonHint: "Что Admissions должен знать при начале работы",
    overrideReasonHint: "Почему передача нужна без обычных условий",
    submit: "Передать в Admissions",
    submitOverride: "Передать как исключение Admin",
    saving: "Передаём…",
    saved: "Admissions-кейс создан.",
    invalid: "Проверьте ответственного, режим и обязательный комментарий.",
    forbidden: "Текущая роль не может выполнить эту передачу.",
    gateBlocked: "База отклонила передачу: условия проверки не выполнены.",
    stale: "Состояние изменилось. Страница обновится.",
    requestConflict: "Этот запрос уже использован с другими данными.",
    unavailable: "Supabase недоступен. Кейс не создан.",
    caseId: "Admissions-кейс",
    ownerResult: "Ответственный",
    tasks: "Стартовых задач",
    modeResult: "Режим",
    reasonResult: "Комментарий передачи",
    openCase: "Открыть Admissions-кейс",
    roleRestricted:
      "Кейс создан. Полная карточка доступна только Admissions и Admin.",
  },
  ky: {
    title: "Admissions бөлүмүнө өткөрүү",
    blocked: "Supabase азырынча өткөрүүгө уруксат бербейт. Жогорудагы шарттарды аткарыңыз.",
    ready:
      "Шарттар аткарылды. Admissions жооптуусун тандап, бир өткөрүүнү ырастаңыз.",
    exceptional:
      "Admin база уруксат берген өзгөчө өткөрүүнү түшүндүрмө менен гана аткара алат.",
    completed: "Өткөрүү Supabase базасында бекитилди.",
    gateState: "Текшерүү абалы",
    gateVersion: "Текшерүү версиясы",
    states: {
      blocked: "бөгөттөлгөн",
      satisfied: "шарттар аткарылды",
      overridden: "өзгөчө уруксат",
    },
    owner: "Admissions жооптуусу",
    noOwners: "Жеткиликтүү Admissions кызматкери жок",
    mode: "Өткөрүү режими",
    normal: "Кадимки өткөрүү",
    override: "Admin өзгөчө өткөрүүсү",
    normalReason: "Өткөрүү комментарийи",
    overrideReason: "Өзгөчө өткөрүүнүн милдеттүү себеби",
    normalReasonHint: "Admissions ишти баштаганда эмнени билиши керек",
    overrideReasonHint: "Кадимки шарттарсыз өткөрүү эмне үчүн керек",
    submit: "Admissions бөлүмүнө өткөрүү",
    submitOverride: "Admin өзгөчө чечими менен өткөрүү",
    saving: "Өткөрүлүүдө…",
    saved: "Admissions кейси түзүлдү.",
    invalid: "Жооптууну, режимди жана милдеттүү комментарийди текшериңиз.",
    forbidden: "Учурдагы роль бул өткөрүүнү аткара албайт.",
    gateBlocked: "База өткөрүүнү четке какты: текшерүү шарттары аткарылган жок.",
    stale: "Абалы өзгөрдү. Барак жаңыланат.",
    requestConflict: "Бул сурам башка маалымат менен колдонулган.",
    unavailable: "Supabase жеткиликсиз. Кейс түзүлгөн жок.",
    caseId: "Admissions кейси",
    ownerResult: "Жооптуу",
    tasks: "Баштапкы тапшырмалар",
    modeResult: "Режим",
    reasonResult: "Өткөрүү комментарийи",
    openCase: "Admissions кейсин ачуу",
    roleRestricted:
      "Кейс түзүлдү. Толук карточка Admissions жана Admin үчүн гана жеткиликтүү.",
  },
  en: {
    title: "Handoff to Admissions",
    blocked: "Supabase does not allow handoff yet. Complete the conditions above first.",
    ready:
      "The conditions are satisfied. Choose the Admissions owner and confirm one handoff.",
    exceptional:
      "Admin can perform only the exceptional handoff allowed by the database, with a reason.",
    completed: "The handoff is committed in Supabase.",
    gateState: "Gate state",
    gateVersion: "Gate version",
    states: {
      blocked: "blocked",
      satisfied: "conditions satisfied",
      overridden: "exception allowed",
    },
    owner: "Admissions owner",
    noOwners: "No eligible Admissions owner",
    mode: "Handoff mode",
    normal: "Normal handoff",
    override: "Exceptional Admin handoff",
    normalReason: "Handoff note",
    overrideReason: "Required exception reason",
    normalReasonHint: "What Admissions should know when work begins",
    overrideReasonHint: "Why handoff is required without the normal conditions",
    submit: "Hand off to Admissions",
    submitOverride: "Hand off as an Admin exception",
    saving: "Handing off…",
    saved: "The Admissions case was created.",
    invalid: "Check the owner, mode, and required note.",
    forbidden: "The current role cannot perform this handoff.",
    gateBlocked: "The database rejected handoff because the gate is not satisfied.",
    stale: "The state changed. The page will refresh.",
    requestConflict: "This request was already used with different data.",
    unavailable: "Supabase is unavailable. No case was created.",
    caseId: "Admissions case",
    ownerResult: "Owner",
    tasks: "Starter tasks",
    modeResult: "Mode",
    reasonResult: "Handoff note",
    openCase: "Open Admissions case",
    roleRestricted:
      "The case was created. Its full view is restricted to Admissions and Admin.",
  },
} as const;

type Copy = (typeof COPY)[Locale];

function actionMessage(
  state: PlatformLeadAdmissionsHandoffActionState,
  copy: Copy,
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

export function PlatformSalesHandoffCard({
  actorRole,
  handoff,
  locale,
  requestId,
}: Readonly<{
  actorRole: FixedRole;
  handoff: PlatformLeadAdmissionsHandoffSnapshot;
  locale: Locale;
  requestId: string;
}>) {
  const copy = COPY[locale];
  const router = useRouter();
  const initialState: PlatformLeadAdmissionsHandoffActionState = {
    status: "idle",
    requestId,
    leadId: handoff.leadId,
    gateVersion: handoff.gateVersion,
    studentCaseId: handoff.caseId,
    changedAt: null,
  };
  const [state, action, pending] = useActionState(
    handoffPlatformLeadToAdmissionsAction,
    initialState,
  );
  const normalAvailable = handoff.canSubmitNormal;
  const exceptionalAvailable =
    actorRole === "admin" && handoff.canSubmitExceptional;
  const initialMode: HandoffMode = normalAvailable
    ? "normal"
    : "exceptional_override";
  const [mode, setMode] = useState<HandoffMode>(initialMode);
  const effectiveMode =
    (mode === "normal" && normalAvailable) ||
    (mode === "exceptional_override" && exceptionalAvailable)
      ? mode
      : initialMode;
  const committedCaseId = state.studentCaseId ?? handoff.caseId;
  const message = actionMessage(state, copy);

  useEffect(() => {
    if (state.status === "saved" || state.status === "stale") router.refresh();
  }, [router, state.changedAt, state.status]);

  return (
    <Card title={copy.title} className="shadow-none">
      <div className="space-y-4" data-testid="platform-sales-handoff-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-[56ch] text-sm leading-5 text-fg-3">
            {committedCaseId
              ? copy.completed
              : normalAvailable
                ? copy.ready
                : exceptionalAvailable
                  ? copy.exceptional
                  : copy.blocked}
          </p>
          <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-xs text-fg-3">
            <dt>{copy.gateState}</dt>
            <dd className="font-semibold text-fg">
              {copy.states[handoff.gateState]}
            </dd>
            <dt>{copy.gateVersion}</dt>
            <dd className="font-mono text-fg">{handoff.gateVersion}</dd>
          </dl>
        </div>

        {committedCaseId ? (
          <div
            className="rounded-ctl border border-border bg-surface-2 p-4"
            data-testid="platform-handoff-result"
          >
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-fg-3">{copy.caseId}</dt>
                <dd className="mt-1 break-all font-mono text-xs text-fg">
                  {committedCaseId}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-3">{copy.ownerResult}</dt>
                <dd className="mt-1 font-semibold text-fg">
                  {handoff.admissionsOwnerDisplayName ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-3">{copy.tasks}</dt>
                <dd className="mt-1 font-semibold text-fg">
                  {handoff.starterTaskCount}
                </dd>
              </div>
            </dl>
            {handoff.handoffMode || handoff.handoffReason ? (
              <dl className="mt-3 grid gap-2 border-t border-border pt-3 text-sm sm:grid-cols-2">
                {handoff.handoffMode ? (
                  <div>
                    <dt className="text-xs text-fg-3">{copy.modeResult}</dt>
                    <dd className="mt-1 text-fg">
                      {handoff.handoffMode === "exceptional_override"
                        ? copy.override
                        : copy.normal}
                    </dd>
                  </div>
                ) : null}
                {handoff.handoffReason ? (
                  <div>
                    <dt className="text-xs text-fg-3">{copy.reasonResult}</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-fg">
                      {handoff.handoffReason}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            <div className="mt-4">
              {actorRole === "admin" ? (
                <Link href={`/clients/${committedCaseId}`} className={btnCls}>
                  {copy.openCase}
                </Link>
              ) : (
                <p className="text-xs text-fg-3">{copy.roleRestricted}</p>
              )}
            </div>
          </div>
        ) : normalAvailable || exceptionalAvailable ? (
          <form
            action={action}
            className="space-y-4"
            data-testid="platform-handoff-form"
          >
            <input type="hidden" name="lead_id" value={handoff.leadId} />
            <input
              type="hidden"
              name="expected_gate_version"
              value={handoff.gateVersion}
            />
            <input type="hidden" name="request_id" value={state.requestId} />

            <div className="grid gap-4 md:grid-cols-2">
              <label>
                <span className={labelCls}>{copy.owner}</span>
                <select
                  name="admissions_owner_membership_id"
                  required
                  defaultValue=""
                  disabled={pending || handoff.eligibleAdmissionsOwners.length === 0}
                  className={inputCls}
                >
                  <option value="" disabled>
                    {handoff.eligibleAdmissionsOwners.length === 0
                      ? copy.noOwners
                      : copy.owner}
                  </option>
                  {handoff.eligibleAdmissionsOwners.map((owner) => (
                    <option key={owner.membershipId} value={owner.membershipId}>
                      {owner.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className={labelCls}>{copy.mode}</span>
                <select
                  name="handoff_mode"
                  value={effectiveMode}
                  onChange={(event) => setMode(event.target.value as HandoffMode)}
                  disabled={pending}
                  className={inputCls}
                >
                  {normalAvailable ? (
                    <option value="normal">{copy.normal}</option>
                  ) : null}
                  {exceptionalAvailable ? (
                    <option value="exceptional_override">{copy.override}</option>
                  ) : null}
                </select>
              </label>
            </div>

            <label>
              <span className={labelCls}>
                {effectiveMode === "exceptional_override"
                  ? copy.overrideReason
                  : copy.normalReason}
              </span>
              <textarea
                name="reason"
                required
                maxLength={1000}
                rows={3}
                placeholder={
                  effectiveMode === "exceptional_override"
                    ? copy.overrideReasonHint
                    : copy.normalReasonHint
                }
                disabled={pending}
                className={cn(inputCls, "h-auto resize-y py-2")}
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={
                  pending || handoff.eligibleAdmissionsOwners.length === 0
                }
                className={btnCls}
              >
                {pending
                  ? copy.saving
                  : effectiveMode === "exceptional_override"
                    ? copy.submitOverride
                    : copy.submit}
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
