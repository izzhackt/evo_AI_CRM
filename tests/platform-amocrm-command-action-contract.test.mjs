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
const FIXED_NOW = Date.parse("2026-09-02T10:00:00.000Z");

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
        ["task_text", "  Call the applicant tomorrow  "],
        ["task_complete_till", "1790000000"],
      ]),
      { now: FIXED_NOW },
    ),
    {
      leadId: IDS.lead,
      noteText: "Keep the amoCRM note exact.",
      requestId: IDS.request,
      taskText: "Call the applicant tomorrow",
      taskCompleteTill: 1790000000,
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
        ["task_text", "Request the first missing document"],
        ["task_complete_till", "1790000000"],
      ]),
      { now: FIXED_NOW },
    ),
    {
      studentCaseId: IDS.studentCase,
      noteText: "Admissions accepted the handoff.",
      requestId: IDS.request,
      taskText: "Request the first missing document",
      taskCompleteTill: 1790000000,
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
    ["task_text", "Valid task"],
    ["task_complete_till", "1790000000"],
    ["request_id", IDS.request],
  ]);
  assert.equal(parsePlatformAmoCrmSalesSyncForm(duplicate, { now: FIXED_NOW }), null);

  const unknown = form([
    ["lead_id", IDS.lead],
    ["note_text", "Valid note"],
    ["request_id", IDS.request],
    ["task_text", "Valid task"],
    ["task_complete_till", "1790000000"],
    ["fallback", "legacy"],
  ]);
  assert.equal(parsePlatformAmoCrmSalesSyncForm(unknown, { now: FIXED_NOW }), null);

  const malformed = form([
    ["student_case_id", IDS.studentCase],
    ["note_text", "\u0000"],
    ["request_id", "not-a-uuid"],
    ["task_text", "Task"],
    ["task_complete_till", "1790000000"],
  ]);
  assert.equal(
    parsePlatformAmoCrmAdmissionsSyncForm(malformed, { now: FIXED_NOW }),
    null,
  );
});

test("React action-state envelopes retain the same exact contract", () => {
  const value = form([
    ["_1_$ACTION_REF_8", ""],
    ["_1_$ACTION_8:0", ""],
    ["_1_$ACTION_KEY", "state-key"],
    ["_1_lead_id", IDS.lead],
    ["_1_note_text", "Reviewed note"],
    ["_1_request_id", IDS.request],
    ["_1_task_text", "Future task"],
    ["_1_task_complete_till", "1790000000"],
    ["0", "previous-state"],
  ]);
  assert.equal(
    parsePlatformAmoCrmSalesSyncForm(value, { now: FIXED_NOW })?.requestId,
    IDS.request,
  );
});

test("task fields are required and task_complete_till must be a future unix second", () => {
  assert.equal(
    parsePlatformAmoCrmSalesSyncForm(
      form([
        ["lead_id", IDS.lead],
        ["note_text", "Valid note"],
        ["request_id", IDS.request],
        ["task_text", "  "],
        ["task_complete_till", "1790000000"],
      ]),
      { now: FIXED_NOW },
    ),
    null,
  );
  assert.equal(
    parsePlatformAmoCrmSalesSyncForm(
      form([
        ["lead_id", IDS.lead],
        ["note_text", "Valid note"],
        ["request_id", IDS.request],
        ["task_text", "Valid task"],
        ["task_complete_till", "1"],
      ]),
      { now: FIXED_NOW },
    ),
    null,
  );
  assert.equal(
    parsePlatformAmoCrmAdmissionsSyncForm(
      form([
        ["student_case_id", IDS.studentCase],
        ["note_text", "Admissions accepted the handoff."],
        ["request_id", IDS.request],
        ["task_text", "Request the first missing document"],
        ["task_complete_till", "not-a-number"],
      ]),
      { now: FIXED_NOW },
    ),
    null,
  );
  assert.equal(
    parsePlatformAmoCrmSalesSyncForm(
      form([
        ["lead_id", IDS.lead],
        ["note_text", "Valid note"],
        ["request_id", IDS.request],
        ["task_text", "Valid task"],
        ["task_complete_till", "2147483647"],
      ]),
      { now: FIXED_NOW },
    )?.taskCompleteTill,
    2_147_483_647,
  );
  assert.equal(
    parsePlatformAmoCrmSalesSyncForm(
      form([
        ["lead_id", IDS.lead],
        ["note_text", "Valid note"],
        ["request_id", IDS.request],
        ["task_text", "Valid task"],
        ["task_complete_till", "2147483648"],
      ]),
      { now: FIXED_NOW },
    ),
    null,
  );
});

test("note_text and task_text reject control characters under the shared fail-closed rule", () => {
  assert.equal(
    parsePlatformAmoCrmSalesSyncForm(
      form([
        ["lead_id", IDS.lead],
        ["note_text", "Line one\nLine two"],
        ["request_id", IDS.request],
        ["task_text", "Valid task"],
        ["task_complete_till", "1790000000"],
      ]),
      { now: FIXED_NOW },
    ),
    null,
  );
  assert.equal(
    parsePlatformAmoCrmSalesSyncForm(
      form([
        ["lead_id", IDS.lead],
        ["note_text", "Valid note"],
        ["request_id", IDS.request],
        ["task_text", "Line one\nLine two"],
        ["task_complete_till", "1790000000"],
      ]),
      { now: FIXED_NOW },
    ),
    null,
  );
});
