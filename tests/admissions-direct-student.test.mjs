// «Добавить студента» без отдела продаж (миграция 281, решения владельца
// 16.10.2026). The form contract (payload builder, amounts, the China default,
// validation, the server-side re-parse and the error wording) and static
// checks of the migration text and its suite wiring. They supplement, never
// replace, the real-Postgres suite supabase/tests/platform_admissions_direct_student.sql
// (hooked after 281 in scripts/test-postgres-authorization.sh).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADMISSIONS_DIRECT_DEGREES,
  CHINA_DEFAULT_COST,
  EMPTY_ADMISSIONS_DIRECT_DRAFT,
  admissionsDirectCaseHref,
  admissionsDirectPhone,
  admissionsDirectMessage,
  admissionsDirectServerField,
  amountToMinor,
  bishkekToday,
  buildAdmissionsDirectPayload,
  minorToAmount,
  parseAdmissionsDirectPayload,
} from "../src/lib/admissions-direct-student-contract.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = source("supabase/migrations/281_platform_admissions_direct_student.sql");
const suite = source("supabase/tests/platform_admissions_direct_student.sql");
const script = source("scripts/test-postgres-authorization.sh");
const drawer = source("src/components/v3/admissions/AddStudentDrawer.tsx");
const page = source("src/app/(v3)/v3/admissions-pipeline/page.tsx");
const directSource = source("src/lib/v3/admissions-direct-student-source.ts");

const draft = (overrides = {}) => ({ ...EMPTY_ADMISSIONS_DIRECT_DRAFT, firstName: "Айдай", country: "MY", ...overrides });

test("amounts: spaces and comma, two decimals, positive only", () => {
  assert.equal(amountToMinor("1 500"), 150000);
  assert.equal(amountToMinor("1500,5"), 150050);
  assert.equal(amountToMinor("1 500.25"), 150025);
  assert.equal(amountToMinor(""), "");
  assert.equal(amountToMinor("0"), null);
  assert.equal(amountToMinor("12.345"), null);
  assert.equal(amountToMinor("-5"), null);
  assert.equal(minorToAmount(150000), "1 500");
  assert.equal(minorToAmount(150050), "1 500,50");
});

test("China default cost is 1 500 USD (owner decision 16.10.2026)", () => {
  assert.deepEqual({ ...CHINA_DEFAULT_COST }, { amount: "1500", currency: "USD" });
  assert.match(drawer, /value === "CN" && untouched/u);
  assert.match(drawer, /Для Китая по умолчанию 1 500 USD\. Можно изменить\./u);
});

test("degrees come from the product wording", () => {
  assert.deepEqual([...ADMISSIONS_DIRECT_DEGREES], ["Фаундейшн", "Языковые курсы", "Диплом", "Бакалавриат", "Магистратура", "Докторантура"]);
});

test("a full draft builds the exact RPC payload", () => {
  const built = buildAdmissionsDirectPayload(draft({
    lastName: "Демо", phone: "+996 555 123 456", email: "aidai@example.invalid", birthDate: "2008-05-01", age: "40",
    parentRelation: "mother", parentFirstName: "Гульнара", parentPhone: "+996 700 000 001",
    country: "CN", degree: "Бакалавриат", program: "Computer Science", intake: "Сентябрь 2027",
    educationCurrent: "11 класс", english: "IELTS 6.0", chinese: "HSK 3",
    curator: "d0e07ebe-5fef-43c5-be1d-cba49471c550", stage: "documents",
    costAmount: "1 500", costCurrency: "USD", signedOn: "2026-09-01",
    payments: [{ amount: "500", currency: "USD", paidOn: "2026-09-05" }, { amount: "20 000", currency: "KGS", paidOn: "2026-09-10" }],
    note: "  Звонить после 18:00  ",
  }), "2026-10-16");
  assert.equal(built.ok, true);
  assert.deepEqual(built.payload, {
    student: { name: "Айдай Демо", firstName: "Айдай", lastName: "Демо", phone: "+996 555 123 456", email: "aidai@example.invalid", birthDate: "2008-05-01" },
    parent: { relation: "mother", firstName: "Гульнара", phone: "+996 700 000 001" },
    route: { country: "CN", degree: "Бакалавриат", program: "Computer Science", intake: "Сентябрь 2027" },
    education: { current: "11 класс", english: "IELTS 6.0", chinese: "HSK 3" },
    curatorMembershipId: "d0e07ebe-5fef-43c5-be1d-cba49471c550",
    pipelineStage: "documents",
    money: {
      cost: { amountMinor: 150000, currency: "USD" }, signedOn: "2026-09-01",
      payments: [{ amountMinor: 50000, currency: "USD", paidOn: "2026-09-05" }, { amountMinor: 2000000, currency: "KGS", paidOn: "2026-09-10" }],
    },
    note: "Звонить после 18:00",
  });
  assert.deepEqual(parseAdmissionsDirectPayload(built.payload), built.payload, "the server re-parse accepts the builder output");
});

