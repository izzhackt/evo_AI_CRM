import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  PLATFORM_STUDENT_DOCUMENT_PROFILE_CATEGORIES,
  PLATFORM_STUDENT_DOCUMENT_PROFILE_FIELD_CATALOG,
  PLATFORM_STUDENT_DOCUMENT_PROFILE_FIELD_KEYS,
  normalizePlatformStudentDocumentProfileField,
  projectConfirmedFieldsToCanonicalStudentProfile,
  validatePlatformStudentDocumentProfileConsistency,
} from "../src/lib/platform-student-document-profile-domain.ts";
import {
  PLATFORM_CHINA_DOCUMENT_REQUIREMENTS,
  derivePlatformDocumentDisplayState,
  derivePlatformDocumentRequirementApplicability,
  guardPlatformExtractedFactDecision,
  guardPlatformStudentProfileMutationRevisions,
  isPlatformDocumentExtractedFactTransitionAllowed,
  isPlatformDocumentExtractionRunTransitionAllowed,
  isPlatformStudentProfileExportTransitionAllowed,
} from "../src/lib/platform-document-intelligence-domain.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const STUDENT_CASE_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const FACT_ID = "44444444-4444-4444-8444-444444444444";
const DECISION_ID = "55555555-5555-4555-8555-555555555555";
const AT = "2026-08-05T08:00:00Z";
const MIGRATION_PATH = new URL(
  "../supabase/migrations/059_platform_student_document_intelligence.sql",
  import.meta.url,
);

function confirmed(fieldKey, value, overrides = {}) {
  return {
    fieldKey,
    value,
    fieldRevision: 1,
    profileRevision: 7,
    confirmedAt: AT,
    provenance: {
      kind: "manual",
      decisionId: DECISION_ID,
    },
    ...overrides,
  };
}

function extractedFact(overrides = {}) {
  return {
    id: FACT_ID,
    organizationId: ORGANIZATION_ID,
    studentCaseId: STUDENT_CASE_ID,
    extractionRunId: "66666666-6666-4666-8666-666666666666",
    documentVersionId: DOCUMENT_VERSION_ID,
    documentVersionNumber: 2,
    fieldKey: "personal.first_name",
    candidateValue: "Aida",
    normalizedValue: "Aida",
    confidence: 0.81,
    sourceLocator: { kind: "page", pageNumber: 1, anchor: "field:first_name" },
    extractorPolicyVersion: "policy-1",
    modelVersion: "model-1",
    status: "proposed",
    createdAt: AT,
    ...overrides,
  };
}

function displayEvidence(overrides = {}) {
  return {
    applicability: "required",
    hasCurrentVersion: true,
    immutableBytesFinalized: true,
    validationState: "clean",
    extractionState: "succeeded",
    humanReviewState: "approved",
    candidateStatuses: ["confirmed"],
    validationLeaseActive: false,
    extractionLeaseActive: false,
    deterministicChecksPassed: true,
    requiredHumanDecisionsPassed: true,
    ...overrides,
  };
}

test("expanded profile catalog covers every source-form section with unique typed keys", () => {
  assert.equal(PLATFORM_STUDENT_DOCUMENT_PROFILE_FIELD_CATALOG.length, 62);
  assert.equal(
    new Set(PLATFORM_STUDENT_DOCUMENT_PROFILE_FIELD_KEYS).size,
    PLATFORM_STUDENT_DOCUMENT_PROFILE_FIELD_KEYS.length,
  );
  assert.deepEqual(
    new Set(PLATFORM_STUDENT_DOCUMENT_PROFILE_FIELD_CATALOG.map((entry) => entry.category)),
    new Set(PLATFORM_STUDENT_DOCUMENT_PROFILE_CATEGORIES),
  );

  for (const requiredKey of [
    "identity.preferred_display_name",
    "personal.passport_number",
    "education.history",
    "study.budget_per_year",
    "father.personal_email",
    "mother.personal_email",
    "emergency.phone_or_email",
    "visa.previous_refusal",
    "health.chronic_or_allergies",
    "referral.source",
    "acknowledgement.student_signature",
    "acknowledgement.parent_signature",
  ]) {
    assert.ok(PLATFORM_STUDENT_DOCUMENT_PROFILE_FIELD_KEYS.includes(requiredKey));
  }

  const passport = PLATFORM_STUDENT_DOCUMENT_PROFILE_FIELD_CATALOG.find(
    (entry) => entry.key === "personal.passport_number",
  );
  assert.deepEqual(
    { valueKind: passport?.valueKind, sensitive: passport?.sensitive },
    { valueKind: "passport_number", sensitive: true },
  );
});

