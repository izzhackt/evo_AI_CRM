import { setPlatformAutonomyControlAction } from "@/lib/platform-autonomous-reply-actions";
import type {
  PlatformAutonomousReplyAckName,
  PlatformAutonomousReplyAttemptOutcome,
  PlatformAutonomousReplyBlockReason,
  PlatformAutonomousReplyIntentState,
  PlatformAutonomousReplyState,
  PlatformAutonomyControlState,
} from "@/lib/platform-autonomous-replies";

export type PlatformAutonomousReplyCardLabels = Readonly<{
  title: string;
  hint: string;
  unavailable: string;
  runtime: string;
  runtimeEnabled: string;
  runtimeDisabled: string;
  runtimeDisabledHint: string;
  control: string;
  controlLabels: Readonly<Record<PlatformAutonomyControlState, string>>;
  decision: string;
  noDecision: string;
  decisionBlocked: string;
  decisionQueued: string;
  reason: string;
  reasonPlaceholder: string;
  enable: string;
  resume: string;
  pause: string;
  takeOver: string;
  optOutLocked: string;
  delivery: string;
  noIntent: string;
  intentLabels: Readonly<Record<PlatformAutonomousReplyIntentState, string>>;
  attempt: string;
  noAttempt: string;
  attemptLabels: Readonly<Record<PlatformAutonomousReplyAttemptOutcome, string>>;
  ack: string;
  noAck: string;
  ackLabels: Readonly<Record<PlatformAutonomousReplyAckName, string>>;
  blockedReasonLabels: Readonly<Record<PlatformAutonomousReplyBlockReason, string>>;
  lastControlChange: string;
  decidedAt: string;
  attemptedAt: string;
  providerProofBlocked: string;
}>;

type Props = Readonly<{
  conversationId: string;
  labels: PlatformAutonomousReplyCardLabels;
  locale: string;
  runtimeEnabled: boolean;
  state: PlatformAutonomousReplyState | null;
  unavailable: boolean;
  testIdSuffix?: string;
}>;

function testId(base: string, suffix = "") {
  return `${base}${suffix}`;
}