test("a minimal draft: name and country, no curator, stage new", () => {
  const built = buildAdmissionsDirectPayload(draft({ age: "17" }), "2026-10-16");
  assert.equal(built.ok, true);
  assert.deepEqual(built.payload, {
    student: { name: "Айдай", firstName: "Айдай", age: 17 }, route: { country: "MY" },
    curatorMembershipId: null, pipelineStage: "new",
  });
});

test("validation mirrors the database: required, shapes, money", () => {
  const errors = (overrides) => {
    const built = buildAdmissionsDirectPayload(draft(overrides), "2026-10-16");
    assert.equal(built.ok, false);
    return built;
  };
  assert.ok(errors({ firstName: " " }).errors.firstName);
  assert.ok(errors({ country: "" }).errors.country);
  assert.ok(errors({ phone: "12" }).errors.phone);
  assert.ok(errors({ email: "not-an-email" }).errors.email);
  assert.ok(errors({ birthDate: "2026-10-17" }).errors.birthDate);
  assert.ok(errors({ age: "4" }).errors.age);
  assert.ok(errors({ parentFirstName: "Мама" }).errors.parentRelation, "a parent needs mother or father");
  assert.ok(errors({ stage: "bogus" }).errors.stage);
  assert.ok(errors({ costAmount: "abc" }).errors.costAmount);
  assert.ok(errors({ costAmount: "100", payments: [{ amount: "200", currency: "USD", paidOn: "2026-09-01" }] }).errors.payments,
    "payments above the cost in its currency");
  assert.equal(buildAdmissionsDirectPayload(draft({ costAmount: "100", costCurrency: "USD",
    payments: [{ amount: "200", currency: "KGS", paidOn: "2026-09-01" }] }), "2026-10-16").ok, true,
    "another currency is a separate paid tranche, not an excess");
  assert.deepEqual(errors({ payments: [{ amount: "", currency: "USD", paidOn: "2026-09-01" }, { amount: "1", currency: "USD", paidOn: "2026-10-18" }] })
    .paymentErrors.map(Boolean), [true, true], "each payment row is checked");
  assert.equal(buildAdmissionsDirectPayload(draft({ birthDate: "2008-05-01", age: "abc" }), "2026-10-16").ok, true,
    "the age is ignored when the birth date is given");
});

