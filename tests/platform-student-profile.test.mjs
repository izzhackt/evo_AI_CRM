import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PLATFORM_STUDENT_PROFILE_MAX_DECISION_PARTICIPANTS,
  PlatformStudentProfileRepositoryError,
  listPlatformCountryRequirementVersions,
  listPlatformStudentCaseDocuments,
  normalizePlatformCountryRequirementVersion,
  normalizePlatformStudentCaseDocument,
  normalizePlatformStudentProfileSnapshot,
  parsePlatformStudentProfileDecisionParticipants,
  parsePlatformStudentProfileUuid,
} from "../src/lib/platform-student-profile.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const REQUIREMENT_VERSION_ID = "44444444-4444-4444-8444-444444444444";
const REQUIREMENT_ID = "55555555-5555-4555-8555-555555555555";
const SLOT_ID = "66666666-6666-4666-8666-666666666666";
const DOCUMENT_VERSION_ID = "77777777-7777-4777-8777-777777777777";
const AT = "2026-08-02T05:00:00+00:00";

function actor(platformRole) {
  return {
    authUserId: "88888888-8888-4888-8888-888888888888",
    profileId: "99999999-9999-4999-8999-999999999999",
    membershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organizationId: ORGANIZATION_ID,
    displayName: "Synthetic actor",
    platformRole,
    platformAccessVersion: 8,
    role: platformRole === "student" ? "client" : platformRole,
  };
}

function profileRow(overrides = {}) {
  return {
    case_id: CASE_ID,
    student_profile_id: PROFILE_ID,
    profile_revision: "2",
    preferred_display_name: "Test Student",
    legal_display_name: "Synthetic Legal Name",
    communication_language: "en",
    date_of_birth: "2007-02-28",
    citizenship_country: "KG",
    residency_country: "KG",
    current_education_summary: "Synthetic school profile",
    academic_summary: "Synthetic academic summary",
    language_summary: "Synthetic language summary",
    budget_band: "synthetic-band",
    decision_participant_labels: ["student", "guardian"],
    consent_status: "granted",
    consent_evidence_ref: "synthetic-consent-evidence",
    profile_next_step: "Review the checklist",
    applied_country_requirement_version_id: REQUIREMENT_VERSION_ID,
    checklist_version: "3",
    required_profile_fields: ["legal_display_name", "date_of_birth"],
    ...overrides,
  };
}

function requirementVersionRow(overrides = {}) {
  return {
    case_id: CASE_ID,
    country_requirement_version_id: REQUIREMENT_VERSION_ID,
    target_country: "Malaysia",
    target_degree: "Bachelor",
    program_direction: "Computer Science",
    version: "3",
    status: "approved",
    required_profile_fields: ["legal_display_name", "date_of_birth"],
    source_count: "2",
    approved_at: AT,
    retired_at: null,
    is_applied: true,
    created_at: AT,
    ...overrides,
  };
}

function documentRow(overrides = {}) {
  return {
    case_id: CASE_ID,
    document_slot_id: SLOT_ID,
    document_requirement_id: REQUIREMENT_ID,
    requirement_key: "passport",
    requirement_label: "Passport",
    instructions: "Synthetic instruction",
    checklist_version: "3",
    slot_status: "correction_required",
    deadline: "2026-09-30",
    next_action: "Upload a clearer scan",
    document_version_id: DOCUMENT_VERSION_ID,
    version_no: "1",
    original_filename: "synthetic-passport.pdf",
    declared_mime_type: "application/pdf",
    byte_size: "1024",
    submitted_at: AT,
    review_decision: "correction_required",
    rework_reason: "Synthetic image is unclear",
    reviewed_at: AT,
    ...overrides,
  };
}

test("student profile snapshot accepts only the bounded, applied checklist shape", () => {
  const profile = normalizePlatformStudentProfileSnapshot(profileRow(), CASE_ID);
  assert.equal(profile.studentCaseId, CASE_ID);
  assert.equal(profile.profileRevision, 2);
  assert.equal(profile.consentStatus, "granted");
  assert.equal(profile.checklistVersion, 3);
  assert.deepEqual(profile.requiredProfileFields, ["legal_display_name", "date_of_birth"]);

  assert.throws(
    () => normalizePlatformStudentProfileSnapshot(
      profileRow({ required_profile_fields: ["unknown_sensitive_field"] }),
    ),
    PlatformStudentProfileRepositoryError,
  );
  assert.throws(
    () => normalizePlatformStudentProfileSnapshot(
      profileRow({ consent_status: "not_recorded" }),
    ),
    PlatformStudentProfileRepositoryError,
  );
  assert.throws(
    () => normalizePlatformStudentProfileSnapshot(
      profileRow({ student_profile_id: null, profile_revision: 2 }),
    ),
    PlatformStudentProfileRepositoryError,
  );
});

