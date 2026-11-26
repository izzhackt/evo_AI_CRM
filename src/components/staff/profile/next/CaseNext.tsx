import type { ReactNode } from "react";

import { CaseHeader } from "../CaseHeader";
import { caseFactValues } from "../CaseOverview";
import type { CaseNextSource } from "../CaseWorkParts";
import { caseSummaryParts } from "../case-summary-view";
import { CaseNextOverview } from "./CaseNextOverview";
import { SummaryCard } from "./SummaryCard";

/**
 * Вкладки, на которых строка «Документы · Оплата» не рисуется на телефоне, потому что её числа там уже есть: только «Обзор»
 * («Сведения»; чек-лист 23.11: до вкладок было около 530 px). На «Документах» в строке единственная оплата, на «Деньгах» -
 * единственные документы, поэтому на остальных вкладках она остаётся (информацию не прячем). От ширины `sm` она видна везде.
 */
export const CASE_SUMMARY_REPEATED_ON = ["overview"] as const;

/**
 * Карточка дела (`?case=`) в «Новом виде»: та же сборка, что у прежнего вида (`caseWorkParts`), другая разметка.
 * Сводка (06.11.2026) - этап, «Что дальше», состояние (прежняя `CaseHeader` без своих линий: предупреждения и «Назначить куратора»
 * остаются в ней) и одна строка «Документы 0/21 · Оплата 50%». Куратор и направление с их действиями - в «Сведениях» «Обзора»
 * (`CaseNextOverview`), там же подробности документов и оплаты. «Обзор» - виджеты.
 * Ссылки «Открыть документы / вузы / договор / переписку» не рисуются: те же переходы есть у вкладок и у «Написать».
 * `tab` - открытая вкладка: по ней на телефоне решается, рисовать ли строку сводки (`CASE_SUMMARY_REPEATED_ON`).
 */
export function caseNextParts(source: CaseNextSource, actions: ReactNode, tab: string | null = null): Readonly<{ header: ReactNode; overview: ReactNode; actions: ReactNode }> {
  const values = caseFactValues(source.overview, { links: false, flush: true });
  const parts = caseSummaryParts(source.overview);
  const header = (
    <>
      {source.mark}
      <SummaryCard
        testId="v3-case-summary"
        summaryFromSm={tab !== null && (CASE_SUMMARY_REPEATED_ON as readonly string[]).includes(tab)}
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
