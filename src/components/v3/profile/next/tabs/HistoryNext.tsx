import Link from "next/link";

import { KeyFacts } from "@/components/kit/KeyFacts";
import { Button } from "@/components/ui/button";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";
import { eventLabel, journalEventText, role as roleWord, source as sourceWord, taskChangeField } from "@/lib/v3/wording";

import { caseMomentLabel } from "../../case-work-view";
import type { PersonProfile, ProfileEvent } from "../../types";
import { MoreSheet } from "../MoreSheet";
import { NamedCard } from "../NamedCard";

/** Сколько последних событий видно на странице: остальные уходят в панель «Ещё N». */
export const HISTORY_SHOWN = 10;

/** Название события словами; неизвестное событие — `null`, и строки нет: сырой ключ на экране не нужен. */
const historyLabel = (entry: ProfileEvent) => journalEventText(entry.transition, entry.directionChange) ?? eventLabel(entry.transition);

/** Событие журнала: название (ссылка, если есть куда), момент, что изменено и кто. */
function HistoryRow({ entry, label, today }: Readonly<{ entry: ProfileEvent; label: string; today: string }>) {
  const moment = entry.occurredAt && Number.isFinite(Date.parse(entry.occurredAt)) ? caseMomentLabel(entry.occurredAt, today) : entry.at;
  const changed = [...new Set((entry.changedFields ?? []).map(taskChangeField).filter(Boolean))].join(", ");
  const by = roleWord(entry.role);
  return (
    <li className="py-2.5 first:pt-0 last:pb-0" data-testid="v3-history-event">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {entry.href ? (
          <Link href={entry.href} className="inline-flex min-h-11 min-w-0 items-center t-body-compact text-fg underline underline-offset-4">{label}</Link>
        ) : <span className="min-w-0 t-body-compact text-fg">{label}</span>}
        {moment ? <span className="t-meta font-mono tabular-nums text-fg-3">{moment}</span> : null}
      </div>
      {changed || by ? <p className="t-meta text-fg-3">{[changed ? `Изменено: ${changed}` : null, by].filter(Boolean).join(" · ")}</p> : null}
    </li>
  );
}

/** Страницы журнала: те же адреса, что у прежней вкладки. */
function HistoryPager({ olderHref, latestHref }: Readonly<{ olderHref?: string | null; latestHref?: string | null }>) {
  if (!olderHref && !latestHref) return null;
  return (
    <nav aria-label="Страницы истории" className="flex flex-wrap gap-x-2 border-t border-border pt-1">
      {latestHref ? <Button asChild variant="ghost"><Link href={latestHref}>К последним событиям</Link></Button> : null}
      {olderHref ? <Button asChild variant="ghost"><Link href={olderHref}>Более ранние события</Link></Button> : null}
    </nav>
  );
}

/**
 * «История» дела в «Новом виде»: журнал — десять последних событий на странице, остальные в панели «Ещё N»; справа «Источник»
 * (откуда пришёл, когда появился, когда передан). Чтение и права те же (`profile.timeline`, `timelineForbidden`): нет доступа к журналу
 * - говорится словами, а не пустым списком. Прежняя вкладка (`History` в `tabs.tsx`) не тронута.
 */
export function HistoryNext({ profile }: Readonly<{ profile: PersonProfile }>) {
  const today = dayInOrganizationTimezone(new Date());
  const rows = profile.timeline.flatMap((entry) => {
    const label = historyLabel(entry);
    return label ? [<HistoryRow key={entry.id} entry={entry} label={label} today={today} />] : [];
  });
  const shown = rows.slice(0, HISTORY_SHOWN);
  const rest = rows.slice(HISTORY_SHOWN);
  const handoff = profile.handoff;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]" data-testid="v3-history">
      <NamedCard title="Что происходило" id="case-history" testId="v3-history-events">
        {profile.timelineForbidden ? (
          <p className="t-body-compact text-fg-2" data-testid="v3-history-forbidden">Нет доступа к журналу этого дела.</p>
        ) : rows.length === 0 ? (
          <p className="t-body-compact text-fg-3">Событий нет.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            <ol className="divide-y divide-border" data-testid="v3-history-list">{shown}</ol>
            {rest.length > 0 ? (
              <MoreSheet label={`Ещё ${rest.length}`} ariaLabel={`Ещё ${rest.length} в истории`} title="Что происходило" testId="v3-history-overflow">
                <ol className="divide-y divide-border" data-testid="v3-history-overflow-items">{rest}</ol>
              </MoreSheet>
            ) : null}
            <HistoryPager olderHref={profile.timelineOlderHref} latestHref={profile.timelineLatestHref} />
          </div>
        )}
        {profile.timelineForbidden ? <HistoryPager olderHref={profile.timelineOlderHref} latestHref={profile.timelineLatestHref} /> : null}
      </NamedCard>
      <NamedCard title="Источник" testId="v3-history-source">
        <KeyFacts
          columns={1}
          facts={[
            { label: "Откуда", value: sourceWord(profile.source) ?? "Не известно" },
            { label: "Появился", value: profile.arrived },
            { label: "Передан", value: handoff ? (handoff.override ? `${handoff.at} · с исключением из условий` : handoff.at) : null },
          ]}
        />
      </NamedCard>
    </div>
  );
}
