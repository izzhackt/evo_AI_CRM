"use client";

import { AlertTriangleIcon, CircleCheckIcon, LockIcon } from "lucide-react";

import { KeyFacts, StatusBadge, WidgetCard } from "@/components/kit";
import { AiActionForm } from "@/components/v3/ai-agent/AiActionForm";
import { AiMemoryToggle } from "@/components/v3/ai-agent/AiMemoryToggle";
import { AiMonthlyCapForm } from "@/components/v3/ai-agent/AiMonthlyCapForm";
import { recordAiConsentAction, saveAiMemoryAction } from "@/lib/platform-ai-agent-actions";
import type { AiAgentStatus } from "@/lib/server/ai-agent-route-handlers";
import { aiDateTime, aiErrorCopy, formatUsd, type AiSettings } from "@/lib/v3/ai-agent";
import { AI_MEMORY_SETTINGS_COPY } from "@/lib/v3/ai-agent-memory";

import { AI_OUTLINE_BUTTON } from "./ai-buttons";

function statusLine(status: AiAgentStatus, showModel: boolean): Readonly<{ tone: "ok" | "warn" | "muted"; text: string }> {
  if (status.state === "off") return { tone: "muted", text: "ИИ-агент не подключён к CRM на сервере." };
  if (status.state === "unavailable") return { tone: "warn", text: aiErrorCopy("agent_unavailable") };
  if (status.block) return { tone: "warn", text: aiErrorCopy(status.block) };
  return status.keyAccepted
    ? { tone: "ok", text: `Gemini принимает ключ EVO${showModel && status.model ? ` · модель ${status.model}` : ""}.` }
    : { tone: "warn", text: "Gemini не принял ключ EVO — проверьте ключ в Google Cloud." };
}

/** «Память о клиенте» (P3): включает и выключает любой сотрудник с ai.agent.manage; без согласия на Gemini не включается, а выключение удаляет сводки всех клиентов. */
function MemoryBlock({ settings, preview, requestId }: Readonly<{ settings: AiSettings; preview: boolean; requestId: string }>) {
  const copy = AI_MEMORY_SETTINGS_COPY;
  const consent = settings.consent.recorded;
  return (
    <section id="ai-memory" aria-labelledby="ai-memory-title" className="grid scroll-mt-20 gap-2 border-t border-border pt-4" data-testid="v3-ai-memory-settings" data-enabled={settings.memoryEnabled}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id="ai-memory-title" className="t-item text-fg">{copy.title}</h3>
        <StatusBadge label={settings.memoryEnabled ? copy.on : copy.off} tone={settings.memoryEnabled ? "ok" : "neutral"} />
      </div>
      <p className="max-w-[70ch] text-pretty t-body-compact text-fg-2">{copy.about}</p>
      {settings.memoryEnabled && !consent ? (
        <p className="flex items-start gap-2 t-body-compact text-warn" data-testid="v3-ai-memory-no-consent"><AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Без согласия на Gemini память не работает: сводки не собираются.</p>
      ) : null}
      {settings.canManage && !preview ? <AiMemoryToggle enabled={settings.memoryEnabled} consentRecorded={consent} version={settings.version} requestId={requestId} action={saveAiMemoryAction} buttonClassName={AI_OUTLINE_BUTTON} /> : null}
    </section>
  );
}

/**
 * «Агент и лимит»: подключён ли агент и принял ли Gemini ключ (на виду — это состояние работы), модели и лимит запросов (видит администратор), месячный
 * лимит расходов, согласие на передачу текстов в Gemini и его отзыв (отзыв ещё и выключает память и удаляет сводки — сказано рядом) и память о клиенте.
 */
