import Link from "next/link";

import { Pill } from "@/components/v3/Pill";

/**
 * Read-only V3 sales board over the canonical Supabase projection.
 *
 * Issue #595 owns the real atomic workflow form. Until that server action is
 * wired, this component must never imitate a stage change in browser state.
 */
export type PipelineStage = Readonly<{
  key: string;
  title: string;
  gate: boolean;
  terminal: boolean;
}>;

export type PipelineLead = Readonly<{
  id: string;
  name: string;
  stageKey: string;
  source: string;
  nextAction: string | null;
  nextActionAt: string | null;
  due: "overdue" | "today" | "later" | "none";
  href: string;
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
}: {
  lead: PipelineLead;
  terminal: boolean;
}) {
  const mark = terminal && lead.due === "none" ? null : DUE_MARK[lead.due];

  return (
    <article className="relative rounded-ctl border border-border bg-surface px-3 py-2.5 hover:border-control-edge">
      <div className="flex items-start gap-1.5">
        <p className="min-w-0 flex-1">
          <Link
            href={lead.href}
            prefetch={false}
            className="flex min-h-6 items-center text-sm font-semibold leading-5 text-fg after:absolute after:inset-0 after:content-['']"
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
    </article>
  );
}

export function Pipeline({
  stages,
  leads,
}: {
  stages: readonly PipelineStage[];
  leads: readonly PipelineLead[];
}) {
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
                {inStage.map((lead) => (
                  <li key={lead.id}>
                    <LeadCard lead={lead} terminal={stage.terminal} />
                  </li>
                ))}
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
