import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

function dataModule(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

const harness = {
  actorRole: "sales",
  guardCalls: [],
  serviceCalls: [],
  revalidated: [],
  result: {
    status: "accepted",
    reason: "accepted",
    attemptId: "00000000-0000-4000-8000-000000000091",
    steps: [
      {
        operationName: "update_contact",
        status: "accepted",
        reason: "accepted",
        attemptId: "00000000-0000-4000-8000-000000000091",
      },
    ],
  },
  providerAvailability: { status: "ready", accountDomain: "example.amocrm.ru" },
  commandConfigError: null,
  tokenError: null,
};
globalThis.__canonicalAmoCrmCommandActionHarness = harness;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: dataModule("export default {};"),
      };
    }
    if (!context.parentURL?.includes("/canonical-amocrm-command-actions.ts")) {
      return nextResolve(specifier, context);
    }
    if (specifier === "@/lib/platform-guards") {
      return {
        shortCircuit: true,
        url: dataModule(`
          function actor(kind) {
            const harness = globalThis.__canonicalAmoCrmCommandActionHarness;
            harness.guardCalls.push(kind);
            return { platformRole: harness.actorRole };
          }
          export async function requirePlatformSalesActor() {
            return actor("sales");
          }
          export async function requirePlatformAdmissionsActor() {
            return actor("admissions");
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
    if (specifier === "./platform-amocrm-command-service") {
      return {
        shortCircuit: true,
        url: dataModule(`
          function execute(kind, input) {
            const harness = globalThis.__canonicalAmoCrmCommandActionHarness;
            harness.serviceCalls.push({ kind, input });
            return harness.result;
          }
          export async function executePlatformAmoCrmSalesSync(input) {
            return execute("sales", input);
          }
          export async function executePlatformAmoCrmAdmissionsSync(input) {
            return execute("admissions", input);
          }
          export async function reconcilePlatformAmoCrmSyncAttempt(input) {
            return execute("reconcile", input);
          }
        `),
      };
    }
    if (specifier === "./canonical-amocrm-provider-config") {
      return {
        shortCircuit: true,
        url: dataModule(`
          export function readCanonicalAmoCrmProviderAvailability() {
            return globalThis.__canonicalAmoCrmCommandActionHarness.providerAvailability;
          }
          export function loadCanonicalAmoCrmProviderConfig() {
            return { status: "ready", tokenFilePath: "/ignored/token.json" };
          }
        `),
      };
    }
    if (specifier === "./canonical-amocrm-command-config") {
      return {
        shortCircuit: true,
        url: dataModule(`
          export class CanonicalAmoCrmCommandConfigurationError extends Error {}
          export function loadCanonicalAmoCrmCommandConfig() {
            const error = globalThis.__canonicalAmoCrmCommandActionHarness.commandConfigError;
            if (error) throw error;
            return { sales: {}, admissions: {} };
          }
        `),
      };
    }
    if (specifier === "./canonical-amocrm-token-store") {
      return {
        shortCircuit: true,
        url: dataModule(`
          export async function readCanonicalAmoCrmTokenFile() {
            const error = globalThis.__canonicalAmoCrmCommandActionHarness.tokenError;
            if (error) throw error;
            return { accessToken: "not-exposed" };
          }
        `),
      };
    }
    if (specifier === "next/cache") {
      return {
        shortCircuit: true,
        url: dataModule(`
          export function revalidatePath(path) {
            globalThis.__canonicalAmoCrmCommandActionHarness.revalidated.push(path);
          }
        `),
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  readCanonicalAmoCrmCommandAvailability,
  reconcileCanonicalAmoCrmCommandAction,
  syncCanonicalAmoCrmAdmissionsAction,
  syncCanonicalAmoCrmSalesAction,
} = await import("../src/lib/server/canonical-amocrm-command-actions.ts");

const IDS = Object.freeze({
  lead: "00000000-0000-4000-8000-000000000081",
  studentCase: "00000000-0000-4000-8000-000000000082",
  request: "00000000-0000-4000-8000-000000000083",
  attempt: "00000000-0000-4000-8000-000000000084",
});

const INITIAL_STATE = Object.freeze({
  status: "idle",
  reason: "idle",
  attemptId: null,
  steps: Object.freeze([]),
});

function resetHarness() {
  harness.actorRole = "sales";
  harness.guardCalls.length = 0;
  harness.serviceCalls.length = 0;
  harness.revalidated.length = 0;
  harness.result = {
    status: "accepted",
    reason: "accepted",
    attemptId: "00000000-0000-4000-8000-000000000091",
    steps: [
      {
        operationName: "update_contact",
        status: "accepted",
        reason: "accepted",
        attemptId: "00000000-0000-4000-8000-000000000091",
      },
    ],
  };
  harness.providerAvailability = {
    status: "ready",
    accountDomain: "example.amocrm.ru",
  };
  harness.commandConfigError = null;
  harness.tokenError = null;
}

function form(entries) {
  const value = new FormData();
  for (const [key, entry] of Object.entries(entries)) value.append(key, entry);
  return value;
}

test("Sales sync accepts only exact fields and passes a trimmed bounded human note", async () => {
  resetHarness();
  const result = await syncCanonicalAmoCrmSalesAction(
    INITIAL_STATE,
    form({
      lead_id: IDS.lead.toUpperCase(),
      request_id: IDS.request.toUpperCase(),
      note_text: "  Sales verified the current qualification.  ",
      task_text: "  Call the applicant after syncing.  ",
      task_complete_till: "1790000000",
    }),
  );

  assert.deepEqual(harness.guardCalls, ["sales"]);
  assert.deepEqual(harness.serviceCalls, [
    {
      kind: "sales",
      input: {
        actor: { platformRole: "sales" },
        actorRole: "sales",
        leadId: IDS.lead,
        baseRequestId: IDS.request,
        noteText: "Sales verified the current qualification.",
        taskText: "Call the applicant after syncing.",
        taskCompleteTill: 1790000000,
      },
    },
  ]);
  assert.deepEqual(harness.revalidated, [`/sales/${IDS.lead}`]);
  assert.deepEqual(result, harness.result);
});

test("Admissions sync uses the Admissions guard and exact Student 360 path", async () => {
  resetHarness();
  harness.actorRole = "admin";

  await syncCanonicalAmoCrmAdmissionsAction(
    INITIAL_STATE,
    form({
      student_case_id: IDS.studentCase,
      request_id: IDS.request,
      note_text: "Admissions accepted the handoff.",
      task_text: "Prepare the next admissions action.",
      task_complete_till: "1790003600",
    }),
  );

  assert.deepEqual(harness.guardCalls, ["admissions"]);
  assert.deepEqual(harness.serviceCalls[0], {
    kind: "admissions",
    input: {
      actor: { platformRole: "admin" },
      actorRole: "admin",
      studentCaseId: IDS.studentCase,
      baseRequestId: IDS.request,
      noteText: "Admissions accepted the handoff.",
      taskText: "Prepare the next admissions action.",
      taskCompleteTill: 1790003600,
    },
  });
  assert.deepEqual(harness.revalidated, [`/clients/${IDS.studentCase}`]);
});

test("unknown fields, duplicate fields, bad UUIDs, and notes outside 1..1000 UTF-8 bytes fail closed", async () => {
  const invalidForms = [
    form({
      lead_id: IDS.lead,
      request_id: IDS.request,
      note_text: "Valid note",
      task_text: "Valid task",
      task_complete_till: "1790000000",
      fallback: "legacy",
    }),
    (() => {
      const value = form({
        lead_id: IDS.lead,
        request_id: IDS.request,
        note_text: "Valid note",
        task_text: "Valid task",
        task_complete_till: "1790000000",
      });
      value.append("note_text", "Duplicate");
      return value;
    })(),
    form({
      lead_id: "not-a-uuid",
      request_id: IDS.request,
      note_text: "Note",
      task_text: "Task",
      task_complete_till: "1790000000",
    }),
    form({
      lead_id: IDS.lead,
      request_id: IDS.request,
      note_text: "   ",
      task_text: "Task",
      task_complete_till: "1790000000",
    }),
    form({
      lead_id: IDS.lead,
      request_id: IDS.request,
      note_text: "🙂".repeat(251),
      task_text: "Task",
      task_complete_till: "1790000000",
    }),
    form({
      lead_id: IDS.lead,
      request_id: IDS.request,
      note_text: "Note",
      task_text: "",
      task_complete_till: "1790000000",
    }),
    form({
      lead_id: IDS.lead,
      request_id: IDS.request,
      note_text: "Note",
      task_text: "Task",
      task_complete_till: "not-a-unix-time",
    }),
  ];

  for (const invalidForm of invalidForms) {
    resetHarness();
    const result = await syncCanonicalAmoCrmSalesAction(
      INITIAL_STATE,
      invalidForm,
    );
    assert.equal(result.status, "error");
    assert.equal(result.reason, "invalid_request");
    assert.equal(result.attemptId, null);
    assert.deepEqual(result.steps, []);
    assert.equal(harness.serviceCalls.length, 0);
    assert.equal(harness.revalidated.length, 0);
  }
});

test("all honest service terminal states and their step evidence pass through without invented success", async () => {
  for (const status of [
    "accepted",
    "rejected",
    "unknown",
    "blocked",
    "error",
    "request_conflict",
  ]) {
    resetHarness();
    harness.result = {
      status,
      reason: `${status}_reason`,
      attemptId: status === "blocked" ? null : IDS.attempt,
      steps: [
        {
          operationName: "add_note",
          status,
          reason: `${status}_reason`,
          attemptId: status === "blocked" ? null : IDS.attempt,
        },
      ],
    };
    const result = await syncCanonicalAmoCrmSalesAction(
      INITIAL_STATE,
      form({
        lead_id: IDS.lead,
        request_id: IDS.request,
        note_text: "Human-approved note",
        task_text: "Task",
        task_complete_till: "1790000000",
      }),
    );
    assert.deepEqual(result, harness.result);
  }
});

test("read-only reconciliation selects the workflow guard and exact path without a new request id", async () => {
  resetHarness();
  harness.actorRole = "admissions";
  harness.result = {
    status: "accepted",
    reason: "reconciled",
    attemptId: IDS.attempt,
    steps: [],
  };

  const result = await reconcileCanonicalAmoCrmCommandAction(
    INITIAL_STATE,
    form({
      workflow_scope: "admissions_post_handoff",
      lead_id: IDS.lead,
      student_case_id: IDS.studentCase,
      attempt_id: IDS.attempt,
    }),
  );

  assert.deepEqual(harness.guardCalls, ["admissions"]);
  assert.deepEqual(harness.serviceCalls, [
    {
      kind: "reconcile",
      input: {
        actor: { platformRole: "admissions" },
        actorRole: "admissions",
        workflowScope: "admissions_post_handoff",
        leadId: IDS.lead,
        studentCaseId: IDS.studentCase,
        attemptId: IDS.attempt,
      },
    },
  ]);
  assert.deepEqual(harness.revalidated, [`/clients/${IDS.studentCase}`]);
  assert.deepEqual(result, harness.result);
});

test("availability blocks on provider, routing, or token readiness without exposing account details", async () => {
  resetHarness();
  assert.deepEqual(await readCanonicalAmoCrmCommandAvailability(), {
    status: "ready",
  });

  harness.providerAvailability = {
    status: "blocked",
    reason: "configuration_missing",
  };
  assert.deepEqual(await readCanonicalAmoCrmCommandAvailability(), {
    status: "blocked",
    reason: "configuration_missing",
  });

  resetHarness();
  harness.commandConfigError = new Error("missing mapping");
  assert.deepEqual(await readCanonicalAmoCrmCommandAvailability(), {
    status: "blocked",
    reason: "routing_configuration_invalid",
  });

  resetHarness();
  harness.tokenError = new Error("secret path is unavailable");
  assert.deepEqual(await readCanonicalAmoCrmCommandAvailability(), {
    status: "blocked",
    reason: "token_unavailable",
  });
});