test("normalizes deterministic scalar, money and repeating education values", () => {
  assert.deepEqual(normalizePlatformStudentDocumentProfileField("personal.first_name", "  Ai\u0301da  "), {
    ok: true,
    value: "Aída",
  });
  assert.deepEqual(
    normalizePlatformStudentDocumentProfileField("personal.citizenship_country", " kg "),
    { ok: true, value: "KG" },
  );
  assert.deepEqual(
    normalizePlatformStudentDocumentProfileField("personal.mobile_phone", "+996 (555) 12-34-56"),
    { ok: true, value: "+996555123456" },
  );
  assert.deepEqual(
    normalizePlatformStudentDocumentProfileField("personal.student_email", " Student@Example.COM "),
    { ok: true, value: "student@example.com" },
  );
  assert.deepEqual(
    normalizePlatformStudentDocumentProfileField("personal.passport_number", " an 12-3456 "),
    { ok: true, value: "AN12-3456" },
  );
  assert.deepEqual(
    normalizePlatformStudentDocumentProfileField("study.budget_per_year", {
      amount: 25_000,
      currency: "USD",
    }),
    { ok: true, value: { amount: 25_000, currency: "USD" } },
  );
  assert.deepEqual(
    normalizePlatformStudentDocumentProfileField("education.history", [{
      school_name: "  Synthetic Lyceum  ",
      country_city: " Bishkek, KG ",
      year_from: 2021,
      year_to: 2024,
      degree_certificate: " Certificate ",
    }]),
    {
      ok: true,
      value: [{
        school_name: "Synthetic Lyceum",
        country_city: "Bishkek, KG",
        year_from: 2021,
        year_to: 2024,
        degree_certificate: "Certificate",
      }],
    },
  );
});

test("rejects malformed field values rather than coercing them into trusted data", () => {
  for (const [fieldKey, value] of [
    ["personal.first_name", "Aida\u0000"],
    ["personal.date_of_birth", "2025-02-29"],
    ["personal.citizenship_country", "Kyrgyzstan"],
    ["personal.student_email", "missing-at.example.com"],
    ["personal.mobile_phone", "123"],
    ["personal.passport_number", "***"],
    ["education.expected_graduation_year", 1899],
    ["study.scholarship_interest", "yes"],
    ["study.budget_per_year", { amount: -1, currency: "USD" }],
    ["education.history", [{
      school_name: "Synthetic School",
      country_city: "Bishkek, KG",
      year_from: 2025,
      year_to: 2024,
      degree_certificate: "Certificate",
    }]],
  ]) {
    assert.equal(
      normalizePlatformStudentDocumentProfileField(fieldKey, value).ok,
      false,
      fieldKey,
    );
  }
});

test("cross-field rules make conditional declarations and signatures explicit", () => {
  assert.deepEqual(
    validatePlatformStudentDocumentProfileConsistency({
      "visa.previous_refusal": true,
      "health.chronic_or_allergies": false,
      "health.details": "Should not be present",
      "acknowledgement.student_signature": true,
      "acknowledgement.parent_signature": false,
      "acknowledgement.parent_signature_date": "2026-08-05",
      "personal.date_of_birth": "2008-03-10",
      "personal.passport_expiry_date": "2008-03-09",
      "consent.status": "granted",
    }),
    [
      { fieldKey: "visa.refusal_country", code: "missing_dependent_field" },
      { fieldKey: "health.details", code: "unexpected_dependent_field" },
      {
        fieldKey: "acknowledgement.student_signature_date",
        code: "missing_dependent_field",
      },
      {
        fieldKey: "acknowledgement.parent_signature_date",
        code: "unexpected_dependent_field",
      },
      { fieldKey: "consent.evidence_ref", code: "missing_dependent_field" },
      { fieldKey: "personal.passport_expiry_date", code: "inconsistent_date" },
    ],
  );

  assert.deepEqual(
    validatePlatformStudentDocumentProfileConsistency({
      "visa.previous_refusal": false,
      "health.chronic_or_allergies": true,
      "health.details": "Synthetic declaration",
      "acknowledgement.student_signature": true,
      "acknowledgement.student_signature_date": "2026-08-05",
      "acknowledgement.parent_signature": true,
      "acknowledgement.parent_signature_date": "2026-08-05",
      "consent.status": "granted",
      "consent.evidence_ref": "consent-record-1",
    }),
    [],
  );
});

