import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";
import * as contract from "../src/lib/student-application-contract.ts";
import * as callback from "../src/lib/student-invite-callback-contract.ts";
import * as routes from "../src/lib/platform-route-contract.ts";
import * as origins from "../src/lib/platform-public-origin.ts";
import * as requestIds from "../src/lib/request-id.ts";

const REQUEST = "10000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000002";
const CSRF = "10000000-0000-4000-8000-000000000003";
const EMAIL = "student@example.test";
const PASSWORD = randomUUID();

function draft(overrides = {}) {
  return { schemaVersion: 1, requestId: REQUEST, firstName: "Тест", lastName: "Заявки", phone: "+996555000000",
    destinationCountries: ["CN", "MY"], intakeSeason: "autumn", intakeYear: 2027,
    educationLevel: "high_school", averageGrade: 4.5, gradeScale: "5", studyFields: ["Инженерия", "Дизайн"],
    studyLevels: ["bachelor", "foundation"], nationality: "KG", english: { mode: "self", level: "intermediate" },
    tuitionBudget: "5000_10000", fundingSource: "family", consent: true, consentVersion: contract.STUDENT_APPLICATION_CONSENT_VERSION,
    ...overrides };
}
function form(values) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
function registration(overrides = {}) {
  return form({ questionnaire: JSON.stringify(draft()), email: EMAIL, password: PASSWORD, expected_revision: "0", ...overrides });
}
function identity(overrides = {}) {
  return { id: USER, email: EMAIL, email_confirmed_at: "2026-09-18T10:00:00Z", user_metadata: { [contract.STUDENT_APPLICATION_METADATA_KEY]: draft() }, ...overrides };
}
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
const fields = compile("src/lib/server/action-form-fields.ts");

// Execute production functions; Auth/repository calls are observed boundaries,
// not a substitute for real signup, email delivery or database acceptance.
function harness(options = {}) {
  const calls = [];
  const callbackUrl = new URL(callback.studentInviteCallbackUrl(process.env.NODE_ENV, process.env.EVO_STUDENT_INVITE_LOCAL_ORIGIN));
  const requestHeaders = new Headers({ origin: callbackUrl.origin, host: callbackUrl.host, ...options.headers });
  const responses = options.identities ?? [{ data: { user: null }, error: { name: "AuthSessionMissingError" } }];
  let identityIndex = 0;
  const client = { auth: {
    async getUser() { calls.push(["getUser"]); return responses[Math.min(identityIndex++, responses.length - 1)]; },
    async signUp(input) { calls.push(["signUp", input]); return options.signup ?? { data: { user: { id: "obfuscated-existing-user", identities: [] }, session: null }, error: null }; },
    async updateUser(input) { calls.push(["updateUser", input]); return options.cleanup ?? { data: {}, error: null }; },
    async exchangeCodeForSession(code) { calls.push(["exchangeCode", code]); return { error: options.exchangeError ?? null }; },
    async verifyOtp(input) { calls.push(["verifyOtp", input]); return { error: options.exchangeError ?? null }; },
    async refreshSession() { calls.push(["refreshSession"]); return { error: options.refreshError ?? null }; },
    async getClaims() { calls.push(["getClaims"]); return options.claims ?? { data: { claims: { sub: USER } }, error: null }; },
  } };
  const source = {
    async readOwnStudentApplication(received) { assert.equal(received, client); calls.push(["readOwn"]); if (options.readError) throw options.readError; return options.existing ?? null; },
    async submitStudentApplication(...args) { assert.equal(args[0], client); calls.push(["submit", ...args.slice(1)]); if (options.submitError) throw options.submitError; return { id: REQUEST, status: "pending" }; },
  };
  const runtime = compile("src/lib/server/student-signup-runtime.ts", {
    "../student-application-contract": contract, "../v3/student-application-source": source,
  });
  const actions = compile("src/lib/student-signup-actions.ts", {
    "next/headers": { headers: async () => requestHeaders, cookies: async () => ({ get: () => ({ value: options.csrf ?? CSRF }), delete: (key) => calls.push(["deleteCookie", key]) }) },
    "next/navigation": { redirect: (destination) => { throw Object.assign(new Error("redirect"), { destination }); } },
    "next/cache": { revalidatePath: (path) => calls.push(["revalidate", path]) },
    "./server/action-form-fields": fields, "./server/student-signup-runtime": runtime,
    "./student-application-contract": contract, "./student-invite-callback-contract": callback,
    "./supabase/server": { createSupabaseServerClient: async () => { calls.push(["client"]); return client; } },
    "./supabase/student-portal-authority": { readVerifiedStudentPortalAuthority: async (received, claims) => { assert.equal(received, client); calls.push(["portalAuthority", claims]); return options.authority ?? { status: "unauthenticated" }; } },
    "./v3/student-application-source": source,
  });
  return { ...actions, resume: () => runtime.resumeStudentApplication(client), calls };
}
const callNames = (run) => run.calls.map(([name]) => name);
const verified = (user = identity()) => ({ data: { user }, error: null });
const redirectsTo = (destination) => (error) => error.destination === destination;

