import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decodeStudentPortalAccessOperation } from "../src/lib/server/student-portal-provisioning-form.ts";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V3 profile exposes Student Portal provisioning to Admin always, and to Sales only for a cabinet_pending case (S8)", () => {
  const profile = source("src/components/v3/profile/Profile.tsx");
  const page = source("src/app/(v3)/v3/profile/page.tsx");
  // The render gate is no longer a bare "admin only" check (S8: plan §4 —
  // Sales must be able to dispatch a cabinet case's own invite) — it is
  // "not preview" AND ("is admin" OR "is a cabinet case AND holds
  // sales.write"), never derived from caseState alone.
  assert.match(profile, /!isStaffPreview\(actor\) &&\s*profile\.student &&\s*draft\.admissions &&\s*\(actor\.systemRole === "admin" \|\|\s*\(draft\.admissions\.isCabinetCase && staffCan\(actor, "sales\.write"\)\)\)[\s\S]*<StudentPortalAccessCard/u);
  assert.match(profile, /isCabinetCase=\{draft\.admissions\.isCabinetCase\}/u);
  assert.doesNotMatch(profile, /authorityRole === "admin"[\s\S]*<StudentPortalAccessCard/u);
  // Curator options are only ever consumed by the legacy_pending picker
  // (never cabinet_pending, which has no curator at all) — that fetch stays
  // admin-only, byte-unchanged from before S8.
  assert.match(
    page,
    /actor\.systemRole === "admin" && !isStaffPreview\(actor\)[\s\S]*listStudentPortalActiveCurators/u,
  );
  assert.match(page, /@\/lib\/server\/student-portal-curator-options/u);
  assert.doesNotMatch(page, /@\/lib\/platform-case-assignment/u);
});

test("Admin action replays the authenticated receipt before service-role reconciliation", () => {
  const actions = source("src/lib/student-portal-provisioning-actions.ts");
  const reconcileStart = actions.indexOf("async function reconcileStudentPortalAccess");
  const serviceCall = actions.indexOf("createStudentPortalInviteReconcilerDependencies", reconcileStart);
  const adminReplay = actions.indexOf(".prepare({", reconcileStart);
  assert.ok(reconcileStart >= 0 && adminReplay > reconcileStart && serviceCall > adminReplay);
  assert.match(actions, /authorizedState\.attemptId !== attemptId/u);
  assert.match(actions, /authorizedState\.reissueRequestId !== reissueRequestId/u);
});

test("issued or accepted initial receipt can reach no-resend finalization replay", () => {
  const actions = source("src/lib/student-portal-provisioning-actions.ts");
  assert.match(
    actions,
    /receipt\.provisioningState === "invite_succeeded" &&\s*!receipt\.authorityActivated[\s\S]*?return "dispatch_initial"/u,
  );
  assert.match(
    actions,
    /finalizationReplay\s*\? receipt\.inviteGeneration\s*:\s*nextVersion\(receipt\.inviteGeneration\)/u,
  );
});

