// «Задать направление» делу студента (миграция 292): разбор ответа команды, слова, вход
// действия и разметка «Сведений» дела. Дополняет, а не заменяет граничный набор на настоящем
// Postgres supabase/tests/platform_case_direction.sql (scripts/test-postgres-authorization.sh):
// право, версию, регламент, повтор и журнал решает SQL.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ADMISSIONS_DIRECTIONS } from "../src/lib/platform-admissions-playbook-contract.ts";
import {
  PlatformCaseDirectionError,
  caseDirectionStatusFromRpcError,
  normalizeCaseDirectionReceipt,
  parseCaseDirection,
  setStudentCaseDirection,
} from "../src/lib/platform-case-direction.ts";
import { caseDirectionOptionNote, caseDirectionOutcome, caseDirectionWords } from "../src/lib/v3/wording.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const surfaces = new Map(JSON.parse(execFileSync(
  process.execPath,
  [fileURLToPath(new URL("./e2e/case-static-render.cjs", import.meta.url)), "--json"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)).map((surface) => [surface.name, surface.html]));
const texts = (html) => html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();

const ORG = "29200000-0000-4000-8000-000000000001";
const CASE = "29200000-0000-4000-8000-000000000501";
const REQUEST = "5b0d7c0e-2d4f-4c1a-9a7e-3f2b1c0d9e8f";
const expected = { organizationId: ORG, studentCaseId: CASE, requestId: REQUEST, direction: "MY" };
const receipt = (overrides = {}) => ({
  organization_id: ORG, student_case_id: CASE, admissions_direction: "MY", admissions_version: "3",
  changed: true, request_id: REQUEST, changed_at: "2026-10-17T10:00:00.000000+00:00", ...overrides,
});

test("the direction is one of the five staff directions, never one of the six product countries", () => {
  for (const direction of ADMISSIONS_DIRECTIONS) assert.equal(parseCaseDirection(direction), direction);
  assert.deepEqual([...ADMISSIONS_DIRECTIONS], ["CN", "MY", "EUROPE", "AE", "TR"]);
  for (const bad of ["IT", "CZ", "cn", "", "undecided", "unknown", " CN", null, undefined, 1, {}]) assert.equal(parseCaseDirection(bad), null);
  // Домен команды совпадает с проверкой столбца (137) и миграцией 292.
  const check = source("supabase/migrations/137_platform_admissions_playbooks.sql").match(/admissions_direction TEXT CHECK\(admissions_direction IN \(([^)]*)\)\)/u);
  assert.ok(check, "the 137 CHECK is found");
  assert.deepEqual(check[1].replaceAll("'", "").split(","), [...ADMISSIONS_DIRECTIONS]);
  const migration = source("supabase/migrations/292_platform_case_direction.sql");
  assert.ok(migration.includes("p_direction NOT IN ('CN', 'MY', 'EUROPE', 'AE', 'TR')"));
  assert.ok(!/study_country_codes\(\)/u.test(migration.replace(/--[^\n]*/gu, "")), "the command does not use the six-country list");
});

test("the receipt must describe exactly this write", () => {
  const ok = normalizeCaseDirectionReceipt(receipt(), expected);
  assert.deepEqual({ ...ok }, {
    studentCaseId: CASE, direction: "MY", admissionsVersion: "3", changed: true, requestId: REQUEST, changedAt: "2026-10-17T10:00:00.000000+00:00",
  });
  // Значение уже стояло: ничего не записано, времени записи нет.
  const same = normalizeCaseDirectionReceipt(receipt({ changed: false, changed_at: null, admissions_version: "0" }), expected);
  assert.equal(same.changed, false);
  assert.equal(same.changedAt, null);
  const bad = [
    receipt({ organization_id: "29200000-0000-4000-8000-000000000002" }),
    receipt({ student_case_id: "29200000-0000-4000-8000-000000000502" }),
    receipt({ request_id: "7b0d7c0e-2d4f-4c1a-9a7e-3f2b1c0d9e8f" }),
    receipt({ admissions_direction: "CN" }),
    receipt({ admissions_direction: "IT" }),
    receipt({ admissions_version: "0" }),
    receipt({ admissions_version: 3 }),
    receipt({ admissions_version: "9223372036854775808" }),
    receipt({ changed: "true" }),
    receipt({ changed_at: null }),
    receipt({ changed: false, changed_at: "2026-10-17T10:00:00Z" }),
    receipt({ changed_at: "not a time" }),
    { ...receipt(), extra: 1 },
    Object.fromEntries(Object.entries(receipt()).filter(([key]) => key !== "changed_at")),
    null, [], "x",
  ];
  for (const value of bad) assert.throws(() => normalizeCaseDirectionReceipt(value, expected), (error) => error.name === "CaseDirectionContractError");
});

