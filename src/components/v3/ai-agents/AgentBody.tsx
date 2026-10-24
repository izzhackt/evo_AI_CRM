import Link from "next/link";

import { AI_AGENT_DEFAULTS, AI_AGENT_PREAMBLE } from "@/content/ai-agents";
import { type AiAgentDetail, type AiAgentDigestsListResult, type AiAgentDraftsListResult, type AiAgentRunGetResult, type AiAgentRunsListResult } from "@/lib/ai-agents/contract";
import { QueueViewTabs } from "@/components/v3/queue/QueueViewTabs";
import {
  AI_AGENT_STARTERS,
  AI_AGENT_TABS,
  aiAgentHref,
  aiAgentIsRunnable,
  aiAgentNextStep,
  aiAgentSyncProblemText,
  type AiAgentConversationRow,
  type AiAgentTab,
} from "@/lib/v3/ai-agents-view";

import { AgentSetup, SetupAction } from "./AgentSetup";
import { CommandWorkspace } from "./CommandWorkspace";
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
  resume: Readonly<{ runId: string | null; sendAuthority: boolean; run?: AiAgentConversationRow | null }>;
  /** «Мои разговоры» вкладки «Поручить»: собственные `command`-запуски сотрудника этому агенту, новые выше. */
  conversations?: readonly AiAgentConversationRow[];
  /** Сотрудник может создавать задачи (`taskComposerAccess`): под ответом агента есть «Сделать задачей». */
  canMakeTasks?: boolean;
  /** Имя сотрудника: свои поручения в «Запусках» подписаны «Вы», а «Открыть в чате» и «Повторить» есть только у них. */
  viewerName?: string;
}>;

function tabFailure(read: TabRead<unknown>, what: string, retryHref: string) {
  if (read.status === "not_ready") return <NotReady />;
  return <Unavailable what={what} retryHref={retryHref} denied={read.status === "denied"} />;
}

/**
 * Содержимое страницы агента под шапкой: плашки о том, что требует внимания (ключ Claude, синхронизация),
 * вкладки и выбранная вкладка. Строки состояния «Включён · Авто · модель · расписание» здесь нет: она
 * повторяла переключатели шапки, «Настройки» и «Обзор» — состояние говорит то, что отличается от нормы.
 */
