import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isConnectedStudentPortalApi, isPublicStudentRegistrationApi } from "../src/lib/platform-route-contract.ts";
import { createStudentPortalCaseFileDownloadHandler } from "../src/lib/server/platform-case-agreement-storage-route-handlers.ts";
import {
  createStudentPortalMobilePasswordHandler,
  createStudentPortalMobileSessionHandler,
} from "../src/lib/server/student-portal-mobile-route-handlers.ts";
import { createRecoveryRateLimiter } from "../src/lib/student-password-recovery-rate-limit.ts";

// Мобильное приложение (Expo), серверные шаги S3-S5. Все данные выдуманы; Supabase не вызывается: проверяются границы
// обработчиков и вызовы общих функций. Живая цепочка Auth/БД здесь не проверяется.

const TOKEN = ["synthetichead", "syntheticbody", "syntheticpart"].join(".");
const USER = "3f6a1e9c-2b3d-4c5e-8f90-123456789abc";
const GOOD_PASSWORD = "a-long-test-passphrase";
const SESSION = { access_token: TOKEN, refresh_token: "refresh-synthetic", expires_at: 1900000000, expires_in: 3600, token_type: "bearer" };

function post(path, body, headers = {}) {
  return new Request(`https://app.evoadmissions.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// --- S3 ---

function sessionHarness(over = {}) {
  const calls = { resolve: [], signIn: [], revoke: [], sleeps: [] };
  let clock = 0;
  const handler = createStudentPortalMobileSessionHandler({
    async resolveLoginEmail(login) { calls.resolve.push(login); return login === "aidai.chynarova" ? { status: "found", email: "aidai@example.test" } : { status: "missing" }; },
    async signIn(email, password) { calls.signIn.push([email, password]); return password === GOOD_PASSWORD ? { status: "ok", session: SESSION } : { status: "invalid_credentials" }; },
    async classifyAccount() { return { status: "ok", staff: false, claims: { app_metadata: {} } }; },
    async revokeSession(token) { calls.revoke.push(token); return true; },
    limiter: createRecoveryRateLimiter(),
    minFailureMs: 1000,
    sleep: async (ms) => { calls.sleeps.push(ms); clock += ms; },
    now: () => clock,
    ...over,
  });
  return { handler, calls };
}
const login = (body, headers) => post("/api/portal/mobile/session", body, headers);

test("session: an email login returns the five token fields and sets no cookie", async () => {
  const { handler, calls } = sessionHarness();
  const response = await handler(login({ login: " Student@Example.test ", password: GOOD_PASSWORD }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), SESSION);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls.resolve, [], "an email never goes through the login lookup");
  assert.deepEqual(calls.signIn, [["Student@Example.test", GOOD_PASSWORD]]);
});

test("session: the имя.фамилия login is resolved by the shared server lookup", async () => {
  const { handler, calls } = sessionHarness();
  const response = await handler(login({ login: "aidai.chynarova", password: GOOD_PASSWORD }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.resolve, ["aidai.chynarova"]);
  assert.deepEqual(calls.signIn, [["aidai@example.test", GOOD_PASSWORD]]);
});

test("session: wrong password and unknown login answer identically and not before the fixed minimum", async () => {
  const wrong = sessionHarness();
  const unknown = sessionHarness();
  const a = await wrong.handler(login({ login: "aidai.chynarova", password: "nope" }));
  const b = await unknown.handler(login({ login: "nobody.nowhere", password: "nope" }));
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.deepEqual(await a.json(), { error: "invalid_credentials" });
  assert.deepEqual(await b.json(), { error: "invalid_credentials" });
  assert.deepEqual(wrong.calls.sleeps, [1000]);
  assert.deepEqual(unknown.calls.sleeps, [1000]);
  assert.deepEqual(unknown.calls.signIn, [], "an unknown login never reaches Auth");
});

test("session: a staff account is refused with 403 and its new session is revoked", async () => {
  const { handler, calls } = sessionHarness({ async classifyAccount() { return { status: "ok", staff: true, claims: { app_metadata: {} } }; } });
  const response = await handler(login({ login: "aidai.chynarova", password: GOOD_PASSWORD }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "staff_account" });
  assert.deepEqual(calls.revoke, [TOKEN]);
});

test("session: an unreadable account state revokes the session and answers 503", async () => {
  const { handler, calls } = sessionHarness({ async classifyAccount() { return { status: "unavailable" }; } });
  const response = await handler(login({ login: "aidai.chynarova", password: GOOD_PASSWORD }));
  assert.equal(response.status, 503);
  assert.deepEqual(calls.revoke, [TOKEN]);
});

test("session: the temporary-password flag adds must_set_password and keeps the tokens", async () => {
  const { handler } = sessionHarness({ async classifyAccount() { return { status: "ok", staff: false, claims: { app_metadata: { evo_temporary_password: true } } }; } });
  const body = await (await handler(login({ login: "aidai.chynarova", password: GOOD_PASSWORD }))).json();
  assert.deepEqual(body, { ...SESSION, must_set_password: true });
});

test("session: unknown keys, wrong types, oversize and non-JSON bodies are invalid_request", async () => {
  const { handler, calls } = sessionHarness();
  for (const body of [
    { login: "a.b", password: GOOD_PASSWORD, extra: 1 }, { login: "a.b" }, { password: "x" }, { login: 5, password: "x" },
    { login: "", password: "x" }, { login: "a.b", password: "" }, { login: "a".repeat(321), password: "x" },
    { login: "a.b", password: "x".repeat(4097) }, [], "null", "{broken",
  ]) {
    const response = await handler(login(body));
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 40));
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  const wrongType = await handler(new Request("https://app.evoadmissions.com/api/portal/mobile/session", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }));
  assert.equal(wrongType.status, 400);
  assert.deepEqual(calls.signIn, []);
});

test("session: the per-login and per-IP limits answer 429 before any sign-in", async () => {
  const perLogin = sessionHarness();
  for (let i = 0; i < 10; i += 1) await perLogin.handler(login({ login: "aidai.chynarova", password: "nope" }, { "x-forwarded-for": `198.51.100.${i + 1}` }));
  const blocked = await perLogin.handler(login({ login: "AIDAI.chynarova", password: GOOD_PASSWORD }, { "x-forwarded-for": "198.51.100.200" }));
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), { error: "rate_limited" });
  assert.equal(perLogin.calls.signIn.length, 10);

  const perIp = sessionHarness();
  for (let i = 0; i < 30; i += 1) await perIp.handler(login({ login: `user${i}.test`, password: "nope" }, { "x-forwarded-for": "203.0.113.9" }));
  const ipBlocked = await perIp.handler(login({ login: "fresh.login", password: GOOD_PASSWORD }, { "x-forwarded-for": "203.0.113.9" }));
  assert.equal(ipBlocked.status, 429);
});

test("session: an Auth rate limit or outage is mapped, not leaked", async () => {
  const limited = sessionHarness({ async signIn() { return { status: "rate_limited" }; } });
  assert.equal((await limited.handler(login({ login: "aidai.chynarova", password: "x" }))).status, 429);
  const down = sessionHarness({ async signIn() { return { status: "unavailable" }; } });
  assert.equal((await down.handler(login({ login: "aidai.chynarova", password: "x" }))).status, 503);
  const lookupDown = sessionHarness({ async resolveLoginEmail() { return { status: "unavailable" }; } });
  assert.equal((await lookupDown.handler(login({ login: "aidai.chynarova", password: "x" }))).status, 503);
});

// --- S4 ---

function passwordHarness(over = {}) {
  const calls = { authorize: [], verify: [], set: [], revoke: [] };
  const handler = createStudentPortalMobilePasswordHandler({
    async authorize(token) { calls.authorize.push(token); return { status: "ok", userId: USER, email: "aidai@example.test", staff: false }; },
    async readTemporaryFlag() { return { status: "ok", temporary: false, appMetadata: { provider: "email" } }; },
    async verifyCurrentPassword(...args) { calls.verify.push(args); return args[2] === "old-password-value" ? "ok" : "wrong"; },
    async setPassword(...args) { calls.set.push(args); return "ok"; },
    async revokeOtherSessions(token) { calls.revoke.push(token); return true; },
    limiter: createRecoveryRateLimiter(),
    ...over,
  });
  return { handler, calls };
}
const change = (body, headers = { authorization: `Bearer ${TOKEN}` }) => post("/api/portal/mobile/password", body, headers);

test("password: a missing or malformed Bearer is 401 and never consults cookies", async () => {
  const { handler, calls } = passwordHarness();
  for (const headers of [{}, { authorization: "Basic abc" }, { authorization: "Bearer not-a-jwt" }]) {
    const response = await handler(change({ password: GOOD_PASSWORD }, headers));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "unauthorized" });
  }
  assert.deepEqual(calls.authorize, []);
  const rejected = passwordHarness({ async authorize() { return { status: "unauthorized" }; } });
  assert.equal((await rejected.handler(change({ password: GOOD_PASSWORD }))).status, 401);
});

test("password: staff accounts are refused", async () => {
  const { handler, calls } = passwordHarness({ async authorize() { return { status: "ok", userId: USER, email: "s@example.test", staff: true }; } });
  const response = await handler(change({ password: GOOD_PASSWORD, current_password: "old-password-value" }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "staff_account" });
  assert.deepEqual(calls.set, []);
});

test("password: a change verifies the current password, sets the new one and revokes the other sessions", async () => {
  const { handler, calls } = passwordHarness();
  const response = await handler(change({ password: GOOD_PASSWORD, current_password: "old-password-value" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(calls.verify, [[USER, "aidai@example.test", "old-password-value"]]);
  assert.deepEqual(calls.set, [[USER, GOOD_PASSWORD, null]], "the flag metadata is touched only for a temporary password");
  assert.deepEqual(calls.revoke, [TOKEN]);
});

test("password: a wrong current password is 403 and nothing changes", async () => {
  const { handler, calls } = passwordHarness();
  const response = await handler(change({ password: GOOD_PASSWORD, current_password: "guess-guess-guess" }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "invalid_current_password" });
  assert.deepEqual(calls.set, []);
  assert.deepEqual(calls.revoke, []);
});

test("password: a missing current password is invalid_request outside the temporary flow", async () => {
  const { handler, calls } = passwordHarness();
  const response = await handler(change({ password: GOOD_PASSWORD }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_request" });
  assert.deepEqual(calls.verify, []);
});

test("password: the temporary flow needs no current password, clears the flag in the same update and revokes the others", async () => {
  const meta = { provider: "email", evo_temporary_password: true };
  const { handler, calls } = passwordHarness({ async readTemporaryFlag() { return { status: "ok", temporary: true, appMetadata: meta }; } });
  const response = await handler(change({ password: GOOD_PASSWORD }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.verify, []);
  assert.deepEqual(calls.set, [[USER, GOOD_PASSWORD, meta]]);
  assert.deepEqual(calls.revoke, [TOKEN]);
});

test("password: the web policy applies (12+ characters, at most 72 bytes) and unknown keys are rejected", async () => {
  const { handler, calls } = passwordHarness();
  for (const password of ["short", "x".repeat(73), "я".repeat(37)]) {
    const response = await handler(change({ password, current_password: "old-password-value" }));
    assert.equal(response.status, 400, password.length.toString());
    assert.deepEqual(await response.json(), { error: "weak_password" });
  }
  for (const body of [{ password: GOOD_PASSWORD, current_password: "old-password-value", x: 1 }, { current_password: "x" }, { password: 5 }]) {
    assert.equal((await handler(change(body))).status, 400);
  }
  assert.deepEqual(calls.set, []);
});

test("password: an Auth-side rejection is weak_password; a failed revoke is 503 after the change", async () => {
  const rejected = passwordHarness({ async setPassword() { return "rejected"; } });
  const a = await rejected.handler(change({ password: GOOD_PASSWORD, current_password: "old-password-value" }));
  assert.equal(a.status, 400);
  assert.deepEqual(await a.json(), { error: "weak_password" });
  const revokeFails = passwordHarness({ async revokeOtherSessions() { return false; } });
  assert.equal((await revokeFails.handler(change({ password: GOOD_PASSWORD, current_password: "old-password-value" }))).status, 503);
});

test("password: attempts to guess the current password are rate limited per student", async () => {
  const { handler, calls } = passwordHarness();
  for (let i = 0; i < 5; i += 1) await handler(change({ password: GOOD_PASSWORD, current_password: `wrong-guess-${i}` }));
  const blocked = await handler(change({ password: GOOD_PASSWORD, current_password: "old-password-value" }));
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), { error: "rate_limited" });
  assert.equal(calls.verify.length, 5);
});

// --- S5 ---

const FILE_ID = "35200000-0000-4000-8000-000000000921";
function caseFileHarness({ actor = { status: "authenticated" }, rpc } = {}) {
  const calls = { actor: [], client: [], rpc: [], sign: [] };
  const handler = createStudentPortalCaseFileDownloadHandler({
    async resolveBearerActor(token) { calls.actor.push(token); return actor; },
    async createBearerClient(token) {
      calls.client.push(token);
      return { schema: () => ({ rpc: async (name, args) => { calls.rpc.push([name, args]); return rpc ?? { data: { file_id: FILE_ID, file_kind: args.p_file_kind, storage_object_name: "cases/synthetic/object" }, error: null }; } }) };
    },
    createServiceClient: () => ({ storage: { from: () => ({ createSignedUrl: async (name, seconds, options) => { calls.sign.push([name, seconds, options]); return { data: { signedUrl: "https://storage.example.test/signed?token=synthetic" }, error: null }; } }) } }),
  });
  const get = (kind = "contract", headers = { authorization: `Bearer ${TOKEN}` }) => handler(
    new Request(`https://app.evoadmissions.com/api/portal/case-files/${kind}/${FILE_ID}/download`, { headers }),
    { params: Promise.resolve({ fileKind: kind, fileId: FILE_ID }) },
  );
  return { get, calls };
}

