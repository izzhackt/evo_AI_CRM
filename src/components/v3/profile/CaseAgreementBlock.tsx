import type { ReactNode } from "react";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview } from "@/lib/platform-access";
import { financeMoney, type CaseAgreement } from "@/lib/platform-case-agreement-contract";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";
import { readCaseAgreement } from "@/lib/v3/case-agreement-source";
import { caseMoneyWords } from "@/lib/v3/wording";

import { StatusChip } from "../blocks/StatusChip";
import {
  CaseAgreementPaymentForm,
  CaseAgreementTrancheEditor,
  CaseAgreementUploadContract,
} from "./CaseAgreementForms";
import { CaseMoneyOpen } from "./CaseMoney";
import { CasePaymentReceiptUpload } from "./CasePaymentReceiptUpload";
import {
  CASE_MONEY_PANEL,
  CASE_MONEY_ROW_ACTION,
  caseMoneySummary,
  caseTrancheState,
  moneyDay,
  moneyMomentDay,
} from "./case-money-view";

/**
 * Строка сводки: термин, значение и (не всегда) действие строки. От 36rem
 * листа — три колонки на волосяной линии, прижатые к верху: термин и
 * действие (цель 44 px) стоят на первой строке значения, многострочное
 * значение (договор, прежние версии) растёт вниз. Уже — термин над
 * значением, действие справа от него или, если не помещается, строкой ниже.
 */
export function MoneyRow({ term, children, action, testId }: Readonly<{
  term: string;
  children: ReactNode;
  action?: ReactNode;
  testId?: string;
}>) {
  // @xl: первая строка значения (t-body-compact, 21 px) и подпись термина
  // (t-caption, 16 px) — по центру 44 px цели действия: отступы 12 и 14 px.
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 border-b border-border py-1.5 last:border-b-0 @xl:grid @xl:grid-cols-[9rem_minmax(0,1fr)_auto] @xl:items-start @xl:py-0"
      data-testid={testId}
    >
      <dt className="basis-full pt-1 t-caption text-fg-2 @xl:pt-3.5">{term}</dt>
      <dd className="min-w-0 flex-1 basis-36 py-1 t-body-compact tabular-nums text-fg @xl:py-3">{children}</dd>
      {action ? <dd className="ms-auto flex min-w-0 items-center justify-end gap-x-4">{action}</dd> : null}
    </div>
  );
}

/**
 * Финансовый стоп — строкой сводки: слово чипом и причина, без боковой
 * полосы (шапка дела уже показывает «финансовый стоп»). «Стопы» открывает
 * панель управления стопами, если она есть у этого сотрудника.
 */
export function FinanceStopRow({ reason, stopsPanel }: Readonly<{ reason: string; stopsPanel: boolean }>) {
  return (
    <MoneyRow
      term={caseMoneyWords.rows.stop}
      testId="v3-case-money-stop"
      action={stopsPanel ? <CaseMoneyOpen panel={CASE_MONEY_PANEL.stops}>{caseMoneyWords.panels.stops}</CaseMoneyOpen> : null}
    >
      <span className="me-2 inline-block align-middle"><StatusChip label="стоп активен" tone="danger" /></span>
      {reason}
    </MoneyRow>
  );
}

/**
 * «Договор и оплата» — сводка дела по чтению 189 (OTH-3): отдельный запрос
 * к `staff_case_agreement_v1`. Отказ по правам (42501) — ни одной суммы,
 * только слова, что роли они не видны; сбой — честное «недоступно». Раздел
 * договора (подготовка по шаблону) живёт в панели «⋯» листа и от этого
 * чтения не зависит.
 */
export async function CaseAgreementBlock({
  actor,
  studentCaseId,
  saleConditionsHref,
  financeStop,
  stopsPanel,
}: Readonly<{
  actor: ActivePlatformActor;
  studentCaseId: string;
  saleConditionsHref: string | null;
  financeStop: string | null;
  stopsPanel: boolean;
}>) {
  const result = await readCaseAgreement(actor, studentCaseId);
  // FIX 6 (adversarial review): "forbidden" (42501) is a legitimate access
  // refusal — no financial content; "unavailable" means something actually
  // broke and must say so instead of silently vanishing.
  if (result.status !== "ok") {
    return (
      <div data-testid="v3-case-agreement">
        <p role={result.status === "unavailable" ? "alert" : undefined} className="py-3 t-body-compact text-fg-2">
          {result.status === "unavailable" ? caseMoneyWords.financeUnavailable : caseMoneyWords.financeHidden}
        </p>
        {financeStop ? <dl><FinanceStopRow reason={financeStop} stopsPanel={stopsPanel} /></dl> : null}
      </div>
    );
  }
  return (
    <CaseAgreementView
      agreement={result.agreement}
      canWrite={result.agreement.canWrite && !isStaffPreview(actor)}
      today={dayInOrganizationTimezone(new Date())}
      saleConditionsHref={saleConditionsHref}
      financeStop={financeStop}
      stopsPanel={stopsPanel}
    />
  );
}

