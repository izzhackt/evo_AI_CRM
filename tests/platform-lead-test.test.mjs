// «Тестовый лид» (миграция 385): запись и чтение пометки, слова, переключатель и метка «Тест» в разметке. Без сети и базы:
// подставной клиент RPC; рендер — в статической разметке через esbuild (как tests/ai-agents-ui.test.mjs).
//
//   node --conditions=react-server --experimental-strip-types --test tests/platform-lead-test.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import {
  PlatformLeadTestError,
  leadTestStatusFromRpcError,
  parseLeadTestUuid,
  readTestLeadIds,
  setLeadIsTest,
} from "../src/lib/platform-lead-test.ts";
import { leadTestOutcome, leadTestWords } from "../src/lib/v3/wording.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const LEAD_2 = "33333333-3333-4333-8333-333333333333";
const REQ = "44444444-4444-4444-8444-444444444444";
const ACTOR = { organizationId: ORG };

function client(handler) {
  const calls = [];
  return {
    calls,
    schema: (name) => ({
      rpc: async (fn, args) => {
        calls.push({ name, fn, args });
        return handler(fn, args);
      },
    }),
  };
}

test("запись: аргументы RPC, квитанция только по ответу базы", async () => {
  const fake = client((_fn, args) => ({
    data: { organization_id: ORG, lead_id: LEAD, is_test: args.p_is_test, changed: true, request_id: REQ, changed_at: "2026-11-28T10:00:00Z" },
    error: null,
  }));
  const receipt = await setLeadIsTest(ACTOR, { leadId: LEAD, isTest: true, requestId: REQ }, { client: fake });
  assert.deepEqual(receipt, { leadId: LEAD, isTest: true, changed: true, requestId: REQ });
  assert.deepEqual(fake.calls, [{
    name: "platform", fn: "set_lead_is_test_v1",
    args: { p_organization_id: ORG, p_lead_id: LEAD, p_is_test: true, p_request_id: REQ },
  }]);
});

test("запись: чужая или искажённая квитанция — «неизвестно», а не успех", async () => {
  const bad = [
    { organization_id: ORG, lead_id: LEAD_2, is_test: true, changed: true, request_id: REQ },
    { organization_id: ORG, lead_id: LEAD, is_test: false, changed: true, request_id: REQ },
    { organization_id: ORG, lead_id: LEAD, is_test: true, changed: "yes", request_id: REQ },
    { organization_id: ORG, lead_id: LEAD, is_test: true, changed: true, request_id: LEAD_2 },
    null,
  ];
  for (const data of bad) {
    await assert.rejects(
      setLeadIsTest(ACTOR, { leadId: LEAD, isTest: true, requestId: REQ }, { client: client(() => ({ data, error: null })) }),
      (error) => error instanceof PlatformLeadTestError && error.status === "unavailable",
    );
  }
});

test("запись: коды ошибок базы становятся словами экрана; мусор на входе до базы не доходит", async () => {
  const cases = [
    [{ code: "42501", message: "lead_test_flag_forbidden" }, "forbidden"],
    [{ code: "PT409", message: "lead_test_flag_state_conflict" }, "archived"],
    [{ code: "22023", message: "lead_test_flag_request_conflict" }, "request_conflict"],
    [{ code: "22023", message: "lead_test_flag_invalid" }, "invalid"],
    [{ code: "XX000", message: "boom" }, "unavailable"],
  ];
  for (const [error, status] of cases) {
    assert.equal(leadTestStatusFromRpcError(error), status);
    await assert.rejects(
      setLeadIsTest(ACTOR, { leadId: LEAD, isTest: true, requestId: REQ }, { client: client(() => ({ data: null, error })) }),
      (thrown) => thrown.status === status,
    );
  }
  assert.equal(leadTestStatusFromRpcError(null), "unavailable");
  const never = client(() => { throw new Error("не должно дойти до базы"); });
  for (const command of [{ leadId: "x", isTest: true, requestId: REQ }, { leadId: LEAD, isTest: "true", requestId: REQ }, { leadId: LEAD, isTest: true, requestId: "" }]) {
    await assert.rejects(setLeadIsTest(ACTOR, command, { client: never }), (thrown) => thrown.status === "invalid");
  }
  assert.equal(never.calls.length, 0);
  assert.equal(parseLeadTestUuid(LEAD.toUpperCase()), LEAD);
  assert.equal(parseLeadTestUuid("nope"), null);
});

