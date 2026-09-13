import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizePlatformStudentProfileFieldReviewReceipt,
  normalizePlatformStudentProfileStartReceipt,
  parsePlatformReviewStudentProfileFieldCommand,
  parsePlatformStartStudentProfileCommand,
  platformStudentProfileFieldErrorOutcome,
} from "../src/lib/platform-student-profile-fields.ts";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "10000000-0000-4000-8000-000000000002";
const PROFILE = "10000000-0000-4000-8000-000000000003";
const REQUEST = "10000000-0000-4000-8000-000000000004";
const PROPOSAL = "10000000-0000-4000-8000-000000000005";
const VERSION = "10000000-0000-4000-8000-000000000006";
const REVIEW = "10000000-0000-4000-8000-000000000007";

function form(values) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
function review(overrides = {}) {
  return form({
    student_case_id: CASE, field_key: "student_first_name", decision: "confirm",
    value: "Synthetic student", proposal_id: "", source_version_id: "", source_page: "",
    expected_revision: "1", reason: "Manual review", request_id: REQUEST, ...overrides,
  });
}

test("start command represents explicit absence and React action-state envelopes", () => {
  const values = { student_case_id: CASE, expected_profile_revision: "0", reason: "Start profile", request_id: REQUEST };
  const command = parsePlatformStartStudentProfileCommand(form(values));
  assert.deepEqual(command, { studentCaseId: CASE, expectedRevision: 0, reason: "Start profile", requestId: REQUEST });
  const envelope = form(Object.fromEntries(Object.entries(values).map(([key, value]) => [`_1_${key}`, value])));
  envelope.set("0", "{}");
  envelope.set("_1_$ACTION_REF_test", "");
  assert.deepEqual(parsePlatformStartStudentProfileCommand(envelope), command);
});

test("manual confirm, proposal acceptance, explicit clear and rejection have separate command shapes", () => {
  const manual = parsePlatformReviewStudentProfileFieldCommand(review({ source_version_id: VERSION, source_page: "2" }));
  assert.equal(manual.value, "Synthetic student");
  assert.equal(manual.sourceVersionId, VERSION);
  assert.equal(manual.sourcePage, 2);
  const accept = parsePlatformReviewStudentProfileFieldCommand(review({ value: "", proposal_id: PROPOSAL }));
  assert.equal(accept.value, null);
  assert.equal(accept.proposalId, PROPOSAL);
  const clear = parsePlatformReviewStudentProfileFieldCommand(review({ decision: "clear", value: "" }));
  assert.equal(clear.decision, "clear");
  assert.equal(clear.value, null);
  const reject = parsePlatformReviewStudentProfileFieldCommand(review({ decision: "reject_proposal", value: "", proposal_id: PROPOSAL }));
  assert.equal(reject.decision, "reject_proposal");
  assert.equal(reject.proposalId, PROPOSAL);
});

test("commands require one coherent decision and an exact set of form fields", () => {
  assert.equal(parsePlatformReviewStudentProfileFieldCommand(review({ decision: "clear" })), null);
  assert.equal(parsePlatformReviewStudentProfileFieldCommand(review({ value: "" })), null);
  assert.equal(parsePlatformReviewStudentProfileFieldCommand(review({ source_page: "2" })), null);
  const duplicate = review();
  duplicate.append("request_id", REQUEST);
  assert.equal(parsePlatformReviewStudentProfileFieldCommand(duplicate), null);
  const scoped = review();
  scoped.set("organization_id", ORG);
  assert.equal(parsePlatformReviewStudentProfileFieldCommand(scoped), null);
});

test("actual migration158 and159 receipts return only profile identity and revision", () => {
  const start = parsePlatformStartStudentProfileCommand(form({ student_case_id: CASE, expected_profile_revision: "0", reason: "Start profile", request_id: REQUEST }));
  const startReceipt = {
    id: PROFILE, student_profile_id: PROFILE, organization_id: ORG, student_case_id: CASE,
    revision: 1, applied_country_requirement_version_id: null, updated_field_names: [], input_sha256: "a".repeat(64),
  };
  assert.deepEqual(normalizePlatformStudentProfileStartReceipt(startReceipt, ORG, start), { studentProfileId: PROFILE, profileRevision: 1 });
  const command = parsePlatformReviewStudentProfileFieldCommand(review());
  const receipt = {
    organization_id: ORG, student_case_id: CASE, student_profile_id: PROFILE, profile_revision: 2,
    field_key: command.fieldKey, decision: command.decision, review_id: REVIEW, request_id: REQUEST,
    input_sha256: "b".repeat(64),
  };
  assert.deepEqual(normalizePlatformStudentProfileFieldReviewReceipt(receipt, ORG, command), { studentProfileId: PROFILE, profileRevision: 2 });
  assert.equal(normalizePlatformStudentProfileFieldReviewReceipt({ ...receipt, profile_revision: 3 }, ORG, command), null);
});

test("SQL errors become explicit safe outcomes without returning database messages", () => {
  assert.equal(platformStudentProfileFieldErrorOutcome({ code: "40001" }), "stale");
  assert.equal(platformStudentProfileFieldErrorOutcome({ code: "42501" }), "forbidden");
  assert.equal(platformStudentProfileFieldErrorOutcome({ code: "22023", message: `request_id ${REQUEST} was already used for another mutation` }), "request_conflict");
  assert.equal(platformStudentProfileFieldErrorOutcome({ code: "22023" }), "invalid");
  assert.equal(platformStudentProfileFieldErrorOutcome({ code: "P0001", message: "Profile field source document is unavailable" }), "source_unavailable");
  assert.equal(platformStudentProfileFieldErrorOutcome({ code: "unexpected", message: "Synthetic private diagnostic" }), "unavailable");
});

test("server actions are wired to the session-bound start and review RPCs", () => {
  const source = readFileSync(new URL("../src/lib/platform-student-profile-field-actions.ts", import.meta.url), "utf8");
  assert.ok(source.startsWith('"use server";'));
  assert.equal((source.match(/await requirePlatformStaffActor\(\)/g) ?? []).length, 2);
  assert.ok(source.includes('.rpc("start_student_profile",'));
  assert.ok(source.includes('.rpc("review_student_profile_field",'));
  assert.equal((source.match(/p_organization_id: actor\.organizationId/g) ?? []).length, 2);
  assert.ok(source.includes('revalidatePath("/v3/profile")'));
});
