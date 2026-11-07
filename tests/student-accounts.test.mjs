// Кабинеты студентов от администратора (342, 07.11.2026). Чистые правила — напрямую; создание кабинета, действие
// администратора и «Придумайте свой пароль» — настоящий код против наблюдаемых подделок клиентов. Сторону базы
// (только админ, повтор, логин, журнал, час на завершение) доказывает supabase/tests/platform_student_accounts.sql.
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import * as contract from "../src/lib/student-account-contract.ts";
import * as recovery from "../src/lib/student-password-recovery-contract.ts";

const ORG = "10000000-0000-4000-8000-000000000001";
const REQUEST = "10000000-0000-4000-8000-000000000002";
const PERMISSION = "10000000-0000-4000-8000-000000000003";
const USER = "10000000-0000-4000-8000-000000000004";
const PORTAL = "https://app.example.test";
const NAME = { firstName: "Айдай", lastName: "Чынарова" };
const STRONG = "a-long-enough-password";

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

const steps = (calls) => calls.map((call) => (call[0] === "rpc" ? call[1] : call[0]));

test("the form: name and surname are required and tidied, the email is optional", () => {
  assert.deepEqual(contract.parseStudentAccountInput("  Айдай ", " Чынарова  ", ""), { ...NAME, email: null });
  assert.deepEqual(contract.parseStudentAccountInput("Анна  Мария", "Ли", " Student@Example.TEST "),
    { firstName: "Анна Мария", lastName: "Ли", email: "student@example.test" });
  for (const input of [["", "Ли", ""], ["Анна", " ", ""], ["x".repeat(61), "Ли", ""], ["<b>", "Ли", ""], ["Анна\u0007", "Ли", ""],
    ["Анна", "Ли", "not-an-email"]]) {
    assert.equal(contract.parseStudentAccountInput(...input), null, JSON.stringify(input));
  }
});

test("the temporary-password flag, the placeholder email and the admin's name prefill", () => {
  assert.equal(contract.hasTemporaryPassword({ [contract.TEMPORARY_PASSWORD_FLAG]: true }), true);
  for (const value of [{ [contract.TEMPORARY_PASSWORD_FLAG]: false }, { [contract.TEMPORARY_PASSWORD_FLAG]: "true" }, {}, null, "x"]) {
    assert.equal(contract.hasTemporaryPassword(value), false, JSON.stringify(value));
  }
  assert.equal(contract.isTechnicalStudentEmail(`Student-1@${contract.TECHNICAL_STUDENT_EMAIL_DOMAIN.toUpperCase()}`), true);
  for (const value of ["student@example.test", `x@evil-${contract.TECHNICAL_STUDENT_EMAIL_DOMAIN}`, null, undefined]) {
    assert.equal(contract.isTechnicalStudentEmail(value), false, String(value));
  }
  const key = contract.ACCOUNT_NAME_PREFILL_KEY;
  assert.deepEqual(contract.accountNamePrefill({ [key]: { firstName: " Айдай ", lastName: "Чынарова" } }), NAME);
  for (const value of [{}, null, { [key]: { firstName: "Айдай" } }, { [key]: { firstName: "<x>", lastName: "Ли" } }]) {
    assert.equal(contract.accountNamePrefill(value), null, JSON.stringify(value));
  }
});

test("the WhatsApp message and the mailing table carry the login and the temporary password", () => {
  const account = { ...NAME, login: "aidai.chynarova", password: "abcd-efgh-jkmn" };
  const message = contract.studentAccountMessage(account, PORTAL);
  for (const part of [`${PORTAL}/login`, "aidai.chynarova", "abcd-efgh-jkmn"]) assert.ok(message.includes(part), part);
  const csv = contract.studentAccountsCsv([account, { ...account, lastName: 'Ли "Младшая"', login: "aidai.chynarova2" }], PORTAL);
  assert.ok(csv.startsWith("﻿"), "BOM: Excel opens Cyrillic as is");
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines.length, 4, "header, two rows, final line break");
  assert.equal(lines[0], '"Фамилия";"Имя";"Логин";"Временный пароль";"Сообщение для WhatsApp"');
  assert.ok(lines[2].startsWith('"Ли ""Младшая""";"Айдай";"aidai.chynarova2";"abcd-efgh-jkmn";'), lines[2]);
});

