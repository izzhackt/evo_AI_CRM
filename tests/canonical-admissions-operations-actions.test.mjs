import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

function dataModule(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

const harness = {
  actor: { platformRole: "admissions" },
  guardCalls: [],
  repositoryCalls: [],
  revalidated: [],
  nextError: null,
};
globalThis.__canonicalAdmissionsOperationsActionHarness = harness;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.includes(
        "/canonical-admissions-operations-actions.ts",
      )
    ) {
      if (specifier === "@/lib/platform-guards") {
        return {
          shortCircuit: true,
          url: dataModule(`
            export async function requirePlatformCapability(capability, from) {
              const harness = globalThis.__canonicalAdmissionsOperationsActionHarness;
              harness.guardCalls.push({ capability, from });
              return harness.actor;
            }
          `),
        };
      }
      if (specifier === "./action-form-fields") {
        return {
          shortCircuit: true,
          url: new URL(
            "../src/lib/server/action-form-fields.ts",
            import.meta.url,
          ).href,
        };
      }
      if (specifier === "next/cache") {
        return {
          shortCircuit: true,
          url: dataModule(`
            export function revalidatePath(path) {
              globalThis.__canonicalAdmissionsOperationsActionHarness.revalidated.push(path);
            }
          `),
        };
      }
      if (specifier === "./canonical-crm-repository") {
        return {
          shortCircuit: true,
          url: dataModule(`
            export class CanonicalCrmRepositoryError extends Error {
              constructor(code) {
                super("Canonical CRM operation failed.");
                this.code = code;
              }
            }
            function beforeCall(kind, input) {
              const harness = globalThis.__canonicalAdmissionsOperationsActionHarness;
              harness.repositoryCalls.push({ kind, input });
              if (harness.nextError === "unknown") throw new Error("unknown");
              if (harness.nextError) {
                throw new CanonicalCrmRepositoryError(harness.nextError);
              }
            }
            export async function createCanonicalUniversityApplication(input) {
              beforeCall("create_application", input);
              return {
                applicationId: "00000000-0000-4000-8000-000000000041",
                studentCaseId: input.studentCaseId,
                status: "draft",
                version: 1,
              };
            }
            export async function updateCanonicalUniversityApplication(input) {
              beforeCall("update_application", input);
              return {
                applicationId: input.applicationId,
                studentCaseId: "00000000-0000-4000-8000-000000000040",
                status: "draft",
                version: input.expectedVersion + 1,
              };
            }
            export async function transitionCanonicalUniversityApplication(input) {
              beforeCall("transition_application", input);
              return {
                applicationId: input.applicationId,
                studentCaseId: "00000000-0000-4000-8000-000000000040",
                status: input.toStatus,
                version: input.expectedVersion + 1,
              };
            }
            export async function transitionCanonicalVisaMilestone(input) {
              beforeCall("transition_visa", input);
              return {
                visaMilestoneId: input.visaMilestoneId,
                studentCaseId: "00000000-0000-4000-8000-000000000040",
                milestoneKind: "submission",
                status: input.toStatus,
                version: input.expectedVersion + 1,
              };
            }
            export async function assertCanonicalFinanceStop(input) {
              beforeCall("assert_finance_stop", input);
              return {
                financeStopId: "00000000-0000-4000-8000-000000000043",
                studentCaseId: input.studentCaseId,
                isStopped: true,
                version: input.expectedVersion + 1,
              };
            }
            export async function releaseCanonicalFinanceStop(input) {
              beforeCall("release_finance_stop", input);
              return {
                financeStopId: input.financeStopId,
                studentCaseId: "00000000-0000-4000-8000-000000000040",
                isStopped: false,
                version: input.expectedVersion + 1,
              };
            }
          `),
        };
      }
    }
    return nextResolve(specifier, context);
  },
});

const {
  assertCanonicalFinanceStopAction,
  createCanonicalUniversityApplicationAction,
  releaseCanonicalFinanceStopAction,
  transitionCanonicalUniversityApplicationAction,
  transitionCanonicalVisaMilestoneAction,
  updateCanonicalUniversityApplicationAction,
} = await import(
  "../src/lib/server/canonical-admissions-operations-actions.ts"
);

