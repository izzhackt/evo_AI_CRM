import { KeyFacts, type KeyFact } from "@/components/kit/KeyFacts";
import { StatusBadge } from "@/components/kit/StatusBadge";
import { Button } from "@/components/ui/button";
import type { CaseAgreement } from "@/lib/platform-case-agreement-contract";
import { caseMoneyWords } from "@/lib/v3/wording";

import { CaseAgreementUploadContract } from "../../CaseAgreementForms";
import { CaseMoneyOpen } from "../../CaseMoney";
import { CASE_MONEY_PANEL, caseMoneySummary, caseScheduleRemaining, moneyMomentDay, moneyShort } from "../../case-money-view";
import { MoreSheet } from "../MoreSheet";

const MUTED = "text-fg-3";
const download = (caseId: string, fileId: string) => `/api/v2/case-contract-files/${caseId}/${fileId}/download`;

/** Финансовый стоп - на виду (риск): слово, причина и «Стопы», если панель есть у этого сотрудника. */
export function MoneyStop({ reason, stopsPanel }: Readonly<{ reason: string; stopsPanel: boolean }>) {
  return (
    <div className="grid gap-1 border-t border-border pt-3" data-testid="v3-case-money-stop">
      <p className="t-caption text-fg-3">{caseMoneyWords.rows.stop}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusBadge label="стоп активен" tone="danger" />
        {/* Узкая карточка: причина - своей строкой под значком и «Стопы» (иначе она остаётся колонкой в 1-2 слова); широкая - в одну строку. */}
        <span className="order-last min-w-0 basis-full break-words t-body-compact text-fg @lg:order-none @lg:flex-1 @lg:basis-0" data-testid="v3-case-money-stop-reason">{reason}</span>
        {stopsPanel ? <CaseMoneyOpen panel={CASE_MONEY_PANEL.stops}>{caseMoneyWords.panels.stops}</CaseMoneyOpen> : null}
      </div>
    </div>
  );
}

/**
 * Сводка: договор, оплачено и остаток; стоимость — только если её указали (10.11.2026: вписывать сумму договора каждый раз
 * неудобно, поэтому без неё остаток считается по графику платежей). Под ними действия с договором и условия продажи, затем
 * стоп. Суммы - из `caseMoneySummary` без нулевых копеек: суммы разных валют не пересчитываются.
 */
export function MoneySummary({ agreement, canWrite, today, saleConditionsHref, financeStop, stopsPanel }: Readonly<{
  agreement: CaseAgreement;
  canWrite: boolean;
  today: string;
  saleConditionsHref: string | null;
  financeStop: string | null;
  stopsPanel: boolean;
}>) {
  const summary = caseMoneySummary(agreement);
  const current = agreement.contractCurrent;
  const caseId = agreement.studentCaseId;
  const costKnown = summary.cost !== null || summary.costWithoutCurrency;
  const remaining = costKnown ? summary.remaining.values.map(moneyShort) : caseScheduleRemaining(agreement);
  const remainingNote = costKnown ? summary.remaining.note : null;
  // Стоимость - первой, если её указали; нет - её строки нет вовсе.
  const facts: KeyFact[] = [
    ...(costKnown ? [{
      label: caseMoneyWords.rows.cost,
      value: <span className="tabular-nums">{summary.cost ? moneyShort(summary.cost) : <span className={MUTED}>валюта не указана</span>}</span>,
    }] : []),
    {
      label: caseMoneyWords.rows.contract,
      // Имя файла часто служебное (длинный хеш) — на экране день и кто загрузил, имя файла — в подсказке.
      value: current ? (
        <span data-testid="v3-case-money-contract" title={current.originalFilename}>
          от <time dateTime={current.uploadedAt} className="tabular-nums">{moneyMomentDay(current.uploadedAt, today)}</time>
          {current.uploadedByDisplayName ? <span className="block t-meta text-fg-3">{current.uploadedByDisplayName}</span> : null}
        </span>
      ) : <span className={MUTED} data-testid="v3-case-money-contract">не загружен</span>,
    },
    {
      label: caseMoneyWords.rows.paid,
      value: (
        <span className="tabular-nums">
          {summary.paid.length > 0 ? summary.paid.map(moneyShort).join(" · ") : <span className={MUTED}>оплат нет</span>}
          {summary.refunds ? <span className="block t-meta text-fg-3">с учётом возвратов</span> : null}
        </span>
      ),
    },
    {
      label: costKnown ? caseMoneyWords.rows.remaining : "Осталось по графику",
      value: (
        <span className="tabular-nums">
          {remaining.length > 0 ? remaining.join(" · ") : <span className={MUTED}>—</span>}
          {remainingNote ? <span className="block t-meta text-fg-3">{remainingNote}</span> : null}
        </span>
      ),
    },
  ];
  const history = agreement.contractHistory;
  const hasActions = current !== null || canWrite || history.length > 0 || saleConditionsHref !== null;
  return (
    <div className="grid grid-cols-1 gap-3">
      <KeyFacts facts={facts} columns={facts.length === 4 ? 4 : 3} />
      {hasActions ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3" data-testid="v3-case-money-actions">
          {current ? <Button asChild variant="outline"><a href={download(caseId, current.id)}>Скачать договор</a></Button> : null}
          {canWrite ? <div className="[&>div]:items-start [&>div]:text-start"><CaseAgreementUploadContract studentCaseId={caseId} replace={current !== null} /></div> : null}
          {history.length > 0 ? (
            <MoreSheet label={`Прежние версии · ${history.length}`} title="Прежние версии договора" testId="v3-case-money-history">
              <ul className="divide-y divide-border">
                {history.map((file) => (
                  <li key={file.id} className="flex flex-wrap items-center justify-between gap-x-3 py-2">
                    <span className="min-w-0 break-words t-body-compact text-fg">{file.originalFilename}</span>
                    <time dateTime={file.uploadedAt} className="font-mono t-meta tabular-nums text-fg-3">{moneyMomentDay(file.uploadedAt, today)}</time>
                    <Button asChild variant="ghost"><a href={download(caseId, file.id)}>Скачать</a></Button>
                  </li>
                ))}
              </ul>
            </MoreSheet>
          ) : null}
          {saleConditionsHref ? <Button asChild variant="ghost"><a href={saleConditionsHref}>Условия продажи</a></Button> : null}
        </div>
      ) : null}
      {financeStop ? <MoneyStop reason={financeStop} stopsPanel={stopsPanel} /> : null}
    </div>
  );
}
