import Link from "next/link";

import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import {
  AI_AGENT_DRAFT_CHANNEL_LABELS,
  AI_AGENT_RUN_STATUS_LABELS,
  AI_AGENT_TOOL_LABELS,
  AI_AGENT_TRIGGER_LABELS,
  type AiAgentKey,
  type AiAgentRunGetResult,
  type AiAgentRunRow,
} from "@/lib/ai-agents/contract";
import {
  AI_AGENT_RUNS_MAX,
  AI_AGENT_RUNS_STEP,
  actionArgsWords,
  aiAgentHref,
  draftStatusWords,
  draftTargetHref,
  durationWords,
  formatClockRu,
  formatDateTimeRu,
  formatUsdCents,
  plainPreview,
  pluralRu,
  runErrorWords,
  runOriginLabel,
  runStatusTone,
  toolErrorWords,
} from "@/lib/v3/ai-agents-view";

import { Markdown } from "./Markdown";
import { RunActions } from "./RunActions";
import { TranscriptLoader } from "./TranscriptLoader";

/**
 * Список «Запусков» (контракт §D.4, п. 3): строка — ссылка на хронику запуска. В строке:
 * когда, слово состояния и кто запустил; что поручили и чем кончилось — простым текстом
 * (разметка Markdown снята), без обрезанной третьей строки.
 */
