import type { ReactNode } from "react";

import { CaseHeader } from "../CaseHeader";
import { caseFactValues } from "../CaseOverview";
import type { CaseNextSource } from "../CaseWorkParts";
import { caseSummaryParts } from "../case-summary-view";
import { CaseNextOverview } from "./CaseNextOverview";
import { SummaryCard } from "./SummaryCard";

/**
 * Карточка дела (`?case=`) в «Новом виде»: та же сборка, что у прежнего вида (`caseWorkParts`), другая разметка.
 * Сводка (06.11.2026) - этап, «Что дальше», состояние (прежняя `CaseHeader` без своих линий: предупреждения и «Назначить куратора»
 * остаются в ней) и одна строка «Документы 0/21 · Оплата 50%». Куратор и направление с их действиями - в «Сведениях» «Обзора»
 * (`CaseNextOverview`), там же подробности документов и оплаты. «Обзор» - виджеты.
 * Ссылки «Открыть документы / вузы / договор / переписку» не рисуются: те же переходы есть у вкладок и у «Написать».
 */
export function caseNextParts(source: CaseNextSource, actions: ReactNode): Readonly<{ header: ReactNode; overview: ReactNode; actions: ReactNode }> {
  const values = caseFactValues(source.overview, { links: false, flush: true });
  const parts = caseSummaryParts(source.overview);
  const header = (
    <>
      {source.mark}
      <SummaryCard
        testId="v3-case-summary"
        summary={parts.length > 0 ? (
          <p className="t-body-compact flex flex-wrap items-baseline gap-x-2 text-fg" data-testid="v3-case-summary-line">
            {parts.map((part, index) => (
              <span key={part.key} className="inline-flex items-baseline gap-x-2">
                {index > 0 ? <span aria-hidden="true" className="text-fg-3">·</span> : null}
                <span><span className="text-fg-2">{part.label}</span>{" "}<span className="font-medium tabular-nums">{part.value}</span></span>
              </span>
            ))}
          </p>
        ) : undefined}
      >
        <CaseHeader {...source.header} bare />
      </SummaryCard>
    </>
  );
  return { header, overview: <CaseNextOverview input={source.overview} values={values} />, actions };
}
