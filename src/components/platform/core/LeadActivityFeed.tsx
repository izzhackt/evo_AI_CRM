import { btnCls, Card, EmptyState, cn, inputCls } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";

const ACT_CHIP: Record<string, { icon: IconName; cls: string }> = {
  wa: { icon: "message-circle", cls: "bg-ok-weak text-ok" },
  call: { icon: "phone", cls: "bg-info-weak text-info" },
  note: { icon: "message-square", cls: "bg-violet-weak text-violet" },
  status: { icon: "funnel", cls: "bg-accent-weak text-accent" },
};

export function LeadActivityFeed({
  activities,
  noteAction,
  leadId,
  labels,
}: {
  activities: { id: number; type: string; text: string; created_at: string; author_name: string | null }[];
  noteAction: (form: FormData) => void | Promise<void>;
  leadId: number;
  labels: {
    title: string;
    addNote: string;
    add: string;
    noResults: string;
    activityType: Record<string, string>;
    leadStatus: Record<string, string>;
  };
}) {
  return (
    <Card title={labels.title}>
      <form action={noteAction} className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="lead_id" value={leadId} />
        <input name="text" required placeholder={labels.addNote} className={inputCls} />
        <button type="submit" aria-label={labels.add} title={labels.add} className={cn(btnCls, "sm:w-12 sm:px-0")}>
          <Icon name="plus" size={16} />
        </button>
      </form>

      {activities.length === 0 ? (
        <EmptyState text={labels.noResults} />
      ) : (
        <ol className="space-y-3">
          {activities.map((activity) => {
            const chip = ACT_CHIP[activity.type] ?? { icon: "alert" as const, cls: "bg-surface-2 text-fg-2" };
            const body =
              activity.type === "status"
                ? labels.leadStatus[activity.text] ?? activity.text
                : activity.text;
            return (
              <li key={activity.id} className="flex gap-3 rounded-ctl border border-border bg-surface-2 px-3.5 py-3">
                <span aria-hidden="true" className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px]", chip.cls)}>
                  <Icon name={chip.icon} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] leading-6 text-fg">{body}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-fg-3">
                    <span>{labels.activityType[activity.type] ?? activity.type}</span>
                    <span>·</span>
                    <span>{activity.author_name ?? "—"}</span>
                    <span>·</span>
                    <span>{activity.created_at}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
