import { PageShell } from "@/components/kit";
import { aiAgentRoleLine } from "@/lib/v3/ai-agents-view";

import { SyncNowButton } from "@/components/staff/ai-agents/SyncPanel";
import type { NextAgentPageProps } from "./agent-defaults";
import { agentGate } from "./agent-gate";
import { NextBackArrow, NextBackLink } from "./NextBackLink";
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
  // Состояние агента и «Включён» / «Авто» — одной строкой под именем (25.11.2026, шапка на телефоне занимала почти весь экран):
  // слева что с агентом сейчас, справа переключатели. Не `meta`: со вторичной строкой ряд шапки переносится, и «?» уходил вниз.
  const tabs = (bare: boolean) => <NextAgentTabs bare={bare} agentKey={detail.key} title={detail.title} tab={tab} draftsPending={detail.stats.draftsPending} />;
  // Телефон (27.11.2026, «нужно тут прокачать»): состояние, переключатели и ряд вкладок — одна белая карточка шапки; ряд
  // прокручивается вбок внутри неё от края до края карточки. На компьютере карточки нет (`sm:contents`): строка, плашки и
  // вкладки стоят, как стояли, — вкладки встают после плашек порядком сетки (`sm:order-1`, тело — `sm:order-2`).
  const head = (
    <div className="-mt-2 min-w-0 overflow-hidden rounded-card border border-border bg-surface sm:contents" data-testid="v3-aia-head">
      <div className="flex flex-col gap-1 px-3 pt-2.5 pb-1 sm:-mt-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:gap-y-2 sm:p-0" data-testid="v3-aia-head-row">
        <div className="min-w-0 t-meta text-fg-3"><NextAgentStatus detail={detail} now={now} /></div>
        {switches}
      </div>
      <div className="min-w-0 border-t border-border px-4 py-1 sm:order-1 sm:border-t-0 sm:p-0" data-aia-card-tabs="">{tabs(false)}</div>
    </div>
  );

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
    <PageShell title={detail.title} leading={<><NextBackArrow />{mascot}</>} help={roleLine} testId="v3-ai-agent-page" back={<NextBackLink phone="arrow" />}>
      <div className="grid min-w-0 gap-4" data-testid="v3-aia-agent" data-tab={tab}>
        {head}
        {alerts}
        <div className="min-w-0 sm:order-2">{body}</div>
      </div>
    </PageShell>
  );
}