test("case file: a Bearer student gets the 60 s signed-URL redirect after the target RPC", async () => {
  for (const kind of ["contract", "receipt", "pending_receipt"]) {
    const { get, calls } = caseFileHarness();
    const response = await get(kind);
    assert.equal(response.status, 307, kind);
    assert.equal(response.headers.get("location"), "https://storage.example.test/signed?token=synthetic");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(calls.actor, [TOKEN]);
    assert.deepEqual(calls.client, [TOKEN]);
    assert.deepEqual(calls.rpc, [["student_portal_case_file_target_v1", { p_file_kind: kind, p_file_id: FILE_ID }]]);
    assert.deepEqual(calls.sign, [["cases/synthetic/object", 60, { download: true }]]);
  }
});

test("case file: a rejected Bearer fails closed and never signs", async () => {
  const malformed = caseFileHarness();
  assert.equal((await malformed.get("contract", { authorization: "Bearer nope" })).status, 401);
  assert.deepEqual(malformed.calls.actor, []);
  const expired = caseFileHarness({ actor: { status: "invalid", reason: "supabase_session_invalid" } });
  assert.equal((await expired.get()).status, 401);
  const notStudent = caseFileHarness({ actor: { status: "invalid", reason: "student_authority_invalid" } });
  assert.equal((await notStudent.get()).status, 403);
  const down = caseFileHarness({ actor: { status: "invalid", reason: "student_authority_unavailable" } });
  assert.equal((await down.get()).status, 503);
  for (const harness of [expired, notStudent, down]) assert.deepEqual(harness.calls.sign, []);
});

