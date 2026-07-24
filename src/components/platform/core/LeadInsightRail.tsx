import Link from "next/link";
import { Badge, Card, btnCls, btnGhostCls, cn, inputCls } from "@/components/ui";
import { Icon } from "@/components/icons";

export function LeadInsightRail({
  sync,
  nextTask,
  taskAction,
  labels,
}: {
  sync: {
    stageLabel: string;
    managerName: string | null;
    source: string | null;
    updatedAt: string;
    channel: string | null;
    conversationHref?: string | null;
    draftReviewText?: string | null;
    draftReviewStatus?: string | null;
  };
  nextTask: {
    openTasks: number;
    overdueTasks: number;
    title: string | null;
    dueDate: string | null;
    leadId: number;
    assigneeId: number | null;
  };
  taskAction: (form: FormData) => void | Promise<void>;
  labels: {
    sourceOfTruthTitle: string;
    sourceOfTruthHint: string;
    syncStatus: string;
    stage: string;
    manager: string;
    source: string;
    updatedAt: string;
    lastChannel: string;
    whatsapp: string;
    nextTask: string;
    noNextTask: string;
    overdueTasks: string;
    add: string;
    addTask: string;
    priority: string;
    priorities: { value: string; label: string }[];
    draftReview: string;
    draftReviewNotSent: string;
    save: string;
    notAssigned: string;
    dueDate: string;
  };
}) {
  const taskSummary = nextTask.overdueTasks > 0
    ? `${labels.overdueTasks}: ${nextTask.overdueTasks}`
    : nextTask.openTasks === 0
      ? labels.noNextTask
      : `${nextTask.title ?? labels.nextTask} · ${nextTask.dueDate ?? "—"}`;

  return (
    <div className="space-y-5">
      <Card title={labels.sourceOfTruthTitle}>
        <div className="rounded-ctl border border-warn/25 bg-warn-weak/60 px-3.5 py-3">
          <div className="inline-flex min-h-6 items-center rounded-full bg-surface px-2.5 py-0.5 text-[11.5px] font-semibold text-warn">
            {labels.syncStatus}
          </div>
          <dl className="mt-3 space-y-2.5 text-[12.5px]">
            <div className="flex justify-between gap-3">
              <dt className="text-fg-3">{labels.stage}</dt>
              <dd className="text-right font-medium text-fg">{sync.stageLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-3">{labels.manager}</dt>
              <dd className="text-right text-fg">{sync.managerName ?? labels.notAssigned}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-3">{labels.source}</dt>
              <dd className="text-right text-fg">{sync.source ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-3">{labels.updatedAt}</dt>
              <dd className="text-right font-mono text-fg">{sync.updatedAt}</dd>
            </div>
          </dl>
          <p className="mt-3 text-[12px] leading-5 text-fg-3">
            {labels.sourceOfTruthHint}
          </p>
        </div>

        {(sync.channel || sync.draftReviewText || sync.conversationHref) && (
          <div className="mt-4 space-y-3">
            {sync.channel ? (
              <div className="rounded-ctl border border-border bg-surface-2 px-3.5 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">{labels.lastChannel}</div>
                <div className="mt-1.5 text-[13.5px] font-medium text-fg">{sync.channel}</div>
                {sync.conversationHref ? (
                  <Link href={sync.conversationHref} className={cn(btnGhostCls, "mt-3 h-10 text-[12px]")}>
                    <Icon name="message-circle" size={14} />
                    {labels.whatsapp}
                  </Link>
                ) : null}
              </div>
            ) : null}

            {sync.draftReviewText ? (
              <div className="rounded-ctl border border-border bg-surface-2 px-3.5 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">{labels.draftReview}</div>
                <div className="mt-1.5 text-[12.5px] leading-5 text-fg">{sync.draftReviewText}</div>
                <div className="mt-2">
                  <Badge
                    value="review"
                    label={sync.draftReviewStatus || labels.draftReviewNotSent}
                  />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <Card title={labels.nextTask}>
        <div className={cn(
          "mb-4 rounded-ctl px-3.5 py-3 text-[13px] font-medium",
          nextTask.overdueTasks > 0 ? "bg-danger-weak text-danger" : nextTask.openTasks === 0 ? "bg-warn-weak text-warn" : "bg-ok-weak text-ok",
        )}>
          {taskSummary}
        </div>
        <form action={taskAction} className="grid gap-2">
          <input type="hidden" name="lead_id" value={nextTask.leadId} />
          <input type="hidden" name="assignee_id" value={nextTask.assigneeId ?? ""} />
          <input name="title" required placeholder={labels.nextTask} className={inputCls} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input name="due_date" type="date" aria-label={labels.dueDate} className={cn(inputCls, "font-mono")} />
            <select name="priority" defaultValue="normal" aria-label={labels.priority} className={inputCls}>
              {labels.priorities.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={btnCls}>
            {labels.add}
          </button>
        </form>
      </Card>

    </div>
  );
}
