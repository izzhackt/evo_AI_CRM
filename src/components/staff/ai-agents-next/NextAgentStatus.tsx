import Link from "next/link";

import { StatusBadge } from "@/components/kit";
import { AI_AGENT_RUN_STATUS_LABELS, type AiAgentDetail } from "@/lib/ai-agents/contract";
import { aiAgentHref, formatDateTimeRu, pluralRu, runStatusTone } from "@/lib/v3/ai-agents-view";

/**
 * Строка под именем агента (14.11.2026, «UXUI ещё круче»): что с агентом сейчас, не открывая вкладок. Работает —
 * живая точка и ссылка на историю; иначе — когда был последний запуск и чем он кончился (чип словом). Не работал —
 * так и сказано. Включён ли агент, говорит переключатель справа, здесь это не повторяется.
 */
export function NextAgentStatus({ detail, now }: Readonly<{ detail: AiAgentDetail; now: string }>) {
  const { runsRunning, lastRunAt, lastRunStatus } = detail.stats;
  if (runsRunning > 0) {
    return (
      <span className="inline-flex items-center gap-2" data-testid="v3-aia-status">
        <span aria-hidden="true" className="size-2 shrink-0 animate-pulse rounded-full bg-ok motion-reduce:animate-none" />
        <Link href={aiAgentHref(detail.key, { tab: "runs" })} className="text-fg underline underline-offset-4">
          Работает: {runsRunning} {pluralRu(runsRunning, ["поручение", "поручения", "поручений"])}
        </Link>
      </span>
    );
  }
  if (lastRunAt === null) return <span data-testid="v3-aia-status">Ещё не запускался</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="v3-aia-status">
      <span>Последний запуск {formatDateTimeRu(lastRunAt, now)}</span>
      {lastRunStatus ? <StatusBadge label={AI_AGENT_RUN_STATUS_LABELS[lastRunStatus]} tone={runStatusTone(lastRunStatus)} /> : null}
    </span>
  );
}
