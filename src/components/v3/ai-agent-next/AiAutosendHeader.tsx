"use client";

import { AlertTriangleIcon, LockIcon } from "lucide-react";

import { StatusBadge, WidgetCard, type StatusTone } from "@/components/kit";
import { AiActionForm } from "@/components/v3/ai-agent/AiActionForm";
import { AiAutosendModeSwitch } from "@/components/v3/ai-agent/AiAutosendModeSwitch";
import { pauseAiAutosendAction, setAiAutosendModeAction, toggleAiAutosendAction } from "@/lib/platform-ai-agent-autosend-actions";
import {
  AI_AUTOSEND_COPY, AI_AUTOSEND_MODE_LABEL, aiAutosendDayTime, aiAutosendLiveLock, aiAutosendMode, aiAutosendWindowLine, type AiAutosendState,
} from "@/lib/v3/ai-agent-autosend";

import { AI_OUTLINE_BUTTON, AI_PRIMARY_BUTTON } from "./ai-buttons";
import type { AiAutosendRequestIds } from "./ai-agent-next-types";

function modeTone(state: AiAutosendState): StatusTone {
  if (state.pause) return "warn";
  const mode = aiAutosendMode(state);
  return mode === "live" ? "ok" : mode === "shadow" ? "info" : "neutral";
}

/**
 * Шапка автоответчика: состояние словом, ответственный, окно работы, «выключена отправка на сервере» (на виду: ничего не уйдёт), первое включение
 * («Проверка без отправки») или режим, пауза и выключение. Всё решает база (277); команды — прежние формы с теми же полями и request_id.
 * Заперто — не прячется, а объясняется рядом.
 */
export function AiAutosendHeader({ state, serverOn, readOnly, requestIds }: Readonly<{ state: AiAutosendState; serverOn: boolean; readOnly: boolean; requestIds: AiAutosendRequestIds }>) {
  const mode = aiAutosendMode(state);
  const blocked = !state.consentRecorded ? AI_AUTOSEND_COPY.noConsent : !state.canSend ? AI_AUTOSEND_COPY.noSendRight : null;
  const sending = mode === "live" || (mode === "shadow" && state.settings.liveTestConversationIds.length > 0);
  return (
    <div data-testid="v3-ai-autosend-header" data-mode={mode}>
      <WidgetCard
        title={AI_AUTOSEND_COPY.title}
        actions={<StatusBadge label={state.pause ? "На паузе" : AI_AUTOSEND_MODE_LABEL[mode]} tone={modeTone(state)} />}
        bodyClassName="grid gap-4"
      >
        {state.enabled ? (
          <div className="grid gap-1">
            <p className="t-body-compact text-fg-2" data-testid="v3-ai-autosend-responsible">
              Ответственный: <span className="text-fg">{state.responsible?.name ?? "не назначен"}</span>
              {state.enabledAt ? <> · включён {aiAutosendDayTime(state.enabledAt)}</> : null}
            </p>
            <p className="t-body-compact text-fg-2" data-testid="v3-ai-autosend-window">{aiAutosendWindowLine(state)}</p>
          </div>
        ) : null}
        {state.enabled && !serverOn ? (
          <p className={`flex items-start gap-2 t-body-compact ${sending ? "text-warn" : "text-fg-2"}`} data-testid="v3-ai-autosend-server-off">
            {sending ? <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <LockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
            <span><span className="font-semibold">{AI_AUTOSEND_COPY.serverOff}</span>{sending ? " — ничего не уйдёт, пока её не включат на сервере." : "."}</span>
          </p>
        ) : null}
        {!state.enabled ? (
          <div className="grid gap-2" data-testid="v3-ai-autosend-enable">
            <p className="max-w-[70ch] t-body-compact text-fg-2">{AI_AUTOSEND_COPY.firstEnable}</p>
            {readOnly ? null : blocked ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <button type="button" className={`${AI_PRIMARY_BUTTON} cursor-not-allowed`} aria-disabled="true" aria-describedby="ai-autosend-enable-blocked">{AI_AUTOSEND_COPY.enable}</button>
                <p id="ai-autosend-enable-blocked" className="t-body-compact text-fg-2">{blocked}</p>
              </div>
            ) : (
              <AiActionForm requestId={requestIds.toggle} action={toggleAiAutosendAction} fields={{ autosend_action: "enable", expected_version: String(state.version) }}
                label={AI_AUTOSEND_COPY.enable} pendingLabel="Включаю…" buttonClassName={AI_PRIMARY_BUTTON} testId="v3-ai-autosend-enable-form"
                messages={{ saved: "Автоответчик включён: «Проверка без отправки».", consent_required: AI_AUTOSEND_COPY.noConsent, forbidden: AI_AUTOSEND_COPY.noSendRight, conflict: `${AI_AUTOSEND_COPY.conflict}.` }} />
            )}
          </div>
        ) : readOnly ? null : (
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <AiAutosendModeSwitch mode={state.shadowMode ? "shadow" : "live"} lock={aiAutosendLiveLock(state)} version={state.version} requestId={requestIds.mode} action={setAiAutosendModeAction} />
            <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
              {state.pause ? null : (
                <AiActionForm requestId={requestIds.pause} action={pauseAiAutosendAction} fields={{ pause_action: "pause", expected_version: String(state.version) }}
                  label={AI_AUTOSEND_COPY.pause} pendingLabel="Ставлю паузу…" buttonClassName={AI_OUTLINE_BUTTON} testId="v3-ai-autosend-pause" messages={{ saved: "Автоответчик на паузе." }} />
              )}
              <details data-testid="v3-ai-autosend-disable">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center t-label text-fg underline decoration-fg-3 underline-offset-4 hover:decoration-fg [&::-webkit-details-marker]:hidden">{AI_AUTOSEND_COPY.disable}</summary>
                <div className="grid max-w-xs gap-1 pb-2">
                  <p className="t-body-compact text-fg">{AI_AUTOSEND_COPY.disableConfirm}</p>
                  <AiActionForm requestId={requestIds.toggle} action={toggleAiAutosendAction} fields={{ autosend_action: "disable", expected_version: String(state.version) }}
                    label="Выключить" pendingLabel="Выключаю…" buttonClassName={AI_OUTLINE_BUTTON} messages={{ saved: "Автоответчик выключен.", conflict: `${AI_AUTOSEND_COPY.conflict}.` }} />
                </div>
              </details>
            </div>
          </div>
        )}
      </WidgetCard>
    </div>
  );
}
