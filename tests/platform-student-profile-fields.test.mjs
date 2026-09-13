import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePlatformStudentProfileFieldsSnapshot,
  PlatformStudentProfileFieldsError,
} from "../src/lib/platform-student-profile-fields.ts";
import { PROFILE_FIELD_KEYS } from "../src/lib/student-profile-fields.ts";

const CASE = "10000000-0000-4000-8000-000000000001";
const PROFILE = "10000000-0000-4000-8000-000000000002";
const PROPOSAL = "10000000-0000-4000-8000-000000000003";
const VERSION = "10000000-0000-4000-8000-000000000004";
const TIME = "2026-09-13T10:00:00.123456+00:00";

function snapshot(profile = null) {
  return {
    student_case_id: CASE, profile,
    can_initialize: profile === null, can_review: profile !== null, can_export: profile !== null,
    fields: PROFILE_FIELD_KEYS.map(field_key => ({
      field_key, value: null, review_state: "needs_review", reviewed_at: null,
      source_document_version_id: null, source_page: null, proposals: [],
    })),
  };
}

test("missing profile remains distinct from an existing empty canonical profile", () => {
  const missing = normalizePlatformStudentProfileFieldsSnapshot(snapshot(), CASE);
  assert.equal(missing.profile, null);
  assert.equal(missing.canInitialize, true);
  assert.equal(missing.fields.length, 61);
  const existing = normalizePlatformStudentProfileFieldsSnapshot(snapshot({ id: PROFILE, revision: 1 }), CASE);
  assert.deepEqual(existing.profile, { id: PROFILE, revision: 1 });
  assert.equal(existing.canInitialize, false);
  assert.equal(existing.canReview, true);
  assert.ok(existing.fields.every(field => field.value === null && field.state === "needs_review"));
});

test("confirmed empty, conflicts, proposals and exact source provenance survive the DTO", () => {
  const input = snapshot({ id: PROFILE, revision: 7 });
  const field = input.fields.find(field => field.field_key === "student_first_name");
  field.review_state = "confirmed";
  field.reviewed_at = TIME;
  field.proposals.push({
    id: PROPOSAL, value: "Synthetic candidate", source_document_version_id: VERSION,
    source_page: 2, source_snippet: "Synthetic source text", confidence: 0.8,
    created_at: TIME, status: "pending",
  });
  const conflict = input.fields.find(field => field.field_key === "student_last_name");
  conflict.review_state = "conflict";
  const actual = normalizePlatformStudentProfileFieldsSnapshot(input, CASE);
  const confirmed = actual.fields.find(field => field.key === "student_first_name");
  assert.equal(confirmed.value, null);
  assert.equal(confirmed.state, "confirmed");
  assert.equal(confirmed.reviewedAt, TIME);
  assert.equal(confirmed.proposals[0].sourceDocumentVersionId, VERSION);
  assert.equal(confirmed.proposals[0].sourcePage, 2);
  assert.equal(confirmed.proposals[0].status, "pending");
  assert.equal(actual.fields.find(field => field.key === "student_last_name").state, "conflict");
});

test("canonical country length is preserved independently of the DOCX limit", () => {
  const input = snapshot({ id: PROFILE, revision: 2 });
  input.fields.find(field => field.field_key === "nationality").value = "A".repeat(120);
  input.fields.find(field => field.field_key === "country_of_residence").value = "𐐀".repeat(120);
  const actual = normalizePlatformStudentProfileFieldsSnapshot(input, CASE);
  assert.equal(actual.fields.find(field => field.key === "nationality").value, "A".repeat(120));
  assert.equal(actual.fields.find(field => field.key === "country_of_residence").value, "𐐀".repeat(120));
});

test("a missing registry field or incomplete confirmed metadata is an unavailable snapshot", () => {
  const incomplete = snapshot({ id: PROFILE, revision: 1 });
  incomplete.fields.pop();
  assert.throws(() => normalizePlatformStudentProfileFieldsSnapshot(incomplete, CASE), PlatformStudentProfileFieldsError);
  const confirmed = snapshot({ id: PROFILE, revision: 1 });
  confirmed.fields[0].review_state = "confirmed";
  assert.throws(() => normalizePlatformStudentProfileFieldsSnapshot(confirmed, CASE), PlatformStudentProfileFieldsError);
});
