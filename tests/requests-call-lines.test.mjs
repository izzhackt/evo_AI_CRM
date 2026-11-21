// «Заявки → Звонки» (миграция 368): исход последнего звонка у строк очереди читается ОДНИМ вызовом
// `telephony_lead_calls_batch_v1`, а не по вызову на строку. Боевой код идёт против наблюдаемой подделки клиента
// базы; что видит каждый сотрудник, решает база (supabase/tests/platform_requests_speed.sql).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const ORG = "36800000-0000-4000-8000-000000000001";
const LEAD = (n) => `36800000-0000-4000-8000-${String(700 + n).padStart(12, "0")}`;
const ACTOR = { organizationId: ORG };

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

const contract = compile("src/lib/v3/telephony-lead-calls.ts");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Строка звонка, как её отдаёт база (jsonb). */
const call = (overrides = {}) => ({
  callId: "36800000-0000-4000-8000-000000007001", direction: "in", state: "ended", outcome: "missed", outcomeSource: "webhook",
  startedAt: "2026-11-21T08:00:00.000Z", answeredAt: null, endedAt: "2026-11-21T08:03:00.000Z", talkSeconds: null,
  phone: "+996 ••• 00 01", managerName: null, participants: [], recording: "none", resultCode: null, resultAt: null,
  resultByName: null, callbackOn: null, resultEditable: false, ...overrides,
});
const entry = (calls, overrides = {}) => ({ enabled: true, canSetResult: false, hasMore: false, calls, ...overrides });

function harness({ response, throwOnRpc = false, clientFails = false } = {}) {
  const calls = [];
  const client = { schema: (schema) => ({ rpc: async (name, args) => {
    calls.push({ schema, name, args });
    if (throwOnRpc) throw new Error("network");
    return response;
  } }) };
  const source = compile("src/lib/v3/telephony-request-calls-source.ts", {
    "../platform-sales-register-contract.ts": { parseSalesUuid: (value) => (typeof value === "string" && UUID.test(value) ? value : null) },
    "../supabase/server.ts": { createSupabaseServerClient: async () => { if (clientFails) throw new Error("no session"); return client; } },
    "./telephony-lead-calls.ts": contract,
  });
  return { calls, read: (rows) => source.readRequestCallLines(ACTOR, rows) };
}
const lead = (n, source = "phone_call", kind = "lead") => ({ kind, id: LEAD(n), source, leadId: LEAD(n) });

test("one batch call for every phone row, with the organization, the leads in page order and one call per lead", async () => {
  const run = harness({ response: { data: {
    [LEAD(1)]: entry([call({ outcome: "missed" })]),
    [LEAD(2)]: entry([call({ outcome: "answered", direction: "out", talkSeconds: 95 })]),
  }, error: null } });
  const lines = await run.read([lead(1), lead(2), lead(3, "website"), lead(4, "phone_call", "application")]);
  assert.equal(run.calls.length, 1, "exactly one database call, not one per row");
  assert.deepEqual(run.calls[0], { schema: "platform", name: "telephony_lead_calls_batch_v1",
    args: { p_organization_id: ORG, p_lead_ids: [LEAD(1), LEAD(2)], p_limit_per_lead: 1 } });
  assert.deepEqual(Object.keys(lines), [LEAD(1), LEAD(2)]);
  assert.equal(lines[LEAD(1)], "Пропущен");
  assert.equal(lines[LEAD(2)], "Дозвонились · 1 мин 35 с");
});

test("a lead the database leaves out, a lead without calls, telephony off and a malformed entry keep the word «Звонок» (no line)", async () => {
  const run = harness({ response: { data: {
    [LEAD(1)]: entry([]),
    [LEAD(2)]: { enabled: false, canSetResult: false, hasMore: false, calls: [] },
    [LEAD(3)]: { enabled: true, calls: "x" },
    [LEAD(5)]: entry([call()]),
  }, error: null } });
  const lines = await run.read([lead(1), lead(2), lead(3), lead(4), lead(5)]);
  assert.deepEqual(lines, { [LEAD(5)]: "Пропущен" }, "only the lead with a readable call has a line; lead 4 was left out by the database");
});

test("at most 20 phone rows are asked, none are asked when there is no phone row, and no call is made then", async () => {
  const none = harness({ response: { data: {}, error: null } });
  assert.deepEqual(await none.read([lead(1, "website"), lead(2, "whatsapp")]), {});
  assert.equal(none.calls.length, 0);
  const many = harness({ response: { data: {}, error: null } });
  await many.read(Array.from({ length: 30 }, (_, index) => lead(index + 1)));
  assert.equal(many.calls.length, 1);
  assert.equal(many.calls[0].args.p_lead_ids.length, 20);
  assert.deepEqual(many.calls[0].args.p_lead_ids, Array.from({ length: 20 }, (_, index) => LEAD(index + 1)));
});

test("a failure of the read — an error answer, a wrong shape, a thrown call, no session — never breaks the queue", async () => {
  const rows = [lead(1)];
  assert.deepEqual(await harness({ response: { data: null, error: { message: "refused" } } }).read(rows), {});
  assert.deepEqual(await harness({ response: { data: [call()], error: null } }).read(rows), {});
  assert.deepEqual(await harness({ response: { data: "x", error: null } }).read(rows), {});
  assert.deepEqual(await harness({ response: { data: null, error: null } }).read(rows), {});
  assert.deepEqual(await harness({ throwOnRpc: true }).read(rows), {});
  assert.deepEqual(await harness({ clientFails: true }).read(rows), {});
});

test("the page still reads the lines after the queue and only for a queue that carries phone calls", () => {
  const page = readFileSync(new URL("../src/app/(staff)/requests/page.tsx", import.meta.url), "utf8");
  assert.match(page, /read\.status === "ready" && read\.queue\.phoneCalls \? await readRequestCallLines\(actor, read\.queue\.rows\) : \{\}/u);
});

test("the batch read of migration 368 has the parameters the source sends, and no other overload is called", () => {
  const sql = readFileSync(new URL("../supabase/migrations/368_platform_requests_speed.sql", import.meta.url), "utf8");
  const sent = [...readFileSync(new URL("../src/lib/v3/telephony-request-calls-source.ts", import.meta.url), "utf8")
    .match(/rpc\("telephony_lead_calls_batch_v1", \{([^}]*)\}/u)[1].matchAll(/\bp_[a-z_]+/gu)].map((match) => match[0]).sort();
  const declared = [...sql.match(/FUNCTION platform\.telephony_lead_calls_batch_v1\(([^)]*)\)/u)[1].matchAll(/\bp_[a-z_]+/gu)].map((match) => match[0]).sort();
  assert.deepEqual(sent, declared);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.telephony_lead_calls_batch_v1\(UUID, UUID\[\], INTEGER\) TO authenticated;/u);
});