test("review #1194 (6): a payment is dated today at the latest, as in 281", () => {
  const paidOn = (day) => buildAdmissionsDirectPayload(draft({ payments: [{ amount: "1", currency: "USD", paidOn: day }] }), "2026-10-16");
  assert.equal(paidOn("2026-10-16").ok, true, "today is accepted");
  assert.equal(paidOn("2026-10-17").ok, false, "tomorrow is refused");
  assert.equal(paidOn("2026-10-17").paymentErrors[0], "Укажите дату оплаты, не позже сегодняшнего дня.");
  assert.doesNotMatch(migration, /today \+ 1/u, "the database bound is today as well");
  assert.match(migration, /admissions_direct_date\(payment, 'paidOn', DATE '2000-01-01', today, 'paidOn'\)/u);
  assert.match(drawer, /max=\{bishkekToday\(\)\} onChange=\{\(e\) => setPayment\(index, "paidOn"/u);
});

test("the server re-parse refuses foreign keys and types", () => {
  const base = { student: { name: "Айдай" }, route: { country: "MY" }, curatorMembershipId: null, pipelineStage: "new" };
  assert.deepEqual(parseAdmissionsDirectPayload(base), base);
  assert.equal(parseAdmissionsDirectPayload({ ...base, salesOwner: "x" }), null);
  assert.equal(parseAdmissionsDirectPayload({ ...base, route: { country: "RU" } }), null);
  assert.equal(parseAdmissionsDirectPayload({ ...base, pipelineStage: "bogus" }), null);
  assert.equal(parseAdmissionsDirectPayload({ ...base, curatorMembershipId: "nope" }), null);
  assert.equal(parseAdmissionsDirectPayload({ ...base, money: { cost: { amountMinor: 1.5, currency: "USD" } } }), null);
  assert.equal(parseAdmissionsDirectPayload({ ...base, money: { cost: { amountMinor: 100, currency: "RUB" } } }), null);
  assert.equal(parseAdmissionsDirectPayload({ ...base, money: { payments: [] } }), null);
  assert.equal(parseAdmissionsDirectPayload({ ...base, student: { name: "А", age: 4 } }), null);
});

test("error wording: no codes, no long dashes, every server key maps to a field", () => {
  for (const result of [
    { status: "saved", studentCaseId: "x", state: "active" }, { status: "saved", studentCaseId: "x", state: "pending" },
    { status: "invalid", field: "paymentsExceedCost" }, { status: "invalid", field: "curator" }, { status: "invalid", field: null },
    { status: "forbidden" }, { status: "curator_forbidden" }, { status: "case_exists" }, { status: "lead_exists" },
    { status: "request_conflict" }, { status: "unavailable" },
  ]) {
    const message = admissionsDirectMessage(result);
    assert.ok(message.length > 0);
    assert.doesNotMatch(message, /[–—]|admissions_direct|PT409|42501/u);
  }
  const keys = [...migration.matchAll(/admissions_direct_invalid:([A-Za-z]+)/gu)].map((match) => match[1]);
  for (const key of new Set(keys)) {
    if (["payload", "student", "parent", "route", "education", "money", "reason", "importSource", "externalRef"].includes(key)) continue;
    assert.ok(admissionsDirectServerField(key), `server key ${key} maps to a form field`);
  }
  // Review #1194: the refusals say what to do next.
  assert.equal(admissionsDirectMessage({ status: "curator_forbidden" }),
    "Этого куратора вы назначить не можете. Выберите куратора своего отдела или оставьте «Без куратора».");
  // Delta review #1194 (3): the same words for the Admin and everyone else, without «попросите Admin».
  assert.equal(admissionsDirectMessage({ status: "lead_exists" }),
    "Этот человек уже есть в продажах как открытый лид. Дело появится, когда продажи передадут его в поступление.");
  assert.doesNotMatch(admissionsDirectMessage({ status: "lead_exists" }), /Admin/u);
  assert.match(directSource, /error\.code === "42501" && message === "admissions_direct_curator_forbidden"\) return \{ status: "curator_forbidden" \}/u);
  assert.match(directSource, /error\.code === "PT409" && message === "admissions_direct_lead_exists"\) return \{ status: "lead_exists" \}/u);
  const copy = drawer.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
  assert.doesNotMatch(copy, /[–—]/u, "the drawer copy (outside code comments) has no long dashes");
});

