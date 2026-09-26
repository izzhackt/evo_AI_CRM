import Link from "next/link";

import type { ClosedLeadRow } from "@/lib/platform-closure-contract";
import { leadStage } from "@/lib/v3/wording";

import { ClosedLine } from "./Closure";

/**
 * Lead 360 закрытого лида (`/v3/profile?id=…`, миграция 246). Детальное
 * чтение 093 отдаёт только открытые лиды, поэтому закрытый показывается
 * тихо: имя, «Закрыт · причина · дата · Вернуть в работу» и то, на каком
 * этапе он остановился. После возврата страница перечитывается и снова
 * показывает обычную карточку лида на прежнем этапе.
 */
export function ClosedLeadView({
  row,
  backHref,
  backLabel,
  readOnly,
}: Readonly<{
  row: ClosedLeadRow;
  backHref: string;
  backLabel: string;
  /** Просмотр роли: без «Вернуть в работу». */
  readOnly: boolean;
}>) {
  const word = leadStage(row.stageKey);
  const stage = word ? word.charAt(0).toUpperCase() + word.slice(1) : null;
  return (
    <div className="space-y-4" data-testid="v3-lead-closed" data-lead-id={row.leadId}>
      <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline" href={backHref}>
        {backLabel}
      </Link>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="t-record-title min-w-0 break-words text-fg">{row.name ?? "Лид без имени"}</h2>
        <p className="text-sm text-fg-3">Лид</p>
      </header>
      <ClosedLine
        kind="lead"
        subjectId={row.leadId}
        expectedVersion={row.workflowVersion}
        reasonKey={row.reason}
        note={row.note}
        closedAt={row.closedAt}
        canReopen={row.canManage && !readOnly}
        className="border-y border-border py-1"
      />
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 t-body-compact text-fg">
        {stage ? (<><dt className="t-caption pt-0.5 text-fg-2">Этап</dt><dd>{stage}</dd></>) : null}
        <dt className="t-caption pt-0.5 text-fg-2">Ответственный</dt>
        <dd className={row.ownerName ? undefined : "text-fg-3"}>{row.ownerName ?? "Не назначен"}</dd>
        {row.closedByName ? (<><dt className="t-caption pt-0.5 text-fg-2">Закрыл</dt><dd>{row.closedByName}</dd></>) : null}
      </dl>
    </div>
  );
}
