import type {
  PlatformAmoCrmCanonicalContext,
  PlatformAmoCrmCanonicalContextReasonCode,
} from "@/lib/platform-amocrm-canonical-context";

type Labels = Readonly<{
  platformAmoCrmContextTitle: string;
  platformAmoCrmContextHint: string;
  platformAmoCrmContextAvailable: string;
  platformAmoCrmContextDegraded: string;
  platformAmoCrmContextStale: string;
  platformAmoCrmContextUnavailable: string;
  platformAmoCrmContextDisabled: string;
  platformAmoCrmContextNotLinked: string;
  platformAmoCrmContextReasonLabel: string;
  platformAmoCrmContextObservedAt: string;
  platformAmoCrmContextLastAttemptAt: string;
  platformAmoCrmContextContactName: string;
  platformAmoCrmContextLeadName: string;
  platformAmoCrmContextResponsibleUser: string;
  platformAmoCrmContextResponsibleActive: string;
  platformAmoCrmContextPipeline: string;
  platformAmoCrmContextStatus: string;
  platformAmoCrmContextUnknownValue: string;
  platformValueYes: string;
  platformValueNo: string;
  platformAmoCrmContextReasonDisabledByConfig: string;
  platformAmoCrmContextReasonMissingConfiguration: string;
  platformAmoCrmContextReasonMissingBinding: string;
  platformAmoCrmContextReasonProviderRejected: string;
  platformAmoCrmContextReasonProviderNotFound: string;
  platformAmoCrmContextReasonProviderRateLimited: string;
  platformAmoCrmContextReasonProviderTimeout: string;
  platformAmoCrmContextReasonProviderTransportFailure: string;
  platformAmoCrmContextReasonProviderResponseInvalid: string;
  platformAmoCrmContextReasonProviderRelationshipMismatch: string;
  platformAmoCrmContextReasonResponsibleUserForbidden: string;
  platformAmoCrmContextReasonRefreshFailed: string;
  platformAmoCrmContextReasonUnknown: string;
}>;

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

function stateLabel(
  state: PlatformAmoCrmCanonicalContext["state"],
  labels: Labels,
) {
  switch (state) {
    case "available":
      return labels.platformAmoCrmContextAvailable;
    case "degraded":
      return labels.platformAmoCrmContextDegraded;
    case "stale":
      return labels.platformAmoCrmContextStale;
    case "unavailable":
      return labels.platformAmoCrmContextUnavailable;
    case "disabled":
      return labels.platformAmoCrmContextDisabled;
    case "not_linked":
      return labels.platformAmoCrmContextNotLinked;
  }
}

function reasonLabel(
  reasonCode: PlatformAmoCrmCanonicalContextReasonCode | null,
  labels: Labels,
) {
  switch (reasonCode) {
    case "disabled_by_config":
      return labels.platformAmoCrmContextReasonDisabledByConfig;
    case "missing_configuration":
      return labels.platformAmoCrmContextReasonMissingConfiguration;
    case "missing_binding":
      return labels.platformAmoCrmContextReasonMissingBinding;
    case "provider_rejected":
    case "provider_auth_failed":
      return labels.platformAmoCrmContextReasonProviderRejected;
    case "provider_not_found":
      return labels.platformAmoCrmContextReasonProviderNotFound;
    case "provider_rate_limited":
      return labels.platformAmoCrmContextReasonProviderRateLimited;
    case "provider_timeout":
      return labels.platformAmoCrmContextReasonProviderTimeout;
    case "provider_transport_failure":
    case "provider_http_error":
    case "provider_unreachable":
      return labels.platformAmoCrmContextReasonProviderTransportFailure;
    case "provider_response_invalid":
    case "provider_invalid_response":
      return labels.platformAmoCrmContextReasonProviderResponseInvalid;
    case "provider_relationship_mismatch":
    case "provider_binding_mismatch":
      return labels.platformAmoCrmContextReasonProviderRelationshipMismatch;
    case "responsible_user_forbidden":
      return labels.platformAmoCrmContextReasonResponsibleUserForbidden;
    case "refresh_failed":
      return labels.platformAmoCrmContextReasonRefreshFailed;
    case "unknown":
      return labels.platformAmoCrmContextReasonUnknown;
    default:
      return null;
  }
}