test("чтение пометок: только названные лиды; сбой и искажение — null (метка не рисуется), пусто — пустое множество", async () => {
  const ok = client(() => ({ data: { organization_id: ORG, test_lead_ids: [LEAD] }, error: null }));
  const found = await readTestLeadIds(ACTOR, [LEAD, LEAD_2], { client: ok });
  assert.deepEqual([...found], [LEAD]);
  assert.deepEqual(ok.calls[0].args, { p_organization_id: ORG, p_lead_ids: [LEAD, LEAD_2] });

  const empty = client(() => { throw new Error("пустой список базу не спрашивает"); });
  assert.deepEqual([...(await readTestLeadIds(ACTOR, [], { client: empty }))], []);
  assert.equal(empty.calls.length, 0);

  const failures = [
    { data: null, error: { code: "42501" } },
    { data: { organization_id: LEAD, test_lead_ids: [] }, error: null },
    { data: { organization_id: ORG, test_lead_ids: "x" }, error: null },
    { data: { organization_id: ORG, test_lead_ids: [LEAD_2] }, error: null },
    { data: { organization_id: ORG, test_lead_ids: ["not-a-uuid"] }, error: null },
  ];
  for (const response of failures) {
    assert.equal(await readTestLeadIds(ACTOR, [LEAD], { client: client(() => response) }), null);
  }
  assert.equal(await readTestLeadIds(ACTOR, ["x"], { client: ok }), null);
  assert.equal(await readTestLeadIds(ACTOR, [LEAD], { client: client(() => { throw new Error("сеть"); }) }), null);
});

test("слова: один словарь, каждое состояние названо по-русски, сырых ключей нет", () => {
  assert.equal(leadTestWords.label, "Тестовый лид");
  assert.equal(leadTestWords.badge, "Тест");
  for (const status of ["saved", "unchanged", "forbidden", "preview", "archived", "invalid", "request_conflict", "unavailable"]) {
    const text = leadTestOutcome(status, true);
    assert.ok(text && /[А-Яа-я]/u.test(text) && !/_/u.test(text), status);
  }
  assert.notEqual(leadTestOutcome("saved", true), leadTestOutcome("saved", false));
  assert.equal(leadTestOutcome("lead_test_flag_forbidden", true), null, "сырой код базы людям не показывается");
});

const here = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const ENTRY = `
import { renderToStaticMarkup } from "react-dom/server";
import { LeadTestToggle } from "@/components/staff/profile/LeadTestToggle";
import { LeadTestBadge } from "@/components/staff/LeadTestBadge";
export const html = {
  on: renderToStaticMarkup(<LeadTestToggle leadId="${LEAD}" initialIsTest={true} requestId="${REQ}" readOnly={false} />),
  off: renderToStaticMarkup(<LeadTestToggle leadId="${LEAD}" initialIsTest={false} requestId="${REQ}" readOnly={false} />),
  locked: renderToStaticMarkup(<LeadTestToggle leadId="${LEAD}" initialIsTest={false} requestId="${REQ}" readOnly={true} />),
  badge: renderToStaticMarkup(<LeadTestBadge />),
};
`;

test("разметка: переключатель «Тестовый лид» (включён, выключен, закрыт без права) и метка «Тест»", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lead-test-ui-"));
  try {
    writeFileSync(join(dir, "entry.tsx"), ENTRY);
    const outfile = join(dir, "out.cjs");
    await build({
      entryPoints: [join(dir, "entry.tsx")], outfile, bundle: true, platform: "node", format: "cjs", jsx: "automatic",
      tsconfig: here("tsconfig.json"), absWorkingDir: here(""), nodePaths: [here("node_modules")], logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [{
        name: "lead-test-ui",
        setup(b) {
          b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
          b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));
          b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "nav", namespace: "nav" }));
          b.onLoad({ filter: /.*/, namespace: "nav" }, () => ({ contents: "export const useRouter = () => ({ refresh() {} });", loader: "js" }));
          b.onResolve({ filter: /^@\/lib\/platform-lead-test-actions$/ }, () => ({ path: "actions", namespace: "actions" }));
          b.onLoad({ filter: /.*/, namespace: "actions" }, () => ({ contents: "export async function leadTestAction() { throw new Error('не вызывается при рендере'); }", loader: "js" }));
        },
      }],
    });
    const { html } = createRequire(here("package.json"))(outfile);
    assert.match(html.on, /role="switch"/u);
    assert.match(html.on, /aria-checked="true"/u);
    assert.match(html.on, /Тестовый лид/u);
    assert.match(html.on, /ИИ-агенты не просыпаются/u);
    assert.doesNotMatch(html.on, / disabled=""/u);
    assert.match(html.off, /aria-checked="false"/u);
    assert.match(html.locked, / disabled=""/u);
    assert.match(html.locked, /с правом вести продажи/u);
    assert.doesNotMatch(html.locked, /ИИ-агенты не просыпаются/u);
    assert.match(html.badge, />Тест</u);
    assert.match(html.badge, /title="Тестовый лид: ИИ-агентов не будит, в воронке не считается"/u);
    // Ни сырых ключей, ни английских слов людям.
    for (const markup of Object.values(html)) assert.doesNotMatch(markup.replace(/<[^>]+>/gu, " "), /is_test|test_flag|lead_test/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
