// «Добавить лида» с «Следующим действием» (07.11.2026): create_manual_sales_lead писал шаг без квитанции «Воронки»,
// и staff_sales_lead_page отказывал (sales_stage_entry_evidence_inconsistent) — доска и «Заявки» не открывались ни у кого.
// Теперь лид создаётся без шага, а шаг пишет обычная команда «Воронки». Production code runs against observed fakes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const ORG = "10000000-0000-4000-8000-000000000001";
const LEAD = "10000000-0000-4000-8000-000000000002";
const OWNER = "10000000-0000-4000-8000-000000000003";
const ACTOR = { organizationId: ORG, systemRole: "admin", permissionKeys: [] };
// The workflow command's own request-id check (v4 shape only): a v5 id was rejected there as `invalid` (07.11, browser).
const WORKFLOW_REQUEST_ID = new RegExp(readFileSync(new URL("../src/lib/platform-sales.ts", import.meta.url), "utf8")
  .match(/const REQUEST_UUID_PATTERN =\s*\/(.+)\/i;/u)[1], "i");

function compile(path, dependencies = {}) {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "server-only") return {};
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

function harness({ status = "saved", lead = { workflowVersion: "1", stageKey: "new", currentOwnerMembershipId: OWNER, nextActionText: null, nextActionDueDate: null }, mutateError = null } = {}) {
  const calls = [];
  const client = { schema: () => ({ rpc: async (name, args) => {
    calls.push(["rpc", name, args]);
    return { data: { request_id: args.p_request_id, status, lead_id: status === "saved" ? LEAD : null }, error: null };
  } }) };
  const source = compile("src/lib/v3/manual-lead-source.ts", {
    "node:crypto": { createHash },
    "../platform-access.ts": { staffHasPermission: () => true },
    "../platform-manual-lead-contract": { LEAD_DIRECTIONS: {} },
    "../platform-sales": {
      getPlatformSalesLead: async (actor, leadId) => { calls.push(["read", leadId]); return lead; },
      mutatePlatformSalesLeadWorkflow: async (actor, input) => {
        calls.push(["mutate", input]);
        if (mutateError) throw mutateError;
        if (!WORKFLOW_REQUEST_ID.test(input.requestId)) throw new Error("invalid");
        return {};
      },
    },
    "../platform-sales-register-contract": { parseSalesUuid: (value) => (typeof value === "string" ? value : null) },
    "../supabase/server": { createSupabaseServerClient: async () => client },
  });
  return { calls, create: (input) => source.createManualLead(ACTOR, {
    requestId: "10000000-0000-4000-8000-000000000009", name: "QA", phone: "+996700000000", email: null, source: "phone_call",
    ownerId: OWNER, direction: null, nextAction: "Позвонить", dueDate: "2026-11-10", ...input,
  }) };
}

test("the lead is created without a step; the step goes through the workflow command with the lead's stage and owner", async () => {
  const run = harness();
  assert.deepEqual(await run.create(), { status: "saved", leadId: LEAD, requestId: "10000000-0000-4000-8000-000000000009" });
  const rpc = run.calls.find((call) => call[0] === "rpc");
  assert.equal(rpc[1], "create_manual_sales_lead");
  assert.equal(rpc[2].p_next_action, null);
  assert.equal(rpc[2].p_next_action_due_date, null);
  const mutate = run.calls.find((call) => call[0] === "mutate")[1];
  assert.deepEqual({ ...mutate, requestId: undefined }, {
    leadId: LEAD, expectedWorkflowVersion: "1", requestId: undefined, stageKey: "new", ownerMembershipId: OWNER,
    nextActionText: "Позвонить", nextActionDueDate: "2026-11-10", clearNextAction: false, reason: null,
  });
  assert.match(mutate.requestId, WORKFLOW_REQUEST_ID);
  const again = harness();
  await again.create();
  assert.equal(again.calls.find((call) => call[0] === "mutate")[1].requestId, mutate.requestId, "the same form request — the same step request");
  const other = harness();
  await other.create({ requestId: "10000000-0000-4000-8000-000000000010" });
  assert.notEqual(other.calls.find((call) => call[0] === "mutate")[1].requestId, mutate.requestId);
});

test("a step that cannot be written leaves the lead saved and says so", async () => {
  const run = harness({ mutateError: new Error("forbidden") });
  assert.deepEqual(await run.create(), { status: "saved", leadId: LEAD, requestId: "10000000-0000-4000-8000-000000000009", step: "failed" });
});

test("no step asked, a duplicate contact or a replay with the step already there: no workflow command", async () => {
  for (const [label, run, input] of [
    ["no step", harness(), { nextAction: null, dueDate: null }],
    ["duplicate", harness({ status: "duplicate" }), {}],
    ["replay", harness({ lead: { workflowVersion: "2", stageKey: "new", currentOwnerMembershipId: OWNER, nextActionText: "Позвонить", nextActionDueDate: "2026-11-10" } }), {}],
  ]) {
    const result = await run.create(input);
    assert.equal(result.status, label === "duplicate" ? "duplicate" : "saved", label);
    assert.equal(result.step, undefined, label);
    assert.equal(run.calls.some((call) => call[0] === "mutate"), false, label);
  }
});
