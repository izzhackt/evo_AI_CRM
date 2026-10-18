// Подсказка «Похоже на» (#1198, пункт 2; решение владельца 18.10.2026; миграция 306). Проверки без сети и без
// базы: строгий разбор ответа `platform.read_parent_phone_lookalikes_v1` (лишний ключ, номер в ответе, больше
// пяти дел, повтор дела, чужая форма: ошибка, а не совпадение наугад), чтение страницы с поддельной базой (просмотр
// роли и сотрудник без прав базу не зовут, отказ базы 42501 ничего не показывает, сбой и чужая форма говорят
// словами), проводка в странице профиля и настоящий компонент статическим рендером
// (tests/e2e/parent-phone-lookalikes-static-render.cjs). Данные синтетические: ни настоящего номера, ни имени.
// Кто что видит, решает база: supabase/tests/platform_parent_phone_lookalikes.sql.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PARENT_PHONE_LOOKALIKES_LIMIT,
  PARENT_PHONE_LOOKALIKES_WORDS,
  parentPhoneCaseHref,
  parentPhoneRelationText,
  parseParentPhoneLookalikes,
} from "../src/lib/parent-phone-lookalikes-contract.ts";

// Чтение страницы: подмена клиента базы (его открывает `open`, а не «supabase/server»), `server-only`
// проходит под условием react-server.
globalThis.__pp = { calls: [], answer: null };
registerHooks({ resolve(specifier, context, next) {
  if (!context.parentURL?.endsWith("/parent-phone-lookalikes-source.ts")) return next(specifier, context);
  if (specifier === "../supabase/server.ts") {
    return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(`export async function createSupabaseServerClient(){
      if (globalThis.__pp.answer === "throw") throw new Error("the database is unreachable");
      return { schema(name) { return { rpc(fn, args) { globalThis.__pp.calls.push({ schema: name, fn, args }); return Promise.resolve(globalThis.__pp.answer); } }; } };
    }`)}` };
  }
  return next(specifier, context);
} });
const { readParentPhoneLookalikes } = await import("../src/lib/v3/parent-phone-lookalikes-source.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
const render = () => new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/parent-phone-lookalikes-static-render.cjs", import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));

const ID = (n) => `30600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = "eeeeeeee-4444-4444-8444-000000000000";
const row = (n, fields = {}) => ({ studentCaseId: ID(n), studentName: `Студент ${n}`, relation: "mother", ...fields });
const actor = (fields = {}) => ({
  authUserId: ID(900), profileId: ID(901), membershipId: ID(902), organizationId: ORG, displayName: "Сотрудник (синтетический)",
  systemRole: "staff", platformAccessVersion: 1, assignments: [], permissionKeys: ["case.read.full", "profile.read.full"],
  email: "synthetic@example.invalid", presentationRole: null, ...fields,
});
const ask = async (answer, subject = { studentCaseId: ID(1) }, who = actor()) => {
  globalThis.__pp = { calls: [], answer };
  return readParentPhoneLookalikes(who, subject);
};

// ------------------------------------------------------------ contract

test("contract: a well-formed answer is parsed, frozen and keeps the database's order", () => {
  const matches = parseParentPhoneLookalikes([row(1), row(2, { relation: "father" }), row(3, { relation: "both", studentName: "  Имя  " })]);
  assert.deepEqual(matches.map((match) => match.studentCaseId), [ID(1), ID(2), ID(3)]);
  assert.deepEqual(matches.map((match) => match.relation), ["mother", "father", "both"]);
  assert.equal(matches[2].studentName, "Имя", "the name is trimmed");
  assert.ok(Object.isFrozen(matches) && matches.every(Object.isFrozen));
  assert.deepEqual(parseParentPhoneLookalikes([]), []);
  assert.equal(parseParentPhoneLookalikes([row(1, { studentCaseId: ID(1).toUpperCase() })])[0].studentCaseId, ID(1), "ids are lower-cased");
});

test("contract: a foreign shape is null, never a guessed match", () => {
  const bad = [
    null, undefined, {}, "x", 5, [null], [[]], ["x"],
    [{ ...row(1), phone: "+996777302100" }],                      // a number in the answer: leak, refused
    [{ ...row(1), parentName: "Мама" }],                           // a parent's name: leak, refused
    [{ studentCaseId: ID(1), studentName: "Студент", extra: 1 }],  // wrong key set
    [{ studentCaseId: ID(1), studentName: "Студент" }],            // a key missing
    [row(1, { studentCaseId: "not-a-uuid" })], [row(1, { studentCaseId: null })],
    [row(1, { relation: "uncle" })], [row(1, { relation: undefined })], [row(1, { relation: "MOTHER" })],
    [row(1, { studentName: "" })], [row(1, { studentName: "   " })], [row(1, { studentName: 7 })], [row(1, { studentName: null })],
    [row(1, { studentName: "а".repeat(301) })], [row(1, { studentName: "Имя\nс переводом" })], [row(1, { studentName: "Имя\u0000" })],
    [row(1), row(1)],                                              // the same case twice
    Array.from({ length: PARENT_PHONE_LOOKALIKES_LIMIT + 1 }, (_, n) => row(n + 1)),
  ];
  for (const value of bad) assert.equal(parseParentPhoneLookalikes(value), null, JSON.stringify(value)?.slice(0, 80));
  assert.equal(parseParentPhoneLookalikes(Array.from({ length: PARENT_PHONE_LOOKALIKES_LIMIT }, (_, n) => row(n + 1))).length, PARENT_PHONE_LOOKALIKES_LIMIT);
});

test("contract: words and the case address", () => {
  assert.equal(parentPhoneCaseHref(ID(1)), `/v3/profile?case=${ID(1)}`);
  assert.match(parentPhoneRelationText("mother"), /мамы$/u);
  assert.match(parentPhoneRelationText("father"), /папы$/u);
  assert.match(parentPhoneRelationText("both"), /мамы и папы$/u);
  assert.equal(PARENT_PHONE_LOOKALIKES_WORDS.label, "Похоже на");
  assert.match(PARENT_PHONE_LOOKALIKES_WORDS.note, /не объединены/u);
});

// ------------------------------------------------------------ the read of the page

test("read: asks the database with the organization and exactly one subject", async () => {
  const ok = await ask({ data: [row(1), row(2, { relation: "both" })], error: null }, { studentCaseId: ID(5) });
  assert.equal(ok.status, "available");
  assert.deepEqual(ok.matches.map((match) => match.relation), ["mother", "both"]);
  assert.deepEqual(globalThis.__pp.calls, [{ schema: "platform", fn: "read_parent_phone_lookalikes_v1",
    args: { p_organization_id: ORG, p_lead_id: null, p_student_case_id: ID(5) } }]);
  await ask({ data: [], error: null }, { leadId: ID(6) });
  assert.deepEqual(globalThis.__pp.calls[0].args, { p_organization_id: ORG, p_lead_id: ID(6), p_student_case_id: null });
});

test("read: preview of a role and a member without case and анкета rights never reach the database", async () => {
  const preview = actor({ systemRole: "admin", presentationRole: "sales" });
  assert.deepEqual(await ask({ data: [row(1)], error: null }, { leadId: ID(6) }, preview), { status: "available", matches: [] });
  assert.equal(globalThis.__pp.calls.length, 0, "preview does not read: for the database it is the Admin");
  for (const keys of [[], ["lead.read"], ["case.read.full"], ["profile.read.full"], ["case.read.summary", "client.read", "lead.read"]]) {
    const state = await ask({ data: [row(1)], error: null }, { leadId: ID(6) }, actor({ permissionKeys: keys }));
    assert.deepEqual(state, { status: "available", matches: [] }, keys.join());
    assert.equal(globalThis.__pp.calls.length, 0, keys.join());
  }
  const admin = await ask({ data: [row(1)], error: null }, { leadId: ID(6) }, actor({ systemRole: "admin", permissionKeys: [] }));
  assert.equal(admin.status, "available");
  assert.equal(admin.matches.length, 1);
  assert.equal(globalThis.__pp.calls.length, 1, "the Admin reads");
});

test("read: a refusal shows nothing, a failure or a foreign answer says so", async () => {
  assert.deepEqual(await ask({ data: null, error: { code: "42501", message: "parent_phone_lookalikes_forbidden" } }), { status: "available", matches: [] });
  for (const answer of [
    { data: null, error: { code: "XX000", message: "boom" } }, { data: null, error: { code: "22023", message: "parent_phone_lookalikes_invalid" } },
    { data: [{ ...row(1), phone: "+996777302100" }], error: null }, { data: { not: "an array" }, error: null }, { data: null, error: null }, "throw",
  ]) assert.deepEqual(await ask(answer), { status: "unavailable" }, JSON.stringify(answer).slice(0, 80));
});

test("read: not exactly one well-formed subject is unavailable without a database call", async () => {
  for (const subject of [{}, { leadId: ID(1), studentCaseId: ID(2) }, { leadId: "nope" }, { studentCaseId: "nope" }, { leadId: "" }]) {
    assert.deepEqual(await ask({ data: [], error: null }, subject), { status: "unavailable" }, JSON.stringify(subject));
    assert.equal(globalThis.__pp.calls.length, 0, JSON.stringify(subject));
  }
});

// ------------------------------------------------------------ the page and the component

test("page: the hint sits above the card of a lead or a case, never in preview, in its own Suspense", () => {
  const page = read("src/app/(v3)/v3/profile/page.tsx");
  assert.match(page, /import \{ ParentPhoneLookalikes \} from "@\/components\/v3\/profile\/ParentPhoneLookalikes"/u);
  assert.match(page, /const lookalikeSubject: ParentPhoneSubject \| null = caseParts && caseTarget \? \{ studentCaseId: caseTarget\.studentCaseId \}\s*:\s*leadParts && view\?\.details\.routeTarget\.leadId \? \{ leadId: view\.details\.routeTarget\.leadId \} : null;/u);
  const mount = page.indexOf("{lookalikeSubject && !isStaffPreview(actor) ?");
  assert.ok(mount > 0 && mount < page.indexOf("<Profile\n"), "mounted before the card");
  assert.match(page.slice(mount, mount + 220), /<Suspense fallback=\{null\}>\s*<ParentPhoneLookalikes actor=\{actor\} subject=\{lookalikeSubject\} \/>/u);
});

test("component: names, links, relation words and the no-merge note; nothing for no match", () => {
  const pages = render();
  const one = pages.get("one");
  assert.match(one, /data-testid="v3-parent-phone-lookalikes"/u);
  assert.match(text(one), /^Похоже на: Айдай Условная дело студента, номер записан в анкете как телефон мамы Карточки не объединены\. Проверьте вручную, тот ли это человек\.$/u);
  assert.ok(one.includes(`href="/v3/profile?case=${ID(1)}"`), "links to the case");
  assert.match(pages.get("father"), /как телефон папы/u);
  assert.match(pages.get("both"), /как телефон мамы и папы/u);
  const three = pages.get("three");
  assert.equal(three.match(/data-testid="v3-parent-phone-lookalike"/gu).length, 3);
  assert.equal(three.match(/Похоже на:/gu).length, 1, "one label for the list");
  assert.equal(three.match(/Карточки не объединены/gu).length, 1, "one note for the list");
  assert.equal(pages.get("empty"), "", "no match renders nothing");
  assert.match(pages.get("unavailable"), /role="status"/u);
  assert.equal(text(pages.get("unavailable")), PARENT_PHONE_LOOKALIKES_WORDS.unavailable);
});

test("component: calm look, big targets, no number, no dash in the words", () => {
  const pages = render();
  for (const [name, html] of pages) {
    assert.equal(html.match(/(?<![\w:-])bg-accent(?![\w-])/gu)?.length ?? 0, 0, `${name}: no solid red`);
    assert.doesNotMatch(html.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu, ""), /\d{7,}/u, `${name}: no phone number`);
    assert.doesNotMatch(text(html), /[\u2013\u2014]/u, `${name}: no em or en dash`);
  }
  assert.match(pages.get("one"), /class="[^"]*min-h-11[^"]*"[^>]*href=/u, "the link is a 44 px target");
  assert.match(pages.get("one"), /bg-info-weak/u, "info tone, a state of the record");
  assert.match(pages.get("both"), /break-words/u, "a long name wraps by words");
  for (const path of ["src/lib/parent-phone-lookalikes-contract.ts", "src/lib/v3/parent-phone-lookalikes-source.ts",
    "src/components/v3/profile/ParentPhoneLookalikes.tsx", "supabase/migrations/306_platform_parent_phone_lookalikes.sql",
    "supabase/tests/platform_parent_phone_lookalikes.sql"]) {
    assert.doesNotMatch(read(path), /[\u2013\u2014]/u, `${path}: no em or en dash`);
  }
});

test("source: the hint merges nothing and writes nothing", () => {
  const source = read("src/lib/v3/parent-phone-lookalikes-source.ts");
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/u);
  assert.equal(source.match(/\.rpc\(/gu).length, 1, "one read");
  const migration = read("supabase/migrations/306_platform_parent_phone_lookalikes.sql");
  const body = migration.slice(migration.indexOf("AS $$"), migration.indexOf("\n$$;")).replace(/--[^\n]*/gu, "");
  assert.ok(body.length > 1000, "the routine body was found");
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE|PERFORM)\b|create_or_link|merge|RAISE (NOTICE|LOG|WARNING)/iu, "the routine writes, links and logs nothing");
  assert.match(migration, /STABLE SECURITY DEFINER SET search_path = ''/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION platform\.read_parent_phone_lookalikes_v1\(UUID, UUID, UUID\) TO authenticated;/u);
});
