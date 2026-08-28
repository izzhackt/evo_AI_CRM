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
globalThis.__canonicalAdmissionsTaskActionHarness = harness;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.includes("/canonical-admissions-task-actions.ts")
    ) {
      if (specifier === "@/lib/platform-guards") {
        return {
          shortCircuit: true,
          url: dataModule(`
            export async function requirePlatformCapability(capability, from) {
              const harness = globalThis.__canonicalAdmissionsTaskActionHarness;
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
              globalThis.__canonicalAdmissionsTaskActionHarness.revalidated.push(path);
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
              const harness = globalThis.__canonicalAdmissionsTaskActionHarness;
              harness.repositoryCalls.push({ kind, input });
              if (harness.nextError === "unknown") throw new Error("unknown");
              if (harness.nextError) {
                throw new CanonicalCrmRepositoryError(harness.nextError);
              }
            }
            export async function createCanonicalAdmissionsTask(input) {
              beforeCall("create", input);
              return {
                taskId: "00000000-0000-4000-8000-000000000031",
                studentCaseId: input.studentCaseId,
                status: "open",
                version: 1,
              };
            }
            export async function transitionCanonicalAdmissionsTask(input) {
              beforeCall("transition", input);
              return {
                taskId: input.taskId,
                studentCaseId: "00000000-0000-4000-8000-000000000021",
                status: input.toStatus,
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
  createCanonicalAdmissionsTaskAction,
  transitionCanonicalAdmissionsTaskAction,
} = await import("../src/lib/server/canonical-admissions-task-actions.ts");

const REQUEST_ID = "00000000-0000-4000-8000-000000000011";
const CASE_ID = "00000000-0000-4000-8000-000000000021";
const TASK_ID = "00000000-0000-4000-8000-000000000031";

function initialState() {
  return {
    status: "idle",
    requestId: REQUEST_ID,
    taskId: null,
    studentCaseId: null,
    taskStatus: null,
    version: null,
    changedAt: null,
  };
}

function resetHarness() {
  harness.actor = { platformRole: "admissions" };
  harness.guardCalls.length = 0;
  harness.repositoryCalls.length = 0;
  harness.revalidated.length = 0;
  harness.nextError = null;
}

function formData(entries) {
  const form = new FormData();
  for (const [key, value] of entries) form.append(key, value);
  return form;
}

function createForm() {
  return formData([
    ["details", "  Confirm the translated names\nand passport spelling  "],
    ["due_at", "2026-09-04T12:30:00.000+04:00"],
    ["request_id", REQUEST_ID],
    ["student_case_id", CASE_ID],
    ["title", "  Verify translation  "],
  ]);
}

function transitionForm({
  toStatus = "completed",
  reason = "",
} = {}) {
  return formData([
    ["expected_version", "3"],
    ["reason", reason],
    ["request_id", REQUEST_ID],
    ["task_id", TASK_ID],
    ["to_status", toStatus],
  ]);
}

test("create action authorizes first and sends one normalized canonical command", async () => {
  resetHarness();
  const result = await createCanonicalAdmissionsTaskAction(
    initialState(),
    createForm(),
  );

  assert.deepEqual(harness.guardCalls, [
    { capability: "admissions.write", from: "/clients" },
  ]);
  assert.equal(harness.repositoryCalls.length, 1);
  assert.deepEqual(harness.repositoryCalls[0], {
    kind: "create",
    input: {
      actorRole: "admissions",
      idempotencyKey: REQUEST_ID,
      correlationId: REQUEST_ID,
      studentCaseId: CASE_ID,
      title: "Verify translation",
      details: "Confirm the translated names\nand passport spelling",
      dueAt: "2026-09-04T08:30:00.000Z",
    },
  });
  assert.equal(result.status, "saved");
  assert.equal(result.taskId, TASK_ID);
  assert.notEqual(result.requestId, REQUEST_ID);
  assert.deepEqual(harness.revalidated, [
    "/tasks",
    "/clients",
    `/clients/${CASE_ID}`,
  ]);
});

test("unknown, duplicate, and malformed create fields fail closed before the repository", async () => {
  for (const mutate of [
    (form) => form.append("unexpected", "value"),
    (form) => form.append("title", "duplicate"),
    (form) => form.set("due_at", "2026-09-04T12:30:00.123456Z"),
    (form) => form.set("due_at", "2026-02-31T12:30:00.000Z"),
  ]) {
    resetHarness();
    const form = createForm();
    mutate(form);
    const result = await createCanonicalAdmissionsTaskAction(
      initialState(),
      form,
    );

    assert.equal(result.status, "invalid");
    assert.equal(result.requestId, REQUEST_ID);
    assert.equal(harness.repositoryCalls.length, 0);
  }
});

test("transition parsing requires an empty completion reason and a cancellation reason", async () => {
  for (const form of [
    transitionForm({ reason: "completion must not carry a reason" }),
    transitionForm({ toStatus: "cancelled", reason: "   " }),
  ]) {
    resetHarness();
    const result = await transitionCanonicalAdmissionsTaskAction(
      initialState(),
      form,
    );
    assert.equal(result.status, "invalid");
    assert.equal(harness.repositoryCalls.length, 0);
  }

  resetHarness();
  const result = await transitionCanonicalAdmissionsTaskAction(
    initialState(),
    transitionForm({ toStatus: "cancelled", reason: "  Superseded  " }),
  );
  assert.equal(result.status, "saved");
  assert.deepEqual(harness.repositoryCalls[0], {
    kind: "transition",
    input: {
      actorRole: "admissions",
      idempotencyKey: REQUEST_ID,
      correlationId: REQUEST_ID,
      taskId: TASK_ID,
      expectedVersion: 3,
      toStatus: "cancelled",
      reason: "Superseded",
    },
  });
});

test("repository failures map to bounded action states and rotate only conflicts", async () => {
  for (const [error, status, rotates] of [
    ["conflict", "stale", false],
    ["idempotency_conflict", "request_conflict", true],
    ["forbidden", "forbidden", false],
    ["unknown", "unavailable", false],
  ]) {
    resetHarness();
    harness.nextError = error;
    const result = await transitionCanonicalAdmissionsTaskAction(
      initialState(),
      transitionForm(),
    );
    assert.equal(result.status, status, error);
    assert.equal(result.requestId !== REQUEST_ID, rotates, error);
  }
});
