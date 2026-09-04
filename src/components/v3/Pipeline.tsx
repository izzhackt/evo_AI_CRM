import Link from "next/link";

import { Pill } from "@/components/v3/Pill";
import { PipelineDecisionForm } from "@/components/v3/PipelineDecisionForm";
import type { FixedRole } from "@/lib/fixed-role-policy";
import type {
  PlatformSalesOwnerOption,
  PlatformSalesStage,
  PlatformSalesWorkflowLead,
} from "@/lib/platform-sales-contract";

export type PipelineStageKey = PlatformSalesStage | "handed_off";

export type PipelineStage = Readonly<{
  key: PipelineStageKey;
  title: string;
  gate: boolean;
  terminal: boolean;
}>;

export type PipelineLead = Readonly<{
  id: string;
  name: string;
  stageKey: PipelineStageKey;
  source: string;
  nextAction: string | null;
  nextActionAt: string | null;
  due: "overdue" | "today" | "later" | "none";
  href: string;
  workflow: PlatformSalesWorkflowLead;
}>;

const DUE_MARK: Record<PipelineLead["due"], { tone: string; label: string } | null> = {
  overdue: { tone: "bg-danger", label: "срок прошёл" },
  today: { tone: "bg-warn", label: "срок сегодня" },
  later: null,
  none: { tone: "bg-control-edge", label: "следующее действие не назначено" },
};

function LeadCard({
  lead,
  terminal,
  workflowStages,
  ownerOptions,
  ownerOptionsHaveMore,
  actorRole,
  actorMembershipId,
  requestId,
}: {
  lead: PipelineLead;
  terminal: boolean;
  workflowStages: readonly Readonly<{
    key: PlatformSalesStage;
    title: string;
  }>[];
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsHaveMore: boolean;
  actorRole: Extract<FixedRole, "admin" | "sales">;
  actorMembershipId: string;
  requestId: string;
}) {
  const mark = terminal && lead.due === "none" ? null : DUE_MARK[lead.due];

  return (
    <article className="relative rounded-ctl border border-border bg-surface px-3 py-2.5 hover:border-control-edge">
      <div className="flex items-start gap-1.5">
        <p className="min-w-0 flex-1">
          <Link
            href={lead.href}
            prefetch={false}
            className="flex min-h-6 items-center text-sm font-semibold leading-5 text-fg underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {lead.name}
          </Link>
          {lead.nextAction ? (
            <span className="mt-0.5 block truncate text-2xs text-fg-2">
              {lead.nextAction}
            </span>
          ) : null}
          {lead.nextActionAt ? (
            <span className="mt-0.5 block truncate text-2xs text-fg-3">
              {lead.nextActionAt}
            </span>
          ) : null}
        </p>

        {mark ? (
          <>
            <span
              aria-hidden="true"
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${mark.tone}`}
            />
            <span className="sr-only">{mark.label}</span>
          </>
        ) : null}
      </div>

      {!terminal ? (
        <PipelineDecisionForm
          key={`${lead.workflow.leadId}:${lead.workflow.workflowVersion}`}
          lead={lead.workflow}
          stages={workflowStages}
          ownerOptions={ownerOptions}
          ownerOptionsHaveMore={ownerOptionsHaveMore}
          actorRole={actorRole}
          actorMembershipId={actorMembershipId}
          requestId={requestId}
        />
      ) : null}
    </article>
  );
}

export function Pipeline({
  stages,
  leads,
  ownerOptions,
  ownerOptionsHaveMore,
  actorRole,
  actorMembershipId,
  requestIds,
}: {
  stages: readonly PipelineStage[];
  leads: readonly PipelineLead[];
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsHaveMore: boolean;
  actorRole: Extract<FixedRole, "admin" | "sales">;
  actorMembershipId: string;
  requestIds: Readonly<Record<string, string>>;
}) {
  const workflowStages = stages.flatMap((stage) =>
    stage.key === "handed_off"
      ? []
      : [{ key: stage.key, title: stage.title }],
  );

  return (
    <div
      role="group"
      aria-label="Воронка продаж"
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-card"
    >
      <ol className="flex flex-col gap-3 @2xl:w-max @2xl:flex-row md:items-start">
        {stages.map((stage) => {
          const inStage = leads.filter((lead) => lead.stageKey === stage.key);
          return (
            <li
              key={stage.key}
              className="flex min-w-0 flex-col gap-2 rounded-card bg-surface-2 p-2.5 @2xl:w-[280px] md:shrink-0"
            >
              <div className="flex items-center justify-between gap-2 px-1 py-0.5">
                <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-fg">
                  <span className="truncate">{stage.title}</span>
                  {stage.gate ? <Pill tone="solid">гейт</Pill> : null}
                </h3>
                <span className="shrink-0 font-mono text-2xs text-fg-3">
                  {inStage.length}
                </span>
              </div>

              <ul className="flex flex-col gap-2">
                {inStage.map((lead) => {
                  const requestId = requestIds[lead.id];
                  if (!requestId) {
                    throw new Error("Pipeline decision request ID is missing.");
                  }
                  return (
                    <li key={lead.id}>
                      <LeadCard
                        lead={lead}
                        terminal={stage.terminal}
                        workflowStages={workflowStages}
                        ownerOptions={ownerOptions}
                        ownerOptionsHaveMore={ownerOptionsHaveMore}
                        actorRole={actorRole}
                        actorMembershipId={actorMembershipId}
                        requestId={requestId}
                      />
                    </li>
                  );
                })}
                {inStage.length === 0 ? (
                  <li className="px-1 py-2 text-2xs text-fg-3">Пусто</li>
                ) : null}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
