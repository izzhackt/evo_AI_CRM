"use client";

import Link from "next/link";

import { Icon } from "@/components/icons";
import { QUEUE_CONFIRM } from "@/components/v3/queue/queue-buttons";
import type { AiAgentKey } from "@/lib/ai-agents/contract";
import { updateAiAgentAction } from "@/lib/platform-ai-agents-actions";
import { aiAgentHref, type AiAgentSetupStep } from "@/lib/v3/ai-agents-view";

import { AIA_LINK_CONFIRM } from "./buttons";
import { ActionMessage } from "./Notices";
import { SyncNowButton } from "./SyncPanel";
import { useAgentsAction } from "./useAgentsAction";

/** «Включить агента»: тот же `update`, что у переключателя «Включён» в шапке; включение само отправляет настройки в Claude. */
function EnableAgentButton({ agentKey, configVersion }: Readonly<{ agentKey: AiAgentKey; configVersion: number }>) {
  const { state, pending, submit, ready } = useAgentsAction(updateAiAgentAction);
  return (
    <div className="space-y-1">
      <button
        type="button"
        className={QUEUE_CONFIRM}
        disabled={pending || !ready}
        aria-busy={!ready}
        onClick={() => submit({ key: agentKey, expected_version: String(configVersion), patch: JSON.stringify({ enabled: true }) })}
        data-testid="v3-aia-enable-now"
      >
        {pending ? "Включаю…" : "Включить агента"}
      </button>
      <ActionMessage state={state} />
    </div>
  );
}

/** Действие первого несделанного шага. На телефоне шапка страницы в чате скрыта, поэтому «Включён» из неё недоступен, а эта кнопка — на месте. */
export function SetupAction({
  step,
  agentKey,
  configVersion,
}: Readonly<{ step: AiAgentSetupStep; agentKey: AiAgentKey; configVersion: number }>) {
  if (step === "instructions") {
    return (
      <Link href={aiAgentHref(agentKey, { tab: "instructions" })} className={AIA_LINK_CONFIRM} data-testid="v3-aia-setup-instructions">
        Написать инструкцию
      </Link>
    );
  }
  if (step === "enable") return <EnableAgentButton agentKey={agentKey} configVersion={configVersion} />;
  return <SyncNowButton agentKey={agentKey} disabled={false} />;
}

const STEP_ORDER: readonly AiAgentSetupStep[] = ["instructions", "enable", "sync"];
const STEP_TITLES: Readonly<Record<AiAgentSetupStep, string>> = {
  instructions: "Агент не настроен",
  enable: "Агент выключен",
  sync: "Агент не отправлен в Claude",
};
const STEP_LABELS: Readonly<Record<AiAgentSetupStep, string>> = {
  instructions: "Инструкция",
  enable: "Включение",
  sync: "Отправка в Claude",
};

/**
 * Запуск агента одним взглядом: три шага по порядку, сделанные отмечены словом, у первого
 * несделанного — кнопка. Вместо десяти пустых блоков «Обзора» у ненастроенного агента.
 */
export function AgentSetup({
  agentKey,
  configVersion,
  step,
}: Readonly<{ agentKey: AiAgentKey; configVersion: number; step: AiAgentSetupStep }>) {
  const current = STEP_ORDER.indexOf(step);
  return (
    <section aria-labelledby={`aia-setup-${agentKey}`} className="rounded-card border border-border bg-surface p-4" data-testid="v3-aia-setup">
      <h2 id={`aia-setup-${agentKey}`} className="t-section text-fg">{STEP_TITLES[step]}</h2>
      <ol className="mt-2 divide-y divide-border">
        {STEP_ORDER.map((one, index) => {
          const done = index < current;
          return (
            <li key={one} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5" data-state={done ? "done" : index === current ? "next" : "later"}>
              <span className={`inline-flex items-center gap-2 t-body-compact ${done ? "text-fg-3" : "text-fg"}`}>
                {done ? <Icon name="check" size={16} className="shrink-0" /> : null}
                {STEP_LABELS[one]}
                {done ? <span className="t-meta">готово</span> : null}
              </span>
              {index === current ? <SetupAction step={step} agentKey={agentKey} configVersion={configVersion} /> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
