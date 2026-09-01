import { Badge, btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";
import {
  configurePlatformPilotCohortAction,
  setPlatformStudentCasePilotMembershipAction,
} from "@/lib/platform-pilot-cohort-actions";
import type {
  PlatformPilotMembershipBasis,
  PlatformPilotMembershipStatus,
  PlatformPilotProvenance,
  PlatformPilotWriteBoundary,
  PlatformStudentCasePilotCohort,
} from "@/lib/platform-pilot-cohort";

export type PlatformPilotCohortCardLabels = Readonly<{
  title: string;
  hint: string;
  unavailable: string;
  resultSaved: string;
  resultInvalid: string;
  resultUnavailable: string;
  status: string;
  statusLabels: Readonly<Record<PlatformPilotMembershipStatus, string>>;
  basis: string;
  basisLabels: Readonly<Record<PlatformPilotMembershipBasis, string>>;
  notApplicable: string;
  reason: string;
  provenance: string;
  actor: string;
  changedAt: string;
  configuration: string;
  configurationMissing: string;
  configurationState: string;
  configurationActive: string;
  configurationPaused: string;
  cutoff: string;
  configurationVersion: string;
  counts: string;
  countOutside: string;
  countIncluded: string;
  countExcluded: string;
  countTotal: string;
  authority: string;
  evoOnly: string;
  canonicalTarget: string;
  canonicalAllowed: string;
  canonicalBlocked: string;
  legacyTarget: string;
  legacyBlocked: string;
  noFallback: string;
  history: string;
  historyEmpty: string;
  configure: string;
  saveConfiguration: string;
  include: string;
  exclude: string;
  manualReason: string;
  manualProvenance: string;
}>;

type MutationOutcome = "saved" | "invalid" | "unavailable";

function statusClass(status: PlatformPilotMembershipStatus): string {
  if (status === "included") return "bg-ok-weak text-ok";
  if (status === "excluded") return "bg-danger-weak text-danger";
  return "bg-surface-2 text-fg-2";
}

function outcomeMessage(
  outcome: MutationOutcome,
  labels: PlatformPilotCohortCardLabels,
): string {
  if (outcome === "saved") return labels.resultSaved;
  if (outcome === "invalid") return labels.resultInvalid;
  return labels.resultUnavailable;
}

function provenanceLabel(value: PlatformPilotProvenance): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  ));
}

