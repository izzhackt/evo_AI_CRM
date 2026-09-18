import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import Link from "next/link";

import { Pill } from "@/components/v3/Pill";
import { personState } from "@/lib/v3/wording";
import {
  ADMISSIONS_STAGES,
  ADMISSIONS_STAGE_LABELS,
  type AdmissionsStage,
  type AdmissionsWorkspace,
} from "@/lib/platform-admissions-playbook-contract";
import { readAdmissionsWorkspace } from "@/lib/v3/admissions-source";

import { DIRECTION_LABELS } from "./admissions-view";
import type { PersonProfile, ProfileDraft } from "./types";

function formatDueOn(value: string | null): string | null {
  if (!value) return null;
  const parts = value.split("-");
  return parts.length === 3 ? parts.reverse().join(".") : value;
}

function stageLabel(workspace: AdmissionsWorkspace | null): string | null {
  if (!workspace) return null;
  const { case: current } = workspace;
  if (current.outcome === "arrived") return "Прибытие подтверждено";
  if (current.outcome === "cancelled") return "Дело закрыто без прибытия";
  if (current.state === "pending") return "Дело ожидает активации";
  const index = ADMISSIONS_STAGES.indexOf(current.stage as AdmissionsStage);
  if (index < 0) return "Маршрут не выбран";
  return `${index + 1}/${ADMISSIONS_STAGES.length} · ${ADMISSIONS_STAGE_LABELS[current.stage as AdmissionsStage]}`;
}

function activeBlocker(workspace: AdmissionsWorkspace | null): string | null {
  if (!workspace) return null;
  const gate = workspace.gates.find((item) => item.stage === workspace.case.stage);
  if (!gate || gate.ready || gate.blockers.length === 0) return null;
  const [first, ...rest] = gate.blockers;
  return rest.length > 0 ? `${first} и ещё ${rest.length}` : first;
}

function HeaderFact({ label, value, meta, action }: Readonly<{
  label: string; value: string; meta?: string | null; action?: React.ReactNode;
}>) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-fg-3">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm text-fg">
        <span className="min-w-0">{value}</span>
        {meta ? <span className="text-fg-3">до {meta}</span> : null}
        {action}
      </dd>
    </div>
  );
}

/**
 * Шапка дела — сводка над вкладками для `?case=`-целей.
 *
 * Имя и состояние человека, направление, куратор, текущий этап маршрута,
 * следующий шаг и активный блокер — одним взглядом, без перехода на вкладку
 * «Маршрут». Маршрут читается отдельным запросом с собственным `try/catch`:
 * если он недоступен, шапка не пропадает, а показывает то, что уже загружено
 * для страницы (имя, куратор, следующий шаг из канонического профиля).
 */
export async function CaseHeader({
  actor,
  profile,
  draft,
}: Readonly<{
  actor: ActivePlatformActor;
  profile: PersonProfile;
  draft: ProfileDraft;
}>) {
  const caseId = draft.routeTarget.studentCaseId;
  if (!caseId) return null;
  const workspace = await readAdmissionsWorkspace(actor, caseId).catch(() => null);
  const state = personState({
    hasCase: profile.student,
    caseStatus: profile.caseStatus,
    leadStage: profile.stage,
  });
  const direction = workspace?.case.direction ? DIRECTION_LABELS[workspace.case.direction] : "Не выбрано";
  const stage = stageLabel(workspace) ?? "Недоступно";
  const nextAction = (workspace?.case.nextAction ?? profile.nextAction) || "Не назначено";
  const dueOn = workspace ? formatDueOn(workspace.case.nextActionDueOn) : profile.nextActionAt;
  const blocker = activeBlocker(workspace);
  const canLinkCoverage = actor.systemRole === "admin" && !isStaffPreview(actor)
    && staffHasPermission(actor, "case.curator.assign");

  return (
    <section className="flex flex-col gap-3" data-testid="v3-case-header">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="min-w-0 text-xl font-semibold tracking-[-0.02em] text-fg">
          {profile.person}
        </h2>
        <p className="text-sm text-fg-3">{state}</p>
        {profile.financeStop ? <Pill tone="danger">финансовый стоп</Pill> : null}
        {!isStaffPreview(actor) && staffHasPermission(actor, "task.manage") ? (
          <Link
            href={`/v3/tasks?create=case&case=${encodeURIComponent(caseId)}`}
            className="ms-auto inline-flex min-h-11 items-center rounded-ctl border border-control-edge px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            Создать задачу по студенту
          </Link>
        ) : null}
      </div>

      <dl className="grid gap-x-6 gap-y-3 rounded-card border border-border bg-surface px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
        <HeaderFact label="Направление" value={direction} />
        <HeaderFact
          label="Куратор"
          value={draft.responsible ?? "не назначен"}
          action={canLinkCoverage ? (
            <Link href="/v3/profile#curator-coverage" className="text-xs font-semibold text-accent underline underline-offset-4">
              Нагрузка кураторов
            </Link>
          ) : undefined}
        />
        <HeaderFact label="Этап" value={stage} />
        <HeaderFact label="Следующий шаг" value={nextAction} meta={dueOn} />
      </dl>

      {blocker ? (
        <p className="v3-edge-danger flex flex-wrap items-start gap-2 rounded-card border border-border border-s-2 bg-surface px-4 py-3 text-sm leading-5 text-fg">
          <Pill tone="danger">блокер</Pill>
          <span className="min-w-0 flex-1">{blocker}</span>
        </p>
      ) : null}
    </section>
  );
}