test("confirmed fields project deterministically into only the minimized canonical core", () => {
  const fields = [
    confirmed("personal.first_name", "Aida"),
    confirmed("personal.last_name", "Example"),
    confirmed("preferences.communication_language", "ru"),
    confirmed("personal.date_of_birth", "2008-03-10"),
    confirmed("personal.citizenship_country", "KG"),
    confirmed("personal.residency_country", "KZ"),
    confirmed("education.current_study_status", "Final year"),
    confirmed("education.history", [{
      school_name: "Synthetic Lyceum",
      country_city: "Bishkek, KG",
      year_from: 2021,
      year_to: 2024,
      degree_certificate: "Certificate",
    }]),
    confirmed("education.extracurricular_achievements", "Robotics club"),
    confirmed("personal.chinese_level", "HSK 3"),
    confirmed("personal.english_level", "IELTS 6.5"),
    confirmed("study.budget_per_year", { amount: 25_000, currency: "USD" }),
    confirmed("personal.passport_number", "AN123456"),
    confirmed("decision.participant_labels", ["Parent"]),
    confirmed("consent.status", "granted"),
    confirmed("consent.evidence_ref", "consent-record-1"),
    confirmed("workflow.next_step", "Prepare application"),
  ];
  const before = structuredClone(fields);

  assert.deepEqual(projectConfirmedFieldsToCanonicalStudentProfile(fields, 7), {
    ok: true,
    profileRevision: 7,
    projection: {
      preferredDisplayName: "Aida",
      legalDisplayName: "Aida Example",
      communicationLanguage: "ru",
      dateOfBirth: "2008-03-10",
      citizenshipCountry: "KG",
      residencyCountry: "KZ",
      currentEducationSummary:
        "Final year; Synthetic Lyceum (Bishkek, KG; 2021-2024, Certificate)",
      academicSummary:
        "Synthetic Lyceum (Bishkek, KG; 2021-2024, Certificate); Robotics club",
      languageSummary: "Chinese: HSK 3; English: IELTS 6.5",
      budgetBand: "USD 25000.00 per year",
      decisionParticipantLabels: ["Parent"],
      consentStatus: "granted",
      consentEvidenceRef: "consent-record-1",
      nextStep: "Prepare application",
    },
  });
  assert.deepEqual(fields, before, "projection must not mutate confirmed evidence");
});

test("bw8a TypeScript and SQL field catalogs stay in lockstep", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  const sqlRows = [...sql.matchAll(
    /\('([^']+)', '([^']+)', '([^']+)', (\d+), (TRUE|FALSE), (TRUE|FALSE), (NULL|'[^']+')\)/g,
  )]
    .map((match) => ({
      key: match[1],
      valueKind: match[2],
      category: match[3],
      displayOrder: Number(match[4]),
      sensitive: match[5] === "TRUE",
    }));

  const tsRows = PLATFORM_STUDENT_DOCUMENT_PROFILE_FIELD_CATALOG.map(
    (definition, index) => ({
      key: definition.key,
      valueKind: definition.valueKind,
      category: definition.category,
      displayOrder: index + 1,
      sensitive: definition.sensitive,
    }),
  );

  assert.deepEqual(sqlRows, tsRows);
});

test("projection never guesses missing values and rejects duplicate or mixed revisions", () => {
  assert.deepEqual(
    projectConfirmedFieldsToCanonicalStudentProfile([
      confirmed("personal.first_name", "Aida"),
      confirmed("personal.passport_number", "AN123456"),
    ], 7),
    {
      ok: true,
      profileRevision: 7,
      projection: { preferredDisplayName: "Aida" },
    },
  );

  const duplicate = projectConfirmedFieldsToCanonicalStudentProfile([
    confirmed("personal.first_name", "Aida"),
    confirmed("personal.first_name", "Amina", { fieldRevision: 2 }),
  ], 7);
  assert.equal(duplicate.ok, false);
  assert.deepEqual(duplicate.issues, [{
    fieldKey: "personal.first_name",
    code: "duplicate_field",
  }]);

  const mixed = projectConfirmedFieldsToCanonicalStudentProfile([
    confirmed("personal.first_name", "Aida", { profileRevision: 6 }),
  ], 7);
  assert.equal(mixed.ok, false);
  assert.deepEqual(mixed.issues, [{
    fieldKey: "personal.first_name",
    code: "mixed_profile_revision",
  }]);
});

