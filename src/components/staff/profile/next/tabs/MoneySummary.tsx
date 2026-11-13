import { Icon } from "@/components/icons";
import { StatusBadge } from "@/components/kit/StatusBadge";
import type { CaseAgreement } from "@/lib/platform-case-agreement-contract";
import { caseMoneyWords } from "@/lib/v3/wording";

import { CaseAgreementUploadContract } from "../../CaseAgreementForms";
import { CaseMoneyOpen } from "../../CaseMoney";
import { CASE_MONEY_PANEL, caseMoneySummary, casePaidPercent, caseScheduleAgainstCost, caseScheduleRemaining, moneyMomentDay, moneyShort } from "../../case-money-view";
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
        <span className="order-last min-w-0 basis-full break-words t-body-compact text-fg @lg:order-none @lg:flex-1 @lg:basis-0" data-testid="v3-case-money-stop-reason">{reason}</span>
        {stopsPanel ? <CaseMoneyOpen panel={CASE_MONEY_PANEL.stops}>{caseMoneyWords.panels.stops}</CaseMoneyOpen> : null}
      </div>
    </div>
  );
}

/**
 * Одна строка: стоимость, оплачено, остаток и тонкая полоса. Договор — следующей строкой.
 * Суммы разных валют не пересчитываются; без стоимости полосы нет.
 */
export function MoneySummary({ agreement, canWrite, today, financeStop, stopsPanel }: Readonly<{
  agreement: CaseAgreement;
  canWrite: boolean;
  today: string;
  financeStop: string | null;
  stopsPanel: boolean;
}>) {
  const words = caseMoneyWords.pay;
  const summary = caseMoneySummary(agreement);
  const costKnown = summary.cost !== null || summary.costWithoutCurrency;
  const bySchedule = costKnown ? null : caseScheduleRemaining(agreement);
  const paid = summary.paid.map(moneyShort);
  const remaining = (bySchedule ? bySchedule.values : summary.remaining.values).map((value) => bySchedule ? value : moneyShort(value));
  const remainingNote = bySchedule ? bySchedule.note : summary.remaining.note;
  const costLabel = summary.cost
    ? words.cost
    : summary.costWithoutCurrency
      ? "валюта стоимости не указана"
      : "стоимость не указана";
  const percent = casePaidPercent(agreement);
  const against = caseScheduleAgainstCost(agreement);
  const current = agreement.contractCurrent;
  const caseId = agreement.studentCaseId;
  return (
    <div className="grid gap-3">
      <div data-testid="v3-case-money-summary">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {summary.cost ? <span className="t-record-title tabular-nums text-fg">{moneyShort(summary.cost)}</span> : null}
          <span className={`t-meta ${MUTED}`}>{costLabel}</span>
          <Sep />
          <span className="t-body-compact text-fg">{words.paid}{" "}<b className="font-semibold tabular-nums">{paid.length > 0 ? paid.join(" · ") : "—"}</b></span>
          {summary.refunds ? <span className="t-meta text-fg-3">с учётом возвратов</span> : null}
          <Sep />
          <span className="t-body-compact text-fg">{costKnown ? words.left : caseMoneyWords.rows.remainingBySchedule}{" "}
            <b className="font-semibold tabular-nums">{remaining.length > 0 ? remaining.join(" · ") : "—"}</b>
          </span>
          {remaining.length > 0 && remainingNote ? <span className="t-meta text-fg-3">{remainingNote}</span> : null}
        </p>
        {against ? <p className="pt-1 t-meta text-fg-3">{against}</p> : null}
        {percent !== null ? (
          <span className="v3-progress-track mt-2.5" style={{ width: "100%" }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-label={`${words.paid} ${Math.round(percent)}%`}>
            <span className="v3-progress-fill" style={{ width: `${percent}%` }} />
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3" data-testid="v3-case-money-actions">
        <span className="t-body-compact text-fg-3">{words.contract}</span>
        {current ? (
          <a className="inline-flex min-h-11 min-w-0 items-center gap-1.5 text-fg underline underline-offset-4" data-testid="v3-case-money-contract" href={download(caseId, current.id)} title={current.originalFilename}>
            <Icon name="file-text" size={16} />
            <span className="min-w-0 break-all">{current.originalFilename}</span>
          </a>
        ) : <span className={`t-body-compact ${MUTED}`} data-testid="v3-case-money-contract">не загружен</span>}
        {current ? <Sep /> : null}
        {current ? <time dateTime={current.uploadedAt} className="font-mono t-meta tabular-nums text-fg-3">{moneyMomentDay(current.uploadedAt, today)}</time> : null}
        {current?.uploadedByDisplayName ? <><Sep /><span className="t-meta text-fg-3">{current.uploadedByDisplayName}</span></> : null}
        {(canWrite || agreement.contractHistory.length > 0) ? <Sep /> : null}
        {canWrite ? <CaseAgreementUploadContract studentCaseId={caseId} replace={current !== null} inline /> : null}
        {agreement.contractHistory.length > 0 ? (
          <MoreSheet label={`Прежние версии · ${agreement.contractHistory.length}`} title="Прежние версии договора" testId="v3-case-money-history">
            <ul className="divide-y divide-border">
              {agreement.contractHistory.map((file) => (
                <li key={file.id} className="flex flex-wrap items-center justify-between gap-x-3 py-2">
                  <span className="min-w-0 break-words t-body-compact text-fg">{file.originalFilename}</span>
                  <time dateTime={file.uploadedAt} className="font-mono t-meta tabular-nums text-fg-3">{moneyMomentDay(file.uploadedAt, today)}</time>
                  <a className="inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4" href={download(caseId, file.id)}>Скачать</a>
                </li>
              ))}
            </ul>
          </MoreSheet>
        ) : null}
      </div>
      {financeStop ? <MoneyStop reason={financeStop} stopsPanel={stopsPanel} /> : null}
    </div>
  );
}

function Sep() {
  return <span className="text-fg-3" aria-hidden="true">·</span>;
}