test("questionnaire preserves all selections but rejects extra authority, secret and malformed fields", () => {
  const valid = draft();
  assert.deepEqual(contract.validateStudentApplicationDraft(valid), valid);
  for (const extra of [{ password: PASSWORD }, { authUserId: USER }, { role: "admin" }, { organization_id: REQUEST }, { approved: true }]) {
    assert.equal(contract.validateStudentApplicationDraft({ ...valid, ...extra }), null);
  }
  for (const change of [
    { requestId: "not-a-uuid" }, { destinationCountries: ["CN", "CN"] }, { destinationCountries: [] },
    { studyLevels: ["bachelor", "bachelor"] }, { studyFields: ["Инженерия", "Инженерия"] },
    { averageGrade: 5.1 }, { averageGrade: NaN }, { gradeScale: "7" }, { nationality: "ZZ" },
    { consent: false }, { consentVersion: "unapproved" }, { intakeYear: 2025 }, { intakeYear: 2037 },
    { english: { mode: "self", level: "fluent", certified: true } },
  ]) assert.equal(contract.validateStudentApplicationDraft(draft(change)), null, JSON.stringify(change));
});

test("official English scores use their own scales and increments without converting self-report to certification", () => {
  for (const [exam, validScores, invalidScores] of [
    ["ielts", [0, 6.5, 9], [-0.5, 6.25, 9.5]],
    ["toefl", [1, 4.5, 6], [0, 4.25, 6.5, 100]],
    ["toefl_120", [0, 100, 120], [-1, 100.5, 121]],
    ["pte", [10, 65, 90], [0, 65.5, 91]],
    ["duolingo", [10, 115, 160], [0, 112, 165]],
  ]) {
    for (const score of validScores) assert.ok(contract.validateStudentApplicationDraft(draft({ english: { mode: "exam", exam, score } })), `${exam} ${score}`);
    for (const score of invalidScores) assert.equal(contract.validateStudentApplicationDraft(draft({ english: { mode: "exam", exam, score } })), null, `${exam} ${score}`);
  }
  assert.equal(contract.validateStudentApplicationDraft(draft({ english: { mode: "exam", exam: "ielts", score: 7, verified: true } })), null);
  assert.equal(contract.validateStudentApplicationDraft(draft({ english: { mode: "self", level: "C1" } })), null);
});

test("anonymous signup carries only the untrusted questionnaire in metadata and never trusts its returned user id", async () => {
  const run = harness();
  assert.deepEqual(await run.registerStudentAction({ status: "idle" }, registration({ email: " Student@Example.Test " })), { status: "check_email" });
  const input = run.calls.find(([name]) => name === "signUp")[1];
  assert.equal(input.email, EMAIL);
  assert.equal(input.password, PASSWORD);
  assert.deepEqual(input.options.data, { [contract.STUDENT_APPLICATION_METADATA_KEY]: draft() });
  assert.equal(JSON.stringify(input.options.data).includes(PASSWORD), false);
  assert.equal(new URL(input.options.emailRedirectTo).searchParams.get("flow"), "signup");
  assert.deepEqual(callNames(run), ["client", "getUser", "signUp"]);
});

test("duplicate email registration remains non-enumerating and cannot create a case or application", async () => {
  const run = harness({ signup: { data: { user: identity({ id: "duplicate-obfuscated-id", identities: [] }), session: null }, error: null } });
  for (let attempt = 0; attempt < 2; attempt++) assert.deepEqual(await run.registerStudentAction({ status: "idle" }, registration()), { status: "check_email" });
  assert.equal(callNames(run).filter((name) => name === "signUp").length, 2);
  assert.equal(callNames(run).includes("submit"), false);
  assert.equal(callNames(run).includes("updateUser"), false);
});

