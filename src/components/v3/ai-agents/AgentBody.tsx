import Link from "next/link";

import { AI_AGENT_DEFAULTS, AI_AGENT_PREAMBLE } from "@/content/ai-agents";
import { AI_AGENT_MODELS, type AiAgentDetail, type AiAgentDigestsListResult, type AiAgentDraftsListResult, type AiAgentRunGetResult, type AiAgentRunRow, type AiAgentRunsListResult } from "@/lib/ai-agents/contract";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { QueueViewTabs } from "@/components/v3/queue/QueueViewTabs";
import {
  AI_AGENT_STARTERS,
  AI_AGENT_TABS,
  aiAgentConsoleRestore,
  aiAgentHref,
  aiAgentIsRunnable,
  aiAgentStateChip,
  aiAgentSyncProblemText,
  describeSchedule,
  formatDateTimeRu,
  type AiAgentTab,
} from "@/lib/v3/ai-agents-view";

import { AgentSwitches } from "./AgentSwitches";
import { Console } from "./Console";
import { DraftsTab } from "./DraftsTab";
import { InstructionsEditor } from "./InstructionsEditor";
import { ApiKeyMissingLine, InfoLine, NotReady, PreviewLine, Unavailable } from "./Notices";
import { OverviewTab } from "./OverviewTab";
import { RunDetail, RunsList } from "./RunsTab";
import { SettingsForm } from "./SettingsForm";
import { SyncNowButton, SyncPanel } from "./SyncPanel";

/** Чтение вкладки: данные или слово, почему их нет. */
export type TabRead<T> =
  | Readonly<{ status: "available"; data: T }>
  | Readonly<{ status: "not_ready" | "denied" | "missing" | "unavailable" }>;

export type AgentBodyProps = Readonly<{
  detail: AiAgentDetail;
  tab: AiAgentTab;
  now: string;
  /** Системный администратор вне просмотра роли: правит настройки. */
  canEdit: boolean;
  /** `ai.agent.manage`: решает по черновикам, может поручать отправку без черновика. */
  canManage: boolean;
  preview: boolean;
  runtimeConfigured: boolean;
  needsSync: boolean;
  digests: TabRead<AiAgentDigestsListResult> | null;
  runs: TabRead<AiAgentRunsListResult> | null;
  runsLimit: number;
  run: TabRead<AiAgentRunGetResult> | null;
  runId: string | null;
  drafts: TabRead<AiAgentDraftsListResult> | null;
  draftsFilter: "pending" | "all";
  /**
   * Разговор, который вкладка «Поручить» восстанавливает при открытии; `run` — его строка из базы
   * (статус, поручение, итог), по ней серверная разметка сразу говорит правду о ходе работы.
   */
  resume: Readonly<{ runId: string | null; sendAuthority: boolean; run?: AiAgentRunRow | null }>;
}>;

function tabFailure(read: TabRead<unknown>, what: string, retryHref: string) {
  if (read.status === "not_ready") return <NotReady />;
  return <Unavailable what={what} retryHref={retryHref} denied={read.status === "denied"} />;
}