test("minor-only applicability uses the exact as-of date and fails closed on unknown age", () => {
  assert.deepEqual(
    derivePlatformDocumentRequirementApplicability(
      "notarized_parental_travel_consent",
      "2008-08-05",
      "2026-08-05",
    ),
    { state: "not_required", reason: "applicant_is_adult" },
  );
  assert.deepEqual(
    derivePlatformDocumentRequirementApplicability(
      "original_birth_certificate",
      "2008-08-06",
      "2026-08-05",
    ),
    { state: "required", reason: "applicant_is_minor" },
  );
  assert.deepEqual(
    derivePlatformDocumentRequirementApplicability(
      "original_birth_certificate",
      null,
      "2026-08-05",
    ),
    { state: "pending_information", reason: "date_of_birth_missing" },
  );
  assert.deepEqual(
    derivePlatformDocumentRequirementApplicability(
      "original_birth_certificate",
      "2008-08-06",
      null,
    ),
    { state: "pending_information", reason: "as_of_date_invalid" },
  );
  assert.deepEqual(
    derivePlatformDocumentRequirementApplicability(
      "original_birth_certificate",
      "1900-01-01",
      "2026-08-05",
    ),
    { state: "pending_information", reason: "date_of_birth_invalid" },
  );
  assert.deepEqual(
    derivePlatformDocumentRequirementApplicability(
      "passport",
      null,
      "not-a-date",
    ),
    { state: "required", reason: "unconditional" },
  );
  assert.deepEqual(
    PLATFORM_CHINA_DOCUMENT_REQUIREMENTS.filter(
      (entry) => entry.applicabilityRule === "minor_only",
    )
      .map((entry) => entry.key),
    ["notarized_parental_travel_consent", "original_birth_certificate"],
  );
  assert.deepEqual(
    derivePlatformDocumentRequirementApplicability(
      "application_form_after_contract_payment",
      null,
      "2026-08-05",
      null,
    ),
    { state: "not_required", reason: "contract_payment_incomplete" },
  );
  assert.deepEqual(
    derivePlatformDocumentRequirementApplicability(
      "application_form_after_contract_payment",
      null,
      "2026-08-05",
      true,
    ),
    { state: "required", reason: "contract_payment_complete" },
  );
});

test("extraction, fact and export lifecycle transitions are explicit and terminal-safe", () => {
  assert.equal(isPlatformDocumentExtractionRunTransitionAllowed("queued", "processing"), true);
  assert.equal(isPlatformDocumentExtractionRunTransitionAllowed("processing", "succeeded"), true);
  assert.equal(isPlatformDocumentExtractionRunTransitionAllowed("failed", "processing"), false);
  assert.equal(isPlatformDocumentExtractionRunTransitionAllowed("superseded", "queued"), false);

  assert.equal(isPlatformDocumentExtractedFactTransitionAllowed("proposed", "conflict"), true);
  assert.equal(isPlatformDocumentExtractedFactTransitionAllowed("conflict", "confirmed"), true);
  assert.equal(isPlatformDocumentExtractedFactTransitionAllowed("confirmed", "superseded"), true);
  assert.equal(isPlatformDocumentExtractedFactTransitionAllowed("rejected", "confirmed"), false);

  assert.equal(isPlatformStudentProfileExportTransitionAllowed("queued", "processing"), true);
  assert.equal(isPlatformStudentProfileExportTransitionAllowed("processing", "succeeded"), true);
  assert.equal(isPlatformStudentProfileExportTransitionAllowed("succeeded", "superseded"), true);
  assert.equal(isPlatformStudentProfileExportTransitionAllowed("failed", "superseded"), true);
  assert.equal(isPlatformStudentProfileExportTransitionAllowed("failed", "succeeded"), false);
  assert.equal(isPlatformStudentProfileExportTransitionAllowed("superseded", "failed"), false);
});