test("signup response sessions still require a fresh confirmed identity before application persistence", async () => {
  for (const liveUser of [null, identity({ email_confirmed_at: null })]) {
    const run = harness({ identities: [verified(null), verified(liveUser)], signup: { data: { user: identity(), session: { access_token: "synthetic-untrusted-response" } }, error: null } });
    assert.deepEqual(await run.registerStudentAction({ status: "idle" }, registration()), { status: "check_email" });
    assert.deepEqual(callNames(run), ["client", "getUser", "signUp", "getUser"]);
  }
  const liveDraft = draft({ firstName: "Подтверждённый" });
  const run = harness({ identities: [verified(null), verified(identity({ user_metadata: { [contract.STUDENT_APPLICATION_METADATA_KEY]: liveDraft } }))],
    signup: { data: { user: identity({ id: "not-authority", user_metadata: { role: "admin" } }), session: {} }, error: null } });
  await assert.rejects(run.registerStudentAction({ status: "idle" }, registration()), redirectsTo("/apply/status"));
  assert.deepEqual(run.calls.find(([name]) => name === "submit"), ["submit", liveDraft]);
});

test("confirmed signed-in applicants submit revisioned drafts without creating another Auth account", async () => {
  const run = harness({ identities: [verified()] });
  await assert.rejects(run.registerStudentAction({ status: "idle" }, registration({ password: "", expected_revision: "3" })), redirectsTo("/apply/status"));
  assert.deepEqual(run.calls.find(([name]) => name === "submit"), ["submit", draft(), 3]);
  assert.deepEqual(run.calls.find(([name]) => name === "updateUser"), ["updateUser", { data: { [contract.STUDENT_APPLICATION_METADATA_KEY]: null } }]);
  assert.equal(callNames(run).includes("signUp"), false);
  for (const user of [identity({ email_confirmed_at: null }), identity({ email: "different@example.test" })]) {
    const blocked = harness({ identities: [verified(user)] });
    assert.deepEqual(await blocked.registerStudentAction({ status: "idle" }, registration()), { status: "conflict" });
    assert.deepEqual(callNames(blocked), ["client", "getUser"]);
  }
});