function provisioning({ authorize = { data: { provisioning_id: PERMISSION, state: "authorized", login: null }, error: null },
  createError = null, complete = { data: { provisioning_id: PERMISSION, login: "aidai.chynarova" }, error: null } } = {}) {
  const calls = [];
  const rpc = (result) => (name, args) => ({ abortSignal: async () => { calls.push(["rpc", name, args]); return result(name); } });
  const admin = { schema: (schema) => { assert.equal(schema, "platform"); return { rpc: rpc(() => authorize) }; } };
  const service = {
    schema: () => ({ rpc: rpc((name) => (name === "complete_student_account_v1" ? complete : { data: null, error: null })) }),
    auth: { admin: {
      async createUser(input) {
        calls.push(["createUser", input]);
        return createError ? { data: { user: null }, error: createError } : { data: { user: { id: USER } }, error: null };
      },
      async deleteUser(id) { calls.push(["deleteUser", id]); return { data: {}, error: null }; },
    } },
  };
  const subject = compile("src/lib/server/student-account-provisioning.ts", {
    "node:crypto": crypto,
    "../student-account-contract": contract,
    "../student-login": compile("src/lib/student-login.ts"),
    "./platform-supabase-backend-config": { getPlatformSupabaseBackendConfig: () => ({}) },
    "./platform-supabase-service-client": { createPlatformSupabaseServiceClient: () => service },
  });
  return { calls, run: (input = { ...NAME, email: null }) => subject.provisionStudentAccount(admin, ORG, REQUEST, input) };
}

test("a created account: the admin's permission, then Auth with the flag, then the login and the journal", async () => {
  const run = provisioning();
  const result = await run.run();
  assert.deepEqual(steps(run.calls), ["authorize_student_account_v1", "createUser", "complete_student_account_v1"]);
  assert.deepEqual(run.calls[0][2], { p_organization_id: ORG, p_request_id: REQUEST });
  const user = run.calls[1][1];
  assert.ok(user.email.startsWith("student-") && contract.isTechnicalStudentEmail(user.email), user.email);
  assert.equal(user.email_confirm, true);
  assert.deepEqual(user.app_metadata, { [contract.TEMPORARY_PASSWORD_FLAG]: true });
  assert.deepEqual(user.user_metadata, { [contract.ACCOUNT_NAME_PREFILL_KEY]: NAME });
  assert.match(user.password, contract.TEMPORARY_PASSWORD_PATTERN);
  assert.deepEqual(run.calls[2][2], { p_provisioning_id: PERMISSION, p_auth_user_id: USER, p_login_base: "aidai.chynarova" });
  assert.ok(!JSON.stringify(run.calls.filter((call) => call[0] === "rpc")).includes(user.password), "the password never reaches the database");
  assert.deepEqual(result, { status: "created", account: { ...NAME, login: "aidai.chynarova", password: user.password } });
  const second = provisioning();
  await second.run({ ...NAME, email: "student@example.test" });
  assert.equal(second.calls[1][1].email, "student@example.test");
  assert.notEqual(second.calls[1][1].password, user.password);
});

