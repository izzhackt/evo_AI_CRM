import { StatusBadge, type StatusTone } from "@/components/kit/StatusBadge";
import { applicationStatus } from "@/lib/v3/wording";

import { formatQueueDay } from "../../queue/due-bucket";
import type { CaseOverviewInput } from "../CaseOverview";

const APPLICATION_TONE: Readonly<Record<string, StatusTone>> = { ready: "ok", submitted: "info", accepted: "ok", rejected: "danger" };

/** Заявки дела: вуз и программа, состояние словом, срок подачи. Пусто - «пока нет». */
export function ApplicationsValue({ input }: Readonly<{ input: CaseOverviewInput }>) {
  if (input.applications.length === 0) return <span className="text-fg-2">пока нет</span>;
  return (
    <ul className="divide-y divide-border" data-testid="v3-case-applications">
      {input.applications.map((application) => (
        <li key={application.id} className="grid gap-1 py-2 first:pt-0 last:pb-0">
          <span className="break-words font-medium text-fg">{application.title}{application.primary ? " · основной" : ""}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusBadge label={applicationStatus(application.status) ?? "статус не указан"} tone={APPLICATION_TONE[application.status] ?? "neutral"} />
            {application.deadlineOn ? (
              <span className="t-meta text-fg-2">срок <time dateTime={application.deadlineOn} className="font-mono tabular-nums">{formatQueueDay(application.deadlineOn, input.work.today)}</time></span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