export function AgentBody(props: AgentBodyProps) {
  const { detail, tab, now, canEdit, canManage, preview, runtimeConfigured, needsSync } = props;
  const defaults = AI_AGENT_DEFAULTS[detail.key];
  const hasInstructions = detail.hasInstructionsOverride || defaults.hasInstructions;
  // Запуск разрешён и при неудавшейся повторной синхронизации, если у агента есть рабочая настройка (миграция 318).
  const synced = aiAgentIsRunnable(detail.sync);
  const syncProblem = detail.enabled ? aiAgentSyncProblemText(detail.sync) : null;
  // Директору поручает только системный администратор (его инструменты читают данные организации целиком).
  const directorLocked = detail.key === "director" && !canEdit;
  const canRun = !preview && !directorLocked && runtimeConfigured && hasInstructions && detail.enabled && synced;
  const here = (target: AiAgentTab) => aiAgentHref(detail.key, { tab: target });

  // Что мешает запуску и что с этим делать: администратору — кнопка первого несделанного шага, остальным — слова.
  const step = aiAgentNextStep({ canEdit, runtimeConfigured, preview, hasInstructions, enabled: detail.enabled, synced });
  const blockedNote = preview ? "В просмотре роли писать агенту нельзя."
    : directorLocked ? "Директору поручает только системный администратор: он читает данные организации целиком."
    : !runtimeConfigured ? "Ключ Claude API не задан в CRM — его добавляет администратор."
      : !hasInstructions ? (canEdit ? "У агента нет инструкции. Без неё его не включить." : "У агента нет инструкции — её пишет системный администратор.")
        : !detail.enabled ? (canEdit ? "Агент выключен." : "Агент выключен — включает системный администратор.")
          : !synced ? (canEdit ? "Агент ещё не синхронизирован с Claude." : "Агент ещё не синхронизирован с Claude — синхронизирует системный администратор.")
            : null;
  const nextStep = step ? <SetupAction step={step} agentKey={detail.key} configVersion={detail.configVersion} /> : null;
  // «Обзор»: тот же ответ на «почему нельзя» — шаги запуска (администратору) или одна строка; просмотр роли и ключ Claude уже сказаны плашками выше.
  const setup = canRun ? null
    : step ? <AgentSetup agentKey={detail.key} configVersion={detail.configVersion} step={step} />
      : preview || !runtimeConfigured || !blockedNote ? null
        : <InfoLine tone="muted" testId="v3-aia-blocked-note">{blockedNote}</InfoLine>;

  const chat = tab === "command";
  const effectiveInstructions = detail.instructionsOverride?.trim() ? detail.instructionsOverride : defaults.instructions;
  const syncAction = canEdit && runtimeConfigured && hasInstructions ? <SyncNowButton agentKey={detail.key} disabled={false} label={syncProblem ? "Повторить синхронизацию" : undefined} /> : undefined;

  let content;
  switch (tab) {
    case "overview": {
      const digests = props.digests;
      content = (
        <OverviewTab
          detail={detail}
          digests={digests?.status === "available" ? digests.data.digests : []}
          now={now}
          canRun={canRun}
          setup={setup}
          canMakeTasks={Boolean(props.canMakeTasks) && !preview}
        />
      );
      break;
    }
    case "command":
      // Разговор живёт в состоянии `CommandWorkspace`, а не в адресе: после действий страница
      // перерисовывается сервером, и ключ от `?run=` стёр бы набранное и ход разговора (#1293).
      content = (
        <CommandWorkspace
          agentKey={detail.key}
          agentTitle={detail.title}
          autoSend={detail.autoSend}
          canRun={canRun}
          blockedNote={blockedNote}
          canDirect={canManage && !preview}
          canMakeTasks={Boolean(props.canMakeTasks) && !preview}
          now={now}
          conversations={props.conversations ?? []}
          resume={props.resume}
          starters={AI_AGENT_STARTERS[detail.key]}
          nextStep={nextStep}
        />
      );
      break;
    case "runs": {
      const retry = aiAgentHref(detail.key, { tab: "runs", run: props.runId });
      if (props.runId) {
        const read = props.run;
        content = !read ? null
          : read.status === "available" ? <RunDetail agentKey={detail.key} agentTitle={detail.title} data={read.data} now={now} viewerName={props.viewerName} canAct={!preview} canRun={canRun} />
            : read.status === "missing" ? (
              <p className="t-body-compact text-fg-2" data-testid="v3-aia-run-missing">
                Такого запуска нет. <Link href={here("runs")} className="text-fg underline underline-offset-4">Все запуски</Link>
              </p>
            )
              : tabFailure(read, "запуск", retry);
      } else {
        const read = props.runs;
        content = !read ? null
          : read.status === "available" ? <RunsList agentKey={detail.key} runs={read.data.runs.slice(0, props.runsLimit)} hasMore={read.data.hasMore || read.data.runs.length > props.runsLimit} limit={props.runsLimit} now={now} viewerName={props.viewerName} canRun={canRun} />
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
      // «Включён» и «Авто» живут только в шапке страницы: здесь второй пары переключателей нет.
      content = (
        <div className="space-y-4">
          <SettingsForm
            detail={detail}
            defaultSchedulePrompt={defaults.schedulePrompt}
            canEdit={canEdit}
            canRunNow={canRun}
            runNowNote={blockedNote}
          />
          <SyncPanel agentKey={detail.key} sync={detail.sync} needsSync={needsSync} runtimeConfigured={runtimeConfigured} hasInstructions={hasInstructions} canEdit={canEdit && !preview} now={now} />
        </div>
      );
      break;
  }

  return (
    // «Поручить» — чат во всю высоту окна: шапка вверху не сжимается, рабочая область забирает остаток. На телефоне
    // шапка скрыта, и чат занимает экран между строкой логотипа и вкладками (v3.css).
    <div className={chat ? "flex min-h-0 flex-1 flex-col gap-4 [&>:not(:last-child)]:shrink-0" : "space-y-4"} data-testid="v3-aia-agent" data-tab={tab} data-aia-chat={chat ? "" : undefined}>
      {preview ? <PreviewLine /> : null}
      {runtimeConfigured ? null : <ApiKeyMissingLine />}
      {/* О синхронизации на «Настройках» говорит их блок «Синхронизация с Claude» — второй раз та же фраза не нужна. */}
      {tab === "settings" ? null : syncProblem ? (
        <div data-testid="v3-aia-sync-error">
          <InfoLine tone="warn" role="alert" action={syncAction}>{syncProblem}</InfoLine>
        </div>
      ) : needsSync ? (
        <div data-testid="v3-aia-needs-sync">
          <InfoLine tone="warn" role="status" action={syncAction}>Изменения не отправлены в Claude — агент работает по прежним настройкам.</InfoLine>
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
      <div className={chat ? "flex min-h-0 flex-1 flex-col" : undefined}>{content}</div>
    </div>
  );
}
