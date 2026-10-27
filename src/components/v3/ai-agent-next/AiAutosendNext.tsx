"use client";

import { WidgetCard, SectionTabs } from "@/components/kit";
import { AiAutosendSettingsForm } from "@/components/v3/ai-agent/AiAutosendSettingsForm";
import { saveAiAutosendSettingsAction } from "@/lib/platform-ai-agent-autosend-actions";
import { aiAgentHref } from "@/lib/v3/ai-agent";
import { aiAutosendLiveTestLock } from "@/lib/v3/ai-agent-autosend";

import { AiAutosendHeader } from "./AiAutosendHeader";
import { AiAutosendJournalView } from "./AiAutosendJournal";
import { AiAutosendSummaryView } from "./AiAutosendSummary";
import { AiPauseBanner } from "./AiPauseBanner";
import { AiUnavailableNext } from "./AiUnavailableNext";
import type { AiAgentNextBody } from "./ai-agent-next-types";

const VIEW_TABS = [{ key: "settings", label: "Настройки" }, { key: "journal", label: "Журнал" }, { key: "summary", label: "Утренняя сводка" }] as const;

/**
 * «Автоответчик» (план §11, §12.2; ADR 0031): пауза и выключенная отправка на сервере наверху, шапка (состояние, ответственный, окно, выключатель и режим), ниже —
 * «Настройки», «Журнал», «Утренняя сводка». Всё решает база (277); раздел сам ничего не отправляет. Просмотр роли и сотрудник без ai.agent.manage видят всё,
 * но ничего не меняют.
 */
export function AiAutosendNext({ read, route, journal, summary, serverOn, preview, retryHref, requestIds }: Extract<AiAgentNextBody, { kind: "autosend" }>) {
  if (read.status !== "available") return <AiUnavailableNext what="автоответчик" retryHref={retryHref} />;
  const state = read.data;
  const readOnly = preview || !state.canManage;
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-ai-autosend" data-read-only={readOnly || undefined}>
      <AiPauseBanner state={state} preview={readOnly} resumeRequestId={requestIds.resume} />
      <AiAutosendHeader state={state} serverOn={serverOn} readOnly={readOnly} requestIds={requestIds} />
      <SectionTabs label="Автоответчик" value={route.view} tabs={VIEW_TABS.map((tab) => ({ key: tab.key, label: tab.label, href: aiAgentHref("autosend", tab.key === "settings" ? {} : { view: tab.key }) }))} />
      {route.view === "journal" && journal ? <AiAutosendJournalView read={journal} route={route} retryHref={retryHref} />
        : route.view === "summary" && summary ? <AiAutosendSummaryView read={summary} retryHref={retryHref} />
          : (
            <WidgetCard>
              <AiAutosendSettingsForm initial={state.settings} version={state.version} liveTestTitles={state.liveTestTitles} liveTestLock={aiAutosendLiveTestLock(state)}
                readOnly={readOnly} requestId={requestIds.settings} action={saveAiAutosendSettingsAction} />
            </WidgetCard>
          )}
    </div>
  );
}