test("refusals: not an admin, a replay of a finished request, a taken email, a failed completion", async () => {
  assert.deepEqual(await provisioning({ authorize: { data: null, error: { code: "42501" } } }).run(), { status: "forbidden" });
  const replay = provisioning({ authorize: { data: { provisioning_id: PERMISSION, state: "completed", login: "aidai.chynarova" }, error: null } });
  assert.deepEqual(await replay.run(), { status: "already_created", login: "aidai.chynarova" });
  const failed = provisioning({ authorize: { data: { provisioning_id: PERMISSION, state: "failed", login: null }, error: null } });
  assert.deepEqual(await failed.run(), { status: "unavailable" });
  assert.deepEqual([replay.calls.length, failed.calls.length], [1, 1], "a finished request never makes a second account");
  const taken = provisioning({ createError: { code: "email_exists" } });
  assert.deepEqual(await taken.run({ ...NAME, email: "student@example.test" }), { status: "email_taken" });
  assert.deepEqual(steps(taken.calls), ["authorize_student_account_v1", "createUser", "fail_student_account_v1"]);
  const broken = provisioning({ complete: { data: null, error: { code: "55000" } } });
  assert.deepEqual(await broken.run(), { status: "unavailable" });
  assert.deepEqual(steps(broken.calls),
    ["authorize_student_account_v1", "createUser", "complete_student_account_v1", "deleteUser", "fail_student_account_v1"]);
  assert.equal(broken.calls[3][1], USER, "the account without a login is removed again");
});

function action({ actor = { organizationId: ORG, systemRole: "admin" }, preview = false,
  outcome = { status: "created", account: { ...NAME, login: "aidai.chynarova", password: "abcd-efgh-jkmn" } } } = {}) {
  const calls = [];
  const subject = compile("src/lib/student-account-actions.ts", {
    "node:crypto": crypto,
    "./platform-access": { isStaffPreview: () => preview },
    "./platform-guards": { requirePlatformStaffActor: async () => actor },
    "./platform-sales": { parsePlatformSalesUuid: (value) => (typeof value === "string" && /^[0-9a-f-]{36}$/u.test(value) ? value : null) },
    "./server/action-form-fields": compile("src/lib/server/action-form-fields.ts"),
    "./server/student-account-provisioning": { provisionStudentAccount: async (...args) => { calls.push(args.slice(1)); return outcome; } },
    "./student-account-contract": contract,
    "./supabase/server": { createSupabaseServerClient: async () => ({}) },
  });
  const form = (fields) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ request_id: REQUEST, first_name: "Айдай", last_name: "Чынарова", email: "", ...fields })) data.set(key, value);
    return data;
  };
  return { calls, submit: (fields = {}) => subject.createStudentAccountAction({ status: "idle", requestId: REQUEST }, form(fields)) };
}

test("only an administrator outside role preview creates; the database gets the form's request", async () => {
  for (const run of [action({ actor: { organizationId: ORG, systemRole: "staff" } }), action({ preview: true })]) {
    assert.deepEqual(await run.submit(), { status: "forbidden", requestId: REQUEST });
    assert.equal(run.calls.length, 0);
  }
  const bad = action();
  assert.deepEqual(await bad.submit({ last_name: "" }), { status: "invalid", requestId: REQUEST });
  assert.equal(bad.calls.length, 0);
  const ok = action();
  const created = await ok.submit({ email: "Student@Example.test" });
  assert.deepEqual(ok.calls, [[ORG, REQUEST, { ...NAME, email: "student@example.test" }]]);
  assert.equal(created.status, "created");
  assert.notEqual(created.requestId, REQUEST, "the next account is a new request");
});

test("after any answer of the database the next attempt is a new request; a lost answer gives the login", async () => {
  for (const outcome of [{ status: "email_taken" }, { status: "unavailable" }, { status: "invalid" }]) {
    const result = await action({ outcome }).submit();
    assert.equal(result.status, outcome.status);
    assert.notEqual(result.requestId, REQUEST, `${outcome.status}: a refused request is closed, a retry must not reuse it`);
  }
  const replay = await action({ outcome: { status: "already_created", login: "aidai.chynarova" } }).submit();
  assert.deepEqual({ ...replay, requestId: undefined }, { status: "already_created", requestId: undefined, login: "aidai.chynarova" });
});