test("a definite reissue failure retries only through the durable receipt continuation", () => {
  const actions = source("src/lib/student-portal-provisioning-actions.ts");
  assert.match(
    actions,
    /if \(receipt\.inviteDeliveryStatus === "reissue_failed"\) \{\s*return "dispatch_reissue";\s*\}/u,
  );
  assert.match(
    actions,
    /async function dispatchReissue[\s\S]*?targetGeneration = nextVersion\(receipt\.inviteGeneration\)[\s\S]*?studentPortalAttemptId\([\s\S]*?"reissue",[\s\S]*?targetGeneration[\s\S]*?reissueRequestId: receipt\.reissueRequestId[\s\S]*?expectedReceiptVersion: receipt\.receiptVersion[\s\S]*?expectedInviteGeneration: receipt\.inviteGeneration/u,
  );
});

test("React action envelope decodes one exact portal operation", () => {
  const form = new FormData();
  form.append("0", "null");
  form.append("_1_$ACTION_ID_test", "");
  for (const [key, value] of Object.entries({
    operation: "prepare",
    organization_id: "organization",
    student_case_id: "case",
    email: "student@example.com",
    display_name: "Student",
    case_shape: "normal_u6",
    legacy_curator_membership_id: "",
    reason: "Invite",
    request_id: "request",
  })) {
    form.append(`_1_${key}`, value);
  }
  const decoded = decodeStudentPortalAccessOperation(form);
  assert.equal(decoded?.operation, "prepare");
  assert.deepEqual(
    Object.fromEntries(decoded?.commandForm.entries() ?? []),
    {
      organization_id: "organization",
      student_case_id: "case",
      email: "student@example.com",
      display_name: "Student",
      case_shape: "normal_u6",
      legacy_curator_membership_id: "",
      reason: "Invite",
      request_id: "request",
    },
  );
});

test("card makes resend and reconciliation boundaries explicit", () => {
  const card = source("src/components/v3/profile/StudentPortalAccessCard.tsx");
  assert.match(card, /Повторная отправка запрещена/u);
  assert.match(card, /только проверка провайдера/u);
  assert.match(card, /Явно подтвердить новое приглашение/u);
  assert.match(card, /name="reissue_request_id"/u);
});

// ---------------------------------------------------------------------------
// S8: cabinet_pending additions (unified workflow slice S8)
// ---------------------------------------------------------------------------

test("S8: requireStudentPortalOrganization delegates to the untouched requireAdminOrganization for normal_u6/legacy_pending, and only branches for cabinet_pending", () => {
  const actions = source("src/lib/student-portal-provisioning-actions.ts");
  // requireAdminOrganization keeps its exact original admin-only body —
  // normal_u6/legacy_pending must stay byte-identical to pre-S8.
  assert.match(
    actions,
    /async function requireAdminOrganization\(\s*organizationId\?: string,\s*\): Promise<"ok" \| "forbidden" \| "unavailable"> \{\s*const actor = await resolvePlatformActor\(\);\s*if \(\s*actor\.status === "invalid" &&\s*actor\.reason === "staff_authority_unavailable"\s*\) \{\s*return "unavailable";\s*\}\s*return actor\.status === "authenticated" &&\s*actor\.actor\.systemRole === "admin" &&\s*actor\.actor\.organizationId === organizationId\s*\?\s*"ok"\s*:\s*"forbidden";\s*\}/u,
  );
  const gate = actions.slice(
    actions.indexOf("async function requireStudentPortalOrganization("),
    actions.indexOf("function boundReceipt("),
  );
  // Delegation, not duplication — normal_u6/legacy_pending reuse the SAME
  // function object, exactly like the SQL side's assert_student_portal_
  // receipt_authority_e1 delegates to assert_student_portal_receipt_admin_e1.
  assert.match(gate, /if \(caseShape !== "cabinet_pending"\) \{\s*return requireAdminOrganization\(organizationId\);\s*\}/u);
  assert.match(gate, /staffCan\(actor\.actor, "sales\.write"\)/u);
  assert.match(actions, /import \{ staffCan \} from "\.\/platform-access\.ts";/u);
});

test("S8: prepare/reconcile accept cabinet_pending and require a NULL curator for it (like normal_u6)", () => {
  const actions = source("src/lib/student-portal-provisioning-actions.ts");
  const prepareFn = actions.slice(
    actions.indexOf("async function prepareStudentPortalAccess"),
    actions.indexOf("async function authorizeStudentPortalReissue"),
  );
  const reconcileFn = actions.slice(
    actions.indexOf("async function reconcileStudentPortalAccess"),
    actions.indexOf("async function safeAction"),
  );
  for (const fn of [prepareFn, reconcileFn]) {
    assert.match(
      fn,
      /caseShape !== "normal_u6" &&\s*caseShape !== "legacy_pending" &&\s*caseShape !== "cabinet_pending"/u,
    );
    // Both normal_u6 AND cabinet_pending are curator-less — only
    // legacy_pending may carry a legacy_curator_membership_id.
    assert.match(fn, /caseShape !== "legacy_pending" && legacyCuratorMembershipId !== null/u);
    assert.match(fn, /requireStudentPortalOrganization\(organizationId, caseShape\)/u);
  }
});

test("S8: reissue authorization carries case_shape end to end (form fields, action, decoder, card)", () => {
  const actions = source("src/lib/student-portal-provisioning-actions.ts");
  const reissueFn = actions.slice(
    actions.indexOf("async function authorizeStudentPortalReissue"),
    actions.indexOf("async function reconcileStudentPortalAccess"),
  );
  assert.match(reissueFn, /"case_shape",/u);
  assert.match(
    reissueFn,
    /caseShape !== "normal_u6" &&\s*caseShape !== "legacy_pending" &&\s*caseShape !== "cabinet_pending"/u,
  );
  assert.match(reissueFn, /requireStudentPortalOrganization\(organizationId, caseShape\)/u);

  const form = source("src/lib/server/student-portal-provisioning-form.ts");
  assert.match(form, /reissue: \[\s*"organization_id", "receipt_id", "receipt_version",\s*"invite_generation", "reason", "case_shape", "operation",\s*\]/u);

  const card = source("src/components/v3/profile/StudentPortalAccessCard.tsx");
  assert.match(
    card,
    /<input type="hidden" name="operation" value="reissue" \/>\s*<input type="hidden" name="organization_id" value=\{organizationId\} \/>\s*<input type="hidden" name="case_shape" value=\{caseShape\} \/>/u,
  );
});

test("S8: the card's caseShape is source_key-derived (isCabinetCase), never caseState alone — the exact bug the task flags", () => {
  const card = source("src/components/v3/profile/StudentPortalAccessCard.tsx");
  assert.match(card, /isCabinetCase: boolean;/u);
  assert.match(
    card,
    /const caseShape: CaseShape = caseState !== "pending"\s*\? "normal_u6"\s*: isCabinetCase\s*\? "cabinet_pending"\s*: "legacy_pending";/u,
  );
  // The curator picker (legacy_pending-only UI) must key off the derived
  // shape, not off caseState === "pending" directly (that was the bug).
  assert.doesNotMatch(card, /const legacyPending = caseState === "pending";/u);
  assert.match(card, /const legacyPending = caseShape === "legacy_pending";/u);
});

test("S8: Profile passes isCabinetCase through and the admissions workspace/type carry it, source_key-derived", () => {
  const types = source("src/components/v3/profile/types.ts");
  assert.match(types, /isCabinetCase: boolean;/u);
  const profileSource = source("src/lib/v3/profile-source.ts");
  assert.match(profileSource, /readStudentCaseCabinetOrigin/u);
  assert.match(profileSource, /function admissionsWorkspace\(\s*data: FullCaseData,\s*isCabinetCase: boolean,\s*\): ProfileAdmissionsWorkspace/u);
});