test("persisted profile snapshots cannot masquerade as an empty profile seed", () => {
  assert.throws(
    () => normalizePlatformStudentProfileSnapshot(profileRow({
      student_profile_id: null,
      profile_revision: 0,
      preferred_display_name: null,
      communication_language: null,
      citizenship_country: null,
      residency_country: null,
      current_education_summary: null,
      academic_summary: null,
      language_summary: null,
      budget_band: null,
      decision_participant_labels: [],
      consent_status: "not_recorded",
      consent_evidence_ref: null,
      profile_next_step: null,
      applied_country_requirement_version_id: null,
      checklist_version: null,
      required_profile_fields: [],
    })),
    PlatformStudentProfileRepositoryError,
  );
});

test("student profile language and decision participants share the database bound", () => {
  const twelveLabels = Array.from(
    { length: PLATFORM_STUDENT_PROFILE_MAX_DECISION_PARTICIPANTS },
    (_, index) => `participant-${String(index + 1).padStart(2, "0")}`,
  );
  assert.deepEqual(
    parsePlatformStudentProfileDecisionParticipants(twelveLabels.join(", ")),
    twelveLabels,
  );
  assert.equal(
    parsePlatformStudentProfileDecisionParticipants(
      [...twelveLabels, "participant-13"].join(", "),
    ),
    null,
  );
  assert.throws(
    () => normalizePlatformStudentProfileSnapshot(profileRow({
      communication_language: "ky",
    })),
    PlatformStudentProfileRepositoryError,
  );
  assert.throws(
    () => normalizePlatformStudentProfileSnapshot(profileRow({
      decision_participant_labels: [...twelveLabels, "participant-13"],
    })),
    PlatformStudentProfileRepositoryError,
  );
});

test("country requirements retain version, provenance count and immutable case match", () => {
  const version = normalizePlatformCountryRequirementVersion(
    requirementVersionRow(),
    CASE_ID,
  );
  assert.equal(version.version, 3);
  assert.equal(version.sourceCount, 2);
  assert.equal(version.isApplied, true);
  assert.throws(
    () => normalizePlatformCountryRequirementVersion(
      requirementVersionRow({ case_id: PROFILE_ID }),
      CASE_ID,
    ),
    PlatformStudentProfileRepositoryError,
  );
  assert.throws(
    () => normalizePlatformCountryRequirementVersion(
      requirementVersionRow({ source_count: -1 }),
    ),
    PlatformStudentProfileRepositoryError,
  );
});

test("document checklist rows preserve rework state without inventing upload capability", () => {
  const document = normalizePlatformStudentCaseDocument(documentRow(), CASE_ID);
  assert.equal(document.documentSlotId, SLOT_ID);
  assert.equal(document.slotStatus, "correction_required");
  assert.equal(document.reworkReason, "Synthetic image is unclear");
  assert.throws(
    () => normalizePlatformStudentCaseDocument(
      documentRow({ declared_mime_type: "x".repeat(129) }),
    ),
    PlatformStudentProfileRepositoryError,
  );
});

test("finance and student actors are denied before staff profile repositories", async () => {
  await assert.rejects(
    () => listPlatformStudentCaseDocuments(actor("finance"), CASE_ID),
    PlatformStudentProfileRepositoryError,
  );
  await assert.rejects(
    () => listPlatformCountryRequirementVersions(actor("student"), CASE_ID),
    PlatformStudentProfileRepositoryError,
  );
});

test("profile UUID parser rejects nil and malformed identifiers", () => {
  assert.equal(parsePlatformStudentProfileUuid(CASE_ID.toUpperCase()), CASE_ID);
  assert.equal(parsePlatformStudentProfileUuid("00000000-0000-0000-0000-000000000000"), null);
  assert.equal(parsePlatformStudentProfileUuid("not-a-uuid"), null);
});

test("connected profile modules stay Supabase-native and manual-document honest", () => {
  for (const file of [
    "src/lib/platform-student-profile.ts",
    "src/lib/platform-student-profile-actions.ts",
    "src/app/(staff)/clients/[id]/PlatformClientPage.tsx",
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /better-sqlite3|edu_session|service[_-]?role/i, file);
    assert.doesNotMatch(source, /from\s+["']@\/lib\/(?:db|auth|queries|actions)["']/, file);
  }

  const actionSource = readFileSync(
    new URL("../src/lib/platform-student-profile-actions.ts", import.meta.url),
    "utf8",
  );
  assert.match(actionSource, /rpc\("upsert_student_profile"/);
  assert.match(actionSource, /rpc\("apply_country_requirement_version"/);
  assert.match(actionSource, /p_expected_revision/);
  assert.match(actionSource, /p_citizenship_country/);
  assert.match(actionSource, /p_decision_participant_labels/);
  assert.match(actionSource, /p_reason/);
  assert.match(actionSource, /retry_request_id/);

  const connectedPage = readFileSync(
    new URL("../src/app/(staff)/clients/[id]/PlatformClientPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(connectedPage, /connected:\s*false/);
  assert.doesNotMatch(connectedPage, /addDocument:/);
  assert.match(connectedPage, /countryRequirementVersions\.find\(\(version\) => version\.isApplied\)/);
  assert.doesNotMatch(connectedPage, /if\s*\(!profileSnapshot\)\s*return null/);
});
