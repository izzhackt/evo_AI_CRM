"use client";

import { useRef, useState } from "react";

import { updateAiAgentAction } from "@/lib/platform-ai-agents-actions";
import type { AiAgentKey } from "@/lib/ai-agents/contract";
import { btnCls, btnGhostCls } from "@/components/ui";

import { ActionMessage } from "./Notices";
import { useAgentsAction } from "./useAgentsAction";

/**
 * Переключатели «Включён» и «Авто» (контракт §D.4). `role="switch"`, меняет
 * только системный администратор; остальные видят значения словом (чипами в
 * шапке). «Авто» включается через подтверждение прямо под переключателем (не
 * окном: задача не требует прерывания), выключается сразу. Показ оптимистичный
 * и возвращается на значение с сервера, если запись не прошла.
 */
export function AgentSwitches({
  agentKey,
  enabled,
  autoSend,
  configVersion,
  hasInstructions,
  canEdit,
  variant,
}: Readonly<{
  agentKey: AiAgentKey;
  enabled: boolean;
  autoSend: boolean;
  configVersion: number;
  hasInstructions: boolean;
  canEdit: boolean;
  variant: "header" | "settings";
}>) {
  const [enabledLocal, setEnabledLocal] = useState(enabled);
  const [autoLocal, setAutoLocal] = useState(autoSend);
  const [confirming, setConfirming] = useState(false);
  const [local, setLocal] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const autoRef = useRef<HTMLButtonElement>(null);
  const { state, pending, submit } = useAgentsAction(updateAiAgentAction);
  const id = `${variant}-${agentKey}`;

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
    setLocal(null);
    submit({ key: agentKey, expected_version: String(configVersion), patch: JSON.stringify(patch) });
  }

  function toggleEnabled() {
    if (!canEdit || pending) return;
    const next = !enabledLocal;
    if (next && !hasInstructions) { setLocal("Инструкции пока нет — напишите её во вкладке «Инструкция». Без неё агента включить нельзя."); return; }
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

  const row = (kind: "enabled" | "auto") => {
    const on = kind === "enabled" ? enabledLocal : autoLocal;
    const label = kind === "enabled" ? "Включён" : "Авто";
    const labelId = `aia-sw-${kind}-${id}`;
    const hint = kind === "enabled"
      ? (on ? "Агент работает: расписание и события активны." : "Агент не запускается ни по расписанию, ни по событиям.")
      : (on ? "Агент сам пишет клиентам и студентам без вашего одобрения." : "Сообщения клиентам уходят в «Черновики» на ваше одобрение.");
    return (
      <div className={variant === "settings" ? "flex items-start justify-between gap-4 py-3" : "inline-flex items-center gap-1.5"}>
        <div className="min-w-0">
          <span id={labelId} className="t-label text-fg">{label}</span>
          {variant === "settings" ? <p className="mt-0.5 max-w-[56ch] t-body-compact text-fg-2">{hint}</p> : null}
        </div>
        {canEdit ? (
          <button
            ref={kind === "auto" ? autoRef : undefined}
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby={labelId}
            aria-disabled={pending || undefined}
            className="v3-switch"
            onClick={kind === "enabled" ? toggleEnabled : toggleAuto}
            data-testid={`v3-aia-switch-${kind}`}
          >
            <span className="v3-switch-track" aria-hidden="true" />
          </button>
        ) : (
          <span className="t-label text-fg-2" data-testid={`v3-aia-switch-${kind}-readonly`}>{on ? "вкл" : "выкл"}</span>
        )}
      </div>
    );
  };

  return (
    <div className={variant === "settings" ? "divide-y divide-border" : "space-y-2"} data-testid={`v3-aia-switches-${variant}`}>
      <div className={variant === "settings" ? "contents" : "flex flex-wrap items-center gap-x-5 gap-y-1"}>
        {row("enabled")}
        {row("auto")}
      </div>
      {confirming ? (
        <div role="group" aria-labelledby={`aia-auto-confirm-${id}`} className="rounded-card border border-border bg-surface-2/60 p-3" data-testid="v3-aia-auto-confirm">
          <p id={`aia-auto-confirm-${id}`} className="max-w-[60ch] t-body-compact text-fg">
            Агент будет сам писать клиентам и студентам без вашего одобрения. Рекомендуем держать Авто выключенным, пока не обновлена политика
            конфиденциальности (сейчас в ней сказано, что ИИ клиентам не пишет). Включить?
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button ref={confirmRef} type="button" className={btnCls} onClick={confirmAuto}>Включить Авто</button>
            <button type="button" className={btnGhostCls} onClick={cancelAuto}>Отмена</button>
          </div>
        </div>
      ) : null}
      {local ? <p role="alert" className="t-body-compact text-danger">{local}</p> : null}
      <ActionMessage state={state} testId="v3-aia-switch-message" />
    </div>
  );
}