export function AiAgentSettingsCard({ settings, agentStatus, preview, capRequestId, revokeRequestId, memoryRequestId, retryHref }: Readonly<{
  settings: AiSettings | null; agentStatus: AiAgentStatus; preview: boolean; capRequestId: string; revokeRequestId: string; memoryRequestId: string; retryHref: string;
}>) {
  const status = statusLine(agentStatus, settings?.isAdmin ?? false);
  const Icon = status.tone === "ok" ? CircleCheckIcon : status.tone === "warn" ? AlertTriangleIcon : LockIcon;
  return (
    <div data-testid="v3-ai-settings">
      <WidgetCard title="Агент и лимит" bodyClassName="grid gap-4">
        <p className={`flex items-start gap-2 t-body-compact ${status.tone === "ok" ? "text-ok" : status.tone === "warn" ? "text-warn" : "text-fg-2"}`} data-testid="v3-ai-agent-status">
          <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{status.text}
        </p>
        {settings === null ? (
          <p role="alert" className="t-body-compact text-fg-2" data-testid="v3-ai-unavailable">Не удалось загрузить настройки агента. <a href={retryHref} className="inline-flex min-h-11 items-center underline underline-offset-4">Повторить</a></p>
        ) : (
          <>
            {settings.isAdmin ? (
              <KeyFacts columns={4} facts={[
                { label: "Модель ответа", value: <span className="font-mono">{settings.models.answer}</span> },
                { label: "Быстрая модель", value: <span className="font-mono">{settings.models.fast}</span> },
                { label: "Эмбеддинги", value: <span className="font-mono">{settings.models.embedding}</span> },
                { label: "Лимит запросов", value: `${settings.ratePerMemberMinute} ответов в минуту на сотрудника` },
              ]} />
            ) : null}
            {settings.unpricedModels.length > 0 ? (
              <p className="flex items-start gap-2 rounded-card bg-warn-weak px-3 py-2 t-body-compact text-warn"><AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Нет цены на сегодня у {settings.unpricedModels.join(", ")} — пока так, ИИ-вызовы отклоняются.</p>
            ) : null}
            {settings.canManage && !preview
              ? <AiMonthlyCapForm capUsd={settings.monthlyCapUsd} expectedVersion={settings.version} requestId={capRequestId} />
              : <p className="t-body-compact text-fg-2">Месячный лимит — {formatUsd(settings.monthlyCapUsd)}.</p>}
            <div className="grid gap-1 t-body-compact text-fg-2" data-testid="v3-ai-consent-line">
              <p>{settings.consent.recorded
                ? `Согласие на передачу текстов в Gemini записано ${aiDateTime(settings.consent.at)}${settings.consent.byName ? ` · ${settings.consent.byName}` : ""}.`
                : "Согласие на передачу текстов в Gemini не записано."}</p>
              {settings.consent.recorded && settings.isAdmin && !preview ? (
                <details data-testid="v3-ai-consent-revoke">
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center t-label text-fg underline decoration-fg-3 underline-offset-4 hover:decoration-fg [&::-webkit-details-marker]:hidden">Отозвать согласие</summary>
                  <div className="grid gap-2 pb-2">
                    {settings.memoryEnabled ? <p className="max-w-[70ch] text-pretty t-body-compact text-fg">{AI_MEMORY_SETTINGS_COPY.revokeConfirm}</p> : null}
                    <AiActionForm requestId={revokeRequestId} action={recordAiConsentAction} fields={{ consent_action: "revoke" }}
                      label={settings.memoryEnabled ? AI_MEMORY_SETTINGS_COPY.revokeSubmit : "Отозвать — ИИ перестанет готовить ответы"} pendingLabel="Отзываю…" buttonClassName={AI_OUTLINE_BUTTON}
                      messages={{ saved: settings.memoryEnabled ? AI_MEMORY_SETTINGS_COPY.revoked : "Согласие отозвано. ИИ-вызовы отклоняются." }} />
                  </div>
                </details>
              ) : null}
            </div>
            <MemoryBlock settings={settings} preview={preview} requestId={memoryRequestId} />
          </>
        )}
      </WidgetCard>
    </div>
  );
}