/** Содержимое страницы агента под шапкой: полоса состояния, плашки, вкладки и выбранная вкладка. */
export function AgentBody(props: AgentBodyProps) {
  const { detail, tab, now, canEdit, canManage, preview, runtimeConfigured, needsSync } = props;
  const defaults = AI_AGENT_DEFAULTS[detail.key];
  const hasInstructions = detail.hasInstructionsOverride || defaults.hasInstructions;
  const state = aiAgentStateChip({ enabled: detail.enabled, hasInstructions, syncStatus: detail.sync.status, needsSync });
  const model = AI_AGENT_MODELS.find((one) => one.id === detail.model)?.label ?? detail.model;
  // Запуск разрешён и при неудавшейся повторной синхронизации, если у агента есть рабочая настройка (миграция 318).
  const synced = aiAgentIsRunnable(detail.sync);
  const syncProblem = detail.enabled ? aiAgentSyncProblemText(detail.sync) : null;
  // Директору поручает только системный администратор (его инструменты читают данные организации целиком).
  const directorLocked = detail.key === "director" && !canEdit;
  const canRun = !preview && !directorLocked && runtimeConfigured && hasInstructions && detail.enabled && synced;
  const here = (target: AiAgentTab) => aiAgentHref(detail.key, { tab: target });

  const blockedNote = preview ? "В просмотре роли писать агенту нельзя."
    : directorLocked ? "Директору поручает только системный администратор: он читает данные организации целиком."
    : !runtimeConfigured ? "Ключ Claude API не задан в CRM — его добавляет администратор."
      : !hasInstructions ? "Инструкции пока нет: без неё агента нельзя включить."
        : !detail.enabled ? "Агент выключен. Включает его системный администратор переключателем «Включён» в шапке страницы."
          : !synced ? "Агент ещё не синхронизирован с Claude: администратор нажимает «Синхронизировать с Claude»."
            : null;
  const syncSlot = canEdit && runtimeConfigured && hasInstructions && detail.enabled && !synced
    ? <SyncNowButton agentKey={detail.key} disabled={false} />
    : null;

  const effectiveInstructions = detail.instructionsOverride?.trim() ? detail.instructionsOverride : defaults.instructions;

  let content;
  switch (tab) {
    case "overview": {
      const digests = props.digests;
      content = <OverviewTab detail={detail} digests={digests?.status === "available" ? digests.data.digests : []} now={now} />;
      break;
    }
    case "command":
      content = (
        <Console
          // Ключ — только явный `?run=`: перерисовка страницы сервером (после «Синхронизировать», записи
          // настроек и т. п.) не должна пересоздавать вкладку и стирать набранное и ход разговора.
          key={props.runId ?? "conversation"}
          agentKey={detail.key}
          agentTitle={detail.title}
          autoSend={detail.autoSend}
          canRun={canRun}
          blockedNote={blockedNote}
          canDirect={canManage && !preview}
          initialRunId={canRun ? props.resume.runId : null}
          initialRunAuthority={props.resume.sendAuthority}
          restore={canRun && props.resume.runId && props.resume.run ? aiAgentConsoleRestore(props.resume.run) : null}
          starters={AI_AGENT_STARTERS[detail.key]}
          syncSlot={syncSlot}
        />
      );
      break;
    case "runs": {
      const retry = aiAgentHref(detail.key, { tab: "runs", run: props.runId });
      if (props.runId) {
        const read = props.run;
        content = !read ? null
          : read.status === "available" ? <RunDetail agentKey={detail.key} agentTitle={detail.title} data={read.data} now={now} />
            : read.status === "missing" ? (
              <p className="t-body-compact text-fg-2" data-testid="v3-aia-run-missing">
                Такого запуска нет. <Link href={here("runs")} className="text-fg underline underline-offset-4">Все запуски</Link>
              </p>
            )
              : tabFailure(read, "запуск", retry);
      } else {
        const read = props.runs;
        content = !read ? null
          : read.status === "available" ? <RunsList agentKey={detail.key} runs={read.data.runs.slice(0, props.runsLimit)} hasMore={read.data.hasMore || read.data.runs.length > props.runsLimit} limit={props.runsLimit} now={now} />
            : tabFailure(read, "запуски", retry);
      }
      break;
    }
    case "drafts": {
      const read = props.drafts;
      content = !read ? null
        : read.status === "available"
          ? <DraftsTab agentKey={detail.key} drafts={read.data.drafts} counts={read.data.counts} filter={props.draftsFilter} canManage={canManage && !preview} now={now} />
          : tabFailure(read, "черновики", aiAgentHref(detail.key, { tab: "drafts", show: props.draftsFilter === "all" ? "all" : null }));
      break;
    }
    case "instructions":
      content = (
        <InstructionsEditor
          agentKey={detail.key}
          configVersion={detail.configVersion}
          current={effectiveInstructions}
          isOverride={Boolean(detail.instructionsOverride?.trim())}
          defaultText={defaults.instructions}
          preamble={AI_AGENT_PREAMBLE}
          canEdit={canEdit}
          runtimeConfigured={runtimeConfigured}
        />
      );
      break;
    case "settings":
      content = (
        <div className="space-y-6">
          <section className="rounded-card border border-border bg-surface px-4" aria-label="Переключатели агента">
            <AgentSwitches
              agentKey={detail.key}
              enabled={detail.enabled}
              autoSend={detail.autoSend}
              configVersion={detail.configVersion}
              hasInstructions={hasInstructions}
              canEdit={canEdit}
              variant="settings"
            />
          </section>
          <SettingsForm
            detail={detail}
            defaultSchedulePrompt={defaults.schedulePrompt}
            canEdit={canEdit}
            canRunNow={canRun}
            runNowNote={blockedNote}
          />
          <SyncPanel agentKey={detail.key} sync={detail.sync} needsSync={needsSync} runtimeConfigured={runtimeConfigured} canEdit={canEdit && !preview} now={now} />
        </div>
      );
      break;
  }

  return (
    <div className="space-y-4" data-testid="v3-aia-agent" data-tab={tab}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="v3-aia-state-strip">
        <StatusChip label={state.label} tone={state.tone} />
        <StatusChip label={detail.autoSend ? "Авто: вкл" : "Авто: выкл"} tone={detail.autoSend ? "warn" : "neutral"} />
        <span className="t-meta text-fg-3">{model}</span>
        <span className="t-meta text-fg-3">{describeSchedule(detail.scheduleCron, detail.scheduleTz)}</span>
        {detail.sync.status === "ok" && detail.sync.syncedAt ? <span className="t-meta text-fg-3">Синхронизирован {formatDateTimeRu(detail.sync.syncedAt, now)}</span> : null}
      </div>

      {preview ? <PreviewLine /> : null}
      {runtimeConfigured ? null : <ApiKeyMissingLine />}
      {syncProblem ? (
        <div className="space-y-2" data-testid="v3-aia-sync-error">
          <InfoLine tone="warn" role="alert">{syncProblem}</InfoLine>
          {canEdit && runtimeConfigured && tab !== "settings" ? <SyncNowButton agentKey={detail.key} disabled={false} label="Повторить синхронизацию" /> : null}
        </div>
      ) : needsSync ? (
        <div className="space-y-2" data-testid="v3-aia-needs-sync">
          <InfoLine tone="warn" role="status">Изменения не отправлены в Claude — агент работает по прежним настройкам.</InfoLine>
          {canEdit && runtimeConfigured && tab !== "settings" ? <SyncNowButton agentKey={detail.key} disabled={false} /> : null}
        </div>
      ) : null}

      <QueueViewTabs
        label={`Разделы агента «${detail.title}»`}
        tabs={AI_AGENT_TABS.map((one) => ({
          key: one.key,
          label: one.label,
          count: one.key === "drafts" && detail.stats.draftsPending > 0 ? detail.stats.draftsPending : null,
          current: one.key === tab,
          href: here(one.key),
        }))}
      />
      <div>{content}</div>
    </div>
  );
}
