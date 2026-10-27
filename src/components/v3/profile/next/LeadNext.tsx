import type { ReactNode } from "react";

import { HelpTip } from "@/components/kit/HelpTip";

import { Initials } from "../../blocks/Initials";
import type { LeadNextSource } from "../LeadWorkParts";
import { LeadNextOverview } from "./LeadNextOverview";
import { PhoneValue } from "./LeadSideFacts";
import { SummaryCard, SummaryCell } from "./SummaryCard";

/**
 * Карточка лида (`?id=`) в «Новом виде»: та же сборка, что у прежнего вида (`leadWorkParts`), другая разметка.
 * Шапка - действия (набор номера: подсказка о том, как он работает, ушла за «?»); сводка - этап, «Что дальше»
 * и три ключевых данных; «Обзор» - виджеты. Чтения, права и серверные действия те же.
 */
export function leadNextParts(source: LeadNextSource): Readonly<{ header: ReactNode; overview: ReactNode; actions: ReactNode }> {
  const { facts } = source;
  const actions = (
    <>
      {source.actions}
      {source.dialHint ? <HelpTip label="Пояснение: Позвонить" align="end">{source.dialHint}</HelpTip> : null}
    </>
  );
  const header = (
    <SummaryCard
      testId="v3-lead-summary"
      facts={[
        {
          label: "Ответственный",
          value: facts.owner
            ? <span className="inline-flex items-center gap-2"><Initials name={facts.owner} decorative />{facts.owner}</span>
            : <span className="text-fg-2">не назначен</span>,
        },
        { label: "Телефон", value: facts.phone ? <PhoneValue phone={facts.phone} /> : null },
        {
          label: "Последний контакт",
          value: facts.lastContact
            ? <><time dateTime={facts.lastContact.at} className="font-mono tabular-nums">{facts.lastContact.label}</time><span className="text-fg-2"> · {facts.lastContact.what}</span></>
            : <span className="text-fg-2">не записан</span>,
        },
      ]}
    >
      <section className="flex flex-col gap-3" data-testid="v3-lead-header" aria-label="Этап и следующий шаг">
        <dl className="grid grid-cols-1 sm:flex sm:flex-wrap">
          <SummaryCell term="Этап">{source.stage}</SummaryCell>
          <SummaryCell term="Что дальше" wide>{source.nextStep}</SummaryCell>
        </dl>
        {source.financeStop ? <p className="t-body-compact font-medium text-danger">Финансовый стоп: {source.financeStop}</p> : null}
        {source.stepDrawer}
      </section>
    </SummaryCard>
  );
  return { header, overview: <LeadNextOverview source={source} />, actions };
}
