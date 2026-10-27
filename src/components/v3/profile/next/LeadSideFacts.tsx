import Link from "next/link";

import { KeyFacts, type KeyFact } from "@/components/kit/KeyFacts";
import { Icon } from "@/components/icons";

import { HandoffResponseSummary } from "../ProfileSalesTransition";
import { readLeadInterestState, type LeadInterestState } from "../LeadInterestFact";
import type { LeadNextSource } from "../LeadWorkParts";
import { NamedCard } from "./NamedCard";

const LINK = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";

/**
 * «Интересует» читается отдельно (`readLeadInterestState`, как у прежней строки «Сведений»): карточка ждёт это
 * чтение за своей границей `Suspense`, остальная страница рисуется сразу.
 */
export async function LeadSideFactsLoader({ source }: Readonly<{ source: LeadNextSource }>) {
  return <LeadSideFacts source={source} interest={await readLeadInterestState(source.leadId)} />;
}

/**
 * «Сведения» лида в «Новом виде»: то, что осталось после сводки, - почта, источник, «Откуда узнал», «Интересует»,
 * несколько переписок, «Приём дела». Нет значения - строки нет; сбой чтения «Интересует» называется словами.
 */
export function LeadSideFacts({ source, interest }: Readonly<{ source: LeadNextSource; interest: LeadInterestState | null }>) {
  const { facts } = source;
  const items: KeyFact[] = [
    {
      label: "Почта",
      value: facts.email ? (
        <a href={`mailto:${facts.email}`} className="flex min-h-11 w-fit max-w-full items-center break-all text-fg underline-offset-4 hover:underline">{facts.email}</a>
      ) : null,
    },
    {
      label: "Источник",
      value: (
        <>
          {facts.source}
          {facts.arrived ? <span className="text-fg-2"> · <time dateTime={facts.arrived.iso} className="font-mono tabular-nums">{facts.arrived.label}</time></span> : null}
        </>
      ),
    },
    { label: "Откуда узнал", value: facts.channel },
    {
      label: "Интересует",
      value: interest?.status === "value" ? <span data-testid="v3-lead-interest">{interest.direction}</span>
        : interest?.status === "error" ? <span role="alert" className="text-fg-2">не прочитано</span> : null,
    },
    {
      label: "Переписка",
      value: facts.conversations.length > 0 ? (
        <>{facts.conversations.map((conversation) => (
          <Link key={conversation.id} href={conversation.href} className={`${LINK} flex w-fit`}>{conversation.subject}</Link>
        ))}</>
      ) : null,
    },
    {
      label: "Приём дела",
      value: facts.answer ? (
        <>
          <HandoffResponseSummary current={facts.answer.current} />
          {facts.answer.href ? <Link href={facts.answer.href} className={`${LINK} flex w-fit`}>Ответить в деле</Link> : null}
        </>
      ) : null,
    },
  ];
  return (
    <NamedCard title="Сведения" id="lead-facts" testId="v3-lead-facts">
      <KeyFacts facts={items} columns={1} />
    </NamedCard>
  );
}

/** Телефон лида: ссылка набора с номером из карточки. */
export function PhoneValue({ phone }: Readonly<{ phone: string }>) {
  return (
    <a href={`tel:${phone.replace(/[^\d+]/gu, "")}`} className="flex min-h-11 w-fit items-center gap-1.5 tabular-nums text-fg underline-offset-4 hover:underline">
      <Icon name="phone" size={16} className="shrink-0 text-fg-3" />{phone}
    </a>
  );
}