test("every refusal of the command has an honest status and a Russian word", () => {
  const status = (code, message) => caseDirectionStatusFromRpcError({ code, message });
  assert.equal(status("42501", "Student case is unavailable"), "forbidden");
  assert.equal(status("PT409", "case_direction_version_conflict"), "stale");
  assert.equal(status("22023", "case_direction_playbook_bound"), "playbook_bound");
  assert.equal(status("22023", "case_direction_case_closed"), "closed");
  assert.equal(status("22023", "case_direction_actor_access_lost"), "access_lost");
  assert.equal(status("22023", "case_direction_request_conflict"), "request_conflict");
  assert.equal(status("22023", "case_direction_invalid"), "invalid");
  assert.equal(status("22023", "anything else"), "invalid");
  assert.equal(status("42883", "function does not exist"), "unavailable");
  assert.equal(status("PGRST202", "no function"), "unavailable");
  assert.equal(caseDirectionStatusFromRpcError(null), "unavailable");
  assert.equal(caseDirectionStatusFromRpcError("boom"), "unavailable");
  for (const outcome of ["saved", "unchanged", "invalid", "forbidden", "preview", "stale", "playbook_bound", "closed", "access_lost", "request_conflict", "unavailable"]) {
    const word = caseDirectionOutcome(outcome);
    assert.ok(word && /[А-Яа-я]/u.test(word), `${outcome} has a Russian word`);
    assert.ok(!/case_direction|playbook_bound|access_lost|request_conflict|admissions_|[_]/u.test(word), `${outcome} shows no raw key`);
  }
  assert.equal(caseDirectionOutcome("nonsense"), null, "an unknown outcome is not drawn raw");
  assert.equal(caseDirectionOutcome("playbook_bound"), "Направление этого дела задано регламентом, его не меняют.");
  assert.equal(caseDirectionWords.set, "Задать направление");
  assert.equal(caseDirectionWords.change, "Сменить");
  assert.equal(caseDirectionOptionNote("EUROPE"), "Италия, Чехия и другие страны Европы");
  assert.equal(caseDirectionOptionNote("CN"), null);
});

test("the write refuses bad input before any request and keeps the honest outcome", async () => {
  const actor = { organizationId: ORG };
  const command = { studentCaseId: CASE, direction: "MY", expectedVersion: "3", requestId: REQUEST };
  for (const bad of [{ direction: "IT" }, { direction: "CZ" }, { direction: null }, { expectedVersion: "-1" }, { expectedVersion: "x" },
    { expectedVersion: "9223372036854775807" }, { requestId: "nope" }, { studentCaseId: "nope" }]) {
    await assert.rejects(setStudentCaseDirection(actor, { ...command, ...bad }), (error) => error instanceof PlatformCaseDirectionError && error.status === "invalid", JSON.stringify(bad));
  }
  await assert.rejects(setStudentCaseDirection({ organizationId: "nope" }, command), (error) => error.status === "invalid");
});

