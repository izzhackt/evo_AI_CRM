"use client";

import { useState } from "react";

import { DetailSheet, StatusBadge, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AI_AGENT_LIMITS, type AiAgentKey } from "@/lib/ai-agents/contract";
import { saveAiAgentInstructionsAction } from "@/lib/platform-ai-agents-actions";

import { ActionMessage } from "@/components/v3/ai-agents/Notices";
import { useAgentsAction } from "@/components/v3/ai-agents/useAgentsAction";
import { useDirtyGuard } from "@/components/v3/ai-agents/useDirtyGuard";
import { CONFIRM_CLASS, STATIC_BAR, STICKY_BAR } from "./buttons";
import { AgentAlert } from "./NextNotices";

/** Счётчик знаков появляется, когда до предела остаётся мало: далеко от него он только шум. */
const COUNTER_FROM_SHARE = 0.9;

function TextSheet({ title, text }: Readonly<{ title: string; text: string }>) {
  return (
    <DetailSheet title={title} trigger={<Button variant="outline">{title}</Button>}>
      <p className="whitespace-pre-wrap break-words t-body-compact text-fg-2">{text}</p>
    </DetailSheet>
  );
}

/**
 * «Правила агента» в «Новом виде»: действующий текст — свой или стандартный из репозитория — в одной карточке.
 * Правит только системный администратор; остальные читают. Сохранение отправляет изменение в Claude само, «Сбросить на
 * стандартные» просит подтверждения на месте. Стандартные и общие правила EVO — в панелях. Серверное действие то же.
 */
export function NextRules({
  agentKey, configVersion, current, isOverride, defaultText, preamble, canEdit, runtimeConfigured,
}: Readonly<{ agentKey: AiAgentKey; configVersion: number; current: string; isOverride: boolean; defaultText: string; preamble: string; canEdit: boolean; runtimeConfigured: boolean }>) {
  const [value, setValue] = useState(current);
  const [confirmReset, setConfirmReset] = useState(false);
  const { state, pending, submit } = useAgentsAction(saveAiAgentInstructionsAction);
  // Сохранённый текст сменился (запись прошла) — поле показывает его.
  const [seen, setSeen] = useState(current);
  if (seen !== current) { setSeen(current); setValue(current); }
  const hasDefault = defaultText.trim() !== "";
  const changed = value !== current;
  useDirtyGuard(changed && canEdit);
  const save = (mode: "save" | "reset") => submit({ key: agentKey, expected_version: String(configVersion), mode, text: mode === "save" ? value : "" });
  const max = AI_AGENT_LIMITS.instructionsMaxChars;
  const nearMax = value.length >= max * COUNTER_FROM_SHARE;
  // Стандартные правила показывают, только когда свои их заменили: иначе это тот же текст, что в поле.
  const sheets = [
    isOverride && hasDefault ? <TextSheet key="default" title="Стандартные правила" text={defaultText} /> : null,
    preamble.trim() ? <TextSheet key="preamble" title="Общие правила EVO" text={preamble} /> : null,
  ].filter(Boolean);

  return (
    <div className="grid gap-4" data-testid="v3-aia-instructions">
      {!hasDefault && !isOverride ? (
        <AgentAlert tone="warn" testId="v3-aia-no-instructions">
          {canEdit ? "Правил нет. Без них агента не включить." : "Правил нет — их пишет системный администратор."}
        </AgentAlert>
      ) : null}
      <WidgetCard
        title="Правила агента"
        help="Сохранение отправляет изменение в Claude само, если агент там уже есть."
        actions={hasDefault || isOverride ? <StatusBadge label={isOverride ? "Свои правила" : "Стандартные правила EVO"} tone={isOverride ? "info" : "neutral"} /> : undefined}
        footer={sheets.length > 0 ? <div className="flex flex-wrap gap-2">{sheets}</div> : undefined}
      >
        {canEdit ? (
          <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); if (changed && !pending) save("save"); }}>
            <label htmlFor={`aia-instr-text-${agentKey}`} className="sr-only">Текст правил агента</label>
            <Textarea
              id={`aia-instr-text-${agentKey}`}
              value={value}
              maxLength={max}
              rows={18}
              disabled={pending}
              onChange={(event) => setValue(event.target.value)}
              className="min-h-72"
              placeholder="Кто агент, чем занимается, как отвечает, чего не делает…"
              data-testid="v3-aia-instructions-text"
            />
            {changed || nearMax ? (
              <p className="flex flex-wrap justify-between gap-2 t-meta text-fg-3">
                <span>{changed ? "Есть несохранённые изменения" : ""}</span>
                {nearMax ? <span className="tabular-nums">{value.length.toLocaleString("ru-RU")} из {max.toLocaleString("ru-RU")}</span> : null}
              </p>
            ) : null}
            <div className={changed ? STICKY_BAR : STATIC_BAR}>
              <Button type="submit" disabled={!changed || pending} data-testid="v3-aia-instructions-save">{pending ? "Сохраняю…" : "Сохранить"}</Button>
              {isOverride && hasDefault ? <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmReset(true)}>Сбросить на стандартные</Button> : null}
            </div>
            {confirmReset ? (
              <div role="group" aria-label="Подтверждение сброса" className="rounded-card border border-border bg-surface-2 p-3">
                <p className="max-w-[60ch] t-body-compact text-fg">Свои правила будут удалены, агент вернётся к стандартным правилам EVO. Сбросить?</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" className={CONFIRM_CLASS} disabled={pending} onClick={() => { setConfirmReset(false); save("reset"); }}>Сбросить на стандартные</Button>
                  <Button type="button" variant="outline" onClick={() => setConfirmReset(false)}>Отмена</Button>
                </div>
              </div>
            ) : null}
            {!runtimeConfigured ? <p className="t-meta text-fg-3">Ключ Claude API не задан: изменение сохранится в CRM, а в Claude уйдёт после синхронизации.</p> : null}
            <ActionMessage state={state} testId="v3-aia-instructions-message" />
          </form>
        ) : (
          <div className="max-h-[60vh] overflow-auto" tabIndex={0} role="region" aria-label="Текст правил агента">
            {current.trim() ? <p className="whitespace-pre-wrap break-words t-body text-fg">{current}</p> : <p className="t-body-compact text-fg-2">Текста пока нет.</p>}
          </div>
        )}
      </WidgetCard>
    </div>
  );
}
