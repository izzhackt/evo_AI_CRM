import { PageShell } from "@/components/kit";
import { aiAgentRoleLine } from "@/lib/v3/ai-agents-view";

import { SyncNowButton } from "@/components/staff/ai-agents/SyncPanel";
import type { NextAgentPageProps } from "./agent-defaults";
import { agentGate } from "./agent-gate";
import { NextBackLink } from "./NextBackLink";
import { NextAgentSwitches } from "./NextAgentSwitches";
import { NextAgentTab } from "./NextAgentTab";
import { NextAgentTabs } from "./NextAgentTabs";
import { NextChatShell } from "./NextChatShell";
import { NextAgentMascot } from "./NextAgentMascot";
import { NextAgentStatus } from "./NextAgentStatus";
import { AgentAlert, NextApiKeyMissing, NextPreviewLine } from "./NextNotices";

/**
 * Страница агента в «Новом виде»: шапка набора с «Включён» и «Авто», плашки о том, что требует внимания (ключ Claude,
 * синхронизация), шесть вкладок-ссылок `?tab=` и выбранная вкладка. «Чат» — на всю рабочую область (`NextChatShell`).
 * Принимает те же свойства, что `AgentBody` прежнего вида: страница читает данные один раз и передаёт их тому виду, который включён.
 * Тексты по умолчанию из каталога (`@/content/ai-agents`) приходят готовыми в `defaults`: каталога в клиентском коде нет.
 */
export function NextAgentPage(props: NextAgentPageProps) {
  const { detail, tab, now, canEdit, preview, runtimeConfigured, needsSync, defaults } = props;
  const gate = agentGate({ detail, canEdit, preview, runtimeConfigured, defaultHasInstructions: defaults.hasInstructions });
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
  // Маскот агента в шапке каждой вкладки (13.11.2026): тот же, что на главной и в чате.
  const mascot = <NextAgentMascot agentKey={detail.key} size="md" />;
  // Состояние агента — строкой под шапкой, а не `meta`: со вторичной строкой ряд шапки переносится, и «?» на телефоне уходил вниз.
  const status = <div className="-mt-2 t-meta text-fg-3"><NextAgentStatus detail={detail} now={now} /></div>;
  const tabs = (bare: boolean) => <NextAgentTabs bare={bare} agentKey={detail.key} title={detail.title} tab={tab} draftsPending={detail.stats.draftsPending} />;

  if (chat) {
    return (
      <NextChatShell testId="v3-ai-agent-page" title={detail.title} leading={mascot} roleLine={roleLine} tabs={tabs(true)} switches={switches}>
        <div className="flex min-h-0 flex-1 flex-col gap-3 [&>:not(:last-child)]:shrink-0" data-testid="v3-aia-agent" data-tab={tab} data-aia-chat="">
          {alerts}
          <div className="flex min-h-0 flex-1 flex-col">{body}</div>
        </div>
      </NextChatShell>
    );
  }
  return (
    <PageShell title={detail.title} leading={mascot} help={roleLine} actions={switches} testId="v3-ai-agent-page" back={<NextBackLink />}>
      <div className="grid min-w-0 gap-4" data-testid="v3-aia-agent" data-tab={tab}>
        {status}
        {alerts}
        {tabs(false)}
        {body}
      </div>
    </PageShell>
  );
}
