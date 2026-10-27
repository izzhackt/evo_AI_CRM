import Link from "next/link";
import type { ReactNode } from "react";

import { StatusBadge } from "@/components/kit";
import { requestOpenKey, requestsHref, type RequestRow } from "@/lib/requests-queue-contract";
import {
  REQUEST_SOURCE_WORDS,
  requestDisplayName,
  requestReceived,
  requestTriage,
  type RequestTriage,
} from "@/lib/v3/requests-view";

import { Initials } from "../blocks/Initials";
import type { ViewProps } from "../requests/RequestsQueueView";
import { TakeLeadButton } from "../requests/TakeLead";
import { DialButton } from "../telephony/DialButton";

/**
 * Строка таблицы «Заявок» нового вида. Поля-строки — то, по чему таблица ищет и сортирует (слова, которые видит
 * человек); `cells` — готовые ячейки с прежними действиями («Взять себе», «Позвонить»), собранные на сервере.
 */
export type NextRequestRow = Readonly<{
  key: string;
  /** Адрес «Заявок» с открытой записью (`?open=`): панель открывается адресом, как и раньше. */
  openHref: string;
  /** Момент прихода (ISO) — по нему сортируется «Пришла». */
  sortAt: string;
  name: string;
  source: string;
  received: string;
  triage: string;
  cells: Readonly<{ name: ReactNode; source: ReactNode; received: ReactNode; triage: ReactNode }>;
}>;

export function leadCardHref(leadId: string, listHref: string): string {
  return `/v3/profile?id=${encodeURIComponent(leadId)}&returnTo=${encodeURIComponent(listHref)}`;
}

export function rowLeadId(row: RequestRow): string | null {
  return row.kind === "consultation" ? null : row.leadId;
}

/** Слово разбора для поиска и сортировки: то, что человек видит в ячейке. */
function triageWord(triage: RequestTriage): string {
  switch (triage.kind) {
    case "take": return "Без ответственного";
    case "owner": return triage.name;
    case "untaken": return "Без ответственного";
    case "handed": return "Передан в поступление";
    case "state": return [triage.word, triage.by].filter(Boolean).join(" · ");
  }
}

function TriageCell({ row, triage, props, listHref }: Readonly<{ row: RequestRow; triage: RequestTriage; props: ViewProps; listHref: string }>) {
  switch (triage.kind) {
    case "take":
      return row.kind === "lead" && row.take ? (
        <TakeLeadButton leadId={row.leadId} take={row.take} actorMembershipId={props.actorMembershipId}
          requestId={props.takeRequestIds[row.leadId]} personName={requestDisplayName(row)} leadHref={leadCardHref(row.leadId, listHref)} />
      ) : null;
    case "owner":
      return (
        <span className="flex min-w-0 items-center gap-2 t-body-compact text-fg">
          {!triage.mine ? <Initials name={triage.name} decorative /> : null}
          <span className="min-w-0 truncate" title={triage.name}>{triage.name}</span>
        </span>
      );
    case "untaken": return <StatusBadge label="Без ответственного" />;
    case "handed": return <StatusBadge label="Передан в поступление" />;
    case "state": return <StatusBadge label={triageWord(triage)} />;
  }
}

/** Ячейки и слова одной заявки: имя (ссылка на карточку лида — при мыши), источник, «Пришла», разбор. */
export function buildRequestRow(row: RequestRow, props: ViewProps, listHref: string, now: Date): NextRequestRow {
  const key = requestOpenKey(row);
  const name = requestDisplayName(row);
  const leadId = rowLeadId(row);
  const received = requestReceived(row.occurredAt, now);
  const triage = requestTriage(row, { actorMembershipId: props.actorMembershipId, canAct: !props.readOnly });
  const source = REQUEST_SOURCE_WORDS[row.source];
  const callLine = leadId && row.source === "phone_call" ? props.callLines?.[leadId] ?? null : null;
  const dialLeadId = leadId && row.source === "phone_call" && props.dial?.status === "ready" && !props.readOnly ? leadId : null;
  return {
    key,
    openHref: requestsHref(props.selection, key),
    sortAt: row.occurredAt,
    name,
    source: [source, callLine].filter(Boolean).join(" "),
    received: `${received.text} ${received.word}`,
    triage: triageWord(triage),
    cells: {
      name: leadId ? <>
        <Link href={leadCardHref(leadId, listHref)} title={name}
          className="hidden min-h-11 max-w-full items-center rounded-nav underline-offset-2 hover:underline md:pointer-fine:inline-flex">
          <span className="truncate">{name}</span>
        </Link>
        <span className="block truncate md:pointer-fine:hidden" title={name}>{name}</span>
      </> : <span className="block truncate" title={name}>{name}</span>,
      source: <>
        {source}
        {callLine ? <span className="block t-meta text-fg" data-testid="requests-call-outcome">{callLine}</span> : null}
      </>,
      received: <span className="whitespace-nowrap">
        <time dateTime={received.dateTime} className="font-mono tabular-nums text-fg">{received.text}</time>{" "}
        <span className="t-meta text-fg-3">{received.word}</span>
      </span>,
      triage: <span className="flex min-w-0 flex-wrap items-center gap-2">
        <TriageCell row={row} triage={triage} props={props} listHref={listHref} />
        {dialLeadId && props.dial?.status === "ready" ? <DialButton leadId={dialLeadId} mapped={props.dial.mapped} subject={name} iconOnly sharedHint /> : null}
      </span>,
    },
  };
}
