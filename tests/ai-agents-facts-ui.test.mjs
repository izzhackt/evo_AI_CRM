// «Мозг компании» (миграция 381, 28.11.2026): экран «Настройки → Факты», его чтения и действия. Данные синтетические; настоящие
// модули собираются esbuild с подменой только границ (`server-only`, клиент базы, охрана страницы, действия формы).
//
//   node --conditions=react-server --experimental-strip-types --test tests/ai-agents-facts-ui.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import {
  COMPANY_FACT_LIMITS,
  bishkekToday,
  companyFactDateLabel,
  mapCompanyFactError,
  parseCompanyFactSaved,
  parseCompanyFacts,
} from "../src/lib/ai-agents/company-facts.ts";
import {
  COMPANY_FACT_AUDIENCE_WORD,
  COMPANY_FACT_FORM_MESSAGE,
  COMPANY_FACT_SOURCE_WORD,
  COMPANY_FACT_VALIDITY_WORD,
  companyFactTopicKeys,
  companyFactTopicTitle,
  companyFactWords,
} from "../src/lib/v3/wording.ts";

const root = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path) => readFileSync(root(path), "utf8");

const ID = (n) => `38000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FACT = (n, over = {}) => ({
  id: ID(n), topic: "course.sat.group", statementRu: "Групповой курс SAT: 10 недель, 299 долларов США.", statementKy: null, statementEn: null,
  audience: "client", source: "agent_instruction", sourceRef: "src/content/ai-agents/sales.md#Курсы", verifiedAt: "2026-10-23", validUntil: "2026-12-31",
  supersedesId: null, verifiedByMembershipId: null, verifiedByName: null, status: "active", validity: "ok", daysLeft: 33, updatedAt: "2026-11-28T09:00:00Z", ...over,
});
const DATA = (facts, over = {}) => ({
  facts, truncated: false, today: "2026-11-28", counts: { active: facts.filter((f) => f.status === "active").length, expired: 0, expiring: 0 }, canManage: true, ...over,
});

/* -------------------------------------------------------------------------------- разбор ответа базы */

test("the list answer is parsed strictly: shape, dates, ids, topics, texts and counts", () => {
  const ok = parseCompanyFacts(DATA([FACT(1), FACT(2, { topic: "promise.admission", audience: "internal", validUntil: null, validity: "unlimited", daysLeft: null })]));
  assert.equal(ok?.facts.length, 2);
  assert.equal(ok?.today, "2026-11-28");
  assert.equal(ok?.facts[1].validUntil, null);
  const bad = (patch) => assert.equal(parseCompanyFacts({ ...DATA([FACT(1)]), ...patch }), null);
  bad({ facts: "no" });
  bad({ truncated: "no" });
  bad({ today: "28.11.2026" });
  bad({ canManage: 1 });
  bad({ counts: { active: -1, expired: 0, expiring: 0 } });
  bad({ counts: { active: 1, expired: 0 } });
  for (const patch of [{ id: "x" }, { topic: "Bad Topic" }, { topic: "single" }, { statementRu: "" }, { statementRu: "я".repeat(COMPANY_FACT_LIMITS.statementMaxChars + 1) },
    { audience: "everyone" }, { source: "web" }, { verifiedAt: "2026-02-30" }, { validity: "weird" }, { status: "published" }, { daysLeft: 1.5 }, { statementKy: "" }]) {
    assert.equal(parseCompanyFacts(DATA([FACT(1, patch)])), null, JSON.stringify(patch));
  }
  assert.deepEqual(parseCompanyFactSaved({ factId: ID(5).toUpperCase(), status: "saved" }), { factId: ID(5), status: "saved" });
  assert.equal(parseCompanyFactSaved({ factId: "x", status: "saved" }), null);
  assert.equal(parseCompanyFactSaved({ factId: ID(5), status: "done" }), null);
});

test("database errors become the outcomes the form speaks in", () => {
  const table = [
    [{ code: "42501", message: "ai_agent_forbidden" }, "forbidden"],
    [{ code: "22023", message: "company_fact_verification_required" }, "verification_required"],
    [{ code: "22023", message: "company_fact_invalid_dates" }, "invalid_dates"],
    [{ code: "22023", message: "company_fact_invalid_patch" }, "invalid"],
    [{ code: "23505", message: "company_fact_topic_exists" }, "topic_exists"],
    [{ code: "40001", message: "company_fact_stale" }, "stale"],
    [{ code: "40001", message: "company_fact_request_conflict" }, "request_conflict"],
    [{ code: "P0002", message: "company_fact_not_found" }, "not_found"],
    [{ code: "PGRST202", message: "Could not find the function" }, "not_ready"],
    [{ code: "XX000", message: "boom" }, "unavailable"],
    [null, "unavailable"],
  ];
  for (const [error, expected] of table) assert.equal(mapCompanyFactError(error), expected, JSON.stringify(error));
  // Every outcome has words; none is a raw code.
  for (const key of ["forbidden", "invalid", "verification_required", "invalid_dates", "topic_exists", "stale", "not_found", "request_conflict", "not_ready", "unavailable", "saved", "unchanged", "retired"]) {
    assert.match(COMPANY_FACT_FORM_MESSAGE[key], /[А-Яа-я]/u, key);
    assert.doesNotMatch(COMPANY_FACT_FORM_MESSAGE[key], /company_fact|ai_agent|_/u, key);
  }
});

test("dates: the Bishkek day is UTC+6 and the label is day.month.year", () => {
  assert.equal(bishkekToday(new Date("2026-11-28T17:59:59Z")), "2026-11-28");
  assert.equal(bishkekToday(new Date("2026-11-28T18:00:00Z")), "2026-11-29", "00:00 in Bishkek is the new day");
  assert.equal(companyFactDateLabel("2026-10-23"), "23.10.2026");
  assert.equal(companyFactDateLabel(null), "");
});

/* ------------------------------------------------------------------------------------------ слова */

test("every topic the migration seeds has its own title; no title or word shows a raw key", () => {
  const sql = read("supabase/migrations/381_platform_company_facts.sql");
  const seed = JSON.parse(/\$seed\$(\[.*?\])\$seed\$/su.exec(sql)[1]);
  const titled = new Set(companyFactTopicKeys());
  for (const row of seed) {
    assert.ok(titled.has(row.topic), `${row.topic} has a title`);
    const title = companyFactTopicTitle(row.topic);
    assert.match(title, /[А-Яа-я]/u, row.topic);
    assert.doesNotMatch(title, /^[a-z0-9_.-]+$/u, `${row.topic}: the title is words, not the key`);
  }
  assert.equal(titled.size, seed.length, "no title without a seeded topic");
  assert.equal(companyFactTopicTitle("course.unknown.thing"), "Курсы", "an unknown topic falls back to its group word");
  assert.equal(companyFactTopicTitle("zzz.unknown"), "Факт", "an unknown group is still words");
  for (const map of [COMPANY_FACT_AUDIENCE_WORD, COMPANY_FACT_SOURCE_WORD, COMPANY_FACT_VALIDITY_WORD]) {
    for (const [key, word] of Object.entries(map)) assert.match(word, /[А-Яа-я]/u, key);
  }
  assert.equal(companyFactWords.validityLine("expired", -1), "Просрочен вчера");
  assert.equal(companyFactWords.validityLine("expired", -5), "Просрочен 5 дн. назад");
  assert.equal(companyFactWords.validityLine("expiring", 0), "Последний день");
  assert.equal(companyFactWords.validityLine("expiring", 12), "Осталось 12 дн.");
  assert.equal(companyFactWords.validityLine("unlimited", null), "Без срока");
});

/* ---------------------------------------------------------------------------- сборка настоящих модулей */

const SERVER_ONLY = `export {};`;
const ACTION_STUB = `const f = async (previous) => ({ ...previous, status: "idle" }); module.exports = { saveCompanyFactAction: f, retireCompanyFactAction: f };`;
const FAKE_SUPABASE = `exports.createSupabaseServerClient = async () => ({
  schema: (schema) => ({ rpc: async (name, args) => { globalThis.__rpc.calls.push({ schema, name, args }); const next = globalThis.__rpc.next; if (next instanceof Error) throw next; return next; } }),
});`;
const GUARDS = `export async function requirePlatformStaffActor() { return globalThis.__actor; }`;
const CACHE = `export function revalidatePath(path) { (globalThis.__revalidated ??= []).push(path); }`;
const NAV = `export function redirect() { throw new Error("redirect"); } export function notFound() { throw new Error("notfound"); }`;

async function bundle(name, entrySource) {
  const dir = mkdtempSync(join(tmpdir(), `facts-${name}-`));
  try {
    writeFileSync(join(dir, "entry.tsx"), entrySource);
    const outfile = join(dir, "out.cjs");
    await build({
      entryPoints: [join(dir, "entry.tsx")], outfile, bundle: true, platform: "node", format: "cjs", jsx: "automatic",
      tsconfig: root("tsconfig.json"), absWorkingDir: root(""), nodePaths: [root("node_modules")], logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [{
        name: "facts-test",
        setup(b) {
          b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
          b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: SERVER_ONLY, loader: "js" }));
          b.onResolve({ filter: /supabase\/server(\.ts)?$/ }, () => ({ path: "fake-supabase", namespace: "fake" }));
          b.onLoad({ filter: /.*/, namespace: "fake" }, () => ({ contents: FAKE_SUPABASE, loader: "js" }));
          b.onResolve({ filter: /(^|\/)platform-guards(\.ts)?$/ }, () => ({ path: "guards", namespace: "guards" }));
          b.onLoad({ filter: /.*/, namespace: "guards" }, () => ({ contents: GUARDS, loader: "js" }));
          b.onResolve({ filter: /^next\/cache$/ }, () => ({ path: "cache", namespace: "cache" }));
          b.onLoad({ filter: /.*/, namespace: "cache" }, () => ({ contents: CACHE, loader: "js" }));
          b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "nav", namespace: "nav" }));
          b.onLoad({ filter: /.*/, namespace: "nav" }, () => ({ contents: NAV, loader: "js" }));
          b.onResolve({ filter: /platform-company-fact-actions$/ }, (args) => (args.importer.endsWith("entry.tsx") ? null : { path: "actions-stub", namespace: "actions" }));
          b.onLoad({ filter: /.*/, namespace: "actions" }, () => ({ contents: ACTION_STUB, loader: "js" }));
          b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
        },
      }],
    });
    return createRequire(root("package.json"))(outfile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let sourceModule;
const source = async () => (sourceModule ??= await bundle("source", `export * from ${JSON.stringify(root("src/lib/v3/company-facts-source.ts"))};`));
let actionsModule;
const actions = async () => (actionsModule ??= await bundle("actions", `export * from ${JSON.stringify(root("src/lib/platform-company-fact-actions.ts"))};`));
let viewModule;
const view = async () => (viewModule ??= await bundle("view", `
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyFactsNext } from "@/components/staff/settings-next/CompanyFactsNext";
import { CompanyFactForm, CompanyFactRetire, CompanyFactVerifyButton } from "@/components/staff/settings/CompanyFactForm";
export const html = {
  list: (props) => renderToStaticMarkup(<CompanyFactsNext {...props} />),
  form: (fact) => renderToStaticMarkup(<CompanyFactForm fact={fact} />),
  verify: (fact) => renderToStaticMarkup(<CompanyFactVerifyButton fact={fact} />),
  retire: (fact) => renderToStaticMarkup(<CompanyFactRetire fact={fact} />),
};`));

const ACTOR = { organizationId: ID(1), systemRole: "admin", presentationRole: null, displayName: "Админ Синтетический", permissionKeys: [] };
const strip = (markup) => markup.replace(/<!-- -->/gu, "");

/* --------------------------------------------------------------------------------- чтения и запись */

test("the read calls the list function with every status and parses the answer; refusals are words, not crashes", async () => {
  const { readCompanyFacts } = await source();
  globalThis.__rpc = { calls: [], next: { data: DATA([FACT(1)]), error: null } };
  const ok = await readCompanyFacts(ACTOR);
  assert.equal(ok.status, "available");
  assert.deepEqual(globalThis.__rpc.calls[0], {
    schema: "platform", name: "ai_company_facts_list_v1",
    args: { p_organization_id: ID(1), p_topic_prefix: null, p_status: "all", p_audience: null, p_limit: 500 },
  });
  for (const [error, expected] of [[{ code: "42501", message: "ai_agent_forbidden" }, "denied"], [{ code: "PGRST202", message: "x" }, "not_ready"], [{ code: "XX000", message: "x" }, "unavailable"]]) {
    globalThis.__rpc = { calls: [], next: { data: null, error } };
    assert.equal((await readCompanyFacts(ACTOR)).status, expected);
  }
  globalThis.__rpc = { calls: [], next: { data: { facts: "broken" }, error: null } };
  assert.equal((await readCompanyFacts(ACTOR)).status, "unavailable", "a broken shape is unavailable");
  globalThis.__rpc = { calls: [], next: new Error("network") };
  assert.equal((await readCompanyFacts(ACTOR)).status, "unavailable", "a thrown call is unavailable");
});

test("save and retire pass the patch and the request id to the database and map every answer", async () => {
  const { saveCompanyFact, retireCompanyFact } = await source();
  globalThis.__rpc = { calls: [], next: { data: { factId: ID(9), status: "saved", changed: ["verified"] }, error: null } };
  assert.deepEqual(await saveCompanyFact(ACTOR, { factId: ID(3), patch: { markVerified: true }, requestId: ID(100) }), { status: "saved" });
  assert.deepEqual(globalThis.__rpc.calls[0], {
    schema: "platform", name: "ai_company_facts_save_v1", args: { p_organization_id: ID(1), p_fact_id: ID(3), p_patch: { markVerified: true }, p_request_id: ID(100) },
  });
  globalThis.__rpc = { calls: [], next: { data: { factId: ID(3), status: "unchanged", changed: [] }, error: null } };
  assert.deepEqual(await saveCompanyFact(ACTOR, { factId: null, patch: { a: 1 }, requestId: ID(101) }), { status: "unchanged" });
  globalThis.__rpc = { calls: [], next: { data: null, error: { code: "40001", message: "company_fact_stale" } } };
  assert.deepEqual(await saveCompanyFact(ACTOR, { factId: ID(3), patch: { markVerified: true }, requestId: ID(102) }), { status: "stale" });
  globalThis.__rpc = { calls: [], next: { data: { factId: ID(3), status: "retired" }, error: null } };
  assert.deepEqual(await retireCompanyFact(ACTOR, ID(3), ID(103)), { status: "retired" });
  assert.equal(globalThis.__rpc.calls[0].name, "ai_company_facts_retire_v1");
  globalThis.__rpc = { calls: [], next: { data: { factId: ID(3), status: "saved" }, error: null } };
  assert.deepEqual(await retireCompanyFact(ACTOR, ID(3), ID(104)), { status: "unavailable" }, "a retire answer that is not «retired» is not success");
  globalThis.__rpc = { calls: [], next: new Error("down") };
  assert.deepEqual(await saveCompanyFact(ACTOR, { factId: null, patch: {}, requestId: ID(105) }), { status: "unavailable" });
});

/* --------------------------------------------------------------------------------- серверные действия */

function form(fields) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
const SAVE_FIELDS = (over = {}) => ({
  request_id: ID(200), fact_id: ID(3), topic: "", audience: "", statement_ru: "Новый текст", statement_ky: "", statement_en: "", source: "owner",
  source_ref: "", valid_until: "2027-01-31", mark_verified: "1", ...over,
});
const PREVIOUS = { status: "idle", requestId: ID(199) };

test("the save action: preview and malformed forms are refused before the database; the patch is built from the form", async () => {
  const { saveCompanyFactAction } = await actions();
  globalThis.__actor = ACTOR;
  globalThis.__rpc = { calls: [], next: { data: { factId: ID(9), status: "saved", changed: ["statementRu"] }, error: null } };
  globalThis.__revalidated = [];
  const saved = await saveCompanyFactAction(PREVIOUS, form(SAVE_FIELDS()));
  assert.deepEqual(saved, { status: "saved", requestId: ID(200) });
  assert.deepEqual(globalThis.__rpc.calls[0].args, {
    p_organization_id: ID(1), p_fact_id: ID(3), p_request_id: ID(200),
    p_patch: { statementRu: "Новый текст", statementKy: null, statementEn: null, source: "owner", sourceRef: null, validUntil: "2027-01-31", markVerified: true },
  });
  assert.deepEqual(globalThis.__revalidated, ["/settings"]);

  // A new fact carries its topic and audience; an edit never does.
  globalThis.__rpc.calls = [];
  await saveCompanyFactAction(PREVIOUS, form(SAVE_FIELDS({ fact_id: "", topic: "promise.test", audience: "internal", valid_until: "" })));
  assert.deepEqual(globalThis.__rpc.calls[0].args.p_patch, {
    statementRu: "Новый текст", statementKy: null, statementEn: null, source: "owner", sourceRef: null, validUntil: null, markVerified: true, topic: "promise.test", audience: "internal",
  });
  assert.equal(globalThis.__rpc.calls[0].args.p_fact_id, null);

  globalThis.__rpc.calls = [];
  const refused = [
    [{ ...ACTOR, presentationRole: "sales" }, SAVE_FIELDS(), "forbidden"],
    [ACTOR, SAVE_FIELDS({ request_id: "x" }), "invalid"],
    [ACTOR, SAVE_FIELDS({ statement_ru: "   " }), "invalid"],
    [ACTOR, SAVE_FIELDS({ statement_ru: "я".repeat(1501) }), "invalid"],
    [ACTOR, SAVE_FIELDS({ source: "web" }), "invalid"],
    [ACTOR, SAVE_FIELDS({ valid_until: "tomorrow" }), "invalid"],
    [ACTOR, SAVE_FIELDS({ fact_id: "not-an-id" }), "invalid"],
    [ACTOR, SAVE_FIELDS({ fact_id: "", topic: "Bad Topic", audience: "client" }), "invalid"],
    [ACTOR, SAVE_FIELDS({ fact_id: "", topic: "promise.test", audience: "everyone" }), "invalid"],
    [ACTOR, SAVE_FIELDS({ statement_ru: "a\u0000b" }), "invalid"],
  ];
  for (const [actor, fields, expected] of refused) {
    globalThis.__actor = actor;
    assert.equal((await saveCompanyFactAction(PREVIOUS, form(fields))).status, expected, JSON.stringify(fields).slice(0, 80));
  }
  globalThis.__actor = ACTOR;
  const extra = form(SAVE_FIELDS()); extra.set("surprise", "1");
  assert.equal((await saveCompanyFactAction(PREVIOUS, extra)).status, "invalid", "an unknown field fails closed");
  assert.equal(globalThis.__rpc.calls.length, 0, "none of the refusals reached the database");

  // A refusal from the database keeps the request id (a retry repeats it).
  globalThis.__rpc = { calls: [], next: { data: null, error: { code: "22023", message: "company_fact_verification_required" } } };
  assert.deepEqual(await saveCompanyFactAction(PREVIOUS, form(SAVE_FIELDS({ mark_verified: "0" }))), { status: "verification_required", requestId: ID(200) });
});

test("the retire action is refused in preview, needs both ids and reports the database outcome", async () => {
  const { retireCompanyFactAction } = await actions();
  globalThis.__actor = { ...ACTOR, presentationRole: "sales" };
  globalThis.__rpc = { calls: [], next: { data: { factId: ID(3), status: "retired" }, error: null } };
  assert.equal((await retireCompanyFactAction(PREVIOUS, form({ request_id: ID(300), fact_id: ID(3) }))).status, "forbidden");
  globalThis.__actor = ACTOR;
  assert.equal((await retireCompanyFactAction(PREVIOUS, form({ request_id: ID(300), fact_id: "x" }))).status, "invalid");
  assert.equal(globalThis.__rpc.calls.length, 0);
  assert.deepEqual(await retireCompanyFactAction(PREVIOUS, form({ request_id: ID(300), fact_id: ID(3) })), { status: "retired", requestId: ID(300) });
  globalThis.__rpc = { calls: [], next: { data: null, error: { code: "40001", message: "company_fact_stale" } } };
  assert.equal((await retireCompanyFactAction(PREVIOUS, form({ request_id: ID(301), fact_id: ID(3) }))).status, "stale");
});

/* ---------------------------------------------------------------------------------------- экран */

const LIST = [
  FACT(1),
  FACT(2, { topic: "calendar.cn.intake_2027.2026_11", audience: "client", validUntil: "2026-11-01", validity: "expired", daysLeft: -27, statementRu: "Ноябрь 2026: регистрация на HSK и CSCA." }),
  FACT(3, { topic: "docs.cn.bank_statement", validUntil: "2026-12-10", validity: "expiring", daysLeft: 12, statementKy: "Банк тастыктамасы", statementEn: "Bank statement" }),
  FACT(4, { topic: "promise.admission", audience: "internal", validUntil: null, validity: "unlimited", daysLeft: null, verifiedByName: "Ольга Синтетическая" }),
  FACT(5, { topic: "course.ielts.group", status: "retired", validity: "ok" }),
];
const COUNTS = { active: 4, expired: 1, expiring: 1 };
const AVAILABLE = (over = {}) => ({ status: "available", data: DATA(LIST, { counts: COUNTS, ...over }) });

test("the table shows the topic in words with the key small, the text, the audience, the source, the dates and the marks", async () => {
  const { html } = await view();
  const markup = strip(html.list({ read: AVAILABLE(), readOnly: false }));
  assert.match(markup, /data-testid="v3-settings-company-facts"/u);
  assert.match(markup, /Курс SAT: группа и цена/u);
  assert.match(markup, /course\.sat\.group/u, "the key is there, small");
  assert.match(markup, /Групповой курс SAT: 10 недель, 299 долларов США\./u);
  assert.match(markup, /KY: Банк тастыктамасы/u);
  assert.match(markup, /EN: Bank statement/u);
  assert.match(markup, /Клиентский/u);
  assert.match(markup, /Внутренний/u);
  assert.match(markup, /Инструкция агента/u);
  assert.match(markup, /23\.10\.2026/u);
  assert.match(markup, /31\.12\.2026/u);
  assert.match(markup, /Без срока/u);
  assert.match(markup, /Ольга Синтетическая/u);
  assert.match(markup, /Перенесён из инструкции/u);
  // The marks: expired and expiring are worded and counted; the banner says how many.
  assert.match(markup, /Просрочен/u);
  assert.match(markup, /Просрочен 27 дн\. назад/u);
  assert.match(markup, /Скоро истечёт/u);
  assert.match(markup, /Осталось 12 дн\./u);
  assert.match(markup, /data-testid="v3-company-facts-expired"[^>]*>Просрочено фактов: 1\./u);
  assert.match(markup, /data-testid="v3-company-facts-expiring"[^>]*>Скоро истекает срок у фактов: 1\./u);
  assert.match(markup, /Просрочены · 1/u);
  assert.match(markup, /Скоро истекают · 1/u);
  // No raw code reaches the screen.
  const visibleText = markup.replace(/<[^>]*>/gu, " ");
  for (const raw of ["agent_instruction", "unlimited", "expiring", "expired", "kb_node", "catalog_cost", "client", "internal", "supersedes", "valid_until"]) {
    assert.ok(!visibleText.includes(raw), `${raw} is not on screen`);
  }
});

test("retired facts are hidden until asked; the actions exist only for active facts and only with the right", async () => {
  const { html } = await view();
  const markup = strip(html.list({ read: AVAILABLE(), readOnly: false }));
  assert.doesNotMatch(markup, /Курс IELTS: группа и цена/u, "the retired fact is not in the list by default");
  assert.match(markup, /Показать снятые · 1/u);
  assert.match(markup, /Добавить факт/u);
  assert.equal([...markup.matchAll(/data-testid="v3-company-fact-verify"/gu)].length, 4 * 2, "a «Проверено» button per active fact (table and phone card)");
  assert.match(markup, /aria-label="Изменить: Курс SAT: группа и цена"/u);
  // Read only: a viewer or a role preview sees the facts and no buttons, and is told why.
  for (const props of [{ read: AVAILABLE({ canManage: false }), readOnly: false }, { read: AVAILABLE(), readOnly: true }]) {
    const quiet = strip(html.list(props));
    assert.match(quiet, /Курс SAT: группа и цена/u);
    assert.doesNotMatch(quiet, /Добавить факт|v3-company-fact-verify|Изменить:/u);
  }
  assert.match(strip(html.list({ read: AVAILABLE({ canManage: false }), readOnly: false })), /Правка фактов доступна тем, у кого есть право управлять ИИ-агентами/u);
});

test("nothing expired: no banner; an empty list says what to do; broken reads are one sentence", async () => {
  const { html } = await view();
  const calm = strip(html.list({ read: { status: "available", data: DATA([FACT(1)]) }, readOnly: false }));
  assert.doesNotMatch(calm, /v3-company-facts-expired|v3-company-facts-expiring/u);
  const empty = strip(html.list({ read: { status: "available", data: DATA([]) }, readOnly: false }));
  assert.match(empty, /Фактов пока нет\. Добавьте первый/u);
  assert.match(strip(html.list({ read: { status: "denied" }, readOnly: false })), /Факты компании видят сотрудники с доступом к ИИ-агентам\./u);
  assert.match(strip(html.list({ read: { status: "not_ready" }, readOnly: false })), /Раздел готовится\./u);
  const down = strip(html.list({ read: { status: "unavailable" }, readOnly: false }));
  assert.match(down, /Не удалось прочитать факты\./u);
  assert.match(down, /href="\/settings\?section=facts"/u);
  const cut = strip(html.list({ read: { status: "available", data: DATA([FACT(1)], { truncated: true }) }, readOnly: false }));
  assert.match(cut, /Показана часть фактов\./u);
});

test("the forms: a new fact asks for topic and audience; an edit keeps them fixed; text edits come with «Проверено»", async () => {
  const { html } = await view();
  const created = strip(html.form(null));
  assert.match(created, /data-testid="v3-company-fact-form-new"/u);
  assert.match(created, /name="topic"/u);
  assert.match(created, /name="audience"/u);
  assert.match(created, /name="fact_id" value=""/u);
  assert.match(created, /name="mark_verified" value="1"/u, "a new fact is verified by the one who adds it");
  assert.match(created, /Подтверждаю: факт проверен сегодня/u);
  const edit = strip(html.form(FACT(1, { statementKy: "Кыргызча", sourceRef: "ref" })));
  assert.match(edit, /data-testid="v3-company-fact-form"/u);
  assert.doesNotMatch(edit, /name="topic"|name="audience"/u, "topic and audience of an existing fact are not editable");
  assert.match(edit, /Курс SAT: группа и цена/u);
  assert.match(edit, new RegExp(`name="fact_id" value="${ID(1)}"`, "u"));
  assert.match(edit, /name="mark_verified" value="0"/u, "an edit starts unverified; the box is ticked when the text changes");
  assert.match(edit, /Проверено сегодня: текст и срок актуальны/u);
  assert.match(edit, /maxLength="1500"|maxlength="1500"/iu);
  assert.match(edit, /Кыргызча/u);
  assert.match(edit, /name="valid_until"[^>]*value="2026-12-31"/u);
  // The one-click «Проверено» sends the same text and dates and marks them verified.
  const verify = strip(html.verify(FACT(3, { statementKy: "Банк", validUntil: "2026-12-10" })));
  assert.match(verify, /name="fact_id" value="[^"]+"/u);
  assert.match(verify, /name="statement_ru" value="Групповой курс SAT/u);
  assert.match(verify, /name="valid_until" value="2026-12-10"/u);
  assert.match(verify, /name="mark_verified" value="1"/u);
  assert.match(verify, /aria-label="Проверено: /u);
  const retire = strip(html.retire(FACT(1)));
  assert.match(retire, /Снятый факт агенты больше не видят/u);
  assert.match(retire, />Снять</u);
  assert.doesNotMatch(retire, /Да, снять факт/u, "retiring needs a second, explicit click");
});

/* ------------------------------------------------------------------------------------- проводка */

test("«Факты» is a settings section read only for its own section, rendered by its own branch, with no new vocabulary", () => {
  const types = read("src/components/staff/settings/types.ts");
  assert.match(types, /\{ key: "facts", view: null, title: "Факты" \}/u);
  const page = read("src/app/(staff)/settings/page.tsx");
  assert.match(page, /const companyFactsRead = section === "facts" \? readCompanyFacts\(actor\) : Promise\.resolve\(undefined\);/u);
  assert.ok(page.indexOf("const companyFactsRead") > page.indexOf("if (actor.systemRole !== \"admin\")"), "read only after the non-Admin early return");
  assert.match(read("src/components/staff/settings-next/SettingsSection.tsx"), /section === "facts" && props\.companyFacts\) return <CompanyFactsNext \{\.\.\.props\.companyFacts\} \/>/u);
  assert.match(read("src/lib/v3/settings-next-props.ts"), /companyFacts: section === "facts" && input\.companyFacts \? \{ read: input\.companyFacts, readOnly: input\.reportsReadOnly \} : undefined/u);
  // Words live in wording.ts: no Cyrillic label table in the components or the source.
  for (const file of ["src/components/staff/settings-next/CompanyFactsNext.tsx", "src/lib/v3/company-facts-source.ts", "src/lib/ai-agents/company-facts.ts"]) {
    assert.doesNotMatch(read(file), /(client|internal|owner|agent_instruction): ?"[А-Яа-я]/u, `${file} holds no private label table`);
  }
  // The actions are server actions and call only the source; the source calls only the three database functions.
  assert.match(read("src/lib/platform-company-fact-actions.ts"), /^"use server";/u);
  const src = read("src/lib/v3/company-facts-source.ts");
  assert.deepEqual([...new Set([...src.matchAll(/COMPANY_FACT_RPC\.([a-z]+)/gu)].map((match) => match[1]))].sort(), ["list", "retire", "save"]);
  assert.doesNotMatch(src + read("src/lib/platform-company-fact-actions.ts"), /service_role|createSupabaseServiceClient|sk-ant-/u, "staff client only, no service client");
});

test("no label of the facts screen is written in the components: all of them come from wording.ts", () => {
  for (const file of ["src/components/staff/settings-next/CompanyFactsNext.tsx", "src/components/staff/settings-next/company-fact-columns.tsx", "src/components/staff/settings/CompanyFactForm.tsx"]) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
    const lines = code.split("\n").filter((line) => /[А-Яа-я]/u.test(line));
    assert.deepEqual(lines, [], `${file} has Russian text outside wording.ts`);
  }
  assert.ok(COMPANY_FACT_FORM_MESSAGE.invalid.includes(String(COMPANY_FACT_LIMITS.statementMaxChars)), "the limit comes from the constant");
  assert.match(COMPANY_FACT_FORM_MESSAGE.invalid, /«Проверено»/u);
});
