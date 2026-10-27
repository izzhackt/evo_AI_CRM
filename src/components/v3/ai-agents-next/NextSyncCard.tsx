"use client";

import Link from "next/link";
import { useState } from "react";

import { DetailSheet, KeyFacts, StatusBadge, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { AI_AGENT_SYNC_STATUS_LABELS, type AiAgentKey, type AiAgentSyncInfo } from "@/lib/ai-agents/contract";
import { syncAiAgentAction } from "@/lib/platform-ai-agents-actions";
import { aiAgentHref, aiAgentSyncProblemText, formatDateTimeRu } from "@/lib/v3/ai-agents-view";

import { ActionMessage } from "@/components/v3/ai-agents/Notices";
import { useAgentsAction } from "@/components/v3/ai-agents/useAgentsAction";
import { CONFIRM_CLASS } from "./buttons";

const SYNC_TONE: Readonly<Record<AiAgentSyncInfo["status"], "neutral" | "warn" | "ok" | "danger">> = { never: "neutral", pending: "warn", ok: "ok", error: "danger" };

/**
 * «Синхронизация с Claude» в «Новом виде»: слово состояния, одна строка о нём и кнопка (только администратор). Служебные
 * номера и токен — в панели «Технические данные»; обновление токена просит подтверждения на месте. Предупреждения о
 * неотправленных изменениях и отсутствии ключа остаются на виду. Серверное действие то же (`syncAiAgentAction`).
 * `idField` — поле «ID агента в Claude» от «Настроек» (его значение — часть их формы): стоит первым в панели на месте строки «Агент в Claude».
 */
export type NextSyncCardProps = Readonly<{ agentKey: AiAgentKey; sync: AiAgentSyncInfo; needsSync: boolean; runtimeConfigured: boolean; hasInstructions: boolean; canEdit: boolean; now: string; idField?: React.ReactNode }>;

export function NextSyncCard({ agentKey, sync, needsSync, runtimeConfigured, hasInstructions, canEdit, now, idField }: NextSyncCardProps) {
  const run = useAgentsAction(syncAiAgentAction);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const blocked = !runtimeConfigured || !hasInstructions || !canEdit || run.pending || !run.ready;
  const problem = aiAgentSyncProblemText(sync);
  const line = problem ?? (sync.status === "ok" && sync.syncedAt ? `${formatDateTimeRu(sync.syncedAt, now)}${sync.agentVersion !== null ? ` · версия ${sync.agentVersion}` : ""}` : "Агент ещё не создан в Claude.");
  return (
    <div data-testid="v3-aia-sync-panel">
      <WidgetCard
        title="Синхронизация с Claude"
        actions={<StatusBadge label={needsSync ? "Изменения не отправлены" : AI_AGENT_SYNC_STATUS_LABELS[sync.status]} tone={needsSync ? "warn" : SYNC_TONE[sync.status]} />}
        footer={
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <Button type="button" variant={needsSync || sync.status !== "ok" ? "default" : "outline"} className={needsSync || sync.status !== "ok" ? CONFIRM_CLASS : undefined} disabled={blocked} onClick={() => run.submit({ key: agentKey, rotate_token: "0" })} data-testid="v3-aia-sync">
                {run.pending ? "Синхронизирую…" : "Синхронизировать с Claude"}
              </Button>
            ) : <p className="t-meta text-fg-3">Синхронизирует системный администратор.</p>}
            <DetailSheet title="Технические данные" trigger={<Button type="button" variant="outline">Технические данные</Button>}>
              {idField ? <div className="mb-4">{idField}</div> : null}
              <KeyFacts columns={1} facts={[
                { label: "Агент в Claude", value: idField ? null : sync.claudeAgentId ?? "—" },
                { label: "Среда", value: sync.environmentId ?? "—" },
                { label: "Хранилище токена", value: sync.vaultId ?? "—" },
                { label: "Расписание", value: sync.deploymentId ?? "—" },
                { label: "Адрес CRM для агента", value: <span className="break-all">{sync.mcpUrl ?? "—"}</span> },
                { label: "Токен доступа агента к CRM", value: `${sync.tokenFingerprint ? `отпечаток ${sync.tokenFingerprint}` : "не выпущен"}${sync.tokenRotatedAt ? ` · обновлён ${formatDateTimeRu(sync.tokenRotatedAt, now)}` : ""}` },
              ]} />
              {canEdit ? (
                <div className="mt-4 grid gap-3">
                  <div><Button type="button" variant="outline" disabled={blocked || !sync.tokenFingerprint} onClick={() => setConfirmRotate(true)} data-testid="v3-aia-rotate">Обновить токен</Button></div>
                  {confirmRotate ? (
                    <div role="group" aria-label="Подтверждение обновления токена" className="rounded-card border border-border bg-surface-2 p-3">
                      <p className="t-body-compact text-fg">Агент получит новый токен; старый ещё 10 минут принимается, чтобы идущий запуск не оборвался. Обновить?</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" className={CONFIRM_CLASS} disabled={blocked} onClick={() => { setConfirmRotate(false); run.submit({ key: agentKey, rotate_token: "1" }); }} data-testid="v3-aia-rotate-confirm">Обновить токен</Button>
                        <Button type="button" variant="outline" onClick={() => setConfirmRotate(false)}>Отмена</Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </DetailSheet>
          </div>
        }
      >
        <div className="grid gap-1.5">
          <p role={sync.status === "error" ? "alert" : undefined} className="t-body-compact text-fg-2">{line}</p>
          {needsSync ? <p role="status" className="t-body-compact text-warn">Изменения не отправлены в Claude — агент работает по прежним настройкам.</p> : null}
          {!runtimeConfigured ? <p className="t-body-compact text-warn">Ключ Claude API не задан в CRM: синхронизация недоступна.</p> : null}
          {canEdit && runtimeConfigured && !hasInstructions ? (
            <p className="t-body-compact text-fg-2">Сначала напишите <Link href={aiAgentHref(agentKey, { tab: "instructions" })} className="text-fg underline underline-offset-4">правила</Link>: без них агента в Claude не создать.</p>
          ) : null}
          <ActionMessage state={run.state} testId="v3-aia-sync-message" />
        </div>
      </WidgetCard>
    </div>
  );
}
