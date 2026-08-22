import { randomUUID } from "node:crypto";

import { PlatformStopFactorsSection } from "@/components/platform/finance/PlatformStopFactorsSection";
import { ContextBanner, QueueMetrics } from "@/components/platform/operations/OperationsPrimitives";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { requirePlatformFinanceActor } from "@/lib/platform-guards";
import {
  createPlatformStopFactorAction,
  resolvePlatformStopFactorAction,
} from "@/lib/platform-stop-factors-actions";
import {
  listPlatformStopFactorObligations,
  listPlatformStopFactorOwners,
  listPlatformStopFactorPaymentEvents,
  listPlatformStopFactors,
  type PlatformStopFactor,
  type PlatformStopFactorObligation,
} from "@/lib/platform-stop-factors";
import type { PlatformStopFactorsResult } from "@/components/platform/finance/PlatformStopFactorsSection";

type FinanceSearchParams = Record<string, string | string[] | undefined>;

const RESULTS = ["saved", "invalid", "unavailable"] as const;

function single(
  params: FinanceSearchParams,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

function parseResult(
  params: FinanceSearchParams,
): PlatformStopFactorsResult | null {
  const value = single(params, "p6f_result");
  return (RESULTS as readonly string[]).includes(value ?? "")
    ? (value as PlatformStopFactorsResult)
    : null;
}

function totalsByCurrency(
  obligations: readonly PlatformStopFactorObligation[],
  locale: string,
): string {
  const sums = new Map<string, number>();
  for (const obligation of obligations) {
    sums.set(
      obligation.currency,
      (sums.get(obligation.currency) ?? 0) + obligation.outstandingMinor,
    );
  }
  const parts = [...sums.entries()]
    .filter(([, minor]) => minor > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, minor]) =>
      `${(minor / 100).toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} ${currency}`
    );
  return parts.length > 0 ? parts.join(" + ") : "0";
}

// Timestamps arrive with an explicit offset, so they are compared as instants
// rather than as strings.
function isOverdue(
  obligation: PlatformStopFactorObligation,
  nowMs: number,
): boolean {
  return obligation.outstandingMinor > 0
    && Date.parse(obligation.dueAt) < nowMs;
}

function overdueCount(
  obligations: readonly PlatformStopFactorObligation[],
  nowMs: number,
): number {
  return obligations.filter((obligation) => isOverdue(obligation, nowMs))
    .length;
}

function resolveRequestIdMap(
  stopFactors: readonly PlatformStopFactor[],
  retryRequestId: string | null,
  retryOperation: string | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const factor of stopFactors) {
    if (factor.status !== "active") continue;
    map[factor.stopFactorId] = randomUUID();
  }
  // A failed submit hands the same request id back so a retry replays the one
  // audited attempt instead of opening a second one.
  if (retryRequestId && retryOperation === "stop-resolve") {
    const first = Object.keys(map)[0];
    if (first !== undefined) map[first] = retryRequestId;
  }
  return map;
}

export default async function PlatformFinancePage({
  searchParams,
}: {
  searchParams: FinanceSearchParams;
}) {
  const actor = await requirePlatformFinanceActor();
  const { t, locale } = await getT();

  const [stopFactors, obligations, paymentEvents, owners] = await Promise.all([
    listPlatformStopFactors(actor),
    listPlatformStopFactorObligations(actor),
    listPlatformStopFactorPaymentEvents(actor),
    listPlatformStopFactorOwners(actor),
  ]);

  const result = parseResult(searchParams);
  const retryRequestId = single(searchParams, "p6f_retry_request_id") ?? null;
  const retryOperation = single(searchParams, "p6f_retry_operation");
  const createRequestId = retryOperation === "stop-create" && retryRequestId
    ? retryRequestId
    : randomUUID();

  const active = stopFactors.filter((factor) => factor.status === "active");
  const nowMs = Date.parse(new Date().toISOString());

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("finance")}
        description={t("platformFinanceHint")}
      />

      <ContextBanner
        title={t("sourceBoundary")}
        description={t("platformFinanceSourceHint")}
        tone="neutral"
      />

      <QueueMetrics
        items={[
          {
            label: t("totalPending"),
            value: totalsByCurrency(obligations, locale),
            tone: "warn",
          },
          {
            label: t("overduePayments"),
            value: overdueCount(obligations, nowMs),
            tone: overdueCount(obligations, nowMs) ? "danger" : "ok",
          },
          {
            label: t("stopFactorsActive"),
            value: active.length,
            tone: active.length ? "danger" : "ok",
          },
          {
            label: t("payments"),
            value: obligations.length,
            tone: "info",
          },
        ]}
      />

      <Card title={t("payments")}>
        {obligations.length === 0
          ? <EmptyState text={t("noResults")} />
          : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead className="border-b border-border text-[11px] uppercase tracking-[0.04em] text-fg-3">
                  <tr>
                    <th className="py-2 pr-4 font-semibold">{t("payment")}</th>
                    <th className="py-2 pr-4 text-right font-semibold">
                      {t("amount")}
                    </th>
                    <th className="py-2 pr-4 font-semibold">{t("dueDate")}</th>
                    <th className="py-2 font-semibold">{t("status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {obligations.map((obligation) => {
                    const blocked = active.some(
                      (factor) =>
                        factor.paymentObligationId
                          === obligation.paymentObligationId,
                    );
                    const overdue = isOverdue(obligation, nowMs);
                    const status = obligation.outstandingMinor === 0
                      ? "paid"
                      : overdue
                      ? "overdue"
                      : "pending";
                    return (
                      <tr key={obligation.paymentObligationId}>
                        <td className="py-2 pr-4">
                          <span className="font-semibold text-fg">
                            {obligation.label}
                          </span>
                          <span className="ml-2 font-mono text-[11.5px] text-fg-3">
                            {obligation.studentCaseId.slice(0, 8)}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right font-mono font-semibold text-fg">
                          {`${(obligation.outstandingMinor / 100).toLocaleString(
                            locale,
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            },
                          )} ${obligation.currency}`}
                        </td>
                        <td className="py-2 pr-4 font-mono text-[12.5px] text-fg-2">
                          {new Date(obligation.dueAt).toLocaleDateString(locale)}
                        </td>
                        <td className="py-2">
                          <Badge value={status} label={t(`pay.${status}`)} />
                          {blocked && (
                            <Badge
                              value="stop_active"
                              label={t("stopFactorActive")}
                              className="ml-2"
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <PlatformStopFactorsSection
        t={t}
        locale={locale}
        stopFactors={stopFactors}
        obligations={obligations}
        paymentEvents={paymentEvents}
        owners={owners}
        canOverride={actor.platformRole === "admin"}
        createRequestId={createRequestId}
        resolveRequestIds={resolveRequestIdMap(
          stopFactors,
          retryRequestId,
          retryOperation,
        )}
        result={result}
        createAction={createPlatformStopFactorAction}
        resolveAction={resolvePlatformStopFactorAction}
      />
    </div>
  );
}
