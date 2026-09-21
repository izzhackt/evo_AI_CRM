import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview } from "@/lib/platform-access";
import { PLATFORM_ORGANIZATION_TIMEZONE } from "@/lib/platform-organization-time";
import { Card } from "@/components/ui";
import { CasePaymentReceiptUpload } from "./CasePaymentReceiptUpload";
import { Pill } from "@/components/v3/Pill";
import { financeMoney } from "@/lib/platform-case-agreement-contract";
import { readCaseAgreement } from "@/lib/v3/case-agreement-source";
import {
  CaseAgreementPaymentForm,
  CaseAgreementTrancheEditor,
  CaseAgreementUploadContract,
} from "./CaseAgreementForms";

/**
 * «Договор и оплата» — the single unified block (OTH-3,
 * docs/EVO_OTHER_FABLE_PLAN_2026-09-19.md §«Деньги и договоры»). Renders on
 * the Money tab FIRST, replacing the old «Договор» card (tabs.tsx). Renders
 * no financial content when its read RPC refuses (42501). The independently
 * authorized contract slot remains available; it does not widen finance access.
 */
export async function CaseAgreementBlock({
  actor,
  studentCaseId,
  saleConditionsHref,
  contractWorkspace,
}: Readonly<{
  actor: ActivePlatformActor;
  studentCaseId: string | null;
  saleConditionsHref: string | null;
  contractWorkspace: React.ReactNode;
}>) {
  if (!studentCaseId) return contractWorkspace;
  const result = await readCaseAgreement(actor, studentCaseId);
  // FIX 6 (adversarial review): "forbidden" (42501) is a legitimate access
  // refusal — omit financial content. "unavailable" means something
  // actually broke (an outage, a malformed payload) and must say so instead
  // of silently vanishing — same alert-card pattern FinanceEntryWorkspace.tsx
  // uses.
  if (result.status === "forbidden") return contractWorkspace;
  if (result.status === "unavailable") {
    return (
      <div className="space-y-4" data-testid="v3-case-agreement">
        <Card title="Договор и оплата">
          <p role="alert" className="px-4 py-3 text-sm text-fg-2">
            Финансовые данные сейчас недоступны. Обновите страницу; новые финансовые операции пока остановлены.
          </p>
        </Card>
        {contractWorkspace}
      </div>
    );
  }
  const agreement = result.agreement;
  const canWrite = agreement.canWrite && !isStaffPreview(actor);
  const costCurrency = agreement.costCurrency;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: PLATFORM_ORGANIZATION_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const perCurrency = agreement.currencyMismatch
    ? Object.entries(
        agreement.tranches.reduce<Record<string, bigint>>((sums, tranche) => {
          sums[tranche.currency] = (sums[tranche.currency] ?? BigInt(0)) +
            BigInt(tranche.amountMinor);
          return sums;
        }, {}),
      )
    : [];

  return (
    <div data-testid="v3-case-agreement">
      <Card title="Договор и оплата">
        <div className="flex flex-col gap-4 px-4 py-3">
          <div>
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-fg-2">Стоимость услуг EVO</dt>
                <dd className="mt-1 font-semibold tabular-nums text-fg">
                  {agreement.costMinor === null ? "Не указана" : costCurrency
                    ? financeMoney(agreement.costMinor, costCurrency) : "Валюта не указана"}
                </dd>
              </div>
              {!agreement.currencyMismatch && costCurrency && agreement.costMinor !== null ? <>
                <div>
                  <dt className="text-sm text-fg-2">Оплачено с учётом возвратов</dt>
                  <dd className="mt-1 font-semibold tabular-nums text-fg">{financeMoney(agreement.paidMinor, costCurrency)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-fg-2">Остаток</dt>
                  <dd className="mt-1 font-semibold tabular-nums text-fg">{agreement.remainingMinor !== null
                    ? financeMoney(agreement.remainingMinor, costCurrency) : "—"}</dd>
                </div>
              </> : null}
            </dl>
            {agreement.currencyMismatch ? (
              <p className="mt-3 text-sm tabular-nums text-fg-2">
                Транши по валютам: {perCurrency.map(([currency, sum]) =>
                  financeMoney(sum.toString(), currency)
                ).join(" · ")}
              </p>
            ) : agreement.costMismatch && costCurrency ? (
              <p className="mt-3 text-sm text-fg-2">
                Сумма траншей: {financeMoney(agreement.trancheSumMinor, costCurrency)}.
              </p>
            ) : null}
            {saleConditionsHref ? (
              <a className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" href={saleConditionsHref}>
                Условия продажи
              </a>
            ) : null}
          </div>

          <section className="border-t border-border pt-4">
            <h3 className="mb-2 text-base font-semibold text-fg">Договор</h3>
            {agreement.contractCurrent ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="min-w-0 flex-1 break-words text-fg">
                  {agreement.contractCurrent.originalFilename}
                </span>
                <span className="text-xs text-fg-2">
                  {agreement.contractCurrent.uploadedByDisplayName ?? "—"} ·{" "}
                  {new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek" }).format(
                    new Date(agreement.contractCurrent.uploadedAt),
                  )}
                </span>
                <a
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  href={`/api/v2/case-contract-files/${studentCaseId}/${agreement.contractCurrent.id}/download`}
                >
                  Скачать
                </a>
              </div>
            ) : (
              <p className="text-sm text-fg-2">Договор ещё не загружен.</p>
            )}
            {agreement.contractHistory.length > 0 ? (
              <details className="mt-2">
                <summary className="min-h-11 cursor-pointer py-3 text-sm text-fg-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">История договоров</summary>
                <ul className="mt-1.5 space-y-1">
                  {agreement.contractHistory.map((file) => (
                    <li key={file.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                      <span className="min-w-0 flex-1 break-words text-fg-2">{file.originalFilename}</span>
                      <span className="text-xs text-fg-2">
                        {file.uploadedByDisplayName ?? "—"} ·{" "}
                        {new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek" }).format(
                          new Date(file.uploadedAt),
                        )}
                      </span>
                      <a
                        className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                        href={`/api/v2/case-contract-files/${studentCaseId}/${file.id}/download`}
                      >
                        Скачать
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {canWrite ? (
              <div className="mt-3"><CaseAgreementUploadContract studentCaseId={studentCaseId} /></div>
            ) : null}
          </section>

          {contractWorkspace}

          <section className="border-t border-border pt-4" data-testid="v3-case-agreement-tranches">
            <h3 className="mb-2 text-base font-semibold text-fg">Транши</h3>
            <ul className="divide-y divide-border">
              {agreement.tranches.map((tranche) => (
                <li key={tranche.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="min-w-0 flex-1 break-words text-sm font-medium text-fg">{tranche.label}</span>
                  <span className="shrink-0 font-mono text-sm tabular-nums text-fg">
                    {financeMoney(tranche.amountMinor, tranche.currency)}
                  </span>
                  <div className="flex w-full flex-wrap gap-x-4 gap-y-1 text-sm text-fg-2">
                    <span>{tranche.dueOn ? `До ${new Date(tranche.dueOn).toLocaleDateString("ru-RU", { timeZone: "UTC" })}` : "Срок не задан"}</span>
                    <span>Остаток {financeMoney(tranche.outstandingMinor, tranche.currency)}</span>
                    <span>Оплаты до вычета возвратов: {financeMoney(tranche.totalPaidMinor, tranche.currency)}</span>
                    {tranche.dueOn && tranche.dueOn < today && BigInt(tranche.outstandingMinor) > BigInt(0)
                      ? <Pill tone="danger">Просрочен</Pill> : null}
                  </div>
                  {canWrite ? (
                    <CaseAgreementTrancheEditor
                      studentCaseId={studentCaseId}
                      tranche={tranche}
                      canArchive={tranche.totalPaidMinor === "0"}
                    />
                  ) : null}
                </li>
              ))}
              {agreement.tranches.length === 0 ? (
                <li className="py-2 text-sm text-fg-2">Транши не заведены.</li>
              ) : null}
            </ul>
            {canWrite ? (
              <div className="mt-3">
                <CaseAgreementTrancheEditor studentCaseId={studentCaseId} tranche={null} canArchive={false} />
              </div>
            ) : null}
          </section>

          <section className="border-t border-border pt-4" data-testid="v3-case-agreement-payment">
            <h3 className="mb-2 text-base font-semibold text-fg">Оплаты и чеки</h3>
            <ul className="divide-y divide-border">
              {agreement.payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="text-xs text-fg-2">
                    {new Date(payment.occurredOn).toLocaleDateString("ru-RU", { timeZone: "UTC" })}
                  </span>
                  {payment.eventType === "refund" ? <Pill tone="warn">Возврат</Pill> : null}
                  <span className="shrink-0 font-mono text-sm tabular-nums text-fg">
                    {payment.eventType === "refund" ? "−" : ""}
                    {financeMoney(payment.amountMinor, payment.currency)}
                  </span>
                  <span className="text-xs text-fg-2">{payment.actorDisplayName ?? "—"}</span>
                  {canWrite && payment.eventType === "payment" && payment.receipts.length === 0 ? <CasePaymentReceiptUpload paymentEventId={payment.id} /> : null}
                  {payment.receipts.map((receipt) => (
                    <a
                      key={receipt.id}
                      className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                      href={`/api/v2/payment-receipt-files/${studentCaseId}/${receipt.id}/download`}
                    >
                      Чек
                    </a>
                  ))}
                </li>
              ))}
              {agreement.payments.length === 0 ? (
                <li className="py-2 text-sm text-fg-2">Оплат ещё нет.</li>
              ) : null}
            </ul>
            {canWrite && agreement.tranches.length > 0 ? (
              <div className="mt-3">
                <CaseAgreementPaymentForm studentCaseId={studentCaseId} tranches={agreement.tranches} />
              </div>
            ) : null}
          </section>
        </div>
      </Card>
    </div>
  );
}