const REQUEST_ID = "00000000-0000-4000-8000-000000000044";
const CASE_ID = "00000000-0000-4000-8000-000000000040";
const APPLICATION_ID = "00000000-0000-4000-8000-000000000041";
const VISA_ID = "00000000-0000-4000-8000-000000000042";
const FINANCE_STOP_ID = "00000000-0000-4000-8000-000000000043";

function resetHarness() {
  harness.actor = { platformRole: "admissions" };
  harness.guardCalls.length = 0;
  harness.repositoryCalls.length = 0;
  harness.revalidated.length = 0;
  harness.nextError = null;
}

function initialState() {
  return {
    status: "idle",
    requestId: REQUEST_ID,
    objectId: null,
    studentCaseId: null,
    objectStatus: null,
    version: null,
    changedAt: null,
  };
}

function form(entries) {
  const result = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    result.append(key, value);
  }
  return result;
}

test("application actions validate exact fields and pass normalized commands after the guard", async () => {
  resetHarness();
  const result = await createCanonicalUniversityApplicationAction(
    initialState(),
    form({
      institution_name: "  Technical   University ",
      next_action: "  Collect transcript  ",
      next_action_at: "2026-09-01T12:00:00.000Z",
      program_name: "  Computer   Science ",
      request_id: REQUEST_ID.toUpperCase(),
      student_case_id: CASE_ID.toUpperCase(),
      target_intake: "  Fall   2027 ",
    }),
  );
  assert.equal(result.status, "saved");
  assert.deepEqual(harness.guardCalls, [
    { capability: "admissions.write", from: "/clients" },
  ]);
  assert.deepEqual(harness.repositoryCalls, [
    {
      kind: "create_application",
      input: {
        actorRole: "admissions",
        idempotencyKey: REQUEST_ID,
        correlationId: REQUEST_ID,
        studentCaseId: CASE_ID,
        institutionName: "Technical University",
        programName: "Computer Science",
        targetIntake: "Fall 2027",
        nextAction: "Collect transcript",
        nextActionAt: "2026-09-01T12:00:00.000Z",
      },
    },
  ]);
  assert.deepEqual(harness.revalidated, [
    "/applications",
    "/clients",
    `/clients/${CASE_ID}`,
  ]);

  resetHarness();
  const invalid = form({
    institution_name: "Technical University",
    next_action: "Collect transcript",
    next_action_at: "2026-09-01T12:00:00.000Z",
    program_name: "Computer Science",
    request_id: REQUEST_ID,
    student_case_id: CASE_ID,
    target_intake: "Fall 2027",
    unexpected: "fail closed",
  });
  const rejected = await createCanonicalUniversityApplicationAction(
    initialState(),
    invalid,
  );
  assert.equal(rejected.status, "invalid");
  assert.equal(harness.repositoryCalls.length, 0);
});

test("application update and transition actions preserve optimistic versions and reason rules", async () => {
  resetHarness();
  await updateCanonicalUniversityApplicationAction(
    initialState(),
    form({
      application_id: APPLICATION_ID,
      expected_version: "2",
      next_action: "  Submit application  ",
      next_action_at: "2026-09-02T12:00:00.000Z",
      request_id: REQUEST_ID,
    }),
  );
  assert.deepEqual(harness.repositoryCalls[0], {
    kind: "update_application",
    input: {
      actorRole: "admissions",
      idempotencyKey: REQUEST_ID,
      correlationId: REQUEST_ID,
      applicationId: APPLICATION_ID,
      expectedVersion: 2,
      nextAction: "Submit application",
      nextActionAt: "2026-09-02T12:00:00.000Z",
    },
  });

  resetHarness();
  const rejected = await transitionCanonicalUniversityApplicationAction(
    initialState(),
    form({
      application_id: APPLICATION_ID,
      expected_version: "3",
      reason: " ",
      request_id: REQUEST_ID,
      to_status: "rejected",
    }),
  );
  assert.equal(rejected.status, "invalid");
  assert.equal(harness.repositoryCalls.length, 0);

  resetHarness();
  await transitionCanonicalUniversityApplicationAction(
    initialState(),
    form({
      application_id: APPLICATION_ID,
      expected_version: "3",
      reason: "  University declined the application  ",
      request_id: REQUEST_ID,
      to_status: "rejected",
    }),
  );
  assert.deepEqual(harness.repositoryCalls[0], {
    kind: "transition_application",
    input: {
      actorRole: "admissions",
      idempotencyKey: REQUEST_ID,
      correlationId: REQUEST_ID,
      applicationId: APPLICATION_ID,
      expectedVersion: 3,
      toStatus: "rejected",
      reason: "University declined the application",
    },
  });
});

