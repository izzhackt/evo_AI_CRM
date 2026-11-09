import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import ts from "typescript";

import {
  isPortalLanguage,
  normalizePortalNamePart,
  parsePortalProfile,
  splitPortalDisplayName,
} from "../src/lib/portal/portal-profile.ts";
import * as profileContract from "../src/lib/portal/portal-profile.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const PROFILE = {
  displayName: "Student",
  email: "student@example.invalid",
  portalLanguage: "ru",
  caseState: "pending",
  deletionRequestedAt: null,
};

// PORT-5a: разбор get_own_portal_profile_v1 строгий — дрейф формы с сервера
// не превращается в тихо неполный экран профиля.
test("portal profile payload parses strictly and fails closed on drift", () => {
  assert.deepEqual(parsePortalProfile(PROFILE), PROFILE);
  assert.deepEqual(
    parsePortalProfile({
      ...PROFILE,
      portalLanguage: "ky",
      caseState: null,
      deletionRequestedAt: "2026-09-19T10:00:00+00:00",
    }),
    {
      ...PROFILE,
      portalLanguage: "ky",
      caseState: null,
      deletionRequestedAt: "2026-09-19T10:00:00+00:00",
    },
  );
  for (const broken of [
    null,
    [],
    { ...PROFILE, portalLanguage: "en" },
    { ...PROFILE, displayName: "" },
    { ...PROFILE, email: " " },
    { ...PROFILE, caseState: "archived" },
    { ...PROFILE, deletionRequestedAt: "2026-09-19" },
    { ...PROFILE, extra: 1 },
    Object.fromEntries(Object.entries(PROFILE).filter(([key]) => key !== "deletionRequestedAt")),
  ]) {
    assert.equal(parsePortalProfile(broken), null, JSON.stringify(broken));
  }
});

test("portal language accepts exactly ru and ky", () => {
  assert.ok(isPortalLanguage("ru"));
  assert.ok(isPortalLanguage("ky"));
  for (const wrong of ["en", "RU", "", null, undefined, 1]) {
    assert.equal(isPortalLanguage(wrong), false, String(wrong));
  }
});

