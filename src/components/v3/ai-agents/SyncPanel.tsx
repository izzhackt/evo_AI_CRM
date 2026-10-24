"use client";

import Link from "next/link";
import { useState } from "react";

import { Icon } from "@/components/icons";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
import { AI_AGENT_SYNC_STATUS_LABELS, type AiAgentKey, type AiAgentSyncInfo } from "@/lib/ai-agents/contract";
import { syncAiAgentAction } from "@/lib/platform-ai-agents-actions";
import { aiAgentHref, aiAgentSyncProblemText, formatDateTimeRu } from "@/lib/v3/ai-agents-view";

import { ActionMessage } from "./Notices";
import { useAgentsAction } from "./useAgentsAction";

/** Кнопка «Синхронизировать с Claude» для плашек и пустых состояний (только админ): тёмная, красный — одному главному действию страницы. */
export function SyncNowButton({
  agentKey,
  disabled,
  label = "Синхронизировать с Claude",
}: Readonly<{ agentKey: AiAgentKey; disabled: boolean; label?: string }>) {
  const { state, pending, submit, ready } = useAgentsAction(syncAiAgentAction);
  return (
    <div className="space-y-1">
      <button
        type="button"
        className={QUEUE_CONFIRM}
        disabled={disabled || pending || !ready}
        aria-busy={!ready}
        onClick={() => submit({ key: agentKey, rotate_token: "0" })}
        data-testid="v3-aia-sync-now"
      >
        {pending ? "Синхронизирую…" : label}
      </button>
      <ActionMessage state={state} />
    </div>
  );
}

const SYNC_TONE: Readonly<Record<AiAgentSyncInfo["status"], "neutral" | "warn" | "ok" | "danger">> = {
  never: "neutral", pending: "warn", ok: "ok", error: "danger",
};

/**
 * Блок «Синхронизация с Claude» во вкладке «Настройки» (контракт §D.4, п. 6): слово
 * состояния, одна строка о нём и действия. Плашки о синхронизации на этой вкладке
 * нет — её слова живут здесь, один раз. Служебные номера Claude и токен спрятаны
 * под «Технические данные»; обновление токена просит подтверждения на месте.
 */
export function SyncPanel({
  agentKey,
  sync,
  needsSync,
  runtimeConfigured,
  hasInstructions,
  canEdit,
  now,
}: Readonly<{
  agentKey: AiAgentKey;
  sync: AiAgentSyncInfo;
  needsSync: boolean;
  runtimeConfigured: boolean;
  /** Без инструкции в Claude создавать нечего: синхронизация заперта. */
  hasInstructions: boolean;
  canEdit: boolean;
  now: string;
}>) {
  const run = useAgentsAction(syncAiAgentAction);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const blocked = !runtimeConfigured || !hasInstructions || !canEdit || run.pending || !run.ready;
  const problem = aiAgentSyncProblemText(sync);
  const facts: readonly (readonly [string, string])[] = [
    ["Агент в Claude", sync.claudeAgentId ?? "—"],
    ["Среда", sync.environmentId ?? "—"],
    ["Хранилище токена", sync.vaultId ?? "—"],
    ["Расписание", sync.deploymentId ?? "—"],
    ["Адрес CRM для агента", sync.mcpUrl ?? "—"],
  ];
  const line = problem
    ?? (sync.status === "ok" && sync.syncedAt
      ? `${formatDateTimeRu(sync.syncedAt, now)}${sync.agentVersion !== null ? ` · версия ${sync.agentVersion}` : ""}`
      : "Агент ещё не создан в Claude.");
  return (
    <section aria-labelledby={`aia-sync-${agentKey}`} className="rounded-card border border-border bg-surface p-4" data-testid="v3-aia-sync-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`aia-sync-${agentKey}`} className="t-section text-fg">Синхронизация с Claude</h3>
        <StatusChip label={needsSync ? "Изменения не отправлены" : AI_AGENT_SYNC_STATUS_LABELS[sync.status]} tone={needsSync ? "warn" : SYNC_TONE[sync.status]} />
      </div>
      <p role={sync.status === "error" ? "alert" : undefined} className="mt-2 t-body-compact text-fg-2">{line}</p>
      {needsSync ? <p role="status" className="mt-1 t-body-compact text-warn">Изменения не отправлены в Claude — агент работает по прежним настройкам.</p> : null}
      {!runtimeConfigured ? <p className="mt-1 t-body-compact text-warn">Ключ Claude API не задан в CRM: синхронизация недоступна.</p> : null}
      {canEdit && runtimeConfigured && !hasInstructions ? (
        <p className="mt-1 t-body-compact text-fg-2">
          Сначала напишите <Link href={aiAgentHref(agentKey, { tab: "instructions" })} className="text-fg underline underline-offset-4">инструкцию</Link>: без неё агента в Claude не создать.
        </p>
      ) : null}

      {canEdit ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={needsSync || sync.status !== "ok" ? QUEUE_CONFIRM : QUEUE_SECONDARY} disabled={blocked} onClick={() => run.submit({ key: agentKey, rotate_token: "0" })} data-testid="v3-aia-sync">
              {run.pending ? "Синхронизирую…" : "Синхронизировать с Claude"}
            </button>
          </div>
          <ActionMessage state={run.state} testId="v3-aia-sync-message" />
        </div>
      ) : (
        <p className="mt-3 t-meta text-fg-3">Синхронизирует системный администратор.</p>
      )}

      <details className="group mt-3 border-t border-border pt-1">
        <summary className="flex min-h-11 cursor-pointer items-center gap-1.5 t-label text-fg-2">
          Технические данные
          <Icon name="chevron-down" size={16} className="shrink-0 text-fg-3 transition-transform duration-[180ms] group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <dl className="grid gap-x-6 gap-y-2 pb-2 pt-1 @2xl:grid-cols-2">
          {facts.map(([name, value]) => (
            <div key={name} className="min-w-0">
              <dt className="t-meta text-fg-3">{name}</dt>
              <dd className="break-all font-mono t-meta text-fg-2">{value}</dd>
            </div>
          ))}
          <div className="min-w-0">
            <dt className="t-meta text-fg-3">Токен доступа агента к CRM</dt>
            <dd className="font-mono t-meta text-fg-2">
              {sync.tokenFingerprint ? `отпечаток ${sync.tokenFingerprint}` : "не выпущен"}
              {sync.tokenRotatedAt ? <span className="font-sans text-fg-3"> · обновлён {formatDateTimeRu(sync.tokenRotatedAt, now)}</span> : null}
            </dd>
          </div>
        </dl>
        {canEdit ? (
          <div className="space-y-3 pb-3">
            <button type="button" className={QUEUE_SECONDARY} disabled={blocked || !sync.tokenFingerprint} onClick={() => setConfirmRotate(true)} data-testid="v3-aia-rotate">
              Обновить токен
            </button>
            {confirmRotate ? (
              <div role="group" aria-label="Подтверждение обновления токена" className="rounded-card border border-border bg-surface-2/60 p-3">
                <p className="max-w-[60ch] t-body-compact text-fg">Агент получит новый токен; старый ещё 10 минут принимается, чтобы идущий запуск не оборвался. Обновить?</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={QUEUE_CONFIRM} disabled={blocked} onClick={() => { setConfirmRotate(false); run.submit({ key: agentKey, rotate_token: "1" }); }} data-testid="v3-aia-rotate-confirm">Обновить токен</button>
                  <button type="button" className={QUEUE_SECONDARY} onClick={() => setConfirmRotate(false)}>Отмена</button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </details>
    </section>
  );
}
