import type { ReactNode } from "react";

import { CaseHeader } from "../CaseHeader";
import { caseFactValues } from "../CaseOverview";
import type { CaseNextSource } from "../CaseWorkParts";
import { CaseNextOverview } from "./CaseNextOverview";
import { SummaryCard } from "./SummaryCard";

/**
 * Карточка дела (`?case=`) в «Новом виде»: та же сборка, что у прежнего вида (`caseWorkParts`), другая разметка.
 * Сводка - этап, «Что дальше», состояние (прежняя `CaseHeader` без своих линий: предупреждения и «Назначить куратора»
 * остаются в ней) и четыре ключевых данных: куратор, направление, документы, оплата. «Обзор» - виджеты.
 * Ссылки «Открыть документы / вузы / договор / переписку» не рисуются: те же переходы есть у вкладок и у «Написать».
 */
export function caseNextParts(source: CaseNextSource, actions: ReactNode): Readonly<{ header: ReactNode; overview: ReactNode; actions: ReactNode }> {
  const values = caseFactValues(source.overview, { links: false });
  const header = (
    <>
      {source.mark}
      <SummaryCard
        testId="v3-case-summary"
        facts={[
          { label: "Куратор", value: values.curator },
          { label: "Направление", value: values.direction },
          { label: "Документы", value: values.documents },
          { label: "Оплата", value: values.payment },
        ]}
      >
        <CaseHeader {...source.header} bare />
      </SummaryCard>
    </>
  );
  return { header, overview: <CaseNextOverview input={source.overview} values={values} />, actions };
}