function toneClass(state: PlatformAmoCrmCanonicalContext["state"]) {
  switch (state) {
    case "available":
      return "border-ok/30 bg-ok-weak text-ok";
    case "degraded":
    case "stale":
      return "border-warn/30 bg-warn-weak text-warn";
    case "unavailable":
      return "border-info/30 bg-info-weak text-info";
    case "disabled":
    case "not_linked":
    default:
      return "border-border bg-surface text-fg-2";
  }
}

function safeValue(value: string | null, fallback: string) {
  return value && value.trim().length > 0 ? value : fallback;
}

export function PlatformAmoCrmContextCard({
  context,
  locale,
  labels,
}: {
  context: PlatformAmoCrmCanonicalContext;
  locale: string;
  labels: Labels;
}) {
  const state = context.state;
  const stateText = stateLabel(state, labels);
  const reasonText = reasonLabel(context.reason_code, labels);
  const showOperationalTimes =
    context.provider_observed_at !== null || context.last_attempt_at !== null;
  const showBusinessFields =
    state === "available" || state === "degraded" || state === "stale";

  return (
    <section
      aria-labelledby="platform-amocrm-context-title"
      className="rounded-ctl border border-border bg-surface-2 p-3"
      data-testid="platform-amocrm-context"
      data-state={state}
    >
      <div className={`rounded-ctl border px-3 py-2 ${toneClass(state)}`}>
        <h3
          id="platform-amocrm-context-title"
          className="text-[11px] font-bold"
        >
          {labels.platformAmoCrmContextTitle}
        </h3>
        <p className="mt-1 text-[10.5px] leading-4">
          {labels.platformAmoCrmContextHint}
        </p>
        <p className="mt-2 text-[11px] font-semibold">{stateText}</p>
        {reasonText ? (
          <p className="mt-1 text-[10.5px] leading-4">
            {labels.platformAmoCrmContextReasonLabel}: {reasonText}
          </p>
        ) : null}
        {showOperationalTimes ? (
          <div className="mt-2 space-y-1 text-[10.5px] leading-4">
            {context.provider_observed_at ? (
              <p>
                {labels.platformAmoCrmContextObservedAt}:{" "}
                {formatTimestamp(context.provider_observed_at, locale)}
              </p>
            ) : null}
            {context.last_attempt_at ? (
              <p>
                {labels.platformAmoCrmContextLastAttemptAt}:{" "}
                {formatTimestamp(context.last_attempt_at, locale)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {showBusinessFields ? (
        <dl className="mt-3 grid gap-3">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.platformAmoCrmContextContactName}
            </dt>
            <dd className="mt-1 break-words text-[11px] font-semibold text-fg-2">
              {safeValue(
                context.contact_name,
                labels.platformAmoCrmContextUnknownValue,
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.platformAmoCrmContextLeadName}
            </dt>
            <dd className="mt-1 break-words text-[11px] font-semibold text-fg-2">
              {safeValue(
                context.lead_name,
                labels.platformAmoCrmContextUnknownValue,
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.platformAmoCrmContextResponsibleUser}
            </dt>
            <dd className="mt-1 break-words text-[11px] font-semibold text-fg-2">
              {safeValue(
                context.responsible_user_name,
                labels.platformAmoCrmContextUnknownValue,
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.platformAmoCrmContextResponsibleActive}
            </dt>
            <dd className="mt-1 text-[11px] font-semibold text-fg-2">
              {context.responsible_user_active === null
                ? labels.platformAmoCrmContextUnknownValue
                : context.responsible_user_active
                  ? labels.platformValueYes
                  : labels.platformValueNo}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.platformAmoCrmContextPipeline}
            </dt>
            <dd className="mt-1 break-words text-[11px] font-semibold text-fg-2">
              {safeValue(
                context.pipeline_name,
                labels.platformAmoCrmContextUnknownValue,
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.platformAmoCrmContextStatus}
            </dt>
            <dd className="mt-1 break-words text-[11px] font-semibold text-fg-2">
              {safeValue(
                context.status_name,
                labels.platformAmoCrmContextUnknownValue,
              )}
            </dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
