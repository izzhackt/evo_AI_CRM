import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const salesSource = source(
  "../src/app/(staff)/sales/ConnectedCanonicalSales.tsx",
);
const leadDetailSource = source(
  "../src/components/platform/core/CanonicalLeadDetail.tsx",
);
const clientDetailSource = source(
  "../src/components/platform/core/CanonicalClientDetail.tsx",
);
const linkedContextSource = source(
  "../src/components/platform/core/CanonicalRecordEvidence.tsx",
);
const transcriptRouteSource = source(
  "../src/app/(staff)/sales/[id]/conversations/[conversationId]/page.tsx",
);
const transcriptSource = source(
  "../src/components/platform/communications/PlatformSalesReadOnlyTranscript.tsx",
);

test("connected Sales exposes a separately paginated, filterable U3 intake queue", () => {
  assert.match(salesSource, /listPlatformSalesIntake\(actor,/);
  assert.match(salesSource, /intake_before_at/);
  assert.match(salesSource, /intake_before_id/);
  assert.match(salesSource, /intake_state/);
  assert.match(salesSource, /intake_q/);
  for (const state of [
    "queued",
    "retrying",
    "received",
    "manual_review",
    "unsupported",
    "terminal_failure",
  ]) {
    assert.match(salesSource, new RegExp(state));
  }
  assert.match(
    salesSource,
    /`\/sales\/\$\{row\.canonicalLeadId\}\/conversations\/\$\{row\.conversationId\}`/,
  );
  assert.match(salesSource, /sales-intake-empty/);
  assert.match(salesSource, /sales-intake-unavailable/);
  assert.match(salesSource, /normalizeIntakeSearchParams/);
  assert.match(salesSource, /intakeInvalid/);
});

test("canonical lead conversations stay inside the nested Sales route", () => {
  assert.match(leadDetailSource, /conversationHrefPrefix/);
  assert.match(
    leadDetailSource,
    /`\/sales\/\$\{lead\.id\}\/conversations`/,
  );
  assert.match(linkedContextSource, /conversationHrefPrefix/);
  assert.match(
    linkedContextSource,
    /`\$\{conversationHrefPrefix\}\/\$\{conversation\.id\}`/,
  );
});

test("canonical client context cannot escape receive-only Sales into legacy WhatsApp", () => {
  assert.match(clientDetailSource, /conversationHrefPrefix=\{null\}/);
  assert.doesNotMatch(
    linkedContextSource,
    /conversationHrefPrefix\s*=\s*["']\/whatsapp["']/,
  );
  assert.match(
    linkedContextSource,
    /data-testid="canonical-linked-conversation-read-only"/,
  );
});

test("nested Sales transcript is authorized, bounded, and strictly read-only", () => {
  assert.match(transcriptRouteSource, /requirePlatformSalesActor\(\)/);
  assert.match(transcriptRouteSource, /isPlatformLeadConversationLinked\(/);
  assert.match(transcriptRouteSource, /getPlatformConversationThread\(/);
  assert.match(transcriptRouteSource, /pageSize:\s*50/);
  assert.match(transcriptRouteSource, /PlatformSalesReadOnlyTranscript/);
  assert.ok(
    transcriptRouteSource.indexOf("const linkResult") <
      transcriptRouteSource.indexOf("const threadResult"),
    "the exact lead-conversation link must gate the message read",
  );
  assert.match(transcriptSource, /platform-sales-conversation-thread/);
  assert.match(transcriptSource, /data-provider-proof="not-proved"/);
  assert.match(transcriptSource, /olderMessagesHref/);
  assert.doesNotMatch(
    transcriptSource,
    /<form|<button|PlatformConversationView|PlatformGemini|PlatformAutonomous|PlatformAmoCrm|messaging-actions|amocrm/i,
  );
});
