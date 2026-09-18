import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import Link from "next/link";

import { Pill } from "@/components/v3/Pill";
import { personState } from "@/lib/v3/wording";
import type { AdmissionsAttention } from "@/lib/platform-admissions-playbook-contract";
import { readCaseAttentionFlags } from "@/lib/platform-admissions";
import type { StudentPortalCuratorOption } from "@/lib/server/student-portal-curator-options";

import { AssignCaseCuratorForm } from "./AssignCaseCuratorForm";
import { DIRECTION_LABELS } from "./admissions-view";
import type { PersonProfile, ProfileDraft } from "./types";

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
 * Имя и состояние человека, направление, куратор и следующий шаг — одним
 * взглядом. Unified workflow S4 (plan §8): «Обзор» больше не несёт
 * обязательный индикатор этапов поступления, поэтому эта шапка больше не
 * читает отдельный маршрут-воркспейс и не показывает «Этап» или блокер
 * текущего этапа — их источник (маршрут/плейбук/gates) удалён вместе с
 * вкладкой «Маршрут». Направление берётся из уже загруженного `draft.admissions`
 * (заполняется из того же DTO дела, что и раньше читало
 * `staff_case_admissions_workspace_v1` — profile-source.ts's `admissionsWorkspace()`).
 */
export async function CaseHeader({
  actor,
  profile,
  draft,
  curators = [],
  assignCuratorRequestId,
}: Readonly<{
  actor: ActivePlatformActor;
  profile: PersonProfile;
  draft: ProfileDraft;
  /** Reused from the same `listStudentPortalActiveCurators` read the page already loads (S3, plan §7). */
  curators?: readonly StudentPortalCuratorOption[];
  assignCuratorRequestId: string;
}>) {
  const caseId = draft.routeTarget.studentCaseId;
  if (!caseId) return null;
  const state = personState({
    hasCase: profile.student,
    caseStatus: profile.caseStatus,
    leadStage: profile.stage,
  });
  const direction = draft.admissions?.direction ? DIRECTION_LABELS[draft.admissions.direction] : "Не выбрано";
  const nextAction = profile.nextAction || "Не назначено";
  const dueOn = profile.nextActionAt;
  const canLinkCoverage = actor.systemRole === "admin" && !isStaffPreview(actor)
    && staffHasPermission(actor, "case.curator.assign");
  // S3 (plan §7): «Admin выбирает другого куратора внутри того же дела» — a
  // pending case reverted by a declined assignment (still carrying its sale)
  // is a needs-curator case, read the same way the directory computes it,
  // via a dedicated small RPC (182's staff_case_attention_flags_v1).
  const canAssignCurator = canLinkCoverage
    && (await readCaseAttentionFlags(actor, caseId).catch((): readonly AdmissionsAttention[] => []))
      .includes("needs_curator");

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

      <dl className="grid gap-x-6 gap-y-3 rounded-card border border-border bg-surface px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
        <HeaderFact label="Направление" value={direction} />
        <HeaderFact
          label="Куратор"
          value={draft.responsible ?? "не назначен"}
          action={canLinkCoverage && !canAssignCurator ? (
            <Link href="/v3/profile#curator-coverage" className="inline-flex min-h-11 items-center text-xs font-semibold text-accent underline underline-offset-4">
              Нагрузка кураторов
            </Link>
          ) : undefined}
        />
        <HeaderFact label="Следующий шаг" value={nextAction} meta={dueOn} />
      </dl>

      {canAssignCurator ? (
        <div className="rounded-card border border-border bg-surface px-4 py-3">
          <AssignCaseCuratorForm
            studentCaseId={caseId}
            curators={curators}
            requestId={assignCuratorRequestId}
          />
        </div>
      ) : null}
    </section>
  );
}
