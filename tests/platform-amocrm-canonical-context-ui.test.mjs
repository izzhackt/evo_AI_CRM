import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/app/(staff)/whatsapp/[id]/page.tsx", import.meta.url),
  "utf8",
);
const viewSource = readFileSync(
  new URL(
    "../src/components/platform/communications/PlatformConversationView.tsx",
    import.meta.url,
  ),
  "utf8",
);
const cardSource = readFileSync(
  new URL(
    "../src/components/platform/communications/PlatformAmoCrmContextCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
const i18nSource = readFileSync(
  new URL("../src/lib/i18n-data.ts", import.meta.url),
  "utf8",
);

test("conversation page resolves canonical context only after an accepted thread exists", () => {
  const notFoundIndex = pageSource.indexOf('if (!thread || !workflow) notFound();');
  const serviceCallIndex = pageSource.indexOf("await getPlatformAmoCrmCanonicalContext(");

  assert.match(
    pageSource,
    /import \{ getPlatformAmoCrmCanonicalContext \} from ["']@\/lib\/server\/platform-amocrm-canonical-context-service["'];/,
  );
  assert.notEqual(notFoundIndex, -1);
  assert.notEqual(serviceCallIndex, -1);
  assert.ok(
    serviceCallIndex > notFoundIndex,
    "canonical context must be fetched only after thread/workflow access is proved",
  );
  assert.match(
    pageSource,
    /amocrmCanonicalContext=\{amocrmCanonicalContext\}/,
  );
});

test("conversation view accepts only the safe canonical context type and keeps existing provider proof", () => {
  assert.match(
    viewSource,
    /import type \{ PlatformAmoCrmCanonicalContext \} from ["']@\/lib\/platform-amocrm-canonical-context["'];/,
  );
  assert.doesNotMatch(
    viewSource,
    /platform-amocrm-canonical-context-service/,
  );
  assert.match(
    viewSource,
    /amocrmCanonicalContext: PlatformAmoCrmCanonicalContext;/,
  );
  assert.match(
    viewSource,
    /data-provider-proof="not-proved"/,
  );
  assert.match(viewSource, /data-testid="platform-conversation-thread"/);
  assert.match(viewSource, /<PlatformMessagingWorkflowPanel/);
  assert.match(viewSource, /data-testid="platform-waha-session-health"/);
});

test("context card is rendered in the existing right rail and exposes the required states", () => {
  assert.match(
    viewSource,
    /<aside className="hidden w-\[280px\] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface xl:flex">/,
  );
  assert.match(
    viewSource,
    /<PlatformAmoCrmContextCard[\s\S]*context=\{amocrmCanonicalContext\}[\s\S]*\/>/,
  );
  assert.match(cardSource, /data-testid="platform-amocrm-context"/);
  assert.match(cardSource, /data-state=\{state\}/);

  for (const state of [
    "available",
    "degraded",
    "stale",
    "unavailable",
    "disabled",
    "not_linked",
  ]) {
    assert.match(cardSource, new RegExp(`case "${state}"`));
  }
});

test("context card translates every persisted provider failure reason", () => {
  for (const reasonCode of [
    "provider_auth_failed",
    "provider_binding_mismatch",
    "provider_http_error",
    "provider_invalid_response",
    "provider_unreachable",
  ]) {
    assert.match(
      cardSource,
      new RegExp(`case ["']${reasonCode}["']:`),
      `${reasonCode} must have an operator-facing label`,
    );
  }
});

test("context card renders safe fields only and never exposes provider identifiers or contact secrets", () => {
  for (const safeField of [
    "contact_name",
    "lead_name",
    "responsible_user_name",
    "responsible_user_active",
    "pipeline_name",
    "status_name",
    "provider_observed_at",
    "last_attempt_at",
    "reason_code",
  ]) {
    assert.match(cardSource, new RegExp(safeField));
  }

  for (const forbidden of [
    "accountDomain",
    "accessToken",
    "amocrmAccountId",
    "amocrmContactId",
    "amocrmLeadId",
    "pipelineId",
    "statusId",
    "responsibleUserId",
    "phone",
    "email",
    "domain",
    "token",
  ]) {
    assert.doesNotMatch(cardSource, new RegExp(forbidden));
  }

  assert.doesNotMatch(cardSource, /button/i);
  assert.doesNotMatch(cardSource, /fetch\(/);
  assert.doesNotMatch(cardSource, /navigator|window|document/);
});

test("RU, KY, and EN dictionaries contain amoCRM context labels and reasons", () => {
  for (const key of [
    "platformAmoCrmContextTitle",
    "platformAmoCrmContextHint",
    "platformAmoCrmContextAvailable",
    "platformAmoCrmContextDegraded",
    "platformAmoCrmContextStale",
    "platformAmoCrmContextUnavailable",
    "platformAmoCrmContextDisabled",
    "platformAmoCrmContextNotLinked",
    "platformAmoCrmContextReasonLabel",
    "platformAmoCrmContextObservedAt",
    "platformAmoCrmContextLastAttemptAt",
    "platformAmoCrmContextContactName",
    "platformAmoCrmContextLeadName",
    "platformAmoCrmContextResponsibleUser",
    "platformAmoCrmContextResponsibleActive",
    "platformAmoCrmContextPipeline",
    "platformAmoCrmContextStatus",
    "platformAmoCrmContextUnknownValue",
    "platformAmoCrmContextReasonDisabledByConfig",
    "platformAmoCrmContextReasonMissingConfiguration",
    "platformAmoCrmContextReasonInvalidConfiguration",
    "platformAmoCrmContextReasonConfigurationScopeMismatch",
    "platformAmoCrmContextReasonMissingBinding",
    "platformAmoCrmContextReasonProviderRejected",
    "platformAmoCrmContextReasonProviderNotFound",
    "platformAmoCrmContextReasonProviderRateLimited",
    "platformAmoCrmContextReasonProviderTimeout",
    "platformAmoCrmContextReasonProviderTransportFailure",
    "platformAmoCrmContextReasonProviderResponseInvalid",
    "platformAmoCrmContextReasonProviderRelationshipMismatch",
    "platformAmoCrmContextReasonResponsibleUserForbidden",
    "platformAmoCrmContextReasonRefreshFailed",
    "platformAmoCrmContextReasonUnknown",
  ]) {
    const matches = i18nSource.match(new RegExp(`${key}:`, "g")) ?? [];
    assert.equal(matches.length, 3, `${key} should exist in ru, ky, and en`);
  }
});