test("visa and finance actions pass bounded workflow fields and revalidate their queues", async () => {
  resetHarness();
  await transitionCanonicalVisaMilestoneAction(
    initialState(),
    form({
      due_at: "2026-09-10T12:00:00.000Z",
      expected_version: "1",
      next_action: "  Book biometrics  ",
      next_action_at: "2026-09-03T12:00:00.000Z",
      reason: "",
      request_id: REQUEST_ID,
      to_status: "in_progress",
      visa_milestone_id: VISA_ID,
    }),
  );
  assert.deepEqual(harness.repositoryCalls[0], {
    kind: "transition_visa",
    input: {
      actorRole: "admissions",
      idempotencyKey: REQUEST_ID,
      correlationId: REQUEST_ID,
      visaMilestoneId: VISA_ID,
      expectedVersion: 1,
      toStatus: "in_progress",
      reason: null,
      nextAction: "Book biometrics",
      nextActionAt: "2026-09-03T12:00:00.000Z",
      dueAt: "2026-09-10T12:00:00.000Z",
    },
  });
  assert.deepEqual(harness.revalidated, [
    "/visa",
    "/clients",
    `/clients/${CASE_ID}`,
  ]);

  resetHarness();
  await assertCanonicalFinanceStopAction(
    initialState(),
    form({
      expected_version: "0",
      reason: "  First payment needs review  ",
      request_id: REQUEST_ID,
      student_case_id: CASE_ID,
    }),
  );
  assert.deepEqual(harness.repositoryCalls[0], {
    kind: "assert_finance_stop",
    input: {
      actorRole: "admissions",
      idempotencyKey: REQUEST_ID,
      correlationId: REQUEST_ID,
      studentCaseId: CASE_ID,
      expectedVersion: 0,
      reason: "First payment needs review",
    },
  });

  resetHarness();
  harness.actor = { platformRole: "admin" };
  await releaseCanonicalFinanceStopAction(
    initialState(),
    form({
      expected_version: "1",
      finance_stop_id: FINANCE_STOP_ID,
      reason: "  Payment verified  ",
      request_id: REQUEST_ID,
    }),
  );
  assert.deepEqual(harness.repositoryCalls[0], {
    kind: "release_finance_stop",
    input: {
      actorRole: "admin",
      idempotencyKey: REQUEST_ID,
      correlationId: REQUEST_ID,
      financeStopId: FINANCE_STOP_ID,
      expectedVersion: 1,
      reason: "Payment verified",
    },
  });
  assert.deepEqual(harness.revalidated, [
    "/finance",
    "/applications",
    "/visa",
    "/clients",
    `/clients/${CASE_ID}`,
  ]);
});

test("repository failures map to bounded operations states and rotate only idempotency conflicts", async () => {
  for (const [error, status, rotates] of [
    ["conflict", "stale", false],
    ["idempotency_conflict", "request_conflict", true],
    ["gate_unsatisfied", "blocked", false],
    ["forbidden", "forbidden", false],
    ["unknown", "unavailable", false],
  ]) {
    resetHarness();
    harness.nextError = error;
    const result = await transitionCanonicalUniversityApplicationAction(
      initialState(),
      form({
        application_id: APPLICATION_ID,
        expected_version: "1",
        reason: "",
        request_id: REQUEST_ID,
        to_status: "submitted",
      }),
    );
    assert.equal(result.status, status, error);
    assert.equal(result.requestId !== REQUEST_ID, rotates, error);
  }
});
