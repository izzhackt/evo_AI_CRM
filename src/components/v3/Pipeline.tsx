import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import Link from "next/link";

import { PipelineStageViewport } from "@/components/v3/PipelineStageViewport";
import { Pill } from "@/components/v3/Pill";
import { PipelineDecisionForm } from "@/components/v3/PipelineDecisionForm";
import type {
  PlatformSalesOwnerOption,
  PlatformSalesStage,
  PlatformSalesWorkflowLead,
} from "@/lib/platform-sales-contract";
import type { PlatformSalesLeadLatestNote } from "@/lib/platform-sales";

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
  stageAgeDays: number | null;
  latestNote: PlatformSalesLeadLatestNote | null;
  href: string;
  workflow: PlatformSalesWorkflowLead;
}>;

/**
 * Терминальная колонка копится вечно, поэтому свёрнутой она показывает только
 * последние карточки: строки приходят от RPC новыми вперёд, срез честен.
 */
const HANDED_VISIBLE_LIMIT = 20;

const DUE_MARK: Record<PipelineLead["due"], { tone: string; label: string } | null> = {
  overdue: { tone: "bg-danger", label: "срок прошёл" },
  today: { tone: "bg-warn", label: "срок сегодня" },
  later: null,
  none: { tone: "bg-control-edge", label: "следующее действие не назначено" },
};

const NOTE_TIME = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bishkek",
});

function stageAgeCopy(days: number): string {
  if (days === 0) return "На стадии сегодня";
  const modulo100 = days % 100;
  const modulo10 = days % 10;
  const unit = modulo100 >= 11 && modulo100 <= 14
    ? "дней"
    : modulo10 === 1
      ? "день"
      : modulo10 >= 2 && modulo10 <= 4
        ? "дня"
        : "дней";
  return `На стадии ${days} ${unit}`;
}

function LeadCard({
  lead,
  terminal,
  workflowStages,
  ownerOptions,
  ownerOptionsHaveMore,
  actor,
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
  actor: ActivePlatformActor;
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
            <span className="t-meta mt-0.5 block truncate text-fg-2">
              {lead.nextAction}
            </span>
          ) : null}
          {lead.nextActionAt ? (
            <span className="t-meta mt-0.5 block truncate text-fg-3">
              {lead.nextActionAt}
            </span>
          ) : null}
          {!terminal && lead.stageAgeDays !== null ? (
            <span className="t-meta mt-0.5 block text-fg-3">
              {stageAgeCopy(lead.stageAgeDays)}
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

      {lead.latestNote ? (
        <div
          className="mt-2 rounded-ctl border border-border bg-bg px-2.5 py-2"
        >
          <p className="t-meta line-clamp-2 whitespace-pre-wrap break-words text-fg-2">
            {lead.latestNote.body}
          </p>
          <p className="t-meta mt-1 truncate text-fg-3">
            {lead.latestNote.authorDisplayName}
            {" · "}
            <time dateTime={lead.latestNote.createdAt}>
              {NOTE_TIME.format(new Date(lead.latestNote.createdAt))}
            </time>
          </p>
        </div>
      ) : null}

      {!isStaffPreview(actor) && staffHasPermission(actor, "staff.task.read")
        ? <Link href={`/v3/tasks?lead=${lead.workflow.leadId}&create=staff`} className="mt-2 inline-flex min-h-11 items-center text-xs text-accent-text underline underline-offset-2">Задачи по лиду</Link>
        : <p className="mt-2 text-xs text-fg-2">Для связанных задач сначала назначьте ответственного.</p>}
      {!terminal && !isStaffPreview(actor) && staffHasPermission(actor, "lead.sales.workflow.manage") ? (
        <PipelineDecisionForm
          key={`${lead.workflow.leadId}:${lead.workflow.workflowVersion}`}
          lead={lead.workflow}
          stages={workflowStages}
          ownerOptions={ownerOptions}
          ownerOptionsHaveMore={ownerOptionsHaveMore}
          actor={actor}
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
  actor,
  actorMembershipId,
  requestIds,
  handedExpanded,
  handedShowAllHref,
  handedShowLatestHref,
  filteredStage,
  allStagesHref,
  truncated,
}: {
  stages: readonly PipelineStage[];
  leads: readonly PipelineLead[];
  ownerOptions: readonly PlatformSalesOwnerOption[];
  ownerOptionsHaveMore: boolean;
  actor: ActivePlatformActor;
  actorMembershipId: string;
  requestIds: Readonly<Record<string, string>>;
  handedExpanded: boolean;
  handedShowAllHref: string;
  handedShowLatestHref: string;
  filteredStage: PipelineStageKey | "all";
  allStagesHref: string;
  truncated: boolean;
}) {
  const workflowStages = stages.flatMap((stage) =>
    stage.key === "handed_off"
      ? []
      : [{ key: stage.key, title: stage.title }],
  );

  return (
    <PipelineStageViewport
      filteredStage={filteredStage}
      allStagesHref={allStagesHref}
      truncated={truncated}
      panels={stages.map((stage) => {
          const inStage = leads.filter((lead) => lead.stageKey === stage.key);
          const visible =
            stage.terminal && !handedExpanded
              ? inStage.slice(0, HANDED_VISIBLE_LIMIT)
              : inStage;
          return {
            key: stage.key,
            title: stage.title,
            count: inStage.length,
            content: (
              <div
                role="group"
                aria-label={`Стадия «${stage.title}»`}
                tabIndex={0}
                className="flex flex-col rounded-card @2xl:max-h-[70dvh] @2xl:overflow-y-auto"
              >
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-surface-2 px-3.5 pb-2 pt-3">
                  <h3 className="t-item flex min-w-0 items-center gap-1.5 text-fg">
                    <span className="truncate">{stage.title}</span>
                    {stage.gate ? <Pill tone="solid">Есть условия</Pill> : null}
                  </h3>
                  <span className="t-meta shrink-0 tabular-nums text-fg-3">
                    {inStage.length}
                  </span>
                </div>

                <ul className="flex flex-col gap-2 px-2.5 pb-2.5">
                  {visible.map((lead) => {
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
                          actor={actor}
                          actorMembershipId={actorMembershipId}
                          requestId={requestId}
                        />
                      </li>
                    );
                  })}
                  {inStage.length === 0 ? (
                    <li className="t-meta px-1 py-2 text-fg-3">Пусто</li>
                  ) : null}
                  {stage.terminal && visible.length < inStage.length ? (
                    <li>
                      <Link
                        href={handedShowAllHref}
                        prefetch={false}
                        className="flex min-h-6 items-center px-1 t-item text-fg-2 underline underline-offset-4 hover:text-fg"
                      >
                        Показать все {inStage.length}
                      </Link>
                    </li>
                  ) : null}
                  {stage.terminal &&
                  handedExpanded &&
                  inStage.length > HANDED_VISIBLE_LIMIT ? (
                    <li>
                      <Link
                        href={handedShowLatestHref}
                        prefetch={false}
                        className="flex min-h-6 items-center px-1 t-item text-fg-2 underline underline-offset-4 hover:text-fg"
                      >
                        Показать последние {HANDED_VISIBLE_LIMIT}
                      </Link>
                    </li>
                  ) : null}
                </ul>
              </div>
            ),
          };
        })}
    />
  );
}
