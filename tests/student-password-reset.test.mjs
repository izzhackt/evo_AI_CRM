// Сброс пароля студента администратором (344, 07.11.2026). Сервер, действие и чтение карточки — настоящий код против
// наблюдаемых подделок клиентов. Сторону базы (только админ, студент из привязки дела, повтор, журнал, 10 минут)
// доказывает supabase/tests/platform_student_password_resets.sql.
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import * as contract from "../src/lib/student-account-contract.ts";

const ORG = "10000000-0000-4000-8000-000000000001";
const REQUEST = "10000000-0000-4000-8000-000000000002";
const RESET = "10000000-0000-4000-8000-000000000003";
const USER = "10000000-0000-4000-8000-000000000004";
const CASE = "10000000-0000-4000-8000-000000000005";
const PORTAL = "https://app.example.test";

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

function reset({ authorize = { data: { reset_id: RESET, state: "authorized", auth_user_id: USER }, error: null },
  updateError = null, complete = { data: { reset_id: RESET, state: "completed" }, error: null } } = {}) {
  const calls = [];
  const rpc = (result) => (name, args) => ({ abortSignal: async () => { calls.push(["rpc", name, args]); return result(name); } });
  const admin = { schema: (schema) => { assert.equal(schema, "platform"); return { rpc: rpc(() => authorize) }; } };
  const service = {
    schema: () => ({ rpc: rpc((name) => (name.startsWith("complete_") ? (typeof complete === "function" ? complete() : complete) : { data: null, error: null })) }),
    auth: { admin: {
      async updateUserById(id, attributes) {
        calls.push(["updateUserById", id, attributes]);
        return updateError ? { data: { user: null }, error: updateError } : { data: { user: { id } }, error: null };
      },
    } },
  };
  const subject = compile("src/lib/server/student-password-reset.ts", {
    "../student-account-contract": contract,
    "./platform-supabase-backend-config": { getPlatformSupabaseBackendConfig: () => ({}) },
    "./platform-supabase-service-client": { createPlatformSupabaseServiceClient: () => service },
    "./student-account-provisioning": compile("src/lib/server/student-account-provisioning.ts", {
      "node:crypto": crypto,
      "../student-account-contract": contract,
      "../student-login": compile("src/lib/student-login.ts"),
      "./platform-supabase-backend-config": {},
      "./platform-supabase-service-client": {},
    }),
  });
  return { calls, run: () => subject.resetStudentPassword(admin, ORG, REQUEST, CASE) };
}

test("a reset: the admin's permission, then Auth for the bound student, then the journal; the password stays out of the database", async () => {
  const run = reset();
  const result = await run.run();
  assert.deepEqual(steps(run.calls), ["authorize_student_password_reset_v1", "updateUserById", "complete_student_password_reset_v1"]);
  assert.deepEqual(run.calls[0][2], { p_organization_id: ORG, p_request_id: REQUEST, p_student_case_id: CASE });
  const [, id, attributes] = run.calls[1];
  assert.equal(id, USER, "the Auth user comes from the case binding the database returned");
  assert.match(attributes.password, contract.TEMPORARY_PASSWORD_PATTERN);
  assert.deepEqual(attributes.app_metadata, { [contract.TEMPORARY_PASSWORD_FLAG]: true });
  assert.deepEqual(run.calls[2][2], { p_reset_id: RESET });
  assert.ok(!JSON.stringify(run.calls.filter((call) => call[0] === "rpc")).includes(attributes.password), "the password never reaches the database");
  assert.deepEqual(result, { status: "reset", password: attributes.password });
  const second = reset();
  await second.run();
  assert.notEqual(second.calls[1][2].password, attributes.password, "every reset has its own password");
});

test("refusals before Auth: not an admin, no cabinet, a finished or failed request, a broken answer", async () => {
  for (const [error, status] of [[{ code: "42501" }, "forbidden"], [{ code: "PT409", message: "student_case_no_cabinet" }, "no_cabinet"],
    [{ code: "PT409", message: "other" }, "unavailable"], [{ code: "22023" }, "invalid"], [{ code: "23505" }, "invalid"], [{ code: "" }, "unavailable"]]) {
    const run = reset({ authorize: { data: null, error } });
    assert.deepEqual(await run.run(), { status }, JSON.stringify(error));
    assert.equal(run.calls.length, 1, `${status}: Auth is never touched`);
  }
  for (const [data, status] of [[{ reset_id: RESET, state: "completed", auth_user_id: USER }, "already_reset"],
    [{ reset_id: RESET, state: "failed", auth_user_id: USER }, "unavailable"], [{ reset_id: RESET, state: "authorized", auth_user_id: "x" }, "unavailable"],
    [null, "unavailable"]]) {
    const run = reset({ authorize: { data, error: null } });
    assert.deepEqual(await run.run(), { status }, JSON.stringify(data));
    assert.equal(run.calls.length, 1, `${status}: a finished request never sets a second password`);
  }
});

