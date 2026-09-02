import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export default {};",
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  parsePlatformAmoCrmAdmissionsSyncForm,
  parsePlatformAmoCrmReconcileForm,
  parsePlatformAmoCrmSalesSyncForm,
} = await import("../src/lib/platform-amocrm-command-action-contract.ts");

const IDS = Object.freeze({
  lead: "11111111-1111-4111-8111-111111111111",
  studentCase: "22222222-2222-4222-8222-222222222222",
  request: "33333333-3333-4333-8333-333333333333",
  attempt: "44444444-4444-4444-8444-444444444444",
});

function form(entries) {
  const value = new FormData();
  for (const [key, field] of entries) value.append(key, field);
  return value;
}

test("sales parser accepts exact fields and trims the note", () => {
  assert.deepEqual(
    parsePlatformAmoCrmSalesSyncForm(
      form([
        ["lead_id", IDS.lead],
        ["note_text", "  Keep the amoCRM note exact.  "],
        ["request_id", IDS.request],
      ]),
    ),
    {
      leadId: IDS.lead,
      noteText: "Keep the amoCRM note exact.",
      requestId: IDS.request,
    },
  );
});

test("admissions parser accepts only the exact case handoff fields", () => {
  assert.deepEqual(
    parsePlatformAmoCrmAdmissionsSyncForm(
      form([
        ["student_case_id", IDS.studentCase],
        ["note_text", "Admissions accepted the handoff."],
        ["request_id", IDS.request],
      ]),
    ),
    {
      studentCaseId: IDS.studentCase,
      noteText: "Admissions accepted the handoff.",
      requestId: IDS.request,
    },
  );
});

test("reconcile parser enforces the workflow contour", () => {
  assert.deepEqual(
    parsePlatformAmoCrmReconcileForm(
      form([
        ["attempt_id", IDS.attempt],
        ["lead_id", IDS.lead],
        ["student_case_id", IDS.studentCase],
        ["workflow_scope", "admissions_post_handoff"],
      ]),
    ),
    {
      attemptId: IDS.attempt,
      leadId: IDS.lead,
      studentCaseId: IDS.studentCase,
      workflowScope: "admissions_post_handoff",
    },
  );

  assert.deepEqual(
    parsePlatformAmoCrmReconcileForm(
      form([
        ["attempt_id", IDS.attempt],
        ["lead_id", IDS.lead],
        ["student_case_id", ""],
        ["workflow_scope", "admissions_post_handoff"],
      ]),
    ),
    null,
  );
});

test("duplicate, unknown and malformed action fields fail closed", () => {
  const duplicate = form([
    ["lead_id", IDS.lead],
    ["note_text", "Valid note"],
    ["request_id", IDS.request],
    ["request_id", IDS.request],
  ]);
  assert.equal(parsePlatformAmoCrmSalesSyncForm(duplicate), null);

  const unknown = form([
    ["lead_id", IDS.lead],
    ["note_text", "Valid note"],
    ["request_id", IDS.request],
    ["fallback", "legacy"],
  ]);
  assert.equal(parsePlatformAmoCrmSalesSyncForm(unknown), null);

  const malformed = form([
    ["student_case_id", IDS.studentCase],
    ["note_text", "\u0000"],
    ["request_id", "not-a-uuid"],
  ]);
  assert.equal(parsePlatformAmoCrmAdmissionsSyncForm(malformed), null);
});

test("React action-state envelopes retain the same exact contract", () => {
  const value = form([
    ["_1_$ACTION_REF_8", ""],
    ["_1_$ACTION_8:0", ""],
    ["_1_$ACTION_KEY", "state-key"],
    ["_1_lead_id", IDS.lead],
    ["_1_note_text", "Reviewed note"],
    ["_1_request_id", IDS.request],
    ["0", "previous-state"],
  ]);
  assert.equal(
    parsePlatformAmoCrmSalesSyncForm(value)?.requestId,
    IDS.request,
  );
});
