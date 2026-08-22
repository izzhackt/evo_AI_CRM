import {
  Badge,
  Card,
  EmptyState,
  btnCls,
  btnGhostCls,
  cn,
  inputCls,
  labelCls,
} from "@/components/ui";
import { ContextBanner } from "@/components/platform/operations/OperationsPrimitives";
import type {
  PlatformStopFactor,
  PlatformStopFactorObligation,
  PlatformStopFactorOwnerOption,
  PlatformStopFactorPaymentEvent,
} from "@/lib/platform-stop-factors";

type ServerFormAction = (formData: FormData) => void | Promise<void>;
type Translate = (key: string) => string;

export type PlatformStopFactorsResult = "saved" | "invalid" | "unavailable";

export type PlatformStopFactorsSectionProps = Readonly<{
  t: Translate;
  locale: string;
  stopFactors: readonly PlatformStopFactor[];
  obligations: readonly PlatformStopFactorObligation[];
  paymentEvents: readonly PlatformStopFactorPaymentEvent[];
  owners: readonly PlatformStopFactorOwnerOption[];
  canOverride: boolean;
  createRequestId: string;
  resolveRequestIds: Readonly<Record<string, string>>;
  result: PlatformStopFactorsResult | null;
  createAction: ServerFormAction;
  resolveAction: ServerFormAction;
}>;