const MUTED = "text-fg-2";
// Строки траншей и оплат: на узком листе — перенос по словам, от 42rem — колонки,
// суммы выровнены по правому краю своей колонки. У оплаты на узком листе
// «Транш · кто» — своей строкой под датой и суммой, чек — справа на строке суммы.
const TRANCHE_ROW = "flex flex-wrap items-center gap-x-4 border-b border-border py-1 @2xl:grid @2xl:grid-cols-[minmax(0,1fr)_8.5rem_5.5rem_minmax(0,15rem)_5rem]";
const PAYMENT_ROW = "flex flex-wrap items-center gap-x-4 border-b border-border py-1 @2xl:grid @2xl:grid-cols-[4rem_8.5rem_minmax(0,1fr)_auto]";

/**
 * Сводка строками (Стоимость · Договор · Оплачено · Остаток · Финансовый
 * стоп), под ней — транши и оплаты с чеками компактными строками. Даты —
 * «ДД.ММ» по Бишкеку моноширинным шрифтом. Суммы разных валют не
 * пересчитываются: оплачено и остаток — по каждой валюте.
 */
export function CaseAgreementView({
  agreement,
  canWrite,
  today,
  saleConditionsHref,
  financeStop,
  stopsPanel,
}: Readonly<{
  agreement: CaseAgreement;
  canWrite: boolean;
  /** День Бишкека `YYYY-MM-DD`: год в дате — только не текущий, просрочка транша. */
  today: string;
  saleConditionsHref: string | null;
  financeStop: string | null;
  stopsPanel: boolean;
}>) {
  const studentCaseId = agreement.studentCaseId;
  const summary = caseMoneySummary(agreement);
  const current = agreement.contractCurrent;
  const trancheLabel = new Map(agreement.tranches.map((tranche) => [tranche.id, tranche.label]));

  return (
    <div data-testid="v3-case-agreement">
      <dl>
        <MoneyRow
          term={caseMoneyWords.rows.cost}
          action={saleConditionsHref ? <a className={CASE_MONEY_ROW_ACTION} href={saleConditionsHref}>Условия продажи</a> : null}
        >
          {summary.cost ?? <span className={MUTED}>{summary.costWithoutCurrency ? "валюта не указана" : "не указана"}</span>}
        </MoneyRow>
        <MoneyRow
          term={caseMoneyWords.rows.contract}
          testId="v3-case-money-contract"
          action={current || canWrite ? <>
            {current ? (
              <a className={CASE_MONEY_ROW_ACTION} href={`/api/v2/case-contract-files/${studentCaseId}/${current.id}/download`}>
                Скачать
              </a>
            ) : null}
            {canWrite ? <CaseAgreementUploadContract studentCaseId={studentCaseId} replace={current !== null} /> : null}
          </> : null}
        >
          {current ? (
            <>
              <span className="block break-words">{current.originalFilename}</span>
              <span className="block t-meta text-fg-2">
                <time dateTime={current.uploadedAt} className="font-mono tabular-nums">{moneyMomentDay(current.uploadedAt, today)}</time>
                {current.uploadedByDisplayName ? ` · ${current.uploadedByDisplayName}` : null}
              </span>
            </>
          ) : <span className={MUTED}>не загружен</span>}
          {agreement.contractHistory.length > 0 ? (
            <details className="mt-0.5">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg [&::-webkit-details-marker]:hidden">
                Прежние версии · {agreement.contractHistory.length}
              </summary>
              <ul className="pb-1">
                {agreement.contractHistory.map((file) => (
                  <li key={file.id} className="flex flex-wrap items-center gap-x-3 t-meta text-fg-2">
                    <span className="min-w-0 break-words">{file.originalFilename}</span>
                    <time dateTime={file.uploadedAt} className="font-mono tabular-nums">{moneyMomentDay(file.uploadedAt, today)}</time>
                    <a className={CASE_MONEY_ROW_ACTION} href={`/api/v2/case-contract-files/${studentCaseId}/${file.id}/download`}>
                      Скачать
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </MoneyRow>
        <MoneyRow term={caseMoneyWords.rows.paid}>
          {summary.paid.length > 0 ? summary.paid.join(" · ") : <span className={MUTED}>оплат нет</span>}
          {summary.refunds ? <span className="block t-meta text-fg-2">с учётом возвратов</span> : null}
        </MoneyRow>
        <MoneyRow term={caseMoneyWords.rows.remaining}>
          {summary.remaining.values.length > 0 ? summary.remaining.values.join(" · ") : <span className={MUTED}>—</span>}
          {summary.remaining.note ? <span className="block t-meta text-fg-2">{summary.remaining.note}</span> : null}
        </MoneyRow>
        {financeStop ? <FinanceStopRow reason={financeStop} stopsPanel={stopsPanel} /> : null}
      </dl>

      <section className="mt-5" data-testid="v3-case-agreement-tranches" aria-labelledby={`${studentCaseId}-tranches`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 id={`${studentCaseId}-tranches`} className="t-item text-fg">Транши</h3>
          {summary.tranchesAgainstCost ? <p className="t-meta text-fg-2">{summary.tranchesAgainstCost}</p> : null}
        </div>
        <ul className="mt-1 border-t border-border">
          {agreement.tranches.map((tranche) => {
            const state = caseTrancheState(tranche, today);
            return (
              <li key={tranche.id} className={TRANCHE_ROW}>
                <span className="flex min-h-11 min-w-0 flex-1 basis-40 items-center break-words t-body-compact text-fg">{tranche.label}</span>
                <span className="t-body-compact tabular-nums text-fg @2xl:text-end">{financeMoney(tranche.amountMinor, tranche.currency)}</span>
                <span className="t-meta text-fg-2">
                  {tranche.dueOn ? <>до <time dateTime={tranche.dueOn} className="font-mono tabular-nums">{moneyDay(tranche.dueOn, today)}</time></> : "без срока"}
                </span>
                <span className="flex min-h-11 flex-wrap items-center gap-x-2">
                  {state === "paid" ? <StatusChip label="оплачен" tone="ok" /> : (
                    <span className="t-meta tabular-nums text-fg-2">осталось {financeMoney(tranche.outstandingMinor, tranche.currency)}</span>
                  )}
                  {state === "overdue" ? <StatusChip label="просрочен" tone="danger" /> : null}
                </span>
                {canWrite ? (
                  <CaseAgreementTrancheEditor studentCaseId={studentCaseId} tranche={tranche} canArchive={tranche.totalPaidMinor === "0"} />
                ) : null}
              </li>
            );
          })}
          {agreement.tranches.length === 0 ? <li className="py-2.5 t-body-compact text-fg-2">Траншей нет.</li> : null}
        </ul>
        {canWrite ? (
          <CaseAgreementTrancheEditor studentCaseId={studentCaseId} tranche={null} canArchive={false}
            addLabel={agreement.tranches.length === 0 ? "Разбить на транши" : "Добавить транш"} />
        ) : null}
      </section>

      <section className="mt-5" data-testid="v3-case-agreement-payment" aria-labelledby={`${studentCaseId}-payments`}>
        <h3 id={`${studentCaseId}-payments`} className="t-item text-fg">Оплаты и чеки</h3>
        <ul className="mt-1 border-t border-border">
          {agreement.payments.map((payment) => (
            <li key={payment.id} className={PAYMENT_ROW}>
              <time dateTime={payment.occurredOn} className="flex min-h-11 items-center font-mono t-meta tabular-nums text-fg-2">{moneyDay(payment.occurredOn, today)}</time>
              <span className="t-body-compact tabular-nums text-fg @2xl:text-end">
                {payment.eventType === "refund" ? "−" : ""}
                {financeMoney(payment.amountMinor, payment.currency)}
              </span>
              <span className="order-last flex min-w-0 basis-full flex-wrap items-center gap-x-2 break-words pb-1 t-meta text-fg-2 @2xl:order-none @2xl:pb-0">
                {payment.eventType === "refund" ? <StatusChip label="возврат" tone="warn" /> : null}
                {[trancheLabel.get(payment.obligationId), payment.actorDisplayName].filter(Boolean).join(" · ")}
              </span>
              <span className="ms-auto flex items-center justify-end gap-x-4">
                {payment.receipts.map((receipt) => (
                  <a
                    key={receipt.id}
                    className={CASE_MONEY_ROW_ACTION}
                    href={`/api/v2/payment-receipt-files/${studentCaseId}/${receipt.id}/download`}
                  >
                    Чек
                  </a>
                ))}
                {canWrite && payment.eventType === "payment" && payment.receipts.length === 0 ? <CasePaymentReceiptUpload paymentEventId={payment.id} /> : null}
              </span>
            </li>
          ))}
          {agreement.payments.length === 0 ? <li className="py-2.5 t-body-compact text-fg-2">Оплат ещё нет.</li> : null}
        </ul>
        {canWrite && agreement.tranches.length > 0 ? (
          <CaseAgreementPaymentForm studentCaseId={studentCaseId} tranches={agreement.tranches} />
        ) : null}
      </section>
    </div>
  );
}
