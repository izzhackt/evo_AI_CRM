import assert from "node:assert/strict";
import test from "node:test";

import {
  STUDENT_CASE_REASON_MAX_LENGTH,
  canAssignCurator,
  canTransitionStudentCase,
  normalizeStudentCaseReason,
  nextCaseStateForAssignment,
  workflowOwnerForState,
} from "../src/lib/student-case-policy.ts";

test("only Admin can assign or reassign a Curator", () => {
  assert.equal(canAssignCurator("admin"), true);

  for (const role of ["sales", "curator", "finance", "client", "unknown"]) {
    assert.equal(canAssignCurator(role), false, role);
  }
});

test("only Admin or the assigned Curator can close and reopen a case", () => {
  const assignedCase = { curatorId: 42 };

  assert.equal(canTransitionStudentCase({ id: 1, role: "admin" }, assignedCase), true);
  assert.equal(canTransitionStudentCase({ id: 42, role: "curator" }, assignedCase), true);

  for (const actor of [
    { id: 43, role: "curator" },
    { id: 42, role: "sales" },
    { id: 42, role: "finance" },
    { id: 42, role: "client" },
  ]) {
    assert.equal(canTransitionStudentCase(actor, assignedCase), false, JSON.stringify(actor));
  }
});

test("case reasons are trimmed, bounded, and mandatory", () => {
  assert.equal(normalizeStudentCaseReason(null), null);
  assert.equal(normalizeStudentCaseReason("   "), null);
  assert.equal(normalizeStudentCaseReason("  verified handoff  "), "verified handoff");
  assert.equal(
    normalizeStudentCaseReason("x".repeat(STUDENT_CASE_REASON_MAX_LENGTH)),
    "x".repeat(STUDENT_CASE_REASON_MAX_LENGTH),
  );
  assert.equal(
    normalizeStudentCaseReason("x".repeat(STUDENT_CASE_REASON_MAX_LENGTH + 1)),
    null,
  );
});

test("assignment activates only a contract-confirmed pending case", () => {
  const confirmed = {
    contractConfirmedAt: "2026-07-28T10:00:00.000Z",
    contractConfirmationRef: "synthetic:test-contract",
  };

  assert.equal(
    nextCaseStateForAssignment({ caseState: "pending", ...confirmed }),
    "active",
  );
  assert.equal(
    nextCaseStateForAssignment({ caseState: "active", ...confirmed }),
    "active",
  );
  assert.equal(
    nextCaseStateForAssignment({ caseState: "closed", ...confirmed }),
    "closed",
  );
  assert.equal(
    nextCaseStateForAssignment({
      caseState: "pending",
      contractConfirmedAt: null,
      contractConfirmationRef: "synthetic:test-contract",
    }),
    null,
  );
  assert.equal(
    nextCaseStateForAssignment({
      caseState: "pending",
      contractConfirmedAt: "2026-07-28T10:00:00.000Z",
      contractConfirmationRef: " ",
    }),
    null,
  );
});

test("workflow ownership changes at handoff without changing admissions stage", () => {
  assert.equal(workflowOwnerForState("pending"), "sales");
  assert.equal(workflowOwnerForState("active"), "curator");
  assert.equal(workflowOwnerForState("closed"), "curator");
});