function formatTimestamp(value: string, locale: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const language =
    locale === "ky" ? "ky-KG" : locale === "en" ? "en-GB" : "ru-RU";
  return new Intl.DateTimeFormat(language, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function badgeClass(tone: "ok" | "warning" | "danger" | "info") {
  if (tone === "ok") return "border-ok/30 bg-ok-weak text-ok";
  if (tone === "warning") return "border-warn/30 bg-warn-weak text-warn";
  if (tone === "danger") return "border-danger/30 bg-danger-weak text-danger";
  return "border-info/30 bg-info-weak text-info";
}

function controlTone(state: PlatformAutonomyControlState) {
  if (state === "enabled") return "ok" as const;
  if (state === "paused") return "warning" as const;
  return "danger" as const;
}

export function PlatformAutonomousReplyCard({
  conversationId,
  labels,
  locale,
  runtimeEnabled,
  state,
  unavailable,
  testIdSuffix = "",
}: Props) {
  const controlState = state?.controlState ?? "paused";
  const controlVersion = state?.controlVersion ?? "0";
  const enableLabel = controlVersion === "0" ? labels.enable : labels.resume;
  const reasonCode = state?.decisionReasonCode;

  return (
    <section
      className="rounded-card border border-border bg-surface-2 p-3"
      data-autonomous-authority={state?.autonomousAuthority ?? false}
      data-control-state={controlState}
      data-intent-state={state?.intentState ?? "none"}
      data-runtime-enabled={runtimeEnabled}
      data-testid={testId("platform-autonomous-reply-card", testIdSuffix)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[12px] font-bold text-fg">{labels.title}</h3>
          <p className="mt-1 text-[10.5px] leading-4 text-fg-3">{labels.hint}</p>
        </div>
        <span
          className={`rounded-full border px-2 py-1 text-[9.5px] font-bold ${badgeClass(
            runtimeEnabled ? "ok" : "warning",
          )}`}
          data-testid={testId("platform-autonomous-reply-runtime", testIdSuffix)}
        >
          {runtimeEnabled ? labels.runtimeEnabled : labels.runtimeDisabled}
        </span>
      </div>

      {!runtimeEnabled && (
        <p className="mt-2 rounded-lg border border-warn/30 bg-warn-weak px-2.5 py-2 text-[10.5px] leading-4 text-warn">
          {labels.runtimeDisabledHint}
        </p>
      )}

      {unavailable ? (
        <p
          className="mt-3 rounded-lg border border-danger/30 bg-danger-weak px-2.5 py-2 text-[10.5px] text-danger"
          data-testid={testId("platform-autonomous-reply-unavailable", testIdSuffix)}
        >
          {labels.unavailable}
        </p>
      ) : (
        <>
          <dl className="mt-3 grid gap-2 text-[10.5px] sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-fg-3">{labels.control}</dt>
              <dd className="mt-1">
                <span
                  className={`inline-flex rounded-full border px-2 py-1 font-bold ${badgeClass(
                    controlTone(controlState),
                  )}`}
                  data-testid={testId(
                    "platform-autonomous-reply-control-state",
                    testIdSuffix,
                  )}
                >
                  {labels.controlLabels[controlState]}
                </span>
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-fg-3">{labels.decision}</dt>
              <dd
                className="mt-1 font-semibold text-fg"
                data-testid={testId(
                  "platform-autonomous-reply-decision-state",
                  testIdSuffix,
                )}
              >
                {state?.decisionState === "blocked"
                  ? labels.decisionBlocked
                  : state?.decisionState === "queued"
                    ? labels.decisionQueued
                    : labels.noDecision}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-fg-3">{labels.delivery}</dt>
              <dd
                className="mt-1 font-semibold text-fg"
                data-testid={testId(
                  "platform-autonomous-reply-intent-state",
                  testIdSuffix,
                )}
              >
                {state?.intentState
                  ? labels.intentLabels[state.intentState]
                  : labels.noIntent}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-fg-3">{labels.ack}</dt>
              <dd
                className="mt-1 font-semibold text-fg"
                data-testid={testId("platform-autonomous-reply-ack", testIdSuffix)}
              >
                {state?.ackName ? labels.ackLabels[state.ackName] : labels.noAck}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-fg-3">{labels.attempt}</dt>
              <dd className="mt-1 font-semibold text-fg">
                {state?.attemptOutcome
                  ? labels.attemptLabels[state.attemptOutcome]
                  : labels.noAttempt}
              </dd>
            </div>
          </dl>

          {reasonCode && (
            <p
              className="mt-3 rounded-lg border border-warn/30 bg-warn-weak px-2.5 py-2 text-[10.5px] leading-4 text-warn"
              data-testid={testId(
                "platform-autonomous-reply-block-reason",
                testIdSuffix,
              )}
            >
              <strong>{labels.reason}:</strong>{" "}
              {labels.blockedReasonLabels[reasonCode]}
            </p>
          )}

          {controlState === "opted_out" ? (
            <p className="mt-3 text-[10.5px] font-semibold text-danger">
              {labels.optOutLocked}
            </p>
          ) : (
            <form
              action={setPlatformAutonomyControlAction}
              className="mt-3 space-y-2"
              data-testid={testId(
                "platform-autonomous-reply-control-form",
                testIdSuffix,
              )}
            >
              <input name="conversationId" type="hidden" value={conversationId} />
              <input name="expectedVersion" type="hidden" value={controlVersion} />
              <label className="block text-[10px] font-semibold text-fg-3">
                {labels.reason}
                <textarea
                  className="mt-1 min-h-16 w-full resize-y rounded-lg border border-border bg-surface px-2.5 py-2 text-[11px] text-fg outline-none focus:border-accent"
                  data-testid={testId(
                    "platform-autonomous-reply-control-reason",
                    testIdSuffix,
                  )}
                  maxLength={500}
                  minLength={3}
                  name="reason"
                  placeholder={labels.reasonPlaceholder}
                  required
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {controlState !== "enabled" && (
                  <button
                    className="rounded-lg bg-accent px-3 py-2 text-[10.5px] font-bold text-white"
                    data-testid={testId(
                      "platform-autonomous-reply-enable",
                      testIdSuffix,
                    )}
                    name="controlState"
                    type="submit"
                    value="enabled"
                  >
                    {enableLabel}
                  </button>
                )}
                {controlState !== "paused" && (
                  <button
                    className="rounded-lg border border-warn/30 bg-warn-weak px-3 py-2 text-[10.5px] font-bold text-warn"
                    name="controlState"
                    type="submit"
                    value="paused"
                  >
                    {labels.pause}
                  </button>
                )}
                {controlState !== "staff_takeover" && (
                  <button
                    className="rounded-lg border border-danger/30 bg-danger-weak px-3 py-2 text-[10.5px] font-bold text-danger"
                    data-testid={testId(
                      "platform-autonomous-reply-takeover",
                      testIdSuffix,
                    )}
                    name="controlState"
                    type="submit"
                    value="staff_takeover"
                  >
                    {labels.takeOver}
                  </button>
                )}
              </div>
            </form>
          )}

          <dl className="mt-3 space-y-1 text-[9.5px] text-fg-3">
            {state?.controlRecordedAt && (
              <div>
                <dt className="inline font-semibold">{labels.lastControlChange}: </dt>
                <dd className="inline">{formatTimestamp(state.controlRecordedAt, locale)}</dd>
              </div>
            )}
            {state?.decidedAt && (
              <div>
                <dt className="inline font-semibold">{labels.decidedAt}: </dt>
                <dd className="inline">{formatTimestamp(state.decidedAt, locale)}</dd>
              </div>
            )}
            {state?.attemptedAt && (
              <div>
                <dt className="inline font-semibold">{labels.attemptedAt}: </dt>
                <dd className="inline">{formatTimestamp(state.attemptedAt, locale)}</dd>
              </div>
            )}
          </dl>
        </>
      )}

      <p className="mt-3 text-[9.5px] leading-4 text-fg-3">
        {labels.providerProofBlocked}
      </p>
    </section>
  );
}
