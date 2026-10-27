"use client";

import { CalendarIcon } from "lucide-react";

import { StatTile, WidgetCard } from "@/components/kit";
import { ReportTable } from "@/components/v3/admin-next/ReportTable";
import { AiAgentSettingsCard } from "./AiAgentSettingsCard";
import { AiUnavailableNext } from "./AiUnavailableNext";
import { aiLongDate, formatUsd, PURPOSE_GROUP_LABEL, type AiSpend } from "@/lib/v3/ai-agent";

import { plural } from "./ai-document-model";
import type { AiAgentNextBody } from "./ai-agent-next-types";

const KIND_WORD: Readonly<Record<string, string>> = { input: "вход", output: "выход", cached: "кэш", audio_input: "аудио", embedding: "эмбеддинги" };

/** Смена цен Gemini по дням и моделям («С 1 ноября меняются цены…»): видит администратор — модели и цены устройство сервера. */
function priceNotes(spend: AiSpend): readonly string[] {
  const byDay = new Map<string, Map<string, string[]>>();
  for (const change of spend.priceChanges) {
    const models = byDay.get(change.effectiveFrom) ?? new Map<string, string[]>();
    const parts = models.get(change.model) ?? [];
    const was = change.previousUsdPerMillion;
    parts.push(`${KIND_WORD[change.kind] ?? change.kind} ${was !== null ? `${formatUsd(was)} → ` : ""}${formatUsd(change.usdPerMillion)}`);
    models.set(change.model, parts);
    byDay.set(change.effectiveFrom, models);
  }
  return [...byDay.entries()].map(([day, models]) => `С ${aiLongDate(day)} меняются цены Gemini за 1 млн токенов: ${[...models.entries()].map(([model, parts]) => `${model} — ${parts.join(", ")}`).join("; ")}.`);
}

/**
 * «Расходы»: четыре числа (сегодня, месяц, прогноз, лимит) в долларах по Бишкеку, средняя цена ответа, расходы по назначению и «Агент и лимит».
 * Оценка помечена «≈» (эмбеддинги и прерванные вызовы не сообщают точные токены — это за «?»). Не прочиталось — слова и «Повторить», а не ноль.
 */
export function AiSpendNext({ spend, settings, agentStatus, preview, capRequestId, revokeRequestId, memoryRequestId, retryHref }: Extract<AiAgentNextBody, { kind: "spend" }>) {
  const admin = settings.status === "available" && settings.data.isAdmin;
  return (
    <div className="grid min-w-0 gap-4">
      {spend.status !== "available" ? <AiUnavailableNext what="расходы" retryHref={retryHref} /> : (() => {
        const data = spend.data;
        const groups = [...data.byGroup].sort((left, right) => right.usd - left.usd);
        const anyEstimated = data.monthEstimated || groups.some((group) => group.estimated);
        const notes = admin ? priceNotes(data) : [];
        const used = data.monthlyCapUsd > 0 ? Math.min(100, Math.round(((data.monthUsd + data.reservedUsd) / data.monthlyCapUsd) * 100)) : null;
        return (
          <div className="grid min-w-0 gap-4" data-testid="v3-ai-spend">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div data-testid="v3-ai-spend-today" className="contents"><StatTile label="Сегодня" value={formatUsd(data.todayUsd)} hint="день — по Бишкеку" /></div>
              <StatTile label="Этот месяц" value={formatUsd(data.monthUsd, data.monthEstimated)} hint={data.reservedUsd > 0 ? `и в работе ${formatUsd(data.reservedUsd)}` : `с ${aiLongDate(data.monthStart)}`} />
              <StatTile label="Прогноз на месяц" value={formatUsd(data.forecastUsd, data.monthEstimated)} hint="по темпу этого месяца" />
              <StatTile label="Лимит на месяц" value={formatUsd(data.monthlyCapUsd)}
                hint={data.monthlyCapUsd > 0 ? `осталось ${formatUsd(data.remainingUsd)}${used !== null ? ` · занято ${used}%` : ""}` : "ИИ-вызовы отклоняются"} />
            </div>
            <p className="t-body-compact text-fg-2" data-testid="v3-ai-spend-answer">
              {data.answers > 0 && data.averageAnswerUsd !== null
                ? <>Средняя цена ответа — <span className="tabular-nums text-fg">{formatUsd(data.averageAnswerUsd, data.monthEstimated)}</span> · {plural(data.answers, "ответ", "ответа", "ответов")} за месяц (с поиском).</>
                : "Ответов в этом месяце ещё не было — средней цены нет."}
            </p>
            <WidgetCard title="По назначению" help={anyEstimated ? "≈ — оценка: эмбеддинги и прерванные вызовы Gemini не сообщают точные токены." : undefined}>
              {groups.length === 0 ? <p className="t-body-compact text-fg-3">В этом месяце вызовов ещё не было.</p> : (
                <div data-testid="v3-ai-spend-groups">
                  <ReportTable label="Расходы по назначению" minWidth="min-w-[20rem]" columns={["Назначение", "Вызовы", "Сумма"]}
                    rows={groups.map((group) => ({ key: group.group, head: PURPOSE_GROUP_LABEL[group.group], cells: [group.calls.toLocaleString("ru-RU"), formatUsd(group.usd, group.estimated)] }))} />
                </div>
              )}
            </WidgetCard>
            {notes.length > 0 ? (
              <section aria-label="Смена цен" className="grid gap-1" data-testid="v3-ai-price-changes">
                {notes.map((note) => <p key={note} className="flex items-start gap-2 t-body-compact text-fg-2"><CalendarIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-3" />{note}</p>)}
              </section>
            ) : null}
          </div>
        );
      })()}
      <AiAgentSettingsCard settings={settings.status === "available" ? settings.data : null} agentStatus={agentStatus} preview={preview}
        capRequestId={capRequestId} revokeRequestId={revokeRequestId} memoryRequestId={memoryRequestId} retryHref={retryHref} />
    </div>
  );
}