test("migration 281: one permission, two commands, grants and the import guard", () => {
  assert.match(migration, /^BEGIN;/mu);
  assert.match(migration, /COMMIT;\s*$/u);
  assert.match(migration, /'case\.create\.direct'/u);
  assert.match(migration, /current_keys @> ARRAY\['case\.read\.full', 'task\.manage'\]::TEXT\[\]/u,
    "published into the roles that may curate");
  assert.match(migration, /GRANT EXECUTE ON FUNCTION platform\.create_admissions_student_case_v1\(UUID, UUID, JSONB\) TO authenticated;/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION platform\.import_admissions_student_case_v1\(UUID, UUID, TEXT, TEXT, JSONB, TEXT\) TO service_role;/u);
  assert.doesNotMatch(migration, /import_admissions_student_case_v1[^;]*TO authenticated/u);
  assert.match(migration, /REVOKE ALL ON FUNCTION platform_private\.create_admissions_student_case\(UUID, UUID, UUID, JSONB, TEXT, TEXT, TEXT\)\s+FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;/u);
  assert.match(migration, /'admissions-direct:'\|\|canonical_lead_id::TEXT/u, "the new intake origin");
  assert.match(migration, /SET lifecycle_state = 'converted'/u, "the lead is converted, never a sales lead");
  assert.doesNotMatch(migration, /INSERT INTO platform_private\.sales_register|INSERT INTO platform\.sales_admissions_handoffs/u,
    "no sales record and no sales handoff");
  assert.doesNotMatch(migration, /DISABLE\s+(?:ROW LEVEL SECURITY|TRIGGER)|session_replication_role/iu);
  for (const signature of [
    "platform_private.staff_can_take_needs_curator_case(uuid,uuid,uuid)",
    "private.assign_case_curator_v1(uuid,uuid,uuid,uuid,text)",
    "platform_private.admissions_attention_flags(uuid)",
    "platform_private.assign_student_case_curator_authorized_e1(uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)",
    "platform_private.marketing_cohort(uuid,date,date)",
  ]) {
    assert.ok(migration.includes(`('${signature}', '`), `${signature} is md5-anchored`);
  }
});

