import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getPlatformCaseDocumentWorkspace,
  listPlatformDocumentQueue,
  normalizePlatformCaseDocumentWorkspace,
  normalizePlatformDocumentQueueRow,
  PlatformPrivateDocumentsRepositoryError,
} from "../src/lib/platform-private-documents.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const SLOT_ID = "33333333-3333-4333-8333-333333333333";
const REQUIREMENT_ID = "44444444-4444-4444-8444-444444444444";
const CURRENT_VERSION_ID = "55555555-5555-4555-8555-555555555555";
const OLD_VERSION_ID = "66666666-6666-4666-8666-666666666666";
const MEMBERSHIP_ID = "77777777-7777-4777-8777-777777777777";
const REMOVED_SLOT_ID = "88888888-8888-4888-8888-888888888888";
const AT = "2026-09-02T08:00:00+00:00";

const ACTOR = Object.freeze({
  authUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  membershipId: MEMBERSHIP_ID,
  organizationId: ORGANIZATION_ID,
  displayName: "Admissions",
  email: "admissions@example.test",
  platformRole: "admissions",
  authorityRole: "admissions",
  platformAccessVersion: 1,
  platformBundleId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  platformBundleVersion: 1,
});

function version({
  id = CURRENT_VERSION_ID,
  versionNumber = "2",
  current = true,
} = {}) {
  return {
    document_version_id: id,
    version_no: versionNumber,
    original_filename: `passport-v${versionNumber}.pdf`,
    declared_mime_type: "application/pdf",
    byte_size: "2048",
    sha256_hex: current ? "a".repeat(64) : "b".repeat(64),
    integrity_status: "verified",
    malware_status: "clean",
    validation_updated_at: AT,
    submitted_by_membership_id: MEMBERSHIP_ID,
    submitted_by_display_name: "Admissions",
    storage_finalized: true,
    finalized_at: AT,
    download_ready: true,
    is_current: current,
    latest_review: current ? null : {
      decision: "correction_required",
      reason: "Replace the cropped page",
      reviewer_membership_id: MEMBERSHIP_ID,
      reviewer_display_name: "Admissions",
      reviewed_at: AT,
    },
    created_at: AT,
    updated_at: AT,
  };
}

function slot(overrides = {}) {
  return {
    document_slot_id: SLOT_ID,
    document_requirement_id: REQUIREMENT_ID,
    requirement_key: "passport",
    requirement_label: "Passport",
    group_label: "Основные документы",
    intent_kind: "baseline",
    slot_version: "1",
    instructions: "Upload every page",
    checklist_version: "1",
    slot_status: "submitted",
    deadline: null,
    next_action: "Review the current version",
    current_version_id: CURRENT_VERSION_ID,
    current_version_no: "2",
    created_at: AT,
    updated_at: AT,
    versions: [
      version(),
      version({ id: OLD_VERSION_ID, versionNumber: "1", current: false }),
    ],
    ...overrides,
  };
}

function workspace(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    student_case_id: CASE_ID,
    case_state: "active",
    slots: [slot()],
    removed_slots: [],
    ...overrides,
  };
}

function removedSlot(overrides = {}) {
  return {
    ...slot({
      document_slot_id: REMOVED_SLOT_ID,
      intent_kind: "custom",
      document_requirement_id: null,
      requirement_key: null,
      checklist_version: null,
      requirement_label: "Case-local bank statement",
      group_label: "Дополнительные документы",
    }),
    removed_at: AT,
    removed_by_membership_id: MEMBERSHIP_ID,
    removal_reason: "Пункт больше не нужен для выбранной программы",
    ...overrides,
  };
}

