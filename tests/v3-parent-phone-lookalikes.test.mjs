// Подсказка «Похоже на» (#1198, пункт 2; решение владельца 18.10.2026 и его дополнение после review; миграция 306).
// Проверки без сети и без базы: строгий разбор ответа `platform.read_parent_phone_lookalikes_v1` (объект из трёх
// ключей `matches`, `restricted`, `more`; лишний ключ, номер в ответе, больше пяти дел, повтор дела, `more` без пяти
// дел, чужая форма: ошибка, а не совпадение наугад), чтение страницы с поддельной базой (просмотр роли базу не зовёт,
// любой сотрудник кроме него зовёт: решает база, отказ 42501 ничего не показывает, сбой и чужая форма говорят
// словами), проводка в странице профиля и настоящий компонент статическим рендером (оба уровня и предел пяти,
// tests/e2e/parent-phone-lookalikes-static-render.cjs). Данные синтетические: ни настоящего номера, ни имени.
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
  parseParentPhoneMatches,
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
const answerOf = (matches, restricted = false, more = false) => ({ matches, restricted, more });
const rows = (count) => Array.from({ length: count }, (_, n) => row(n + 1));
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
  const answer = parseParentPhoneLookalikes(answerOf([row(1), row(2, { relation: "father" }), row(3, { relation: "both", studentName: "  Имя  " })]));
  assert.deepEqual(answer.matches.map((match) => match.studentCaseId), [ID(1), ID(2), ID(3)]);
  assert.deepEqual(answer.matches.map((match) => match.relation), ["mother", "father", "both"]);
  assert.equal(answer.matches[2].studentName, "Имя", "the name is trimmed");
  assert.equal(answer.restricted, false);
  assert.equal(answer.more, false);
  assert.ok(Object.isFrozen(answer) && Object.isFrozen(answer.matches) && answer.matches.every(Object.isFrozen));
  assert.deepEqual(parseParentPhoneLookalikes(answerOf([])), answerOf([]));
  assert.equal(parseParentPhoneLookalikes(answerOf([row(1, { studentCaseId: ID(1).toUpperCase() })])).matches[0].studentCaseId, ID(1), "ids are lower-cased");
});

test("contract: the two levels and the cap are parsed as the database says them", () => {
  // Level two only: nothing listed, a hidden match exists.
  assert.deepEqual(parseParentPhoneLookalikes(answerOf([], true)), answerOf([], true));
  // Level one with a hidden match beside it.
  const beside = parseParentPhoneLookalikes(answerOf([row(1)], true));
  assert.equal(beside.matches.length, 1);
  assert.equal(beside.restricted, true);
  // More readable matches than the five shown: only with the full five.
  const full = parseParentPhoneLookalikes(answerOf(rows(PARENT_PHONE_LOOKALIKES_LIMIT), false, true));
  assert.equal(full.matches.length, PARENT_PHONE_LOOKALIKES_LIMIT);
  assert.equal(full.more, true);
  assert.equal(parseParentPhoneLookalikes(answerOf(rows(PARENT_PHONE_LOOKALIKES_LIMIT), true, true)).restricted, true);
  assert.equal(parseParentPhoneLookalikes(answerOf(rows(PARENT_PHONE_LOOKALIKES_LIMIT))).more, false, "exactly five readable cases: nothing is cut");
});