export function RunsList({
  agentKey,
  runs,
  hasMore,
  limit,
  now,
  viewerName,
  canRun = false,
}: Readonly<{ agentKey: AiAgentKey; runs: readonly AiAgentRunRow[]; hasMore: boolean; limit: number; now: string; viewerName?: string; canRun?: boolean }>) {
  if (runs.length === 0) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-5 py-4" data-testid="v3-aia-runs-empty" aria-labelledby="aia-runs-empty">
        <h2 id="aia-runs-empty" className="t-section text-fg">Запусков ещё не было</h2>
        {canRun ? <Link href={aiAgentHref(agentKey, { tab: "command" })} className={QUEUE_SECONDARY}>Поручить</Link> : null}
      </section>
    );
  }
  const nextLimit = Math.min(AI_AGENT_RUNS_MAX, limit + AI_AGENT_RUNS_STEP);
  return (
    <section aria-labelledby="aia-runs" data-testid="v3-aia-runs">
      <h2 id="aia-runs" className="sr-only">Запуски агента</h2>
      <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
        {runs.map((run) => {
          const prompt = plainPreview(run.promptPreview, 160);
          const outcome = run.status === "failed" ? runErrorWords(run.errorCode, run.errorMessage) : plainPreview(run.summary, 220);
          const primary = prompt || outcome;
          const secondary = prompt ? outcome : "";
          return (
            <li key={run.id}>
              <Link
                href={aiAgentHref(agentKey, { tab: "runs", run: run.id })}
                className="grid gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-surface-2/60 motion-reduce:transition-none @3xl:grid-cols-[13rem_minmax(0,1fr)_9rem]"
                data-testid="v3-aia-run-row"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="t-label tabular-nums text-fg">{formatDateTimeRu(run.startedAt, now)}</span>
                    <StatusChip label={AI_AGENT_RUN_STATUS_LABELS[run.status]} tone={runStatusTone(run.status)} />
                  </span>
                  <span className="mt-0.5 block t-meta text-fg-3">{runOriginLabel(run, viewerName)}</span>
                </span>
                {/* `self-start`: ячейка не растягивается по высоте строки, и под многоточием не торчит кусок третьей строки. */}
                <span className="min-w-0 self-start">
                  <span className="line-clamp-1 break-words t-body-compact text-fg">{primary || "—"}</span>
                  {secondary ? <span className="mt-0.5 line-clamp-2 break-words t-body-compact text-fg-2">{secondary}</span> : null}
                </span>
                <span className="t-meta tabular-nums text-fg-3 @3xl:text-end">
                  {durationWords(run.durationSeconds)} · {formatUsdCents(run.costCents)}
                  <span className="block">
                    {run.actionsCount} {pluralRu(run.actionsCount, ["действие", "действия", "действий"])}
                    {run.draftsCount > 0 ? ` · ${run.draftsCount} ${pluralRu(run.draftsCount, ["черновик", "черновика", "черновиков"])}` : ""}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {hasMore && limit < AI_AGENT_RUNS_MAX ? (
        <p className="mt-3">
          <Link href={aiAgentHref(agentKey, { tab: "runs", limit: nextLimit })} scroll={false} className={QUEUE_SECONDARY}>
            Показать ещё
          </Link>
        </p>
      ) : null}
    </section>
  );
}

const RESULT_WORDS = { ok: "готово", error: "ошибка", denied: "отказано" } as const;
/** Столько действий показываются без собственной прокрутки внутри карточки. */
const ACTIONS_SCROLL_FROM = 15;

/**
 * Хроника одного запуска: одна строка фактов, поручение и итог сразу под ней, действия над
 * запуском, причина ошибки словами, действия агента (неудавшиеся — выше), черновики и
 * переписка по кнопке. Модель и токены — под «Технические данные».
 */
export function RunDetail({
  agentKey,
  agentTitle,
  data,
  now,
  viewerName,
  canAct = false,
  canRun = false,
}: Readonly<{ agentKey: AiAgentKey; agentTitle: string; data: AiAgentRunGetResult; now: string; viewerName?: string; canAct?: boolean; canRun?: boolean }>) {
  const { run, actions, drafts } = data;
  const origin = runOriginLabel(run, viewerName);
  const ownCommand = run.triggerKind === "command" && origin === "Вы";
  const failedActions = actions.filter((action) => action.resultStatus !== "ok").length;
  const ordered = [...actions].sort((a, b) => Number(b.resultStatus !== "ok") - Number(a.resultStatus !== "ok"));
  const resultCell = (action: (typeof actions)[number]) => (
    <>
      {RESULT_WORDS[action.resultStatus]}
      {action.errorCode ? ` · ${toolErrorWords(action.errorCode)}` : ""}
    </>
  );
  return (
    <div className="space-y-4" data-testid="v3-aia-run-detail">
      <section aria-labelledby="aia-run-title" className="rounded-card border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="aia-run-title" className="t-section text-fg">{run.triggerKind === "command" ? "Поручение" : AI_AGENT_TRIGGER_LABELS[run.triggerKind]}</h2>
          <StatusChip label={AI_AGENT_RUN_STATUS_LABELS[run.status]} tone={runStatusTone(run.status)} />
          {run.sendAuthority ? <StatusChip label="Отправка без черновика" tone="warn" /> : null}
        </div>
        <p className="mt-1 t-meta tabular-nums text-fg-3" data-testid="v3-aia-run-meta-line">
          {[formatDateTimeRu(run.startedAt, now), durationWords(run.durationSeconds), formatUsdCents(run.costCents), origin].join(" · ")}
        </p>
        {run.status === "completed" && failedActions > 0 ? (
          <p role="status" className="mt-2 t-body-compact text-warn" data-testid="v3-aia-run-partial">
            {failedActions} {pluralRu(failedActions, ["действие не выполнено", "действия не выполнены", "действий не выполнено"])}
          </p>
        ) : null}
        {run.status === "failed" || run.errorCode ? (
          <p role="alert" className="mt-3 rounded-card bg-danger-weak px-3 py-2 t-body-compact text-danger" data-testid="v3-aia-run-error">
            {runErrorWords(run.errorCode, run.errorMessage)}
          </p>
        ) : null}
        {run.promptPreview ? (
          <div className="mt-4">
            {run.triggerKind === "command" ? null : <p className="t-meta text-fg-3">Поручение</p>}
            <p className="whitespace-pre-wrap break-words t-body-compact text-fg">{run.promptPreview}</p>
          </div>
        ) : null}
        {run.summary ? (
          <div className="mt-4">
            <p className="mb-1 t-meta text-fg-3">Итог агента</p>
            <Markdown source={run.summary} />
          </div>
        ) : null}
        <RunActions agentKey={agentKey} run={run} ownCommand={ownCommand} canAct={canAct} canRun={canRun} />
        <details className="mt-3 border-t border-border pt-1">
          <summary className="flex min-h-11 cursor-pointer items-center t-label text-fg-2">Технические данные</summary>
          <dl className="grid gap-x-8 gap-y-2 pb-2 @2xl:grid-cols-2">
            <div className="min-w-0">
              <dt className="t-meta text-fg-3">Модель</dt>
              <dd className="break-words t-body-compact text-fg">{run.model ?? "—"}{run.agentVersion !== null ? ` · версия ${run.agentVersion}` : ""}</dd>
            </div>
            <div className="min-w-0">
              <dt className="t-meta text-fg-3">Токены</dt>
              <dd className="break-words t-body-compact tabular-nums text-fg">
                {`вход ${run.inputTokens.toLocaleString("ru-RU")} · выход ${run.outputTokens.toLocaleString("ru-RU")}${run.cacheReadTokens > 0 ? ` · из кэша ${run.cacheReadTokens.toLocaleString("ru-RU")}` : ""}`}
              </dd>
            </div>
          </dl>
        </details>
      </section>

      <section aria-labelledby="aia-run-actions" className="rounded-card border border-border bg-surface p-4">
        <h3 id="aia-run-actions" className="t-section text-fg">
          Действия агента <span className="font-normal tabular-nums text-fg-3">{actions.length}{failedActions > 0 ? ` · ${failedActions} с ошибкой` : ""}</span>
        </h3>
        {actions.length === 0 ? (
          <p className="mt-2 t-body-compact text-fg-2">В этом запуске агент не вызывал инструменты.</p>
        ) : (
          <>
            <div className={`mt-2 hidden overflow-auto rounded-nav border border-border @2xl:block ${actions.length > ACTIONS_SCROLL_FROM ? "max-h-96" : ""}`}>
              <table className="w-full t-body-compact">
                <thead>
                  <tr className="border-b border-border text-fg-2">
                    <th scope="col" className="px-3 py-2 text-start font-medium">Время</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">Инструмент</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">Запрос</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">Итог</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((action) => (
                    <tr key={action.id} className="border-b border-border last:border-b-0">
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-fg-3">{formatClockRu(action.at, run.startedAt)}</td>
                      <td className="px-3 py-1.5 text-fg">{AI_AGENT_TOOL_LABELS[action.tool] ?? action.tool}</td>
                      <td className="max-w-[18rem] break-words px-3 py-1.5 text-fg-2">{actionArgsWords(action.argsSummary) || "—"}</td>
                      <td className={`whitespace-nowrap px-3 py-1.5 ${action.resultStatus === "ok" ? "text-fg-2" : "text-danger"}`}>{resultCell(action)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Узкий экран: список вместо таблицы — без прокрутки в двух направлениях внутри карточки. */}
            <ul className="mt-2 divide-y divide-border @2xl:hidden">
              {ordered.map((action) => (
                <li key={action.id} className="py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="t-body-compact text-fg">{AI_AGENT_TOOL_LABELS[action.tool] ?? action.tool}</span>
                    <span className={`t-meta ${action.resultStatus === "ok" ? "text-fg-3" : "text-danger"}`}>{resultCell(action)}</span>
                  </div>
                  <p className="t-meta tabular-nums text-fg-3">{formatClockRu(action.at, run.startedAt)}</p>
                  {actionArgsWords(action.argsSummary) ? <p className="break-words t-meta text-fg-2">{actionArgsWords(action.argsSummary)}</p> : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {drafts.length > 0 ? (
        <section aria-labelledby="aia-run-drafts" className="rounded-card border border-border bg-surface p-4">
          <h3 id="aia-run-drafts" className="t-section text-fg">Черновики этого запуска <span className="font-normal tabular-nums text-fg-3">{drafts.length}</span></h3>
          <ul className="mt-2 divide-y divide-border">
            {drafts.map((draft) => {
              const words = draftStatusWords(draft);
              const href = draftTargetHref(draft);
              return (
                <li key={draft.id} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip label={words.label} tone={words.tone} />
                    <span className="t-label text-fg">{AI_AGENT_DRAFT_CHANNEL_LABELS[draft.channel]}</span>
                    {draft.targetLabel ? (href ? <Link href={href} className="t-label text-fg underline underline-offset-4">{draft.targetLabel}</Link> : <span className="t-label text-fg-2">{draft.targetLabel}</span>) : null}
                  </div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words t-body-compact text-fg-2">{draft.editedText ?? draft.text}</p>
                  {words.note ? <p className="mt-0.5 t-meta text-fg-3">{words.note}</p> : null}
                </li>
              );
            })}
          </ul>
          <p className="mt-2"><Link href={aiAgentHref(agentKey, { tab: "drafts", show: "all" })} className="t-label text-fg underline underline-offset-4">Все черновики агента</Link></p>
        </section>
      ) : null}

      {run.sessionId ? <TranscriptLoader runId={run.id} agentTitle={agentTitle} /> : null}
    </div>
  );
}