test("review #1194 (1, 2): canonical identity path, one person one card, canonical анкета values", () => {
  const create = migration.match(/CREATE FUNCTION platform_private\.create_admissions_student_case\(([\s\S]+?)\n\$\$;/u)?.[1] ?? "";
  assert.ok(create.length > 0);
  assert.match(create, /platform_private\.create_or_link_client\(p_organization_id, student_name, email_raw, phone_norm,\s*'evo_admissions', 'client', p_request_id::TEXT, evidence, observed,/u);
  assert.match(create, /platform_private\.create_or_link_lead\(p_organization_id, client_id_value, NULL, 'new',\s*'admissions_direct', 'evo_admissions', 'lead', p_request_id::TEXT, evidence, observed,/u);
  assert.doesNotMatch(create, /INSERT INTO platform\.(?:clients|leads)\b/u, "no identity row is written past the canonical path");
  assert.match(create, /RAISE EXCEPTION 'admissions_direct_lead_exists' USING ERRCODE = 'PT409', DETAIL = open_lead_id::TEXT;/u);
  assert.match(create, /'status', 'lead_exists'/u, "the import reports an open lead");
  assert.match(create, /'status', 'case_exists'/u, "the import reports an open case");
  assert.match(create, /hashtextextended\('manual-lead-contact:' \|\| p_organization_id::TEXT \|\| ':' \|\| lock_value, 0\)/u,
    "the contact locks of create_manual_sales_lead");
  assert.doesNotMatch(create, /'desired_start_date'/u, "the intake text never lands in the date field");
  assert.match(create, /platform_private\.normalize_student_profile_field_value\(field\.key, field\.value\)/u);
});

test("review #1194 (3, 5): Admin-authored waiting cases and the curator options", () => {
  assert.match(migration, /OR \(author\.is_system_admin\s+AND platform_private\.admissions_direct_own_department_scope\(p_organization_id, p_membership_id, k\.key\)\)/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION platform\.admissions_direct_curator_options_v1\(UUID\) TO authenticated;/u);
  assert.match(page, /canAddStudent && assignsCurators \? readAdmissionsDirectCuratorOptions\(actor\) : Promise\.resolve\(null\)/u);
  assert.match(page, /kind: "choose", options: addCurators\.options, withoutCurator: addCurators\.withoutCurator/u);
  assert.match(drawer, /\{curator\.withoutCurator \? <option value="">Без куратора: ждёт назначения<\/option>/u,
    "«Без куратора» only when the actor may leave the case waiting");
  assert.match(directSource, /rpc\("admissions_direct_curator_options_v1"/u);
});

test("the real-Postgres suite is hooked by name after 281", () => {
  assert.match(script, /\*_platform_admissions_direct_student\.sql \]\]; then[\s\S]*?-f \/workspace\/supabase\/tests\/platform_admissions_direct_student\.sql/u);
  assert.match(suite, /N281_ADMISSIONS_DIRECT_STUDENT_SUITE_PASSED/u);
  assert.match(suite, /ROLLBACK;\s*$/u);
});

test("the board offers «Добавить студента» only to permitted roles", () => {
  assert.match(page, /const canAddStudent = !isStaffPreview\(actor\) && staffHasPermission\(actor, "case\.create\.direct"\);/u);
  assert.match(page, /kind: "self", membershipId: actor\.membershipId/u);
  assert.match(drawer, /data-testid="v3-admissions-add-student"/u);
  assert.match(drawer, /router\.push\(admissionsDirectCaseHref\(answer\)\)/u, "success opens the new case");
  assert.equal(admissionsDirectCaseHref({ studentCaseId: "c1", state: "active" }), "/v3/profile?case=c1");
  assert.equal(admissionsDirectCaseHref({ studentCaseId: "c2", state: "pending" }), "/v3/profile?view=needs_curator&open=c2",
    "a case without a curator opens where it gets one");
});

test("bishkekToday is UTC+6", () => {
  assert.equal(bishkekToday(new Date("2026-10-16T18:30:00Z")), "2026-10-17");
  assert.equal(bishkekToday(new Date("2026-10-16T17:59:00Z")), "2026-10-16");
});

// --- Delta review #1194, round 1 ----------------------------------------------

test("delta review #1194 (1): one phone form, E.164, the same rule as admissions_direct_phone in 281", () => {
  for (const [input, expected] of [
    ["+996 777 281 999", "+996777281999"], ["+996-777-28-19-99", "+996777281999"], ["996777281999", "+996777281999"],
    ["996 777 281 999", "+996777281999"], ["0777 281 999", "+996777281999"], ["0777281999", "+996777281999"],
    ["(0777) 28-19-99", "+996777281999"], ["+996 0777 281 999", "+996777281999"], ["00996 777 281 999", "+996777281999"],
    ["+7 701 123 45 67", "+77011234567"], ["007 701 123 45 67", "+77011234567"], ["+60 12-345 6789", "+60123456789"],
    ["777 281 999", null], ["8 701 123 45 67", null], ["77011234567", null], ["+996 777 28 19", null], ["+996 777 281 9999", null],
    ["+0 555 123 456", null], ["+", null], ["12", null], ["+996 777 281 999 доб. 1", null],
  ]) {
    assert.equal(admissionsDirectPhone(input), expected, input);
  }
  const phoneError = (value) => buildAdmissionsDirectPayload(draft({ phone: value }), "2026-10-16");
  assert.equal(phoneError("0777 281 999").ok, true, "the national Kyrgyz form is accepted (the database makes it +996…)");
  assert.equal(phoneError("777 281 999").errors.phone,
    "Телефон с кодом страны, например +996 555 123 456. Номер Кыргызстана можно и так: 0555 123 456.");
  assert.ok(buildAdmissionsDirectPayload(draft({ parentRelation: "father", parentPhone: "8 701 123 45 67" }), "2026-10-16").errors.parentPhone);
  // The database decides with the same rule and matches every spelling another intake may have stored.
  const create = migration.match(/CREATE FUNCTION platform_private\.create_admissions_student_case\(([\s\S]+?)\n\$\$;/u)?.[1] ?? "";
  assert.match(create, /phone_norm := platform_private\.admissions_direct_phone\(phone_raw\);/u);
  assert.match(create, /parent_phone_norm := platform_private\.admissions_direct_phone\(parent_phone\);/u);
  assert.match(create, /phone_keys := platform_private\.admissions_direct_phone_keys\(phone_norm\);/u);
  assert.equal([...create.matchAll(/cl\.normalized_phone = ANY \(phone_keys\)/gu)].length, 3,
    "the open case, the open lead and the duplicate candidate match every spelling");
  assert.match(create, /unnest\(phone_keys \|\| ARRAY\[email_norm\]\)/u, "the contact locks cover every spelling");
  assert.doesNotMatch(create, /cl\.normalized_phone = phone_norm\)/u, "no exact-spelling-only match is left");
  assert.match(create, /\('mobile_phone', phone_norm, 'phone'\)/u, "the анкета gets the E.164 form");
  assert.match(drawer, /name="parentPhone" type="tel"[^>]*\s+placeholder="\+996 555 123 456"/u);
});

test("delta review #1194 (4): the contract date is today at the latest, as in 281; an advance stays valid", () => {
  const signed = (day, payments = []) => buildAdmissionsDirectPayload(draft({ signedOn: day, payments }), "2026-10-16");
  assert.equal(signed("2026-10-16").ok, true, "today is accepted");
  assert.equal(signed("2026-10-17").errors.signedOn, "Укажите дату договора, не позже сегодняшнего дня.");
  assert.equal(signed("2099-01-01").ok, false, "the review's 2099 contract is refused");
  assert.equal(signed("2026-10-10", [{ amount: "100", currency: "USD", paidOn: "2026-10-01" }]).ok, true,
    "a payment before the signing day is an advance");
  assert.match(migration, /signed_on := platform_private\.admissions_direct_date\(money, 'signedOn', DATE '2000-01-01', today, 'signedOn'\);/u);
  assert.match(drawer, /name="signedOn" type="date" max=\{bishkekToday\(\)\}/u);
});

test("delta review #1194 (2): a «Ждут куратора» reader is not offered what the database refuses", () => {
  const html = new Map(JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(new URL("./e2e/case-static-render.cjs", import.meta.url)), "--json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })).map((surface) => [surface.name, surface.html]));
  const page = html.get("assign-only");
  const words = page.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");
  assert.doesNotMatch(page, /data-testid="v3-case-task"/u, "no «Задача по делу»");
  assert.doesNotMatch(words, /Добавить заметку/u, "no note composer");
  assert.match(page, /data-testid="v3-case-tasks-forbidden"[^>]*>Нет доступа к задачам этого дела\.</u);
  assert.match(page, /data-testid="v3-case-help-forbidden"[\s\S]*?Нет доступа к обращениям этого дела\./u);
  assert.match(page, /data-testid="v3-case-feed-forbidden"[^>]*>Нет доступа к журналу этого дела\.</u);
  assert.doesNotMatch(words, /Обновите страницу/u, "no retry advice that cannot help");
  // The same page for a curator with the case keeps both actions.
  assert.match(html.get("curator"), /data-testid="v3-case-task"/u);
  assert.match(html.get("curator").replace(/<[^>]+>/gu, " "), /Добавить заметку/u);
  // The page knows the reader from the 42501 snapshot and does not read what the reader may not see.
  const profileSource = source("src/lib/v3/profile-source.ts");
  const workSource = source("src/lib/v3/case-work-source.ts");
  const profilePage = source("src/app/(v3)/v3/profile/page.tsx");
  assert.match(profileSource, /assignOnly: data\.assignOnly,/u);
  assert.match(workSource, /assignOnly \? FORBIDDEN : options\.overview \? readCaseTasks\(actor, target\) : NOT_READ/u);
  assert.match(workSource, /assignOnly \? FORBIDDEN : options\.overview && options\.feed \? readCaseActivity\(actor, target\) : ACTIVITY_NOT_READ/u);
  assert.match(profilePage, /assignOnly: view\?\.details\.assignOnly === true/u);
  // «История» for that reader: no journal read (it answers this reader with an error), an honest line instead.
  assert.match(profileSource, /activity && caseId && !assignOnly && staffPresentationCan\(actor, "admissions\.read"\)/u);
  assert.match(profileSource, /assignOnly \? Object\.freeze\(\{ \.\.\.core\.profile, timeline: \[\], timelineForbidden: true \}\)/u);
  assert.match(source("src/components/v3/profile/tabs.tsx"),
    /profile\.timelineForbidden \? \(\s*<li[^>]*data-testid="v3-history-forbidden">Нет доступа к журналу этого дела\.<\/li>/u);
});

test("delta review #1194 (5): 281 is still the next free number on main", () => {
  // Re-checked before every push (git ls-tree origin/main supabase/migrations); issue #1195 plans its own
  // migration «281»: whichever lands second takes the next free number (docs/PLAN_CHANGES.md).
  assert.match(source("docs/PLAN_CHANGES.md"), /#1195[\s\S]{0,400}следующий\s+свободный\s+номер/u);
});
