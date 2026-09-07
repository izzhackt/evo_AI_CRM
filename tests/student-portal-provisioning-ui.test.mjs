import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decodeStudentPortalAccessOperation } from "../src/lib/server/student-portal-provisioning-form.ts";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V3 profile exposes Student Portal provisioning only in the Admin presentation", () => {
  const profile = source("src/components/v3/profile/Profile.tsx");
  const page = source("src/app/(v3)/v3/profile/page.tsx");
  assert.match(profile, /actorRole === "admin"[\s\S]*<StudentPortalAccessCard/u);
  assert.doesNotMatch(profile, /authorityRole === "admin"[\s\S]*<StudentPortalAccessCard/u);
  assert.match(
    page,
    /actor\.presentationRole === "admin"[\s\S]*listStudentPortalActiveCurators/u,
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
