"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AiAgentKey } from "@/lib/ai-agents/contract";
import { updateAiAgentAction } from "@/lib/platform-ai-agents-actions";
import { aiAgentHref } from "@/lib/v3/ai-agents-view";

import { ActionMessage } from "@/components/v3/ai-agents/Notices";
import { useAgentsAction } from "@/components/v3/ai-agents/useAgentsAction";
import { CONFIRM_CLASS } from "./buttons";

/**
 * «Включён» и «Авто» в шапке страницы агента — единственное место, где они есть; та же логика, что у
 * `AgentSwitches` прежнего вида, на переключателе набора. Меняет только системный администратор, остальные видят
 * состояние словом. «Авто» включается через подтверждение под переключателем (агент начнёт сам писать клиентам),
 * выключается сразу. Без правил «Включён» заперт и ведёт к их написанию. Показ оптимистичный и возвращается на
 * значение сервера, если запись не прошла; «Сохранено» не пишется — отказ и предупреждение говорятся словами.
 */
export function NextAgentSwitches({
  agentKey,
  enabled,
  autoSend,
  configVersion,
  hasInstructions,
  canEdit,
}: Readonly<{ agentKey: AiAgentKey; enabled: boolean; autoSend: boolean; configVersion: number; hasInstructions: boolean; canEdit: boolean }>) {
  const [enabledLocal, setEnabledLocal] = useState(enabled);
  const [autoLocal, setAutoLocal] = useState(autoSend);
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const autoRef = useRef<HTMLButtonElement>(null);
  const { state, pending, submit } = useAgentsAction(updateAiAgentAction);

  // Значения сервера приходят после записи (revalidate): когда они сменились или запись не прошла, показ возвращается к ним.
  const [server, setServer] = useState({ enabled, autoSend });
  if (server.enabled !== enabled || server.autoSend !== autoSend) {
    setServer({ enabled, autoSend });
    setEnabledLocal(enabled);
    setAutoLocal(autoSend);
  }
  const [handled, setHandled] = useState(state);
  if (handled !== state) {
    setHandled(state);
    if (state.status === "failed") { setEnabledLocal(enabled); setAutoLocal(autoSend); }
  }

  const write = (patch: Record<string, unknown>) => submit({ key: agentKey, expected_version: String(configVersion), patch: JSON.stringify(patch) });
  const lockedEnable = !enabledLocal && !hasInstructions;

  function toggleEnabled(next: boolean) {
    if (!canEdit || pending || (next && !hasInstructions)) return;
    setEnabledLocal(next);
    write({ enabled: next });
  }

  function toggleAuto(next: boolean) {
    if (!canEdit || pending) return;
    if (!next) { setAutoLocal(false); setConfirming(false); write({ autoSend: false }); return; }
    setConfirming(true);
    requestAnimationFrame(() => confirmRef.current?.focus());
  }

  if (!canEdit) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="v3-aia-switches-header">
        <span data-testid="v3-aia-switch-enabled-readonly"><StatusBadge label={enabled ? "Включён" : "Выключен"} tone={enabled ? "ok" : "neutral"} /></span>
        {autoSend ? <span data-testid="v3-aia-switch-auto-readonly"><StatusBadge label="Авто: вкл" tone="warn" title="Агент сам пишет клиентам и студентам без одобрения" /></span> : null}
      </div>
    );
  }

  const notable = state.status === "failed" || state.code !== null || (state.warnings?.length ?? 0) > 0;
  return (
    <div className="flex flex-col gap-2 sm:items-end" data-testid="v3-aia-switches-header">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <div className="inline-flex items-center gap-2">
          <Label htmlFor={`aia-sw-enabled-${agentKey}`}>Включён</Label>
          <Switch id={`aia-sw-enabled-${agentKey}`} checked={enabledLocal} aria-disabled={pending || lockedEnable || undefined} onCheckedChange={toggleEnabled} data-testid="v3-aia-switch-enabled" />
          {lockedEnable ? (
            <Link href={aiAgentHref(agentKey, { tab: "instructions" })} className="inline-flex min-h-11 items-center rounded-nav t-meta text-fg underline underline-offset-4" data-testid="v3-aia-switch-needs-instructions">
              Сначала напишите правила
            </Link>
          ) : null}
        </div>
        <div className="inline-flex items-center gap-2">
          <Label htmlFor={`aia-sw-auto-${agentKey}`} title="Агент сам пишет клиентам и студентам без одобрения">Авто</Label>
          <Switch ref={autoRef} id={`aia-sw-auto-${agentKey}`} checked={autoLocal} aria-disabled={pending || undefined} onCheckedChange={toggleAuto} data-testid="v3-aia-switch-auto" />
        </div>
      </div>
      {confirming ? (
        <div role="group" aria-labelledby={`aia-auto-confirm-${agentKey}`} className="max-w-md rounded-card border border-border bg-surface-2 p-3" data-testid="v3-aia-auto-confirm">
          <p id={`aia-auto-confirm-${agentKey}`} className="t-body-compact text-fg">
            Агент начнёт сам писать клиентам и студентам без вашего одобрения. Политика конфиденциальности пока говорит, что ИИ клиентам не пишет. Включить?
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button ref={confirmRef} className={CONFIRM_CLASS} onClick={() => { setConfirming(false); setAutoLocal(true); write({ autoSend: true }); }}>Включить Авто</Button>
            <Button variant="outline" onClick={() => { setConfirming(false); requestAnimationFrame(() => autoRef.current?.focus()); }}>Отмена</Button>
          </div>
        </div>
      ) : null}
      {notable ? <ActionMessage state={state} testId="v3-aia-switch-message" /> : null}
    </div>
  );
}
