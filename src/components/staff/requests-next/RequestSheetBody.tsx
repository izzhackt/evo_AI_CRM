import Link from "next/link";

import { KeyFacts } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { requestOpenKey, type RequestRow } from "@/lib/requests-queue-contract";
import { formatStudentApplicationAnswers } from "@/lib/student-application-presentation";
import { REQUEST_SOURCE_WORDS, requestDisplayName, requestReceived, requestTriage } from "@/lib/v3/requests-view";

import { ApplicationDecision } from "../admissions/StudentApplications";
import type { ViewProps } from "../requests/RequestsQueueView";
import { PortalConsultationDetails } from "../requests/PortalConsultations";
import { TakeLeadButton } from "../requests/TakeLead";
import { DialButton } from "../telephony/DialButton";
import { leadCardHref, rowLeadId } from "./requests-next-rows";

export type RequestSheetContent = Readonly<{
  key: string;
  title: string;
  description: string;
  body: React.ReactNode;
  footer: React.ReactNode;
}>;

/**
 * Содержимое панели заявки: ключевые данные и те же действия, что были в правой панели прежнего вида — «Взять себе»,
 * «Позвонить», решение по анкете, «Отметить обработанной». Команды, права и request_id не меняются; здесь только
 * расстановка. Вторичное (ответы анкеты) стоит в панели, а не на странице.
 */
export function requestSheetContent(row: RequestRow, props: ViewProps, listHref: string, now: Date): RequestSheetContent {
  const received = requestReceived(row.occurredAt, now);
  const triage = requestTriage(row, { actorMembershipId: props.actorMembershipId, canAct: !props.readOnly });
  const leadId = rowLeadId(row);
  const name = requestDisplayName(row);
  const callLine = row.kind === "lead" && row.source === "phone_call" ? props.callLines?.[row.leadId] ?? null : null;
  const owner = triage.kind === "owner" ? triage.name : triage.kind === "handed" ? "Передан в поступление" : "никто не взял";
  const facts = row.kind === "lead" ? [
    { label: "Звонок", value: callLine },
    { label: "Телефон", value: row.phone },
    { label: "Почта", value: row.email },
    { label: "Контакт", value: row.phone || row.email ? null : <span className="text-fg-2">не указан</span> },
    { label: "Ответственный", value: owner },
  ] : row.kind === "application" ? [
    { label: "Почта", value: row.email },
    { label: "Состояние", value: triage.kind === "state" ? triage.word : null },
  ] : [
    { label: "Состояние", value: triage.kind === "state" ? [triage.word, triage.by].filter(Boolean).join(" · ") : null },
  ];
  const body = (
    <div className="space-y-5" data-testid="requests-detail-panel">
      <KeyFacts facts={facts} columns={2} />
      {row.kind === "lead" && triage.kind === "take" && row.take ? (
        <TakeLeadButton leadId={row.leadId} take={row.take} actorMembershipId={props.actorMembershipId}
          requestId={props.takeRequestIds[row.leadId]} personName={name} leadHref={leadCardHref(row.leadId, listHref)} inPanel />
      ) : null}
      {row.kind === "lead" && row.source === "phone_call" && props.dial?.status === "ready" && !props.readOnly ? (
        <DialButton leadId={row.leadId} mapped={props.dial.mapped} subject={name} />
      ) : null}
      {row.kind === "application" ? <>
        <section className="space-y-3 border-t border-border pt-4" aria-label="Заполнено поступающим">
          <h3 className="t-item text-fg">Заполнено поступающим</h3>
          {/* Сведения со слов поступающего — риск ошибки: предупреждение остаётся на виду. */}
          <p className="t-meta text-fg-2">Сведения со слов поступающего, их нужно проверить.</p>
          <KeyFacts columns={2} facts={formatStudentApplicationAnswers(row.application.questionnaire)} />
        </section>
        {row.application.status === "pending" ? props.readOnly
          ? <p className="t-body-compact text-fg-2">В режиме просмотра решения недоступны.</p>
          : <ApplicationDecision application={row.application} requestId={props.decisionRequestId} quiet flat />
          : null}
      </> : null}
      {row.kind === "consultation" ? (
        <section className="border-t border-border pt-4" aria-label="Запрос консультации">
          <PortalConsultationDetails row={row.consultation} readOnly={props.readOnly} refreshHref={listHref} />
        </section>
      ) : null}
    </div>
  );
  return {
    key: requestOpenKey(row),
    title: name,
    description: `${REQUEST_SOURCE_WORDS[row.source]} · пришла ${received.text}, ${received.word}`,
    body,
    footer: leadId ? <Button variant="outline" asChild><Link href={leadCardHref(leadId, listHref)}>Открыть карточку лида</Link></Button> : null,
  };
}