function money(minor: number, currency: string, locale: string): string {
  return `${(minor / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function day(value: string, locale: string): string {
  return new Date(value).toLocaleDateString(locale);
}

function shortCase(studentCaseId: string): string {
  return studentCaseId.slice(0, 8);
}

export function PlatformStopFactorsSection({
  t,
  locale,
  stopFactors,
  obligations,
  paymentEvents,
  owners,
  canOverride,
  createRequestId,
  resolveRequestIds,
  result,
  createAction,
  resolveAction,
}: PlatformStopFactorsSectionProps) {
  const obligationById = new Map(
    obligations.map((obligation) => [obligation.paymentObligationId, obligation]),
  );
  const active = stopFactors.filter((factor) => factor.status === "active");
  const resolved = stopFactors.filter((factor) => factor.status === "resolved");
  // A second block on the same obligation is rejected by the database, so an
  // obligation that already carries one is not offered again.
  const blockedObligationIds = new Set(
    active.map((factor) => factor.paymentObligationId),
  );
  const openObligations = obligations.filter(
    (obligation) => !blockedObligationIds.has(obligation.paymentObligationId),
  );
  const canCreate = openObligations.length > 0 && owners.length > 0;

  return (
    <section id="stop-factors" className="scroll-mt-24 space-y-4">
      <ContextBanner
        title={t("stopFactorsTitle")}
        description={t("stopFactorsHint")}
        tone={active.length > 0 ? "warning" : "neutral"}
      />

      {result !== null && (
        <ContextBanner
          title={t(`stopFactorResult.${result}`)}
          description={t(`stopFactorResultHint.${result}`)}
          tone={result === "saved" ? "neutral" : "warning"}
        />
      )}

      <Card title={t("stopFactorCreate")}>
        {canCreate
          ? (
            <form action={createAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="request_id" value={createRequestId} />
              <div className="sm:col-span-2">
                <label htmlFor="stop-obligation" className={labelCls}>
                  {t("stopFactorObligation")}
                </label>
                <select
                  id="stop-obligation"
                  name="payment_obligation_id"
                  required
                  className={inputCls}
                  defaultValue=""
                >
                  <option value="" disabled>
                    {t("stopFactorObligation")}…
                  </option>
                  {openObligations.map((obligation) => (
                    <option
                      key={obligation.paymentObligationId}
                      value={obligation.paymentObligationId}
                    >
                      {`${obligation.label} · ${
                        money(
                          obligation.outstandingMinor,
                          obligation.currency,
                          locale,
                        )
                      } · ${t("case")} ${shortCase(obligation.studentCaseId)}`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="stop-owner" className={labelCls}>
                  {t("stopFactorOwner")}
                </label>
                <select
                  id="stop-owner"
                  name="owner_membership_id"
                  required
                  className={inputCls}
                  defaultValue=""
                >
                  <option value="" disabled>
                    {t("stopFactorOwner")}…
                  </option>
                  {owners.map((owner) => (
                    <option key={owner.membershipId} value={owner.membershipId}>
                      {owner.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="stop-evidence" className={labelCls}>
                  {t("stopFactorEvidence")}
                </label>
                <input
                  id="stop-evidence"
                  name="evidence_ref"
                  required
                  maxLength={500}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="stop-blocked" className={labelCls}>
                  {t("stopFactorBlockedAction")}
                </label>
                <input
                  id="stop-blocked"
                  name="blocked_action"
                  required
                  maxLength={1000}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="stop-next" className={labelCls}>
                  {t("stopFactorNextAction")}
                </label>
                <input
                  id="stop-next"
                  name="next_action"
                  required
                  maxLength={1000}
                  className={inputCls}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="stop-reason" className={labelCls}>
                  {t("stopFactorReason")}
                </label>
                <input
                  id="stop-reason"
                  name="reason"
                  required
                  minLength={3}
                  maxLength={1000}
                  className={inputCls}
                />
              </div>
              <button type="submit" className={cn(btnCls, "sm:w-fit")}>
                {t("stopFactorCreate")}
              </button>
            </form>
          )
          : <EmptyState text={t("stopFactorCreateUnavailable")} />}
      </Card>

      <Card title={t("stopFactorsActive")}>
        {active.length === 0
          ? <EmptyState text={t("stopFactorsEmpty")} />
          : (
            <ul className="space-y-4">
              {active.map((factor) => {
                const obligation = obligationById.get(
                  factor.paymentObligationId,
                );
                const events = paymentEvents.filter(
                  (event) =>
                    event.paymentObligationId === factor.paymentObligationId,
                );
                return (
                  <li
                    key={factor.stopFactorId}
                    className="rounded-card border border-border bg-surface-2 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-fg">
                          {obligation?.label ?? t("stopFactorObligation")}
                        </p>
                        <p className="mt-1 font-mono text-[12px] text-fg-3">
                          {`${t("case")} ${shortCase(factor.studentCaseId)} · ${
                            t("stopFactorCreatedAt")
                          } ${day(factor.createdAt, locale)}`}
                        </p>
                      </div>
                      <Badge value="stop_active" label={t("stopFactorActive")} />
                    </div>

                    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <dt className="text-[11.5px] text-fg-3">
                          {t("stopFactorBlockedAction")}
                        </dt>
                        <dd className="mt-0.5 text-[13px] font-semibold text-fg">
                          {factor.blockedAction}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11.5px] text-fg-3">
                          {t("stopFactorNextAction")}
                        </dt>
                        <dd className="mt-0.5 text-[13px] text-fg">
                          {factor.nextAction}
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-[11.5px] text-fg-3">
                          {t("stopFactorReason")}
                        </dt>
                        <dd className="mt-0.5 text-[13px] text-fg-2">
                          {factor.reason}
                        </dd>
                      </div>
                    </dl>

                    <details className="mt-4 rounded-nav border border-border bg-surface">
                      <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-semibold text-accent marker:hidden">
                        {t("stopFactorResolve")}
                      </summary>
                      <form
                        action={resolveAction}
                        className="grid gap-3 border-t border-border px-4 py-4 sm:grid-cols-2"
                      >
                        <input
                          type="hidden"
                          name="stop_factor_id"
                          value={factor.stopFactorId}
                        />
                        <input
                          type="hidden"
                          name="request_id"
                          value={resolveRequestIds[factor.stopFactorId] ?? ""}
                        />
                        <div>
                          <label
                            htmlFor={`stop-kind-${factor.stopFactorId}`}
                            className={labelCls}
                          >
                            {t("stopFactorResolutionKind")}
                          </label>
                          <select
                            id={`stop-kind-${factor.stopFactorId}`}
                            name="resolution_kind"
                            required
                            className={inputCls}
                            defaultValue="payment_event"
                          >
                            <option value="payment_event">
                              {t("stopFactorByPayment")}
                            </option>
                            {canOverride && (
                              <option value="admin_override">
                                {t("stopFactorByOverride")}
                              </option>
                            )}
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor={`stop-event-${factor.stopFactorId}`}
                            className={labelCls}
                          >
                            {t("stopFactorPaymentEvent")}
                          </label>
                          <select
                            id={`stop-event-${factor.stopFactorId}`}
                            name="payment_event_id"
                            className={inputCls}
                            defaultValue=""
                          >
                            <option value="">—</option>
                            {events.map((event) => (
                              <option
                                key={event.paymentEventId}
                                value={event.paymentEventId}
                              >
                                {`${
                                  money(
                                    event.amountMinor,
                                    event.currency,
                                    locale,
                                  )
                                } · ${day(event.occurredAt, locale)}`}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <label
                            htmlFor={`stop-override-${factor.stopFactorId}`}
                            className={labelCls}
                          >
                            {t("stopFactorOverrideEvidence")}
                          </label>
                          <input
                            id={`stop-override-${factor.stopFactorId}`}
                            name="evidence_ref"
                            maxLength={500}
                            className={inputCls}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label
                            htmlFor={`stop-resolve-reason-${factor.stopFactorId}`}
                            className={labelCls}
                          >
                            {t("stopFactorReason")}
                          </label>
                          <input
                            id={`stop-resolve-reason-${factor.stopFactorId}`}
                            name="reason"
                            required
                            minLength={3}
                            maxLength={1000}
                            className={inputCls}
                          />
                        </div>
                        <p className="text-[12px] text-fg-3 sm:col-span-2">
                          {canOverride
                            ? t("stopFactorResolveRule")
                            : t("stopFactorOverrideOnlyAdmin")}
                        </p>
                        <button
                          type="submit"
                          className={cn(btnGhostCls, "sm:w-fit")}
                        >
                          {t("stopFactorResolve")}
                        </button>
                      </form>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
      </Card>

      {resolved.length > 0 && (
        <Card title={t("stopFactorsResolved")}>
          <ul className="space-y-3">
            {resolved.map((factor) => (
              <li
                key={factor.stopFactorId}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-fg">
                    {obligationById.get(factor.paymentObligationId)?.label
                      ?? t("stopFactorObligation")}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-fg-2">
                    {factor.resolutionReason}
                  </p>
                  <p className="mt-0.5 font-mono text-[11.5px] text-fg-3">
                    {`${t("case")} ${shortCase(factor.studentCaseId)} · ${
                      t("stopFactorResolvedAt")
                    } ${factor.resolvedAt ? day(factor.resolvedAt, locale) : "—"}`}
                  </p>
                </div>
                <Badge
                  value="stop_resolved"
                  label={factor.resolutionKind === "admin_override"
                    ? t("stopFactorByOverride")
                    : t("stopFactorByPayment")}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
