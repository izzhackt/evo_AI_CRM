import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const salesSource = source(
  "../src/app/(staff)/sales/SalesWorkspace.tsx",
);
const leadDetailSource = source(
  "../src/components/platform/core/CanonicalLeadDetail.tsx",
);
const transcriptRouteSource = source(
  "../src/app/(staff)/sales/[id]/conversations/[conversationId]/page.tsx",
);
const transcriptSource = source(
  "../src/components/platform/communications/PlatformSalesReadOnlyTranscript.tsx",
);

test("canonical Sales queue does not expose the old intake composite", () => {
  assert.match(salesSource, /listCanonicalSalesLeads\(/);
  assert.match(salesSource, /sales-inbound-blocked/);
  assert.doesNotMatch(
    salesSource,
    /listPlatformSalesIntake|intake_before_at|intake_before_id|intake_state|intake_q|sales-intake-empty|sales-intake-unavailable|normalizeIntakeSearchParams|intakeInvalid/,
  );
});

test("canonical lead detail reads the PostgreSQL snapshot without legacy canonical context helpers", () => {
  assert.match(leadDetailSource, /CanonicalLeadSnapshot/);
  assert.match(leadDetailSource, /canonical-lead-detail/);
  assert.doesNotMatch(
    leadDetailSource,
    /PlatformCanonicalLeadDetail|CanonicalAuthorityNotice|CanonicalExternalIdentifiers|CanonicalProvenanceList|CanonicalLinkedContext|DuplicateStatus|Supabase/i,
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