// Структурные пины PORT-5a: профиль в Shell-нав обоих tier'ов; язык
// персистится через RPC И cookie в одном server action; удаление — реальный
// запрос со стабильным request_id и честным состоянием; бейдж в карточке
// клиента аддитивен (Pill в CaseHeader, staff-UI не перестраивается).
test("profile screen wiring stays in place", () => {
  const shell = source("src/components/portal/Shell.tsx");
  assert.match(
    shell,
    /\{ href: "\/portal\/profile", key: "nav\.profile", tiers: \["approved", "assisted"\] \}/u,
  );

  const actions = source("src/lib/portal/portal-profile-actions.ts");
  assert.match(actions, /^"use server";/u);
  assert.match(actions, /set_own_portal_language_v1/u);
  assert.match(actions, /store\.set\("locale", language/u, "the SAME action must update the locale cookie");
  // 280: запрос на удаление — отдельное действие для любого вошедшего аккаунта.
  const ownActions = source("src/lib/account-deletion/own-actions.ts");
  assert.match(ownActions, /^"use server";/u);
  assert.match(ownActions, /request_account_deletion_v2/u);

  const page = source("src/app/(portal)/portal/profile/page.tsx");
  assert.match(page, /href="\/portal\/tests"/u);
  assert.match(page, /logoutStudentPortalAction/u);
  assert.match(page, /<AccountDeletionPanel/u);
  assert.match(page, /readOwnAccountDeletion\(\)/u);

  const deletion = source("src/components/account-deletion/AccountDeletionPanel.tsx");
  assert.match(deletion, /useState\(\(\) => crypto\.randomUUID\(\)\)/u, "request_id must be stable per attempt");
  assert.match(deletion, /strings\.confirmQuestion/u, "an irreversible request asks for a second step");

  // Дело студента 26.09: шапка рисует пилюлю, а чтение запроса — в общем чтении дела.
  const header = source("src/components/staff/profile/CaseHeader.tsx");
  assert.match(header, /запросил удаление аккаунта/u);
  assert.match(source("src/lib/v3/case-work-source.ts"), /hasOpenAccountDeletionRequestForCase\(actor, target\.studentCaseId\)/u);
});

// Решения владельца 07.10.2026 заменяют «никаких сроков» плана §7: экран
// называет срок 30 дней и что хранится по закону — в обоих языках, без тире.
test("deletion strings name the 30-day deadline and the kept records", async () => {
  const { PORTAL_DICTIONARIES } = await import("../src/lib/portal/i18n.ts");
  const ru = PORTAL_DICTIONARIES.accountDeletion.ru;
  const ky = PORTAL_DICTIONARIES.accountDeletion.ky;
  assert.match(ru.description, /30 дней/u);
  assert.match(ky.description, /30 күн/u);
  for (const strings of [ru, ky]) {
    assert.match(strings.requested, /\{date\}/u);
    assert.match(strings.due, /\{date\}/u);
    for (const [key, value] of Object.entries(strings)) {
      assert.doesNotMatch(value, /[\u2013\u2014]/u, `${key} must not use en/em dashes`);
    }
  }
  assert.equal(Object.hasOwn(PORTAL_DICTIONARIES.profile.ru, "deleteDescription"), false);
});

// 356 (09.11.2026): «Имя и фамилия» в «Профиле» — студент правит их сам, логин для входа не меняется.
test("a student name part: trimmed, one space inside, 1–60 characters, a letter, no control characters", () => {
  assert.equal(normalizePortalNamePart("  Айдай  "), "Айдай");
  assert.equal(normalizePortalNamePart("Чынарова   кызы"), "Чынарова кызы");
  assert.equal(normalizePortalNamePart("Жумабаев-Тест"), "Жумабаев-Тест");
  for (const bad of ["", "   ", "123", "a".repeat(61), "Ай\u0007дай", null, 7]) {
    assert.equal(normalizePortalNamePart(bad), null, String(bad));
  }
  assert.deepEqual(splitPortalDisplayName("Айдай Чынарова"), { firstName: "Айдай", lastName: "Чынарова" });
  // Кабинет без фамилии создан с заглушкой «Student»: в форме фамилия пустая, студент впишет свою.
  assert.deepEqual(splitPortalDisplayName("Aibala Student"), { firstName: "Aibala", lastName: "" });
  assert.deepEqual(splitPortalDisplayName("Умар"), { firstName: "Умар", lastName: "" });
});

function nameAction(response) {
  const calls = [];
  const output = ts.transpileModule(source("src/lib/portal/portal-profile-actions.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  const deps = {
    "next/cache": { revalidatePath: () => calls.push(["revalidate"]) },
    "next/headers": { cookies: async () => ({ set() {} }) },
    "../platform-admissions": { parsePlatformAdmissionsUuid: (value) => (/^[0-9a-f-]{36}$/u.test(value) ? value : null) },
    "../server/action-form-fields.ts": { exactActionStringFields: (form, names) => new Map(names.map((name) => [name, form.get(name)])) },
    "../student-portal-guards": { requireStudentPortalActor: async () => ({}) },
    "../supabase/server": { createSupabaseServerClient: async () => ({ schema: () => ({ rpc: async (name, args) => {
      calls.push([name, args]);
      return response;
    } }) }) },
    "./portal-profile": profileContract,
  };
  new Function("require", "module", "exports", output)((name) => {
    if (!Object.hasOwn(deps, name)) throw new Error(`Unexpected dependency: ${name}`);
    return deps[name];
  }, loaded, loaded.exports);
  const submit = (first, last, requestId = "11111111-1111-4111-8111-111111111111") => {
    const form = new FormData();
    form.set("first_name", first);
    form.set("last_name", last);
    form.set("request_id", requestId);
    return loaded.exports.setPortalNameAction({ status: "idle" }, form);
  };
  return { calls, submit };
}

test("the name action sends the cleaned name once and trusts only the confirmed answer; the login is not touched", async () => {
  const ok = nameAction({ data: { displayName: "Айдай Чынарова" }, error: null });
  assert.deepEqual(await ok.submit(" Айдай ", "Чынарова"), { status: "done", displayName: "Айдай Чынарова" });
  assert.deepEqual(ok.calls[0], ["set_own_portal_name_v1", {
    p_first_name: "Айдай", p_last_name: "Чынарова", p_request_id: "11111111-1111-4111-8111-111111111111",
  }]);
  const blank = nameAction({ data: null, error: null });
  assert.deepEqual(await blank.submit("Айдай", "  "), { status: "invalid" });
  assert.equal(blank.calls.length, 0, "nothing is sent without a last name");
  assert.deepEqual(await nameAction({ data: null, error: { code: "22023" } }).submit("Айдай", "Ч"), { status: "invalid" });
  assert.deepEqual(await nameAction({ data: null, error: { code: "42501" } }).submit("Айдай", "Ч"), { status: "unavailable" });
  assert.deepEqual(await nameAction({ data: { displayName: "Другое Имя" }, error: null }).submit("Айдай", "Ч"), { status: "unavailable" });
  // Логин для входа не меняется: ни действие, ни команда базы не трогают таблицу логинов.
  assert.doesNotMatch(source("src/lib/portal/portal-profile-actions.ts"), /student_login|claim_student_login/u);
  const sql = source("supabase/migrations/356_platform_student_own_name.sql");
  assert.doesNotMatch(sql.replace(/--.*$/gmu, ""), /student_logins/u);
  assert.match(sql, /'student\.name\.change', 'student_case', own_case_id, '\{\}'::JSONB/u, "the journal keeps no name");
  assert.match(sql, /GRANT EXECUTE ON FUNCTION platform\.set_own_portal_name_v1\(TEXT, TEXT, UUID\) TO authenticated;/u);
  // Имя правится прямо в «Моих данных» (#1360): та же строка, что была только для чтения.
  const page = source("src/app/(portal)/portal/profile/page.tsx");
  assert.match(page, /<dt>\{strings\.nameLabel\}<\/dt>\s*<dd><NameChangeForm displayName=\{profile\.displayName\} strings=\{strings\} \/><\/dd>/u);
  assert.doesNotMatch(page, /portal-profile-name/u, "no second card for the name");
});

// #1360 (09.11.2026): «Мои данные» в профиле. Телефон в кабинете не правится: RPC для этого нет, поэтому страница
// честно говорит, кто его меняет; пароль меняется формой кабинета, «Выйти» есть и в меню телефона.
test("my data block shows name, email and login read-only; phone is not invented; logout is in the phone menu", async () => {
  const { PORTAL_DICTIONARIES } = await import("../src/lib/portal/i18n.ts");
  const page = source("src/app/(portal)/portal/profile/page.tsx");
  assert.match(page, /<h2 id="portal-profile-mydata" className="pt-section-title">/u);
  // 356: имя студент правит сам — строка «Имя» несёт форму смены имени (логин не меняется).
  assert.match(page, /<dd><NameChangeForm displayName=\{profile\.displayName\} strings=\{strings\} \/><\/dd>/u);
  assert.match(page, /<dd translate="no">\{profile\.email\}<\/dd>/u);
  assert.match(page, /<dd translate="no">\{ownLogin\}<\/dd>/u);
  assert.doesNotMatch(page, /<input|type="tel"|set_own_.*phone|update_.*phone/iu, "no phone edit without a server write path");
  assert.match(page, /<PasswordChangeForm strings=\{strings\} \/>/u);
  assert.match(source("src/lib/student-password-change-actions.ts"), /changeStudentPassword/u);
  assert.match(source("src/components/portal/Shell.tsx"), /<form action=\{logoutStudentPortalAction\} className="pt-nav-logout">/u);
  for (const locale of ["ru", "ky"]) {
    for (const key of ["dataHeading", "nameLabel", "emailLabel", "dataNote", "dataNoteApproved", "dataWrite"]) {
      assert.ok(PORTAL_DICTIONARIES.profile[locale][key], `${locale} ${key}`);
    }
  }
});