test("Auth refuses: the permission is closed and nothing is shown", async () => {
  const run = reset({ updateError: { status: 500 } });
  assert.deepEqual(await run.run(), { status: "unavailable" });
  assert.deepEqual(steps(run.calls), ["authorize_student_password_reset_v1", "updateUserById", "fail_student_password_reset_v1"]);
  assert.deepEqual(run.calls[2][2], { p_reset_id: RESET });
});

test("the journal: a lost answer is asked again; no confirmed row shows no password and closes the permission", async () => {
  let asked = 0;
  const recovered = reset({ complete: () => (++asked === 1 ? { data: null, error: { code: "" } } : { data: { reset_id: RESET, state: "completed" }, error: null }) });
  assert.equal((await recovered.run()).status, "reset");
  assert.deepEqual(steps(recovered.calls),
    ["authorize_student_password_reset_v1", "updateUserById", "complete_student_password_reset_v1", "complete_student_password_reset_v1"]);
  for (const [complete, status] of [[{ data: null, error: { code: "" } }, "unavailable"], [{ data: null, error: { code: "55000" } }, "unavailable"],
    [{ data: null, error: { code: "42501" } }, "forbidden"], [{ data: null, error: { code: "PT409", message: "student_case_no_cabinet" } }, "no_cabinet"],
    [{ data: { state: "authorized" }, error: null }, "unavailable"]]) {
    const run = reset({ complete });
    assert.deepEqual(await run.run(), { status }, JSON.stringify(complete));
    assert.equal(steps(run.calls).at(-1), "fail_student_password_reset_v1", `${status}: the permission is closed`);
  }
});

function action({ actor = { organizationId: ORG, systemRole: "admin" }, preview = false, outcome = { status: "reset", password: "abcd-efgh-jkmn" } } = {}) {
  const calls = [];
  const subject = compile("src/lib/student-password-reset-actions.ts", {
    "node:crypto": crypto,
    "./platform-access": { isStaffPreview: () => preview },
    "./platform-guards": { requirePlatformStaffActor: async () => actor },
    "./platform-sales": { parsePlatformSalesUuid: (value) => (typeof value === "string" && /^[0-9a-f-]{36}$/u.test(value) ? value : null) },
    "./server/action-form-fields": compile("src/lib/server/action-form-fields.ts"),
    "./server/student-password-reset": { resetStudentPassword: async (...args) => { calls.push(args.slice(1)); return outcome; } },
    "./supabase/server": { createSupabaseServerClient: async () => ({}) },
  });
  const submit = (fields = {}) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ request_id: REQUEST, student_case_id: CASE, ...fields })) data.set(key, value);
    return subject.resetStudentPasswordAction({ status: "idle", requestId: REQUEST }, data);
  };
  return { calls, submit };
}

test("only an administrator outside role preview resets; the database gets the form's request and case", async () => {
  for (const run of [action({ actor: { organizationId: ORG, systemRole: "staff" } }), action({ preview: true })]) {
    assert.deepEqual(await run.submit(), { status: "forbidden", requestId: REQUEST });
    assert.equal(run.calls.length, 0);
  }
  const bad = action();
  assert.deepEqual(await bad.submit({ student_case_id: "not-a-case" }), { status: "invalid", requestId: REQUEST });
  assert.deepEqual(await bad.submit({ auth_user_id: crypto.randomUUID() }), { status: "invalid", requestId: REQUEST },
    "the form never names the Auth user");
  assert.equal(bad.calls.length, 0);
  const ok = action();
  const done = await ok.submit();
  assert.deepEqual(ok.calls, [[ORG, REQUEST, CASE]]);
  assert.deepEqual({ ...done, requestId: undefined }, { status: "reset", requestId: undefined, password: "abcd-efgh-jkmn" });
  assert.notEqual(done.requestId, REQUEST, "the next reset is a new request");
  for (const outcome of [{ status: "already_reset" }, { status: "no_cabinet" }, { status: "unavailable" }]) {
    const result = await action({ outcome }).submit();
    assert.equal(result.status, outcome.status);
    assert.notEqual(result.requestId, REQUEST, `${outcome.status}: a retry must not reuse the closed request`);
  }
});