function newPassword({ flagged = true, updateError = null, origin = true, signInError = null } = {}) {
  const calls = [];
  const email = `student-1@${contract.TECHNICAL_STUDENT_EMAIL_DOMAIN}`;
  const user = { id: USER, email, app_metadata: { provider: "email", [contract.TEMPORARY_PASSWORD_FLAG]: flagged } };
  const subject = compile("src/lib/student-new-password-actions.ts", {
    "next/headers": { headers: async () => new Headers() },
    "next/navigation": { redirect: (path) => { throw Object.assign(new Error("redirect"), { path }); } },
    "./server/action-form-fields.ts": compile("src/lib/server/action-form-fields.ts"),
    "./server/platform-supabase-backend-config": { getPlatformSupabaseBackendConfig: () => ({}) },
    "./server/platform-supabase-service-client": { createPlatformSupabaseServiceClient: () => ({ auth: { admin: {
      async updateUserById(id, attributes) { calls.push(["update", id, attributes]); return { data: {}, error: updateError }; },
    } } }) },
    "./student-account-contract": contract,
    "./student-invite-callback-contract.ts": { isExpectedStudentOriginRequest: () => origin },
    "./student-password-recovery-contract.ts": recovery,
    "./supabase/server": { createSupabaseServerClient: async () => ({ auth: {
      getUser: async () => ({ data: { user }, error: null }),
      async signInWithPassword(credentials) {
        calls.push(["signIn", credentials]);
        return signInError ? { data: { user: null }, error: signInError } : { data: { user: { id: USER } }, error: null };
      },
    } }) },
  });
  const submit = async (password, confirmation = password) => {
    const data = new FormData();
    data.set("password", password);
    data.set("password_confirm", confirmation);
    try {
      return await subject.setOwnStudentPasswordAction({ status: "idle" }, data);
    } catch (error) {
      if (typeof error?.path === "string") return { redirect: error.path };
      throw error;
    }
  };
  return { calls, submit };
}

test("«Придумайте свой пароль»: the password and the cleared flag in one server call, then a fresh session", async () => {
  const run = newPassword();
  assert.deepEqual(await run.submit(STRONG), { redirect: "/apply" });
  assert.deepEqual(run.calls, [
    ["update", USER, { password: STRONG, app_metadata: { provider: "email", [contract.TEMPORARY_PASSWORD_FLAG]: false } }],
    ["signIn", { email: `student-1@${contract.TECHNICAL_STUDENT_EMAIL_DOMAIN}`, password: STRONG }],
  ]);
  // The change closes the student's sessions (07.11, browser): without a new session /apply would see a guest.
  assert.deepEqual(await newPassword({ signInError: { status: 400 } }).submit(STRONG), { redirect: "/login" });
  const weak = newPassword();
  assert.deepEqual(await weak.submit("short"), { status: "too_short" });
  assert.deepEqual(await weak.submit(STRONG, `${STRONG}x`), { status: "mismatch" });
  assert.equal(weak.calls.length, 0);
  const done = newPassword({ flagged: false });
  assert.deepEqual(await done.submit(STRONG), { redirect: "/apply" });
  assert.equal(done.calls.length, 0, "without the flag nothing changes");
  assert.deepEqual(await newPassword({ origin: false }).submit(STRONG), { status: "unavailable" });
  assert.deepEqual(await newPassword({ updateError: { status: 422 } }).submit(STRONG), { status: "rejected" });
});

test("every student entrance sends a flagged account to «Придумайте свой пароль» first", () => {
  for (const path of ["src/app/(portal)/layout.tsx", "src/app/apply/page.tsx", "src/app/apply/status/page.tsx", "src/lib/staff-auth-actions.ts"]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.ok(source.includes("hasTemporaryPassword(") && source.includes("NEW_PASSWORD_PATH"), path);
  }
  assert.equal(contract.NEW_PASSWORD_PATH, "/auth/new-password");
  assert.ok(readFileSync(new URL("../src/lib/platform-route-contract.ts", import.meta.url), "utf8").includes('"/auth/new-password"'));
});