test("invalid origin, duplicate fields and injected identity never reach Auth", async () => {
  for (const headers of [{ origin: "https://evil.example" }, { host: "evil.example" }, { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" }]) {
    const run = harness({ headers });
    assert.deepEqual(await run.registerStudentAction({ status: "idle" }, registration()), { status: "invalid" });
    assert.deepEqual(run.calls, []);
  }
  for (const input of [registration({ auth_user_id: USER }), registration({ role: "admin" }), registration({ questionnaire: JSON.stringify(draft({ password: PASSWORD })) }), registration({ expected_revision: "-1" })]) {
    const run = harness();
    assert.deepEqual(await run.registerStudentAction({ status: "idle" }, input), { status: "invalid" });
    assert.deepEqual(run.calls, []);
  }
  const duplicate = registration(); duplicate.append("email", "other@example.test");
  const run = harness();
  assert.deepEqual(await run.registerStudentAction({ status: "idle" }, duplicate), { status: "invalid" });
  assert.deepEqual(run.calls, []);
});

test("registration reports password, rate limit and uncertain Auth failures without claiming persistence", async () => {
  const short = harness();
  assert.deepEqual(await short.registerStudentAction({ status: "idle" }, registration({ password: "short" })), { status: "password" });
  assert.equal(callNames(short).includes("signUp"), false);
  for (const [error, status] of [[{ status: 429 }, "rate_limit"], [{ code: "weak_password" }, "password"], [{ message: "private provider failure" }, "unavailable"]]) {
    const run = harness({ signup: { data: {}, error } });
    assert.deepEqual(await run.registerStudentAction({ status: "idle" }, registration()), { status });
    assert.equal(callNames(run).includes("submit"), false);
  }
  const broken = harness({ identities: [{ data: { user: null }, error: { name: "AuthRetryableFetchError", message: "private details" } }] });
  assert.deepEqual(await broken.registerStudentAction({ status: "idle" }, registration()), { status: "unavailable" });
  assert.deepEqual(callNames(broken), ["client", "getUser"]);
});

test("resume requires live email confirmation before any RPC and routes verified orphans to a real draft", async () => {
  for (const response of [verified(null), verified(identity({ email_confirmed_at: null })), verified(identity({ email: null })), { data: { user: identity() }, error: new Error("unverified transport") }]) {
    const run = harness({ identities: [response] });
    assert.equal(await run.resume(), "unverified");
    assert.deepEqual(callNames(run), ["getUser"]);
  }
  for (const metadata of [{}, { [contract.STUDENT_APPLICATION_METADATA_KEY]: { ...draft(), role: "admin" } }]) {
    const run = harness({ identities: [verified(identity({ user_metadata: metadata }))] });
    assert.equal(await run.resume(), "needs_draft");
    assert.deepEqual(callNames(run), ["getUser", "readOwn"]);
  }
});

test("resume commits the original request before cleaning only its metadata key", async () => {
  const run = harness({ identities: [verified(identity({ user_metadata: { [contract.STUDENT_APPLICATION_METADATA_KEY]: draft(), preference: "retained" } }))] });
  assert.equal(await run.resume(), "saved");
  assert.deepEqual(run.calls, [["getUser"], ["readOwn"], ["submit", draft()], ["updateUser", { data: { [contract.STUDENT_APPLICATION_METADATA_KEY]: null } }]]);
  const failed = harness({ identities: [verified()], submitError: new Error("transaction failed") });
  await assert.rejects(failed.resume(), /transaction failed/);
  assert.equal(callNames(failed).includes("updateUser"), false);
});

test("a saved request wins over stale metadata and retry never resubmits or grants privileges", async () => {
  for (const status of ["pending", "approved", "rejected"]) {
    const run = harness({ identities: [verified(identity({ user_metadata: { [contract.STUDENT_APPLICATION_METADATA_KEY]: { role: "admin" } } }))], existing: { id: REQUEST, status } });
    assert.equal(await run.resume(), "saved");
    assert.equal(await run.resume(), "saved");
    assert.deepEqual(callNames(run), ["getUser", "readOwn", "getUser", "readOwn"]);
  }
  const cleanupFailure = harness({ identities: [verified()], cleanup: { data: null, error: { message: "metadata update unavailable" } } });
  assert.equal(await cleanupFailure.resume(), "saved");
  assert.equal(callNames(cleanupFailure).filter((name) => name === "submit").length, 1);
});

test("confirmation enforces CSRF and fresh identity for both PKCE and email token paths", async () => {
  const code = "c".repeat(32), hash = "a".repeat(64);
  for (const input of [form({ csrf_token: "wrong", code, token_hash: "" }), form({ csrf_token: CSRF, code, token_hash: hash })]) {
    const run = harness();
    assert.deepEqual(await run.confirmStudentSignupAction({ status: "idle" }, input), { status: "invalid" });
    assert.deepEqual(run.calls, []);
  }
  for (const input of [form({ csrf_token: CSRF, code, token_hash: "" }), form({ csrf_token: CSRF, code: "", token_hash: hash })]) {
    const run = harness({ identities: [verified()], existing: { status: "pending" } });
    await assert.rejects(run.confirmStudentSignupAction({ status: "idle" }, input), redirectsTo("/apply/status"));
    assert.ok(callNames(run).indexOf("getUser") < callNames(run).indexOf("readOwn"));
    assert.deepEqual(run.calls.at(-1), ["deleteCookie", callback.STUDENT_INVITE_CSRF_COOKIE]);
  }
  const orphan = harness({ identities: [verified(identity({ user_metadata: {} }))] });
  await assert.rejects(orphan.confirmStudentSignupAction({ status: "idle" }, form({ csrf_token: CSRF, code, token_hash: "" })), redirectsTo("/apply"));
  const expired = harness({ exchangeError: { message: "expired" } });
  assert.deepEqual(await expired.confirmStudentSignupAction({ status: "idle" }, form({ csrf_token: CSRF, code, token_hash: "" })), { status: "expired" });
  assert.equal(callNames(expired).includes("getUser"), false);
});

test("approval status alone cannot enter the portal without refreshed verified Student authority", async () => {
  const pending = harness({ existing: { status: "pending" } });
  assert.deepEqual(await pending.refreshStudentApplicationAction(), { status: "idle" });
  assert.equal(callNames(pending).includes("refreshSession"), false);
  assert.deepEqual(pending.calls.at(-1), ["revalidate", "/apply/status"]);
  const denied = harness({ existing: { status: "approved" } });
  assert.deepEqual(await denied.refreshStudentApplicationAction(), { status: "unavailable" });
  assert.deepEqual(callNames(denied), ["client", "readOwn", "refreshSession", "getClaims", "portalAuthority"]);
  const accepted = harness({ existing: { status: "approved" }, authority: { status: "authenticated" } });
  await assert.rejects(accepted.refreshStudentApplicationAction(), redirectsTo("/portal"));
});

function proxyHarness({ claimsError = null } = {}) {
  const calls = [];
  const loaded = compile("src/proxy.ts", {
    "next/server": { NextRequest, NextResponse },
    "@/lib/platform-route-contract": routes,
    "@/lib/platform-public-origin": origins,
    "@/lib/request-id": requestIds,
    "@/lib/student-invite-callback-contract": callback,
    "@/lib/supabase/config": { getSupabasePublicConfig: () => ({ url: "https://supabase.example.test", publishableKey: "synthetic-public-key" }) },
    "@supabase/ssr": { createServerClient: (_url, _key, { cookies }) => {
      calls.push("createClient");
      return { auth: { getClaims: async () => {
        calls.push("getClaims");
        assert.equal(cookies.getAll().find(({ name }) => name === "sb-test-auth-token")?.value, "expired-cookie");
        cookies.setAll([{ name: "sb-test-auth-token", value: "rotated-cookie", options: { path: "/", httpOnly: true, sameSite: "lax", secure: true } }]);
        return { data: claimsError ? null : { claims: { sub: USER } }, error: claimsError };
      } } };
    } },
    "@/lib/supabase/platform-authority": { readVerifiedPlatformAuthority: async () => { calls.push("staffAuthority"); return { status: "invalid", authority: null }; } },
    "@/lib/supabase/student-portal-authority": { readVerifiedStudentPortalAuthority: async () => { calls.push("studentAuthority"); return { status: "invalid", authority: null }; } },
  });
  return { proxy: loaded.proxy, calls };
}
function publicRequest(path, { host = "app.evoadmissions.com", method = "GET", cookie } = {}) {
  return new NextRequest(`https://${host}${path}`, { method, headers: { host, "x-request-id": "signup-proxy-test", ...(cookie ? { cookie } : {}) } });
}

test("actual proxy admits anonymous application entry and canonicalizes staff-host GET without forwarding POST", async () => {
  const run = proxyHarness();
  const response = await run.proxy(publicRequest("/apply"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const wrongHost = await run.proxy(publicRequest("/apply?step=2", { host: "crm.evoadmissions.com" }));
  assert.equal(wrongHost.status, 307);
  assert.equal(wrongHost.headers.get("location"), "https://app.evoadmissions.com/apply?step=2");
  const wrongHostPost = await run.proxy(publicRequest("/apply", { host: "crm.evoadmissions.com", method: "POST" }));
  assert.equal(wrongHostPost.status, 404);
  assert.equal(wrongHostPost.headers.get("location"), null);
  assert.deepEqual(run.calls, []);
});

test("actual proxy forwards rotated cookies to the browser and downstream request even without product membership", async () => {
  for (const [path, claimsError] of [["/apply", null], ["/apply/status", null], ["/apply", { message: "session refresh failed" }]]) {
    const run = proxyHarness({ claimsError });
    const request = publicRequest(path, { cookie: "sb-test-auth-token=expired-cookie; preference=retained" });
    const response = await run.proxy(request);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.cookies.get("sb-test-auth-token")?.value, "rotated-cookie");
    assert.equal(request.cookies.get("sb-test-auth-token")?.value, "rotated-cookie");
    const forwardedCookie = response.headers.get("x-middleware-request-cookie");
    assert.equal(forwardedCookie, request.cookies.toString());
    assert.ok(forwardedCookie.includes("sb-test-auth-token=rotated-cookie"));
    assert.ok(forwardedCookie.includes("preference=retained"));
    assert.equal(forwardedCookie.includes("expired-cookie"), false);
    assert.ok(response.headers.get("x-middleware-override-headers").split(",").includes("cookie"));
    assert.deepEqual(run.calls, path === "/apply/status"
      ? ["createClient", "getClaims", "staffAuthority", "studentAuthority"]
      : ["createClient", "getClaims"]);
  }
});

test("actual callback proxy establishes CSRF before authority and never refreshes stale Auth over a new callback", async () => {
  const run = proxyHarness();
  const request = publicRequest("/auth/callback?flow=signup&code=synthetic-code", { cookie: "sb-test-auth-token=expired-cookie" });
  const response = await run.proxy(request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const csrf = response.cookies.get(callback.STUDENT_INVITE_CSRF_COOKIE);
  assert.ok(callback.isStudentInviteCsrfToken(csrf?.value));
  assert.equal(csrf.path, "/auth/callback");
  assert.equal(csrf.httpOnly, true);
  assert.equal(request.cookies.get(callback.STUDENT_INVITE_CSRF_COOKIE)?.value, csrf.value);
  assert.ok(response.headers.get("x-middleware-request-cookie").includes(`${callback.STUDENT_INVITE_CSRF_COOKIE}=${csrf.value}`));
  const post = await run.proxy(publicRequest("/auth/callback", { method: "POST", cookie: "sb-test-auth-token=expired-cookie" }));
  assert.equal(post.status, 200);
  assert.equal(post.headers.get("x-middleware-next"), "1");
  assert.deepEqual(run.calls, []);
});