test("the card reads the login or a real e-mail; the WhatsApp message names the way in and the new password", async () => {
  const answers = [];
  const source = compile("src/lib/v3/lead-cabinet-source.ts", {
    "../platform-access.ts": { staffPresentationCan: () => true },
    "../supabase/server": { createSupabaseServerClient: async () => ({ schema: () => ({ rpc: async () => answers.shift() }) }) },
    "../student-account-contract": contract,
    "./portal-invite-email": { readCaseClientEmail: async () => null },
  });
  const read = (data) => { answers.push({ data, error: null }); return source.readStudentCaseCabinet({ organizationId: ORG }, CASE); };
  assert.deepEqual(await read({ state: "open", refusal: "student_case_has_cabinet", login: "aidai.chynarova", email: null }),
    { state: "open", refusal: "case_has_cabinet", login: "aidai.chynarova", email: null });
  assert.deepEqual(await read({ state: "open", refusal: null, login: null, email: `student-1@${contract.TECHNICAL_STUDENT_EMAIL_DOMAIN}` }),
    { state: "open", refusal: null, login: null, email: null }, "the placeholder e-mail is never shown");
  assert.equal((await read({ state: "open", refusal: null, login: null, email: "student@example.test" })).email, "student@example.test");
  const byLogin = contract.studentPasswordResetMessage({ login: "aidai.chynarova", email: "student@example.test" }, "abcd-efgh-jkmn", PORTAL);
  for (const part of [`${PORTAL}/login`, "Логин: aidai.chynarova", "abcd-efgh-jkmn"]) assert.ok(byLogin.includes(part), part);
  assert.ok(!byLogin.includes("student@example.test"), "the login wins over the e-mail");
  assert.ok(contract.studentPasswordResetMessage({ login: null, email: "student@example.test" }, "abcd-efgh-jkmn", PORTAL)
    .includes("Почта: student@example.test"));
});

test("the open cabinet in the card: its own reset request, the reset block in the one cabinet place", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  assert.match(read("src/app/(staff)/profile/page.tsx"), /requestId: randomUUID\(\), resetRequestId: randomUUID\(\)/u,
    "the reset never reuses the cabinet form's request");
  assert.match(read("src/components/staff/profile/CaseCabinetAccount.tsx"),
    /if \(view === "open"\) return <CaseCabinetReset studentCaseId=\{studentCaseId\} portalOrigin=\{portalOrigin\} \{\.\.\.reset\} \/>;/u);
  assert.match(read("src/components/staff/profile/CaseCabinetReset.tsx"), /useActionState\(resetStudentPasswordAction,/u);
});

test("the reset form: the only submit sits in the confirmation, its fields are exactly the action's (review 07.11)", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const ui = read("src/components/staff/profile/CaseCabinetReset.tsx");
  const confirm = ui.indexOf('data-testid="case-cabinet-reset-confirm"');
  const submits = [...ui.matchAll(/type="submit"/gu)].map((match) => match.index);
  assert.equal(submits.length, 1, "one submit button");
  assert.ok(confirm > 0 && submits[0] > confirm && submits[0] < ui.indexOf("Отмена", confirm),
    "«Сбросить пароль» only opens the confirmation; the reset is sent from inside it");
  const hidden = [...ui.matchAll(/<input type="hidden" name="([a-z_]+)"/gu)].map((match) => match[1]);
  const action = read("src/lib/student-password-reset-actions.ts").match(/exactActionStringFields\(form, \[([^\]]+)\]\)/u)[1];
  assert.deepEqual(hidden, action.split(",").map((field) => field.trim().replace(/"/gu, "")),
    "the form posts exactly the fields the action accepts");
});

test("e-mail recovery clears the admin's temporary-password flag before the student signs in (review 07.11)", () => {
  const server = readFileSync(new URL("../src/lib/server/student-password-recovery.ts", import.meta.url), "utf8");
  const update = server.indexOf("client.auth.updateUser({ password })");
  const clear = server.indexOf("[TEMPORARY_PASSWORD_FLAG]: false");
  const signIn = server.indexOf("signInWithPassword");
  assert.ok(update > 0 && clear > update && clear < signIn, "the flag goes after the new password and before the sign-in");
  assert.match(server, /if \(hasTemporaryPassword\(identity\.user\.app_metadata\)\) \{/u, "only a flagged account is touched");
});
