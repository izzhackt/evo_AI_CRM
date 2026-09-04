import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const salesQueueSource = source("src/app/(staff)/sales/SalesWorkspace.tsx");
const studentQueueSource = source("src/app/(staff)/clients/StudentQueue.tsx");
const salesActionSource = source("src/lib/platform-sales-actions.ts");
const handoffActionSource = source("src/lib/platform-student-handoff-actions.ts");
const v3InboxRouteSource = source("src/app/(v3)/v3/inbox/page.tsx");

const removedSalesDetailRuntime = [
  "src/app/(staff)/sales/[id]/page.tsx",
  "src/app/(staff)/sales/[id]/SalesLeadWorkspace.tsx",
  "src/app/(staff)/sales/[id]/PlatformSalesAmoCrmCommandSection.tsx",
  "src/app/(staff)/sales/[id]/conversations/[conversationId]/page.tsx",
  "src/components/platform/sales/CanonicalSalesConversations.tsx",
  "src/components/platform/core/CanonicalLeadDetail.tsx",
];

test("sales detail runtime is removed after V3 profile and inbox replacement proof", () => {
  for (const path of removedSalesDetailRuntime) {
    assert.equal(
      existsSync(new URL(`../${path}`, import.meta.url)),
      false,
      `${path} must be deleted once /sales/:id is replaced`,
    );
  }
});

test("the old /sales/:id route is removed rather than kept as a compatibility path", () => {
  assert.equal(
    existsSync(
      new URL("../src/app/(staff)/sales/[id]/page.tsx", import.meta.url),
    ),
    false,
  );
});

test("active sales and student links open only the V3 profile surface", () => {
  assert.match(salesQueueSource, /href=\{`\/v3\/profile\?id=\$\{lead\.leadId\}`\}/);
  assert.doesNotMatch(salesQueueSource, /href=\{`\/sales\/\$\{lead\.leadId\}`\}/);

  assert.match(studentQueueSource, /href=\{`\/v3\/profile\?id=\$\{leadId\}`\}/);
  assert.doesNotMatch(studentQueueSource, /href=\{`\/sales\/\$\{leadId\}`\}/);
});

test("sales workflow and handoff mutations keep queue/profile revalidation but drop deleted detail revalidation", () => {
  assert.match(salesActionSource, /revalidatePath\(\"\/sales\"\)/);
  assert.match(salesActionSource, /revalidatePath\(`\/v3\/profile\?id=\$\{receipt\.leadId\}`\)/);
  assert.doesNotMatch(salesActionSource, /revalidatePath\(`\/sales\/\$\{receipt\.leadId\}`\)/);

  assert.match(handoffActionSource, /revalidatePath\(\"\/sales\"\)/);
  assert.match(handoffActionSource, /revalidatePath\(\"\/v3\/pipeline\"\)/);
  assert.match(handoffActionSource, /revalidatePath\(`\/v3\/profile\?id=\$\{receipt\.leadId\}`\)/);
  assert.doesNotMatch(handoffActionSource, /revalidatePath\(`\/sales\/\$\{receipt\.leadId\}`\)/);
});

test("V3 inbox is the surviving transcript and amoCRM command surface", () => {
  assert.match(v3InboxRouteSource, /searchParams: Promise<SearchParams>/);
  assert.match(v3InboxRouteSource, /query\.conversation/);
  assert.match(v3InboxRouteSource, /CanonicalAmoCrmCommandPanel/);
  assert.match(v3InboxRouteSource, /data-testid=\"v3-inbox-amocrm\"/);
  assert.doesNotMatch(v3InboxRouteSource, /\/sales\/\$\{leadId\}\/conversations\//);
});