test("the form action checks the permission and the preview before it writes, and only a receipt says saved", () => {
  const actions = source("src/lib/platform-case-direction-actions.ts");
  const lines = actions.split("\n");
  assert.ok(actions.startsWith('"use server";'));
  const exact = actions.match(/CASE_DIRECTION_FIELDS = \[([^\]]*)\]/u);
  assert.deepEqual(exact[1].replaceAll(/["\s]/gu, "").split(","), ["student_case_id", "direction", "expected_version", "request_id"]);
  assert.ok(actions.indexOf("isStaffPreview(actor)") < actions.indexOf("setStudentCaseDirection("), "the preview never writes");
  assert.ok(actions.indexOf('staffHasPermission(actor, "case.curator.assign")') < actions.indexOf("setStudentCaseDirection("), "the permission comes first");
  assert.ok(!/case\.route\.manage/u.test(actions), "the ordinary curator permission is not enough");
  assert.ok(actions.includes('revalidatePath("/v3/profile")'));
  assert.ok(lines.filter((line) => line.includes('status: receipt.changed ? "saved" : "unchanged"')).length === 1, "saved only from the receipt");
  // При отказе идентификатор запроса остаётся тем же (повтор не запишет дважды), кроме конфликта.
  assert.ok(actions.includes('status === "request_conflict" || requestId === null ? randomUUID() : requestId'));
});

test("the case page offers the action only to who assigns curators and reads the case, on a case not closed, with a real version", () => {
  const parts = source("src/components/v3/profile/CaseWorkParts.tsx");
  const gate = parts.slice(parts.indexOf("const directionAction ="), parts.indexOf("const acceptContext"));
  for (const part of ['!preview', '!assignOnly', 'staffHasPermission(actor, "case.curator.assign")', "input.requestIds.direction", "work.row !== null", 'admissions.caseState !== "closed"', "work.row.admissionsVersion"]) {
    assert.ok(gate.includes(part), `the gate keeps ${part}`);
  }
  assert.ok(source('src/app/(v3)/v3/profile/page.tsx').includes("direction: randomUUID()"), "the page gives the form its own request id");
});

test("«Сведения»: Admin and the head see «Задать направление» / «Сменить»; the curator, the preview, the closed case and the needs-curator reader see the plain value", () => {
  const facts = (name) => {
    const html = surfaces.get(name);
    assert.ok(html, `${name} is rendered`);
    const start = html.indexOf('data-testid="v3-case-facts"');
    assert.ok(start > 0, `${name} has «Сведения»`);
    return html.slice(start);
  };
  const action = (name) => facts(name).includes('data-testid="v3-case-direction"');
  const factText = (name) => texts(facts(name).slice(0, facts(name).indexOf("</dl>")));
  // Admin, направление задано (дело прямого студента, снимок: MY): «Сменить», и только оно.
  assert.ok(action("direct-case"));
  assert.match(texts(facts("direct-case")), /Направление\s+Малайзия\s+Сменить направление/u);
  assert.ok(!/Задать направление/u.test(texts(facts("direct-case"))));
  // Admin, направления нет, но строка очереди есть: «Не выбрано» и «Задать направление».
  assert.match(texts(facts("direct-case-no-row")), /Направление\s+Не выбрано\s+Задать направление/u);
  // Без строки очереди версии для записи нет: значение без действия, ничего не выдумано.
  assert.ok(!action("direct-case-free-text"));
  assert.match(factText("direct-case-free-text"), /Направление\s+Не выбрано\s+Куратор/u);
  // Руководитель из «Ждут куратора» читает дело только ради назначения куратора: права `case.read.full` на дело у него нет,
  // команда начинается с него и ответила бы отказом, поэтому действия нет (значение словами остаётся).
  assert.ok(!action("assign-only"));
  assert.match(texts(facts("assign-only")), /Направление\s+Китай\s+Куратор/u);
  // Куратор (право case.route.manage, но не case.curator.assign), просмотр роли и закрытое дело: значение без действия.
  for (const name of ["unread", "fresh", "closed", "closed-outcome", "notes-page", "preview-awaiting", "closed-admin", "direct-case-closed-fields"]) {
    if (surfaces.has(name)) assert.ok(!action(name), `${name}: no direction action`);
  }
  assert.ok(surfaces.has("closed-admin"), "the closed case of an Admin is covered");
  // Форма раскрывается по нажатию: в разметке её нет, а значение и кнопка есть.
  assert.ok(!surfaces.get("direct-case").includes('data-testid="v3-case-direction-form"'));
  // Ключ из базы на экран не попадает.
  for (const name of ["direct-case", "direct-case-no-row", "assign-only"]) assert.ok(!/EUROPE|admissions_direction|case_direction/u.test(texts(facts(name))), `${name}: no raw key`);
});

test("the migration and the suite are wired together", () => {
  const script = source("scripts/test-postgres-authorization.sh");
  assert.ok(script.includes("*_platform_case_direction.sql"));
  assert.ok(script.includes("/workspace/supabase/tests/platform_case_direction.sql"));
  const suite = source("supabase/tests/platform_case_direction.sql");
  assert.ok(suite.includes("N292_CASE_DIRECTION_SUITE_START") && suite.includes("N292_CASE_DIRECTION_SUITE_PASSED"));
  const migration = source("supabase/migrations/292_platform_case_direction.sql");
  assert.ok(/GRANT EXECUTE ON FUNCTION platform\.set_student_case_direction_v1\(UUID, UUID, TEXT, BIGINT, UUID\)\s+TO authenticated;/u.test(migration));
  assert.ok(migration.includes("SECURITY DEFINER SET search_path = ''"));
  assert.ok(migration.includes("admissions_lock_case(p_student_case_id, 'case.curator.assign')"));
  assert.ok(!/UPDATE platform\.student_cases[^;]*(current_curator|operational_stage|next_action|target_country)/su.test(migration.replace(/--[^\n]*/gu, "")), "the command writes the direction and the version only");
});
