import { PageShell, SectionTabs } from "@/components/kit";
import { AI_AGENT_TABS, aiAgentHref, aiAgentRoleLine } from "@/lib/v3/ai-agents-view";

import type { AgentBodyProps } from "@/components/v3/ai-agents/AgentBody";
import { AgentTabs } from "@/components/v3/ai-agents/AgentTabs";
import { SyncNowButton } from "@/components/v3/ai-agents/SyncPanel";
import { agentGate } from "./agent-gate";
import { NextBackLink } from "./NextBackLink";
import { NextAgentSwitches } from "./NextAgentSwitches";
import { NextAgentTab } from "./NextAgentTab";
import { NextChatShell } from "./NextChatShell";
import { AgentAlert, NextApiKeyMissing, NextPreviewLine } from "./NextNotices";

/**
 * Страница агента в «Новом виде»: шапка набора с «Включён» и «Авто», плашки о том, что требует внимания (ключ Claude,
 * синхронизация), шесть вкладок-ссылок `?tab=` и выбранная вкладка. «Чат» — на всю рабочую область (`NextChatShell`).
 * Принимает те же свойства, что `AgentBody` прежнего вида: страница читает данные один раз и передаёт их тому виду, который включён.
 */
export function NextAgentPage(props: AgentBodyProps) {
  const { detail, tab, canEdit, preview, runtimeConfigured, needsSync } = props;
  const gate = agentGate({ detail, canEdit, preview, runtimeConfigured });
  const chat = tab === "command";
  const roleLine = aiAgentRoleLine(detail.roleLine);
  const switches = <NextAgentSwitches agentKey={detail.key} enabled={detail.enabled} autoSend={detail.autoSend} configVersion={detail.configVersion} hasInstructions={gate.hasInstructions} canEdit={canEdit} />;
  // Первый несделанный шаг — «Отправка в Claude»: «Обзор» и закрытый чат уже несут эту же кнопку, второй такой же рядом с плашкой не нужен.
  const stepOnScreen = gate.step === "sync" && (tab === "overview" || tab === "command");
  const syncAction = canEdit && runtimeConfigured && gate.hasInstructions && !stepOnScreen
    ? <SyncNowButton agentKey={detail.key} disabled={false} label={gate.syncProblem ? "Повторить синхронизацию" : undefined} /> : undefined;
  const alerts = (
    <>
      {preview ? <NextPreviewLine /> : null}
      {runtimeConfigured ? null : <NextApiKeyMissing />}
      {/* О синхронизации на «Настройках» говорит их карточка «Синхронизация с Claude» — второй раз та же фраза не нужна. */}
      {tab === "settings" ? null : gate.syncProblem ? (
        <div data-testid="v3-aia-sync-error"><AgentAlert tone="warn" role="alert" action={syncAction}>{gate.syncProblem}</AgentAlert></div>
      ) : needsSync ? (
        <div data-testid="v3-aia-needs-sync"><AgentAlert tone="warn" role="status" action={syncAction}>Изменения не отправлены в Claude — агент работает по прежним настройкам.</AgentAlert></div>
      ) : null}
    </>
  );
  const body = <NextAgentTab props={props} gate={gate} />;

  if (chat) {
    return (
      <NextChatShell testId="v3-ai-agent-page" title={detail.title} roleLine={roleLine} tabs={<AgentTabs bare agentKey={detail.key} title={detail.title} tab={tab} draftsPending={detail.stats.draftsPending} />} switches={switches}>
        <div className="flex min-h-0 flex-1 flex-col gap-3 [&>:not(:last-child)]:shrink-0" data-testid="v3-aia-agent" data-tab={tab} data-aia-chat="">
          {alerts}
          <div className="flex min-h-0 flex-1 flex-col">{body}</div>
        </div>
      </NextChatShell>
    );
  }
  return (
    <PageShell title={detail.title} help={roleLine} actions={switches} testId="v3-ai-agent-page" back={<NextBackLink />}>
      <div className="grid min-w-0 gap-4" data-testid="v3-aia-agent" data-tab={tab}>
        {alerts}
        <SectionTabs
          label={`Разделы агента «${detail.title}»`}
          value={tab}
          tabs={AI_AGENT_TABS.map((one) => ({ key: one.key, label: one.label, count: one.key === "drafts" && detail.stats.draftsPending > 0 ? detail.stats.draftsPending : null, href: aiAgentHref(detail.key, { tab: one.key }) }))}
        />
        {body}
      </div>
    </PageShell>
  );
}
