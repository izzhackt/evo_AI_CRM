"use client";

import Link from "next/link";
import { useRef, useState, type CSSProperties } from "react";

import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import { updateAiAgentAction } from "@/lib/platform-ai-agents-actions";
import type { AiAgentKey } from "@/lib/ai-agents/contract";
import { aiAgentHref } from "@/lib/v3/ai-agents-view";

import { ActionMessage } from "./Notices";
import { useAgentsAction } from "./useAgentsAction";

/** У `.v3-switch` запасной цвет бегунка совпадает с дорожкой включённого: бегунок берёт цвет листа, как в «Телефонии». */
const THUMB_ON = { "--switch-thumb-on": "var(--surface)" } as CSSProperties;

/**
 * Переключатели «Включён» и «Авто» в шапке страницы агента (контракт §D.4) — единственное
 * место, где они есть. `role="switch"`, меняет только системный администратор;
 * остальные видят состояние словом. «Авто» включается через подтверждение прямо
 * под переключателем (не окном: задача не требует прерывания), выключается сразу.
 * Без инструкции «Включён» заперт и ведёт на её написание: нажатие, которое
 * заведомо кончается отказом, не предлагается. Показ оптимистичный и
 * возвращается на значение с сервера, если запись не прошла; «Сохранено»
 * не пишется — об этом говорит сам переключатель, словом отвечают отказ и
 * предупреждение (например, что в Claude изменение пока не ушло).
 */
export function AgentSwitches({
  agentKey,
  enabled,
  autoSend,
  configVersion,
  hasInstructions,
  canEdit,
}: Readonly<{
  agentKey: AiAgentKey;
  enabled: boolean;
  autoSend: boolean;
  configVersion: number;
  hasInstructions: boolean;
  canEdit: boolean;
}>) {
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

  function write(patch: Record<string, unknown>) {
    submit({ key: agentKey, expected_version: String(configVersion), patch: JSON.stringify(patch) });
  }

  function toggleEnabled() {
    if (!canEdit || pending) return;
    const next = !enabledLocal;
    if (next && !hasInstructions) return;
    setEnabledLocal(next);
    write({ enabled: next });
  }

  function toggleAuto() {
    if (!canEdit || pending) return;
    if (autoLocal) { setAutoLocal(false); setConfirming(false); write({ autoSend: false }); return; }
    setConfirming(true);
    requestAnimationFrame(() => confirmRef.current?.focus());
  }

  function confirmAuto() {
    setConfirming(false);
    setAutoLocal(true);
    write({ autoSend: true });
  }

  function cancelAuto() {
    setConfirming(false);
    requestAnimationFrame(() => autoRef.current?.focus());
  }

  if (!canEdit) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="v3-aia-switches-header">
        <span data-testid="v3-aia-switch-enabled-readonly"><StatusChip label={enabled ? "Включён" : "Выключен"} tone={enabled ? "ok" : "neutral"} /></span>
        {autoSend ? (
          <span data-testid="v3-aia-switch-auto-readonly"><StatusChip label="Авто: вкл" tone="warn" title="Агент сам пишет клиентам и студентам без одобрения" /></span>
        ) : null}
      </div>
    );
  }

  const lockedEnable = !enabledLocal && !hasInstructions;
  const notable = state.status === "failed" || state.code !== null || (state.warnings?.length ?? 0) > 0;
  const row = (kind: "enabled" | "auto") => {
    const on = kind === "enabled" ? enabledLocal : autoLocal;
    const label = kind === "enabled" ? "Включён" : "Авто";
    const labelId = `aia-sw-${kind}-${agentKey}`;
    const locked = kind === "enabled" && lockedEnable;
    return (
      <div className="inline-flex items-center gap-1.5">
        <span id={labelId} className="t-label text-fg" title={kind === "auto" ? "Агент сам пишет клиентам и студентам без одобрения" : undefined}>{label}</span>
        <button
          ref={kind === "auto" ? autoRef : undefined}
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          aria-disabled={pending || locked || undefined}
          className="v3-switch"
          onClick={kind === "enabled" ? toggleEnabled : toggleAuto}
          data-testid={`v3-aia-switch-${kind}`}
        >
          <span className="v3-switch-track" aria-hidden="true" />
        </button>
        {locked ? (
          <Link href={aiAgentHref(agentKey, { tab: "instructions" })} className="inline-flex min-h-11 items-center rounded-nav t-meta text-fg underline underline-offset-4" data-testid="v3-aia-switch-needs-instructions">
            Сначала напишите правила
          </Link>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-2" style={THUMB_ON} data-testid="v3-aia-switches-header">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {row("enabled")}
        {row("auto")}
      </div>
      {confirming ? (
        <div role="group" aria-labelledby={`aia-auto-confirm-${agentKey}`} className="rounded-card border border-border bg-surface-2/60 p-3" data-testid="v3-aia-auto-confirm">
          <p id={`aia-auto-confirm-${agentKey}`} className="max-w-[60ch] t-body-compact text-fg">
            Агент начнёт сам писать клиентам и студентам без вашего одобрения. Политика конфиденциальности пока говорит, что ИИ клиентам не пишет. Включить?
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button ref={confirmRef} type="button" className={QUEUE_CONFIRM} onClick={confirmAuto}>Включить Авто</button>
            <button type="button" className={QUEUE_SECONDARY} onClick={cancelAuto}>Отмена</button>
          </div>
        </div>
      ) : null}
      {notable ? <ActionMessage state={state} testId="v3-aia-switch-message" /> : null}
    </div>
  );
}
