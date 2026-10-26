"use client";

import { useState } from "react";

import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import { AI_AGENT_LIMITS, type AiAgentKey } from "@/lib/ai-agents/contract";
import { saveAiAgentInstructionsAction } from "@/lib/platform-ai-agents-actions";

import { AIA_PRIMARY, AIA_STATIC_BAR, AIA_STICKY_BAR } from "./buttons";
import { ActionMessage } from "./Notices";
import { useAgentsAction } from "./useAgentsAction";
import { useDirtyGuard } from "./useDirtyGuard";

/** Счётчик знаков появляется, когда до предела остаётся мало: далеко от него он только шум. */
const COUNTER_FROM_SHARE = 0.9;

/**
 * Вкладка «Инструкция» (контракт §D.4, п. 5): действующая инструкция агента —
 * своя или стандартная из репозитория. Правит только системный администратор;
 * остальные читают. Сохранение отправляет изменение в Claude само (если агент
 * там уже есть), «Сбросить на стандартные» — с подтверждением на месте.
 */
export function InstructionsEditor({
  agentKey,
  configVersion,
  current,
  isOverride,
  defaultText,
  preamble,
  canEdit,
  runtimeConfigured,
}: Readonly<{
  agentKey: AiAgentKey;
  configVersion: number;
  /** Действующий текст: своя или стандартная инструкция. */
  current: string;
  isOverride: boolean;
  defaultText: string;
  preamble: string;
  canEdit: boolean;
  runtimeConfigured: boolean;
}>) {
  const [value, setValue] = useState(current);
  const [confirmReset, setConfirmReset] = useState(false);
  const { state, pending, submit } = useAgentsAction(saveAiAgentInstructionsAction);
  // Сохранённый текст сменился (запись прошла) — поле показывает его.
  const [seen, setSeen] = useState(current);
  if (seen !== current) { setSeen(current); setValue(current); }

  const hasDefault = defaultText.trim() !== "";
  // Пустую инструкцию называет строка ниже, а не второй чип с теми же словами.
  const label = isOverride ? "Свои правила" : "Стандартные правила EVO";
  const tone = isOverride ? "info" : "neutral";
  const changed = value !== current;
  useDirtyGuard(changed && canEdit);
  const save = (mode: "save" | "reset") => submit({ key: agentKey, expected_version: String(configVersion), mode, text: mode === "save" ? value : "" });

  const max = AI_AGENT_LIMITS.instructionsMaxChars;
  return (
    <section aria-labelledby={`aia-instr-${agentKey}`} className="space-y-4" data-testid="v3-aia-instructions">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={`aia-instr-${agentKey}`} className="t-section text-fg">Правила агента</h2>
        {hasDefault || isOverride ? <StatusChip label={label} tone={tone} /> : null}
      </div>

      {!hasDefault && !isOverride ? (
        <p className="max-w-[62ch] rounded-card border border-border bg-surface px-4 py-3 t-body-compact text-fg-2" data-testid="v3-aia-no-instructions">
          {canEdit ? "Правил нет. Без них агента не включить." : "Правил нет — их пишет системный администратор."}
        </p>
      ) : null}

      {canEdit ? (
        <form
          className="space-y-3"
          onSubmit={(event) => { event.preventDefault(); if (changed && !pending) save("save"); }}
        >
          <div>
            <label htmlFor={`aia-instr-text-${agentKey}`} className="sr-only">Текст правил агента</label>
            <textarea
              id={`aia-instr-text-${agentKey}`}
              value={value}
              maxLength={max}
              rows={18}
              disabled={pending}
              onChange={(event) => setValue(event.target.value)}
              className="min-h-72 w-full resize-y rounded-ctl border border-control-edge bg-surface px-3 py-2.5 t-body text-fg placeholder:text-fg-3 focus-visible:border-accent disabled:bg-surface-2"
              placeholder="Кто агент, чем занимается, как отвечает, чего не делает…"
              data-testid="v3-aia-instructions-text"
            />
            {changed || value.length >= max * COUNTER_FROM_SHARE ? (
              <p className="mt-1 flex flex-wrap justify-between gap-2 t-meta text-fg-3">
                <span>{changed ? "Есть несохранённые изменения" : ""}</span>
                {value.length >= max * COUNTER_FROM_SHARE ? <span className="tabular-nums">{value.length.toLocaleString("ru-RU")} из {max.toLocaleString("ru-RU")}</span> : null}
              </p>
            ) : null}
          </div>
          <div className={changed ? AIA_STICKY_BAR : AIA_STATIC_BAR}>
            <button type="submit" className={AIA_PRIMARY} disabled={!changed || pending} data-testid="v3-aia-instructions-save">
              {pending ? "Сохраняю…" : "Сохранить"}
            </button>
            {isOverride && hasDefault ? (
              <button type="button" className={QUEUE_SECONDARY} disabled={pending} onClick={() => setConfirmReset(true)}>Сбросить на стандартные</button>
            ) : null}
          </div>
          {confirmReset ? (
            <div role="group" aria-label="Подтверждение сброса" className="rounded-card border border-border bg-surface-2/60 p-3">
              <p className="max-w-[60ch] t-body-compact text-fg">Свои правила будут удалены, агент вернётся к стандартным правилам EVO. Сбросить?</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={QUEUE_CONFIRM} disabled={pending} onClick={() => { setConfirmReset(false); save("reset"); }}>Сбросить на стандартные</button>
                <button type="button" className={QUEUE_SECONDARY} onClick={() => setConfirmReset(false)}>Отмена</button>
              </div>
            </div>
          ) : null}
          {!runtimeConfigured ? <p className="t-meta text-fg-3">Ключ Claude API не задан: изменение сохранится в CRM, а в Claude уйдёт после синхронизации.</p> : null}
          <ActionMessage state={state} testId="v3-aia-instructions-message" />
        </form>
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-card border border-border bg-surface p-4" tabIndex={0} role="region" aria-label="Текст правил агента">
          {current.trim() ? <p className="whitespace-pre-wrap break-words t-body text-fg">{current}</p> : <p className="t-body-compact text-fg-2">Текста пока нет.</p>}
        </div>
      )}

      {hasDefault ? (
        <details className="rounded-card border border-border bg-surface px-4">
          <summary className="cursor-pointer t-label text-fg-2">Показать стандартные правила</summary>
          <p className="max-h-96 overflow-auto whitespace-pre-wrap break-words pb-4 t-body-compact text-fg-2">{defaultText}</p>
        </details>
      ) : null}
      {preamble.trim() ? (
        <details className="rounded-card border border-border bg-surface px-4">
          <summary className="cursor-pointer t-label text-fg-2">Общие правила EVO (всегда добавляются)</summary>
          <p className="max-h-96 overflow-auto whitespace-pre-wrap break-words pb-4 t-body-compact text-fg-2">{preamble}</p>
        </details>
      ) : null}
    </section>
  );
}