test("contract: a foreign shape is null, never a guessed match", () => {
  const bad = [
    null, undefined, {}, "x", 5, [], [row(1)],                    // not the three-key object (the pre-review array too)
    { matches: [], restricted: false }, { matches: [], more: false }, { restricted: false, more: false },
    { matches: [], restricted: false, more: false, hiddenCount: 3 },     // a count of hidden cases: leak, refused
    { matches: [], restricted: false, more: false, phone: "+996777302100" },
    { matches: [], restricted: "true", more: false }, { matches: [], restricted: 1, more: false },
    { matches: [], restricted: null, more: false }, { matches: [], restricted: false, more: "no" },
    { matches: [], restricted: false, more: 0 }, { matches: [], restricted: true, more: undefined },
    { matches: [], restricted: false, more: true },                       // more without the five shown
    { matches: rows(4), restricted: false, more: true },
    { matches: null, restricted: false, more: false }, { matches: {}, restricted: false, more: false },
    { matches: "x", restricted: false, more: false },
    answerOf([null]), answerOf([[]]), answerOf(["x"]),
    answerOf([{ ...row(1), phone: "+996777302100" }]),                    // a number in the answer: leak, refused
    answerOf([{ ...row(1), parentName: "Мама" }]),                         // a parent's name: leak, refused
    answerOf([{ studentCaseId: ID(1), studentName: "Студент", extra: 1 }]), // wrong key set
    answerOf([{ studentCaseId: ID(1), studentName: "Студент" }]),          // a key missing
    answerOf([row(1, { studentCaseId: "not-a-uuid" })]), answerOf([row(1, { studentCaseId: null })]),
    answerOf([row(1, { relation: "uncle" })]), answerOf([row(1, { relation: undefined })]), answerOf([row(1, { relation: "MOTHER" })]),
    answerOf([row(1, { studentName: "" })]), answerOf([row(1, { studentName: "   " })]), answerOf([row(1, { studentName: 7 })]), answerOf([row(1, { studentName: null })]),
    answerOf([row(1, { studentName: "а".repeat(301) })]), answerOf([row(1, { studentName: "Имя\nс переводом" })]), answerOf([row(1, { studentName: "Имя\u0000" })]),
    answerOf([row(1), row(1)]),                                            // the same case twice
    answerOf(rows(PARENT_PHONE_LOOKALIKES_LIMIT + 1)),
  ];
  for (const value of bad) assert.equal(parseParentPhoneLookalikes(value), null, JSON.stringify(value)?.slice(0, 80));
  assert.equal(parseParentPhoneLookalikes(answerOf(rows(PARENT_PHONE_LOOKALIKES_LIMIT))).matches.length, PARENT_PHONE_LOOKALIKES_LIMIT);
  // The list on its own keeps the old strictness.
  assert.equal(parseParentPhoneMatches(rows(PARENT_PHONE_LOOKALIKES_LIMIT + 1)), null);
  assert.equal(parseParentPhoneMatches({ matches: [] }), null);
});

test("contract: words and the case address", () => {
  assert.equal(parentPhoneCaseHref(ID(1)), `/v3/profile?case=${ID(1)}`);
  assert.match(parentPhoneRelationText("mother"), /мамы$/u);
  assert.match(parentPhoneRelationText("father"), /папы$/u);
  assert.match(parentPhoneRelationText("both"), /мамы и папы$/u);
  assert.equal(PARENT_PHONE_LOOKALIKES_WORDS.label, "Похоже на");
  assert.match(PARENT_PHONE_LOOKALIKES_WORDS.note, /не объединены/u);
  // The owner's words for the second level (18.10.2026), exactly.
  assert.equal(PARENT_PHONE_LOOKALIKES_WORDS.restricted, "Номер совпадает с телефоном родителя в другом деле. Уточните у руководителя поступления.");
  // The second level says nothing that could be a name, a number or a count.
  for (const words of [PARENT_PHONE_LOOKALIKES_WORDS.restricted, PARENT_PHONE_LOOKALIKES_WORDS.restrictedBeside]) {
    assert.doesNotMatch(words, /\d/u, "no digit: no count");
    assert.doesNotMatch(words, /Похоже на|дело студента|студент/iu, "no name of a case");
  }
  assert.equal(PARENT_PHONE_LOOKALIKES_WORDS.more, `Показаны первые ${PARENT_PHONE_LOOKALIKES_LIMIT}, дел с этим номером больше.`);
  assert.equal(PARENT_PHONE_LOOKALIKES_LIMIT, 5, "the cap of the migration (shown_count < 5)");
});

// ------------------------------------------------------------ the read of the page

