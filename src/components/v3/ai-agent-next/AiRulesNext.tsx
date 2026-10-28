"use client";

import { HistoryIcon } from "lucide-react";

import { DetailSheet, StatusBadge, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { AiActionForm } from "@/components/v3/ai-agent/AiActionForm";
import { AiRulesEditor } from "@/components/v3/ai-agent/AiRulesEditor";
import { confirmAiRulesAction } from "@/lib/platform-ai-agent-actions";
import { aiDateTime, RULE_SOURCE_LABEL } from "@/lib/v3/ai-agent";

import { AI_OUTLINE_BUTTON } from "./ai-buttons";
import { AiUnavailableNext } from "./AiUnavailableNext";
import type { AiAgentNextBody } from "./ai-agent-next-types";

/**
 * «Правила общения»: текущая версия (откуда, кто, когда; «нужна проверка» или «проверено» и кнопка «Проверено»), поле правил для того, кто управляет
 * агентом, или текст для чтения, и «История версий» в панели. Пока правил нет, агент отвечает только по постоянным правилам ответа — это на виду.
 */
export function AiRulesNext({ read, preview, editorRequestId, confirmRequestId, retryHref }: Extract<AiAgentNextBody, { kind: "rules" }>) {
  if (read.status !== "available") return <AiUnavailableNext what="«Правила общения»" retryHref={retryHref} />;
  const { current, versions } = read.data;
  const canManage = read.data.canManage && !preview;
  return (
    <div data-testid="v3-ai-rules">
      <WidgetCard
        title={current ? `Версия ${current.version}` : "Правил пока нет"}
        help="Правила общения задают тон и порядок ответов агента. Агент отвечает по ним вместе с материалами; без правил — только по постоянным правилам ответа."
        actions={(
          <DetailSheet title="История версий" trigger={<Button variant="outline"><HistoryIcon aria-hidden="true" />История версий</Button>}>
            <div data-testid="v3-ai-rules-history">
              {versions.length === 0 ? <p className="t-body-compact text-fg-3">Версий пока нет.</p> : (
                <ol className="divide-y divide-border">
                  {versions.map((version) => (
                    <li key={version.id} className="grid gap-0.5 py-2.5">
                      <p className="flex flex-wrap items-center gap-x-2 t-item text-fg">Версия {version.version}{version.current ? <StatusBadge label="текущая" /> : null}</p>
                      <p className="t-meta text-fg-3">{RULE_SOURCE_LABEL[version.source]}{version.createdByName ? ` · ${version.createdByName}` : ""} · {aiDateTime(version.createdAt)}</p>
                      <p className="t-meta text-fg-3">
                        {version.confirmedAt ? `проверено ${aiDateTime(version.confirmedAt)}` : "не проверена"} · {(version.bytes / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} КБ
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </DetailSheet>
        )}
        bodyClassName="grid gap-4"
      >
        {current ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="t-meta text-fg-3">{RULE_SOURCE_LABEL[current.source]}{current.createdByName ? ` · ${current.createdByName}` : ""} · {aiDateTime(current.createdAt)}</p>
            {current.needsReview
              ? <StatusBadge tone="warn" label="нужна проверка" />
              : <StatusBadge tone="ok" label={`проверено${current.confirmedByName ? ` · ${current.confirmedByName}` : ""}`} />}
            {current.needsReview && canManage ? (
              <AiActionForm requestId={confirmRequestId} action={confirmAiRulesAction} fields={{ rules_version_id: current.id }} label="Проверено" pendingLabel="Отмечаю…"
                buttonClassName={AI_OUTLINE_BUTTON} testId="v3-ai-rules-confirm" messages={{ saved: "Версия отмечена проверенной.", conflict: "Эту версию уже проверили — обновите страницу." }} />
            ) : null}
          </div>
        ) : <p className="t-body-compact text-fg-2">Агент отвечает только по постоянным правилам ответа, пока здесь нет текста.</p>}
        {canManage ? <AiRulesEditor initialBody={current?.body ?? ""} expectedVersion={current?.version ?? null} requestId={editorRequestId} />
          : current ? <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-card border border-border bg-surface px-4 py-3 font-sans t-body text-fg">{current.body}</pre> : null}
      </WidgetCard>
    </div>
  );
}
