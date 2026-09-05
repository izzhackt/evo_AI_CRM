import assert from "node:assert/strict";
import test from "node:test";

import { v3InboxProfileHref } from "../src/lib/v3/inbox-profile-link.ts";

const LEAD_ID = "10000000-0000-4000-8000-000000000001";
const CASE_ID = "20000000-0000-4000-8000-000000000002";

test("Inbox profile links follow the exact presented role surface", () => {
  const context = { leadId: LEAD_ID, studentCaseId: CASE_ID };

  assert.equal(v3InboxProfileHref("admin", context), `/v3/profile?id=${LEAD_ID}`);
  assert.equal(v3InboxProfileHref("sales", context), `/v3/profile?id=${LEAD_ID}`);
  assert.equal(
    v3InboxProfileHref("admissions", context),
    `/v3/profile?case=${CASE_ID}`,
  );
});

test("Inbox profile links fail closed when the role identity is unavailable", () => {
  assert.equal(
    v3InboxProfileHref("sales", { leadId: null, studentCaseId: CASE_ID }),
    null,
  );
  assert.equal(
    v3InboxProfileHref("admissions", { leadId: LEAD_ID, studentCaseId: null }),
    null,
  );
});