function BoundaryRow({
  boundary,
  label,
  allowedLabel,
  blockedLabel,
}: Readonly<{
  boundary: PlatformPilotWriteBoundary;
  label: string;
  allowedLabel: string;
  blockedLabel: string;
}>) {
  return (
    <div className="rounded-ctl border border-border bg-surface-2 p-3">
      <dt className="text-2xs font-bold uppercase tracking-[0.06em] text-fg-3">
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm font-semibold ${boundary.allowed ? "text-ok" : "text-danger"}`}
      >
        {boundary.allowed ? allowedLabel : blockedLabel}
      </dd>
      <dd className="mt-1 font-mono text-2xs text-fg-3">
        {boundary.reasonCode}
      </dd>
    </div>
  );
}

export function PlatformPilotCohortCard({
  cohort,
  legacyWriteBoundary,
  unavailable,
  canManage,
  configurationRequestId,
  includeRequestId,
  excludeRequestId,
  outcome,
  labels,
}: Readonly<{
  cohort: PlatformStudentCasePilotCohort | null;
  legacyWriteBoundary: PlatformPilotWriteBoundary | null;
  unavailable: boolean;
  canManage: boolean;
  configurationRequestId: string;
  includeRequestId: string;
  excludeRequestId: string;
  outcome?: MutationOutcome;
  labels: PlatformPilotCohortCardLabels;
}>) {
  return (
    <section
      id="pilot-cohort"
      aria-labelledby="pilot-cohort-title"
      className="scroll-mt-24 rounded-card border border-border bg-surface p-4 shadow-evo sm:p-5"
      data-testid="platform-pilot-cohort-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="pilot-cohort-title" className="text-md font-bold text-fg">
            {labels.title}
          </h2>
          <p className="mt-1 max-w-[56ch] text-sm leading-5 text-fg-3">
            {labels.hint}
          </p>
        </div>
        {cohort && (
          <Badge
            value={cohort.membershipStatus}
            label={labels.statusLabels[cohort.membershipStatus]}
            className={statusClass(cohort.membershipStatus)}
          />
        )}
      </div>

      {outcome && (
        <p
          role="status"
          className="mt-3 rounded-ctl border border-border bg-surface-2 px-3 py-2 text-sm text-fg-2"
          data-testid={`platform-pilot-cohort-result-${outcome}`}
        >
          {outcomeMessage(outcome, labels)}
        </p>
      )}

      {unavailable || !cohort || !legacyWriteBoundary ? (
        <p
          className="mt-4 rounded-ctl border border-danger/20 bg-danger-weak p-3 text-sm text-danger"
          data-testid="platform-pilot-cohort-unavailable"
        >
          {labels.unavailable}
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-ctl bg-surface-2 p-3">
              <div className="text-2xs font-bold uppercase tracking-[0.06em] text-fg-3">
                {labels.status}
              </div>
              <div className="mt-1 text-sm font-semibold text-fg">
                {labels.statusLabels[cohort.membershipStatus]}
              </div>
            </div>
            <div className="rounded-ctl bg-surface-2 p-3">
              <div className="text-2xs font-bold uppercase tracking-[0.06em] text-fg-3">
                {labels.basis}
              </div>
              <div className="mt-1 text-sm font-semibold text-fg">
                {cohort.membershipBasis
                  ? labels.basisLabels[cohort.membershipBasis]
                  : labels.notApplicable}
              </div>
            </div>
            <div className="rounded-ctl bg-surface-2 p-3 sm:col-span-2">
              <div className="text-2xs font-bold uppercase tracking-[0.06em] text-fg-3">
                {labels.reason}
              </div>
              <div className="mt-1 break-words text-sm font-semibold text-fg">
                {cohort.reason ?? labels.notApplicable}
              </div>
            </div>
            <div className="rounded-ctl bg-surface-2 p-3 sm:col-span-2">
              <div className="text-2xs font-bold uppercase tracking-[0.06em] text-fg-3">
                {labels.provenance}
              </div>
              <div className="mt-1 break-all font-mono text-xs text-fg-2">
                {cohort.provenance
                  ? provenanceLabel(cohort.provenance)
                  : labels.notApplicable}
              </div>
            </div>
            <div className="rounded-ctl bg-surface-2 p-3">
              <div className="text-2xs font-bold uppercase tracking-[0.06em] text-fg-3">
                {labels.actor}
              </div>
              <div className="mt-1 text-sm font-semibold text-fg">
                {cohort.changedByName ?? labels.notApplicable}
              </div>
            </div>
            <div className="rounded-ctl bg-surface-2 p-3">
              <div className="text-2xs font-bold uppercase tracking-[0.06em] text-fg-3">
                {labels.changedAt}
              </div>
              <div className="mt-1 font-mono text-2xs text-fg-2">
                {cohort.changedAt ?? labels.notApplicable}
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-nav border border-border p-4">
              <h3 className="text-sm font-bold text-fg">{labels.configuration}</h3>
              {cohort.configuration ? (
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-2xs font-bold uppercase text-fg-3">{labels.configurationState}</dt>
                    <dd className="mt-1 text-sm font-semibold text-fg">
                      {cohort.configuration.state === "active"
                        ? labels.configurationActive
                        : labels.configurationPaused}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-2xs font-bold uppercase text-fg-3">{labels.cutoff}</dt>
                    <dd className="mt-1 font-mono text-2xs text-fg-2">{cohort.configuration.cutoffAt}</dd>
                  </div>
                  <div>
                    <dt className="text-2xs font-bold uppercase text-fg-3">{labels.configurationVersion}</dt>
                    <dd className="mt-1 text-sm font-semibold text-fg">{cohort.configuration.version}</dd>
                  </div>
                  <div>
                    <dt className="text-2xs font-bold uppercase text-fg-3">{labels.actor}</dt>
                    <dd className="mt-1 text-sm font-semibold text-fg">{cohort.configuration.changedByName}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-2xs font-bold uppercase text-fg-3">{labels.reason}</dt>
                    <dd className="mt-1 text-sm text-fg-2">{cohort.configuration.reason}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-2xs font-bold uppercase text-fg-3">{labels.provenance}</dt>
                    <dd className="mt-1 break-all font-mono text-2xs text-fg-2">
                      {provenanceLabel(cohort.configuration.provenance)}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-3 text-sm text-fg-3">{labels.configurationMissing}</p>
              )}
            </div>

            <div className="rounded-nav border border-border p-4">
              <h3 className="text-sm font-bold text-fg">{labels.counts}</h3>
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                {[
                  [labels.countOutside, cohort.counts.outside],
                  [labels.countIncluded, cohort.counts.included],
                  [labels.countExcluded, cohort.counts.excluded],
                  [labels.countTotal, cohort.counts.total],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-ctl bg-surface-2 p-3 text-center">
                    <dt className="text-2xs font-bold uppercase text-fg-3">{label}</dt>
                    <dd className="mt-1 text-xl font-bold text-fg">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <div className="mt-5 rounded-nav border border-info/20 bg-info-weak p-4" data-testid="platform-pilot-write-boundary">
            <h3 className="text-sm font-bold text-info">{labels.authority}: {labels.evoOnly}</h3>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <BoundaryRow
                boundary={cohort.writeBoundary}
                label={labels.canonicalTarget}
                allowedLabel={labels.canonicalAllowed}
                blockedLabel={labels.canonicalBlocked}
              />
              <BoundaryRow
                boundary={legacyWriteBoundary}
                label={labels.legacyTarget}
                allowedLabel={labels.canonicalAllowed}
                blockedLabel={labels.legacyBlocked}
              />
            </dl>
            <p className="mt-3 text-xs font-semibold text-fg-2">{labels.noFallback}</p>
          </div>

          {canManage && (
            <div className="mt-5 grid gap-4 lg:grid-cols-2" data-testid="platform-pilot-admin-controls">
              <form
                action={configurePlatformPilotCohortAction}
                className="rounded-nav border border-border p-4"
                data-testid="platform-pilot-configuration-form"
              >
                <h3 className="text-sm font-bold text-fg">{labels.configure}</h3>
                <input type="hidden" name="student_case_id" value={cohort.studentCaseId} />
                <input type="hidden" name="request_id" value={configurationRequestId} />
                <label className={`${labelCls} mt-3 block`}>
                  {labels.configurationState}
                  <select
                    name="state"
                    defaultValue={cohort.configuration?.state ?? "paused"}
                    className={`${inputCls} mt-1`}
                    required
                  >
                    <option value="active">{labels.configurationActive}</option>
                    <option value="paused">{labels.configurationPaused}</option>
                  </select>
                </label>
                <label className={`${labelCls} mt-3 block`}>
                  {labels.cutoff}
                  <input
                    name="cutoff_at"
                    defaultValue={cohort.configuration?.cutoffAt ?? ""}
                    className={`${inputCls} mt-1 font-mono`}
                    placeholder="2026-08-27T00:00:00Z"
                    maxLength={40}
                    required
                  />
                </label>
                <label className={`${labelCls} mt-3 block`}>
                  {labels.reason}
                  <textarea name="reason" className={`${inputCls} mt-1 min-h-24 py-3`} maxLength={1000} required />
                </label>
                <button type="submit" className={`${btnCls} mt-3`}>{labels.saveConfiguration}</button>
              </form>

              <div className="space-y-3">
                {([
                  ["include", labels.include, includeRequestId, btnCls],
                  ["exclude", labels.exclude, excludeRequestId, btnGhostCls],
                ] as const).map(([action, actionLabel, requestId, buttonClass]) => (
                  <form
                    key={action}
                    action={setPlatformStudentCasePilotMembershipAction}
                    className="rounded-nav border border-border p-4"
                    data-testid={`platform-pilot-membership-${action}-form`}
                  >
                    <input type="hidden" name="student_case_id" value={cohort.studentCaseId} />
                    <input type="hidden" name="membership_action" value={action} />
                    <input type="hidden" name="request_id" value={requestId} />
                    <h3 className="text-sm font-bold text-fg">{actionLabel}</h3>
                    <label className={`${labelCls} mt-3 block`}>
                      {labels.manualReason}
                      <input name="reason" className={`${inputCls} mt-1`} maxLength={1000} required />
                    </label>
                    <label className={`${labelCls} mt-3 block`}>
                      {labels.manualProvenance}
                      <input name="provenance" className={`${inputCls} mt-1 font-mono`} maxLength={500} required />
                    </label>
                    <button type="submit" className={`${buttonClass} mt-3`}>{actionLabel}</button>
                  </form>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5">
            <h3 className="text-sm font-bold text-fg">{labels.history}</h3>
            {cohort.history.length === 0 ? (
              <p className="mt-2 text-sm text-fg-3">{labels.historyEmpty}</p>
            ) : (
              <ol className="mt-2 divide-y divide-border" data-testid="platform-pilot-membership-history">
                {cohort.history.map((entry) => (
                  <li key={entry.eventId} className="py-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-fg">{labels.basisLabels[entry.basis]}</span>
                      <span className="font-mono text-2xs text-fg-3">{entry.changedAt}</span>
                    </div>
                    <p className="mt-1 text-fg-2">{entry.reason}</p>
                    <p className="mt-1 break-all font-mono text-2xs text-fg-3">
                      {provenanceLabel(entry.provenance)} · {entry.changedByName}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </section>
  );
}