test("read: asks the database with the organization and exactly one subject", async () => {
  const ok = await ask({ data: answerOf([row(1), row(2, { relation: "both" })]), error: null }, { studentCaseId: ID(5) });
  assert.equal(ok.status, "available");
  assert.deepEqual(ok.matches.map((match) => match.relation), ["mother", "both"]);
  assert.equal(ok.restricted, false);
  assert.equal(ok.more, false);
  assert.deepEqual(globalThis.__pp.calls, [{ schema: "platform", fn: "read_parent_phone_lookalikes_v1",
    args: { p_organization_id: ORG, p_lead_id: null, p_student_case_id: ID(5) } }]);
  await ask({ data: answerOf([]), error: null }, { leadId: ID(6) });
  assert.deepEqual(globalThis.__pp.calls[0].args, { p_organization_id: ORG, p_lead_id: ID(6), p_student_case_id: null });
});

test("read: the second level and the cap reach the page as the database says them", async () => {
  assert.deepEqual(await ask({ data: answerOf([], true), error: null }, { leadId: ID(6) }),
    { status: "available", matches: [], restricted: true, more: false });
  const cut = await ask({ data: answerOf(rows(PARENT_PHONE_LOOKALIKES_LIMIT), true, true), error: null });
  assert.equal(cut.status, "available");
  assert.equal(cut.matches.length, PARENT_PHONE_LOOKALIKES_LIMIT);
  assert.equal(cut.restricted, true);
  assert.equal(cut.more, true);
});

test("read: only the preview of a role stays away from the database; every other member asks, the database decides", async () => {
  const preview = actor({ systemRole: "admin", presentationRole: "sales" });
  assert.deepEqual(await ask({ data: answerOf([row(1)]), error: null }, { leadId: ID(6) }, preview), { status: "available", matches: [], restricted: false, more: false });
  assert.equal(globalThis.__pp.calls.length, 0, "preview does not read: for the database it is the Admin");
  // The Sales Manager holds neither case.read.full nor profile.read.full and must still get the hint (the second level).
  for (const keys of [[], ["lead.read"], ["case.read.full"], ["profile.read.full"], ["case.read.summary", "client.read", "lead.read"]]) {
    const state = await ask({ data: answerOf([], true), error: null }, { leadId: ID(6) }, actor({ permissionKeys: keys }));
    assert.deepEqual(state, { status: "available", matches: [], restricted: true, more: false }, keys.join());
    assert.equal(globalThis.__pp.calls.length, 1, `${keys.join() || "no keys"}: the database is asked and decides`);
  }
  const admin = await ask({ data: answerOf([row(1)]), error: null }, { leadId: ID(6) }, actor({ systemRole: "admin", permissionKeys: [] }));
  assert.equal(admin.status, "available");
  assert.equal(admin.matches.length, 1);
  assert.equal(globalThis.__pp.calls.length, 1, "the Admin reads");
});

test("read: a refusal shows nothing, a failure or a foreign answer says so", async () => {
  assert.deepEqual(await ask({ data: null, error: { code: "42501", message: "parent_phone_lookalikes_forbidden" } }), { status: "available", matches: [], restricted: false, more: false });
  for (const answer of [
    { data: null, error: { code: "XX000", message: "boom" } }, { data: null, error: { code: "22023", message: "parent_phone_lookalikes_invalid" } },
    { data: answerOf([{ ...row(1), phone: "+996777302100" }]), error: null }, { data: { not: "an answer" }, error: null }, { data: null, error: null },
    { data: [row(1)], error: null },                                        // the pre-review array shape is a foreign answer now
    { data: { ...answerOf([]), hiddenCount: 2 }, error: null }, "throw",
  ]) assert.deepEqual(await ask(answer), { status: "unavailable" }, JSON.stringify(answer).slice(0, 80));
});