test("case file: the RPC refusal stays 403 and nothing is signed", async () => {
  const { get, calls } = caseFileHarness({ rpc: { data: null, error: { code: "42501" } } });
  assert.equal((await get()).status, 403);
  assert.deepEqual(calls.sign, []);
});

// --- route contract and source pins ---

test("route contract: session is a public POST-only path, password is a connected Student POST-only path", () => {
  assert.equal(isPublicStudentRegistrationApi("/api/portal/mobile/session", "POST"), true);
  assert.equal(isConnectedStudentPortalApi("/api/portal/mobile/session", "POST"), false);
  assert.equal(isConnectedStudentPortalApi("/api/portal/mobile/password", "POST"), true);
  assert.equal(isPublicStudentRegistrationApi("/api/portal/mobile/password", "POST"), false);
  for (const path of ["/api/portal/mobile/session", "/api/portal/mobile/password"]) {
    for (const method of ["GET", "PUT", "DELETE"]) {
      assert.equal(isPublicStudentRegistrationApi(path, method) || isConnectedStudentPortalApi(path, method), false, `${method} ${path}`);
    }
    for (const variant of [`${path}/`, `${path}/x`, path.toUpperCase()]) {
      assert.equal(isPublicStudentRegistrationApi(variant, "POST") || isConnectedStudentPortalApi(variant, "POST"), false, variant);
    }
  }
  assert.equal(isConnectedStudentPortalApi(`/api/portal/case-files/contract/${FILE_ID}/download`, "GET"), true);
});

test("route files delegate to the shared handlers on the node runtime", () => {
  for (const [file, handler] of [["session", "createStudentPortalMobileSessionHandler"], ["password", "createStudentPortalMobilePasswordHandler"]]) {
    const source = readFileSync(new URL(`../src/app/api/portal/mobile/${file}/route.ts`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`export const POST = ${handler}\\(\\);`, "u"));
    assert.match(source, /export const runtime = "nodejs";/u);
    assert.match(source, /export const dynamic = "force-dynamic";/u);
    assert.doesNotMatch(source, /GET|PUT|DELETE/u);
  }
  const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
  assert.equal(proxy.split("isPublicStudentRegistrationApi(path, request.method)").length, 2);
});

test("the web new-password action also revokes the other sessions after the re-sign-in", () => {
  const source = readFileSync(new URL("../src/lib/student-new-password-actions.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("signInWithPassword") < source.indexOf('admin.signOut(keep, "others")'));
});