function queueRow(overrides = {}) {
  return {
    sort_at: AT,
    organization_id: ORGANIZATION_ID,
    document_slot_id: SLOT_ID,
    student_case_id: CASE_ID,
    student_display_name: "Real Student",
    case_state: "active",
    document_requirement_id: REQUIREMENT_ID,
    requirement_key: "passport",
    requirement_label: "Passport",
    slot_status: "submitted",
    deadline: null,
    next_action: "Review",
    current_version_id: CURRENT_VERSION_ID,
    current_version_no: "2",
    current_original_filename: "passport-v2.pdf",
    current_declared_mime_type: "application/pdf",
    current_byte_size: "2048",
    current_sha256_hex: "a".repeat(64),
    current_integrity_status: "verified",
    current_malware_status: "clean",
    current_review_decision: null,
    current_review_reason: null,
    current_version_finalized_at: AT,
    download_ready: true,
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

test("case document workspace keeps every immutable version grouped under one slot", () => {
  const normalized = normalizePlatformCaseDocumentWorkspace(
    workspace(),
    ORGANIZATION_ID,
    CASE_ID,
  );
  assert.equal(normalized.slots.length, 1);
  assert.equal(normalized.slots[0].groupLabel, "Основные документы");
  assert.equal(normalized.slots[0].intentKind, "baseline");
  assert.equal(normalized.slots[0].version, 1);
  assert.deepEqual(
    normalized.slots[0].versions.map((item) => [item.versionNumber, item.isCurrent]),
    [[2, true], [1, false]],
  );
  assert.equal(normalized.slots[0].versions[1].latestReview.decision, "correction_required");
  assert.equal("objectName" in normalized.slots[0].versions[0], false);
});

test("case document workspace accepts a case-local custom slot without a shared requirement", () => {
  const normalized = normalizePlatformCaseDocumentWorkspace(
    workspace({
      slots: [slot({
        document_requirement_id: null,
        requirement_key: null,
        requirement_label: "Справка из банка",
        group_label: "Дополнительные документы",
        intent_kind: "custom",
        slot_version: "3",
        checklist_version: null,
      })],
    }),
    ORGANIZATION_ID,
    CASE_ID,
  );

  assert.equal(normalized.slots[0].documentRequirementId, null);
  assert.equal(normalized.slots[0].requirementKey, null);
  assert.equal(normalized.slots[0].checklistVersion, null);
  assert.equal(normalized.slots[0].intentKind, "custom");
  assert.equal(normalized.slots[0].version, 3);
});

test("case document workspace rejects mixed baseline and custom authority fields", () => {
  assert.throws(
    () => normalizePlatformCaseDocumentWorkspace(
      workspace({
        slots: [slot({
          intent_kind: "custom",
          document_requirement_id: null,
          requirement_key: "shared-key-must-not-leak",
          checklist_version: null,
        })],
      }),
      ORGANIZATION_ID,
      CASE_ID,
    ),
    PlatformPrivateDocumentsRepositoryError,
  );
});

test("workspace rejects duplicate versions and mismatched current markers", () => {
  assert.throws(
    () => normalizePlatformCaseDocumentWorkspace(
      workspace({ slots: [slot({ versions: [version(), version()] })] }),
      ORGANIZATION_ID,
      CASE_ID,
    ),
    PlatformPrivateDocumentsRepositoryError,
  );
  assert.throws(
    () => normalizePlatformCaseDocumentWorkspace(
      workspace({ slots: [slot({ current_version_id: OLD_VERSION_ID })] }),
      ORGANIZATION_ID,
      CASE_ID,
    ),
    PlatformPrivateDocumentsRepositoryError,
  );
});

test("workspace returns removed slots as distinct immutable history", () => {
  const result = normalizePlatformCaseDocumentWorkspace(
    workspace({ removed_slots: [removedSlot()] }),
    ORGANIZATION_ID,
    CASE_ID,
  );

  assert.equal(result.slots.length, 1);
  assert.equal(result.removedSlots.length, 1);
  assert.equal(result.removedSlots[0].documentSlotId, REMOVED_SLOT_ID);
  assert.equal(result.removedSlots[0].removalReason, "Пункт больше не нужен для выбранной программы");
  assert.equal(result.removedSlots[0].versions.length, 2);
  assert.equal("uploadRequestId" in result.removedSlots[0], false);
  assert.equal("objectName" in result.removedSlots[0].versions[0], false);
});

test("workspace fails closed on malformed or overlapping removed history", () => {
  const missingHistory = workspace();
  delete missingHistory.removed_slots;
  assert.throws(
    () => normalizePlatformCaseDocumentWorkspace(
      missingHistory,
      ORGANIZATION_ID,
      CASE_ID,
    ),
    PlatformPrivateDocumentsRepositoryError,
  );
  assert.throws(
    () => normalizePlatformCaseDocumentWorkspace(
      workspace({ removed_slots: [removedSlot({ removed_at: null })] }),
      ORGANIZATION_ID,
      CASE_ID,
    ),
    PlatformPrivateDocumentsRepositoryError,
  );
  assert.throws(
    () => normalizePlatformCaseDocumentWorkspace(
      workspace({ removed_slots: [removedSlot({ document_slot_id: SLOT_ID })] }),
      ORGANIZATION_ID,
      CASE_ID,
    ),
    PlatformPrivateDocumentsRepositoryError,
  );
});

test("document queue validates exact finalized metadata without exposing Storage paths", () => {
  const row = normalizePlatformDocumentQueueRow(queueRow(), ORGANIZATION_ID);
  assert.equal(row.currentVersionNumber, 2);
  assert.equal(row.downloadReady, true);
  assert.equal("objectName" in row, false);
  assert.throws(
    () => normalizePlatformDocumentQueueRow(
      queueRow({ download_ready: true, current_integrity_status: "pending" }),
      ORGANIZATION_ID,
    ),
    PlatformPrivateDocumentsRepositoryError,
  );
});

test("document queue accepts custom case slots without inventing a shared requirement", () => {
  const row = normalizePlatformDocumentQueueRow(
    queueRow({
      document_requirement_id: null,
      requirement_key: null,
      requirement_label: "Case-local bank statement",
    }),
    ORGANIZATION_ID,
  );
  assert.equal(row.documentRequirementId, null);
  assert.equal(row.requirementKey, null);
  assert.equal(row.requirementLabel, "Case-local bank statement");

  assert.throws(
    () => normalizePlatformDocumentQueueRow(
      queueRow({ document_requirement_id: null }),
      ORGANIZATION_ID,
    ),
    PlatformPrivateDocumentsRepositoryError,
  );
});

test("case and queue reads call one authenticated GET-safe Supabase RPC each", async () => {
  const calls = [];
  const client = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, args, options) {
          calls.push([name, args, options]);
          return {
            data: name === "staff_student_case_document_workspace"
              ? workspace()
              : [queueRow(), queueRow({
                  document_slot_id: "88888888-8888-4888-8888-888888888888",
                  document_requirement_id: "99999999-9999-4999-8999-999999999999",
                })],
            error: null,
          };
        },
      };
    },
  };
  const caseWorkspace = await getPlatformCaseDocumentWorkspace(
    ACTOR,
    CASE_ID,
    { client },
  );
  const queue = await listPlatformDocumentQueue(ACTOR, 1, { client });
  assert.equal(caseWorkspace.slots[0].versions.length, 2);
  assert.equal(queue.rows.length, 1);
  assert.equal(queue.hasMore, true);
  assert.deepEqual(calls, [
    [
      "staff_student_case_document_workspace",
      { p_student_case_id: CASE_ID },
      { get: true },
    ],
    ["staff_document_queue", { p_limit: 2 }, { get: true }],
  ]);
});

test("Sales is rejected before any Admissions document RPC", async () => {
  let called = false;
  const client = {
    schema() {
      called = true;
      throw new Error("must not run");
    },
  };
  await assert.rejects(
    () => getPlatformCaseDocumentWorkspace(
      { ...ACTOR, platformRole: "sales", authorityRole: "sales" },
      CASE_ID,
      { client },
    ),
    PlatformPrivateDocumentsRepositoryError,
  );
  assert.equal(called, false);
});

test("document runtime source has one Supabase authority and no local-file fallback", () => {
  const source = readFileSync(
    new URL("../src/lib/platform-private-documents.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /staff_student_case_document_workspace/);
  assert.match(source, /staff_document_queue/);
  assert.doesNotMatch(
    source,
    /EVO_PRIVATE_DOCUMENT_ROOT|private-document-repository|filesystem|drizzle|fallback/i,
  );
});