test("read: not exactly one well-formed subject is unavailable without a database call", async () => {
  for (const subject of [{}, { leadId: ID(1), studentCaseId: ID(2) }, { leadId: "nope" }, { studentCaseId: "nope" }, { leadId: "" }]) {
    assert.deepEqual(await ask({ data: answerOf([]), error: null }, subject), { status: "unavailable" }, JSON.stringify(subject));
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

test("component: the second level is one sentence with no name, case id, link or count", () => {
  const pages = render();
  const only = pages.get("restrictedOnly");
  assert.equal(text(only), PARENT_PHONE_LOOKALIKES_WORDS.restricted, "exactly the owner's sentence");
  assert.match(only, /data-testid="v3-parent-phone-restricted"/u);
  assert.doesNotMatch(only, /<a[\s>]|href=|data-relation|v3-parent-phone-lookalike"|30600000-/u, "no link, no case id, no relation");
  assert.doesNotMatch(only, /Похоже на:|Карточки не объединены/u, "no list label and no list note without a readable case");
  assert.doesNotMatch(text(only), /\d/u, "no digit in the words: no count");
  assert.equal(pages.get("empty"), "", "restricted = false with no match still renders nothing (no oracle)");
});

test("component: a hidden match beside readable ones, and the cap of five", () => {
  const pages = render();
  const beside = pages.get("restrictedBeside");
  assert.equal(beside.match(/data-testid="v3-parent-phone-lookalike"/gu).length, 1, "only the readable case is listed");
  assert.match(text(beside), /Айдай Условная дело студента, номер записан в анкете как телефон мамы Номер совпадает с телефоном родителя и в другом деле\. Уточните у руководителя поступления\. Карточки не объединены/u);
  assert.equal(beside.match(/<a[\s>]/gu).length, 1, "one link: the hidden match has none");
  assert.doesNotMatch(pages.get("one"), /в другом деле/u, "no second-level line when nothing is hidden");
  const more = pages.get("more");
  assert.equal(more.match(/data-testid="v3-parent-phone-lookalike"/gu).length, PARENT_PHONE_LOOKALIKES_LIMIT, "five are listed");
  assert.match(text(more), new RegExp(`${PARENT_PHONE_LOOKALIKES_WORDS.more.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
  assert.match(more, /data-testid="v3-parent-phone-more"/u);
  assert.doesNotMatch(more, /v3-parent-phone-restricted-beside/u, "more alone says nothing about a hidden match");
  assert.doesNotMatch(pages.get("exactlyFive"), /v3-parent-phone-more/u, "exactly five: nothing is cut, nothing is said");
  const both = pages.get("moreAndRestricted");
  assert.match(both, /v3-parent-phone-more/u);
  assert.match(both, /v3-parent-phone-restricted-beside/u);
  assert.equal(both.match(/Карточки не объединены/gu).length, 1, "one note for the list");
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

test("source: the hint merges nothing and writes nothing, and the page applies no permission gate of its own", () => {
  const source = read("src/lib/v3/parent-phone-lookalikes-source.ts");
  // The database decides per caller (two levels); a gate here would hide the hint from the Sales Manager.
  assert.doesNotMatch(source, /staffHasPermission|case\.read\.full|profile\.read\.full/u);
  assert.match(source, /isStaffPreview\(actor\)/u);
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/u);
  assert.equal(source.match(/\.rpc\(/gu).length, 1, "one read");
  const migration = read("supabase/migrations/306_platform_parent_phone_lookalikes.sql");
  const body = migration.slice(migration.indexOf("AS $$"), migration.indexOf("\n$$;")).replace(/--[^\n]*/gu, "");
  assert.ok(body.length > 1000, "the routine body was found");
  assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE|PERFORM)\b|create_or_link|merge|RAISE (NOTICE|LOG|WARNING)/iu, "the routine writes, links and logs nothing");
  assert.match(migration, /STABLE SECURITY DEFINER SET search_path = ''/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION platform\.read_parent_phone_lookalikes_v1\(UUID, UUID, UUID\) TO authenticated;/u);
  // The cap of the screen is the cap of the routine, and the answer has exactly the three keys the parser accepts.
  assert.match(body, new RegExp(`shown_count < ${PARENT_PHONE_LOOKALIKES_LIMIT} THEN`, "u"));
  assert.match(body, /jsonb_build_object\('matches', shown, 'restricted', has_hidden, 'more', has_more\)/u);
  assert.equal(body.match(/jsonb_build_object\('matches'/gu).length, 2, "the empty answer and the full one, both with the three keys");
});
