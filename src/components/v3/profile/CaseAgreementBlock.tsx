import type { ActivePlatformActor } from "@/lib/platform-auth";
import { Card } from "@/components/ui";
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
 * nothing when there is no case yet, or the read RPC refuses (42501) — no
 * fake empty state; visibility follows the same card access every other
 * block already uses.
 */
export async function CaseAgreementBlock({
  actor,
  studentCaseId,
  saleConditionsHref,
}: Readonly<{
  actor: ActivePlatformActor;
  studentCaseId: string | null;
  saleConditionsHref: string;
}>) {
  if (!studentCaseId) return null;
  const result = await readCaseAgreement(actor, studentCaseId);
  // FIX 6 (adversarial review): "forbidden" (42501) is a legitimate access
  // refusal — render nothing, same as before. "unavailable" means something
  // actually broke (an outage, a malformed payload) and must say so instead
  // of silently vanishing — same alert-card pattern FinanceEntryWorkspace.tsx
  // uses.
  if (result.status === "forbidden") return null;
  if (result.status === "unavailable") {
    return (
      <div data-testid="v3-case-agreement">
        <Card title="Договор и оплата">
          <p role="alert" className="px-4 py-3 text-sm text-fg-2">
            Информация о договоре и оплате сейчас недоступна. Обновите страницу; новые операции пока остановлены.
          </p>
        </Card>
      </div>
    );
  }
  const agreement = result.agreement;

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
      <Card
        title="Договор и оплата"
        aside={
          agreement.costMinor === null ? (
            <a className="text-sm font-semibold text-accent hover:underline" href={saleConditionsHref}>
              Стоимость не указана
            </a>
          ) : agreement.currencyMismatch ? (
            // FIX 8 (adversarial review): label the per-currency sums
            // explicitly and never render "Оплачено"/"Остаток" numbers here
            // — the server cannot honestly aggregate mixed currencies into
            // one total, so it stays omitted rather than shown unlabeled.
            <span className="font-mono text-sm tabular-nums text-fg">
              Транши по валютам: {perCurrency.map(([currency, sum]) =>
                financeMoney(sum.toString(), currency)
              ).join(" · ")}
            </span>
          ) : (
            <span className="font-mono text-sm tabular-nums text-fg">
              {financeMoney(agreement.costMinor, agreement.costCurrency ?? "USD")}
              {" → "}
              {financeMoney(agreement.paidMinor, agreement.costCurrency ?? "USD")}
              {" → "}
              {agreement.remainingMinor !== null
                ? financeMoney(agreement.remainingMinor, agreement.costCurrency ?? "USD")
                : "—"}
            </span>
          )
        }
      >
        <div className="flex flex-col gap-4 px-4 py-3">
          {agreement.costMismatch ? (
            <p className="text-xs text-fg-3">
              Транши: {financeMoney(agreement.trancheSumMinor, agreement.costCurrency ?? "")} из{" "}
              {agreement.costMinor !== null
                ? financeMoney(agreement.costMinor, agreement.costCurrency ?? "")
                : "—"}
            </p>
          ) : null}

          {agreement.canWrite ? (
            <div className="flex flex-wrap gap-3">
              <CaseAgreementUploadContract studentCaseId={studentCaseId} />
            </div>
          ) : null}

          <section>
            {agreement.contractCurrent ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="min-w-0 flex-1 truncate text-fg">
                  {agreement.contractCurrent.originalFilename}
                </span>
                <span className="text-2xs text-fg-3">
                  {agreement.contractCurrent.uploadedByDisplayName ?? "—"} ·{" "}
                  {new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek" }).format(
                    new Date(agreement.contractCurrent.uploadedAt),
                  )}
                </span>
                <a
                  className="text-sm font-semibold text-accent hover:underline"
                  href={`/api/v2/case-contract-files/${studentCaseId}/${agreement.contractCurrent.id}/download`}
                >
                  Скачать
                </a>
              </div>
            ) : (
              <p className="text-sm text-fg-3">Договор ещё не загружен.</p>
            )}
            {agreement.contractHistory.length > 0 ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-fg-3">История</summary>
                <ul className="mt-1.5 space-y-1">
                  {agreement.contractHistory.map((file) => (
                    <li key={file.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                      <span className="min-w-0 flex-1 truncate text-fg-2">{file.originalFilename}</span>
                      <span className="text-2xs text-fg-3">
                        {file.uploadedByDisplayName ?? "—"} ·{" "}
                        {new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek" }).format(
                          new Date(file.uploadedAt),
                        )}
                      </span>
                      <a
                        className="text-xs font-semibold text-accent hover:underline"
                        href={`/api/v2/case-contract-files/${studentCaseId}/${file.id}/download`}
                      >
                        Скачать
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          <section data-testid="v3-case-agreement-tranches">
            <ul className="divide-y divide-border">
              {agreement.tranches.map((tranche) => (
                <li key={tranche.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="min-w-0 flex-1 text-sm text-fg">{tranche.label}</span>
                  <span className="shrink-0 font-mono text-sm tabular-nums text-fg">
                    {financeMoney(tranche.amountMinor, tranche.currency)}
                  </span>
                  {tranche.dueOn ? (
                    <span className="text-2xs text-fg-3">
                      до {new Date(tranche.dueOn).toLocaleDateString("ru-RU", { timeZone: "UTC" })}
                    </span>
                  ) : null}
                  <span className="text-2xs text-fg-3">
                    оплачено {financeMoney(tranche.totalPaidMinor, tranche.currency)}
                  </span>
                  {agreement.canWrite ? (
                    <CaseAgreementTrancheEditor
                      studentCaseId={studentCaseId}
                      tranche={tranche}
                      canArchive={tranche.totalPaidMinor === "0"}
                    />
                  ) : null}
                </li>
              ))}
              {agreement.tranches.length === 0 ? (
                <li className="py-2 text-sm text-fg-3">Транши не заведены.</li>
              ) : null}
            </ul>
            {agreement.canWrite ? (
              <div className="mt-3">
                <CaseAgreementTrancheEditor studentCaseId={studentCaseId} tranche={null} canArchive={false} />
              </div>
            ) : null}
          </section>

          <section data-testid="v3-case-agreement-payment">
            <ul className="divide-y divide-border">
              {agreement.payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="text-2xs text-fg-3">
                    {new Date(payment.occurredOn).toLocaleDateString("ru-RU", { timeZone: "UTC" })}
                  </span>
                  {payment.eventType === "refund" ? <Pill tone="warn">Возврат</Pill> : null}
                  <span className="shrink-0 font-mono text-sm tabular-nums text-fg">
                    {payment.eventType === "refund" ? "−" : ""}
                    {financeMoney(payment.amountMinor, payment.currency)}
                  </span>
                  <span className="text-2xs text-fg-3">{payment.actorDisplayName ?? "—"}</span>
                  {payment.receipts.map((receipt) => (
                    <a
                      key={receipt.id}
                      className="text-xs font-semibold text-accent hover:underline"
                      href={`/api/v2/payment-receipt-files/${studentCaseId}/${receipt.id}/download`}
                    >
                      Чек
                    </a>
                  ))}
                </li>
              ))}
              {agreement.payments.length === 0 ? (
                <li className="py-2 text-sm text-fg-3">Оплат ещё нет.</li>
              ) : null}
            </ul>
            {agreement.canWrite && agreement.tranches.length > 0 ? (
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