test("display state is derived from persisted evidence with truthful precedence", () => {
  assert.equal(
    derivePlatformDocumentDisplayState(displayEvidence({ applicability: "not_required" })),
    "not_required",
  );
  assert.equal(
    derivePlatformDocumentDisplayState(displayEvidence({
      applicability: "pending_information",
    })),
    "needs_review",
  );
  assert.equal(
    derivePlatformDocumentDisplayState(displayEvidence({ hasCurrentVersion: false })),
    "missing",
  );
  assert.equal(
    derivePlatformDocumentDisplayState(displayEvidence({ immutableBytesFinalized: false })),
    "failed",
  );
  assert.equal(
    derivePlatformDocumentDisplayState(displayEvidence({ validationState: "failed" })),
    "failed",
  );
  assert.equal(
    derivePlatformDocumentDisplayState(displayEvidence({ extractionState: "failed" })),
    "failed",
  );
  assert.equal(
    derivePlatformDocumentDisplayState(displayEvidence({
      validationState: "processing",
      validationLeaseActive: true,
    })),
    "processing",
  );
  assert.equal(
    derivePlatformDocumentDisplayState(displayEvidence({
      validationState: "processing",
      validationLeaseActive: false,
    })),
    "received",
  );
  assert.equal(
    derivePlatformDocumentDisplayState(displayEvidence({ extractionState: "queued" })),
    "received",
  );
  assert.equal(
    derivePlatformDocumentDisplayState(displayEvidence({ candidateStatuses: ["proposed"] })),
    "needs_review",
  );
  assert.equal(
    derivePlatformDocumentDisplayState(displayEvidence({ requiredHumanDecisionsPassed: false })),
    "needs_review",
  );
  assert.equal(derivePlatformDocumentDisplayState(displayEvidence()), "confirmed");
});

test("revision guard rejects invalid, stale profile and stale field revisions", () => {
  assert.deepEqual(guardPlatformStudentProfileMutationRevisions({
    expectedProfileRevision: 7,
    currentProfileRevision: 7,
    expectedFieldRevision: 1,
    currentFieldRevision: 1,
  }), { ok: true });
  assert.deepEqual(guardPlatformStudentProfileMutationRevisions({
    expectedProfileRevision: 6,
    currentProfileRevision: 7,
    expectedFieldRevision: 1,
    currentFieldRevision: 1,
  }), { ok: false, reason: "stale_profile_revision" });
  assert.deepEqual(guardPlatformStudentProfileMutationRevisions({
    expectedProfileRevision: 7,
    currentProfileRevision: 7,
    expectedFieldRevision: null,
    currentFieldRevision: 1,
  }), { ok: false, reason: "stale_field_revision" });
  assert.deepEqual(guardPlatformStudentProfileMutationRevisions({
    expectedProfileRevision: 0,
    currentProfileRevision: 7,
    expectedFieldRevision: null,
    currentFieldRevision: null,
  }), { ok: false, reason: "invalid_revision" });
});

test("fact decision guard blocks terminal facts, stale versions and newer confirmed sources", () => {
  const base = {
    action: "confirm",
    fact: extractedFact(),
    expectedProfileRevision: 7,
    currentProfileRevision: 7,
    expectedFieldRevision: null,
    currentFieldValue: null,
    currentDocumentVersionId: DOCUMENT_VERSION_ID,
    currentDocumentVersionNumber: 2,
  };
  assert.deepEqual(guardPlatformExtractedFactDecision(base), { ok: true });
  assert.deepEqual(guardPlatformExtractedFactDecision({
    ...base,
    currentProfileRevision: 8,
  }), { ok: false, reason: "stale_profile_revision" });
  assert.deepEqual(guardPlatformExtractedFactDecision({
    ...base,
    fact: extractedFact({ status: "rejected" }),
  }), { ok: false, reason: "candidate_not_actionable" });
  assert.deepEqual(guardPlatformExtractedFactDecision({
    ...base,
    currentDocumentVersionId: "77777777-7777-4777-8777-777777777777",
    currentDocumentVersionNumber: 3,
  }), { ok: false, reason: "stale_document_version" });

  const currentFieldValue = confirmed("personal.first_name", "Amina", {
    provenance: {
      kind: "extracted_fact",
      decisionId: DECISION_ID,
      factId: "88888888-8888-4888-8888-888888888888",
      documentVersionId: "99999999-9999-4999-8999-999999999999",
      documentVersionNumber: 3,
    },
  });
  assert.deepEqual(guardPlatformExtractedFactDecision({
    ...base,
    expectedFieldRevision: 1,
    currentFieldValue,
  }), { ok: false, reason: "newer_confirmed_source" });

  const sameNumberDifferentDocument = confirmed("personal.first_name", "Amina", {
    provenance: {
      kind: "extracted_fact",
      decisionId: DECISION_ID,
      factId: "88888888-8888-4888-8888-888888888888",
      documentVersionId: "99999999-9999-4999-8999-999999999999",
      documentVersionNumber: 2,
    },
  });
  assert.deepEqual(guardPlatformExtractedFactDecision({
    ...base,
    expectedFieldRevision: 1,
    currentFieldValue: sameNumberDifferentDocument,
  }), { ok: false, reason: "newer_confirmed_source" });
});
