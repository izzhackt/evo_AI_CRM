"use client";

import { btnCls, btnGhostCls } from "@/components/ui";
import { StatusChip } from "@/components/v3/blocks/StatusChip";
import { AI_AGENT_SYNC_STATUS_LABELS, type AiAgentKey, type AiAgentSyncInfo } from "@/lib/ai-agents/contract";
import { syncAiAgentAction } from "@/lib/platform-ai-agents-actions";
import { aiAgentIsRunnable, formatDateTimeRu } from "@/lib/v3/ai-agents-view";

import { ActionMessage } from "./Notices";
import { useAgentsAction } from "./useAgentsAction";

/** Кнопка «Синхронизировать с Claude» для плашек и пустых состояний (только админ). */
export function SyncNowButton({
  agentKey,
  disabled,
  label = "Синхронизировать с Claude",
}: Readonly<{ agentKey: AiAgentKey; disabled: boolean; label?: string }>) {
  const { state, pending, submit } = useAgentsAction(syncAiAgentAction);
  return (
    <div className="space-y-1">
      <button
        type="button"
        className={btnCls}
        disabled={disabled || pending}
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

/** Блок «Синхронизация с Claude» во вкладке «Настройки» (контракт §D.4, п. 6). */
export function SyncPanel({
  agentKey,
  sync,
  needsSync,
  runtimeConfigured,
  canEdit,
  now,
}: Readonly<{
  agentKey: AiAgentKey;
  sync: AiAgentSyncInfo;
  needsSync: boolean;
  runtimeConfigured: boolean;
  canEdit: boolean;
  now: string;
}>) {
  const run = useAgentsAction(syncAiAgentAction);
  const blocked = !runtimeConfigured || !canEdit || run.pending;
  const facts: readonly (readonly [string, string])[] = [
    ["Агент в Claude", sync.claudeAgentId ?? "—"],
    ["Среда", sync.environmentId ?? "—"],
    ["Хранилище токена", sync.vaultId ?? "—"],
    ["Расписание", sync.deploymentId ?? "—"],
    ["Адрес CRM для агента", sync.mcpUrl ?? "—"],
  ];
  return (
    <section aria-labelledby={`aia-sync-${agentKey}`} className="rounded-card border border-border bg-surface p-4" data-testid="v3-aia-sync-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`aia-sync-${agentKey}`} className="t-section text-fg">Синхронизация с Claude</h3>
        <StatusChip label={needsSync ? "Изменения не отправлены" : AI_AGENT_SYNC_STATUS_LABELS[sync.status]} tone={needsSync ? "warn" : SYNC_TONE[sync.status]} />
      </div>
      <p className="mt-2 t-body-compact text-fg-2">
        {sync.status === "ok" && sync.syncedAt
          ? `Синхронизирован ${formatDateTimeRu(sync.syncedAt, now)}${sync.agentVersion !== null ? ` · версия ${sync.agentVersion}` : ""}.`
          : aiAgentIsRunnable(sync)
            ? `Агент в Claude уже создан${sync.agentVersion !== null ? ` (версия ${sync.agentVersion})` : ""} и работает по прежней настройке, пока синхронизация не пройдёт.`
            : "Агент ещё не создан в Claude: кнопка ниже создаёт его, среду, хранилище токена и расписание."}
      </p>
      {sync.status === "error" && sync.error ? <p role="alert" className="mt-1 t-body-compact text-danger">Ошибка: {sync.error}</p> : null}
      {needsSync ? <p className="mt-1 t-body-compact text-warn">Изменения не отправлены в Claude — агент работает по прежним настройкам.</p> : null}
      {!runtimeConfigured ? <p className="mt-1 t-body-compact text-warn">Ключ Claude API не задан в CRM: синхронизация недоступна.</p> : null}

      <dl className="mt-3 grid gap-x-6 gap-y-1.5 @2xl:grid-cols-2">
        {facts.map(([name, value]) => (
          <div key={name} className="min-w-0">
            <dt className="t-meta text-fg-3">{name}</dt>
            <dd className="break-all font-mono text-[12.5px] leading-5 text-fg-2">{value}</dd>
          </div>
        ))}
        <div className="min-w-0">
          <dt className="t-meta text-fg-3">Токен доступа агента к CRM</dt>
          <dd className="font-mono text-[12.5px] leading-5 text-fg-2">
            {sync.tokenFingerprint ? `отпечаток ${sync.tokenFingerprint}` : "не выпущен"}
            {sync.tokenRotatedAt ? <span className="font-sans text-fg-3"> · обновлён {formatDateTimeRu(sync.tokenRotatedAt, now)}</span> : null}
          </dd>
        </div>
      </dl>

      {canEdit ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={needsSync || sync.status !== "ok" ? btnCls : btnGhostCls} disabled={blocked} onClick={() => run.submit({ key: agentKey, rotate_token: "0" })} data-testid="v3-aia-sync">
              {run.pending ? "Синхронизирую…" : "Синхронизировать с Claude"}
            </button>
            <button type="button" className={btnGhostCls} disabled={blocked} onClick={() => run.submit({ key: agentKey, rotate_token: "1" })} data-testid="v3-aia-rotate">
              Обновить токен доступа
            </button>
          </div>
          <p className="max-w-[60ch] t-meta text-fg-3">
            Токен — пропуск агента в CRM; сам он нигде не показывается. После обновления старый токен ещё 10 минут принимается, чтобы идущий запуск не оборвался.
          </p>
          <ActionMessage state={run.state} testId="v3-aia-sync-message" />
        </div>
      ) : (
        <p className="mt-3 t-meta text-fg-3">Синхронизирует системный администратор.</p>
      )}
    </section>
  );
}
