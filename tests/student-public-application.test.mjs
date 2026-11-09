import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import * as signupContract from "../src/lib/student-signup-confirmation-contract.ts";
import * as signupCapability from "../src/lib/server/student-signup-confirmation-capability.ts";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";
import { createClient } from "@supabase/supabase-js";
import * as contract from "../src/lib/student-application-contract.ts";
import * as callback from "../src/lib/student-invite-callback-contract.ts";
import * as recoveryContract from "../src/lib/student-password-recovery-contract.ts";
import * as routes from "../src/lib/platform-route-contract.ts";
import * as origins from "../src/lib/platform-public-origin.ts";
import * as requestIds from "../src/lib/request-id.ts";
import * as sessionCookie from "../src/lib/session-cookie.ts";
import * as requestTiming from "../src/lib/request-timing.ts";
import * as accountDeletion from "../src/lib/account-deletion-contract.ts";
import * as aiConsentContract from "../src/lib/portal/ai-consent.ts";

const REQUEST = "10000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000002";
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
// The wizard always posts `invite` (341): the personal registration link, empty for a signed-in applicant; and
// `ai_consent` (345): «granted» once the required AI-assistants box is ticked.
function registration(overrides = {}) {
  return form({ questionnaire: JSON.stringify(draft()), email: EMAIL, password: PASSWORD, expected_revision: "0", invite: "",
    ai_consent: "granted", ...overrides });
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
// Confirmation-aware new-account acceptance requires the separate27c Auth packet.
// Retained local action tests use this production helper without an Auth stub;
// they stop before its service access or cover already-authenticated applicants.
const backendConfig = compile("src/lib/server/platform-supabase-backend-config.ts");
const backendClient = compile("src/lib/server/platform-supabase-service-client.ts", {
  "@supabase/supabase-js": { createClient },
});

const signupConfig = compile("src/lib/server/student-signup-confirmation-config.ts", {
  "../supabase/config.ts": compile("src/lib/supabase/config.ts"),
  "../student-signup-confirmation-contract.ts": signupContract,
  "./platform-supabase-backend-config.ts": backendConfig,
});

// Execute production functions; Auth/repository calls are observed boundaries,
// not a substitute for real signup, session or database acceptance.
function harness(options = {}) {
  const calls = [];
  const callbackUrl = new URL(callback.studentInviteCallbackUrl(process.env.NODE_ENV, process.env.EVO_STUDENT_INVITE_LOCAL_ORIGIN));
  const requestHeaders = new Headers({ origin: callbackUrl.origin, host: callbackUrl.host, ...options.headers });
  const responses = options.identities ?? [{ data: { user: null }, error: { name: "AuthSessionMissingError" } }];
  let identityIndex = 0;
  const client = { auth: {
    async getUser() { calls.push(["getUser"]); return responses[Math.min(identityIndex++, responses.length - 1)]; },
    async updateUser(input) { calls.push(["updateUser", input]); return options.cleanup ?? { data: {}, error: null }; },
    async refreshSession() { calls.push(["refreshSession"]); return { error: options.refreshError ?? null }; },
    async getClaims() { calls.push(["getClaims"]); return options.claims ?? { data: { claims: { sub: USER } }, error: null }; },
  } };
  const source = {
    async readOwnStudentApplication(received) { assert.equal(received, client); calls.push(["readOwn"]); if (options.readError) throw options.readError; return options.existing ?? null; },
    async submitStudentApplication(...args) { assert.equal(args[0], client); calls.push(["submit", ...args.slice(1)]); if (options.submitError) throw options.submitError; return { id: REQUEST, status: "pending" }; },
  };
  const portalAuthority = {
    readVerifiedStudentPortalAuthority: async (received, claims) => {
      assert.equal(received, client); calls.push(["portalAuthority", claims]);
      return options.authority ?? { status: "invalid", authority: null };
    },
  };
  // 345: the real AI-consent helper; only the RPC write is observed.
  const aiConsent = compile("src/lib/server/student-registration-ai-consent.ts", {
    "node:crypto": crypto, "../portal/ai-consent": aiConsentContract, "../student-application-contract": contract,
    "../portal/ai-consent-rpc": {
      readAiConsentWith: async (received) => {
        assert.equal(received, client); calls.push(["aiConsentRead"]);
        return options.aiConsentRead === undefined
          ? { status: null, policyVersion: null, decidedAt: null, currentPolicyVersion: aiConsentContract.AI_CONSENT_POLICY_VERSION }
          : options.aiConsentRead;
      },
      writeAiConsentWith: async (received, status, requestId) => {
        assert.equal(received, client); calls.push(["aiConsent", status, requestId]);
        return options.aiConsentWrite ?? { ok: true };
      },
    },
  });
  const runtime = compile("src/lib/server/student-signup-runtime.ts", {
    "../student-application-contract": contract, "../v3/student-application-source": source,
    "./student-registration-ai-consent": aiConsent,
    "../platform-public-origin": origins,
    "../supabase/platform-authority": {
      readVerifiedPlatformAuthority: async (received, claims) => {
        assert.equal(received, client); calls.push(["staffAuthority", claims]);
        return options.staffAuthority ?? { status: "invalid", authority: null };
      },
    },
    "../supabase/student-portal-authority": portalAuthority,
  });
  const publicRegistration = compile("src/lib/server/student-public-registration.ts", {
    "../student-application-contract": contract,
    "../student-login": compile("src/lib/student-login.ts"),
    "./platform-supabase-backend-config": backendConfig,
    "./platform-supabase-service-client": backendClient,
    "./student-signup-runtime": runtime,
    "./student-registration-ai-consent": aiConsent,
    "./student-signup-confirmation-config.ts": signupConfig,
    // 341: the registration link (server reads); this harness checks the account steps, not the link itself.
    "./student-registration-link": options.registrationLink ?? {
      checkRegistrationLink: async () => ({ status: "valid", displayName: null }),
      consumeRegistrationLink: async () => "consumed",
    },
  });
  const confirmationRuntime = compile("src/lib/server/student-signup-confirmation-runtime.ts", {
    "node:crypto": { randomUUID }, "@supabase/supabase-js": { createClient },
    "../supabase/platform-authority.ts": { readVerifiedPlatformAuthority: async () => { throw new Error("New Auth flow is outside this retained harness"); } },
    "../supabase/student-portal-authority.ts": portalAuthority,
    "./platform-supabase-service-client.ts": backendClient,
    "./student-public-registration.ts": publicRegistration,
    "./student-signup-runtime.ts": runtime,
    "./student-signup-confirmation-config.ts": signupConfig,
    "./student-signup-confirmation-capability.ts": signupCapability,
  });
  const actions = compile("src/lib/student-signup-actions.ts", {
    "next/headers": { headers: async () => requestHeaders },
    "next/navigation": { redirect: (destination) => { throw Object.assign(new Error("redirect"), { destination }); } },
    "next/cache": { revalidatePath: (path) => calls.push(["revalidate", path]) },
    "./server/action-form-fields": fields, "./server/student-signup-runtime": runtime,
    "./server/student-registration-ai-consent": aiConsent,
    "./server/student-signup-confirmation-runtime": confirmationRuntime,
    "./server/student-signup-confirmation-web": {
      readPendingStudentSignup: async () => null, // This retained harness has no pending browser cookie.
      rememberStudentSignup: async () => { throw new Error("New account acceptance belongs to27c"); },
    },
    "./student-application-contract": contract, "./student-invite-callback-contract": callback,
    "./portal/consent-gate-rpc": { portalTargetAfterSignIn: async () => options.portalTarget ?? "/portal" },
    "./supabase/server": { createSupabaseServerClient: async () => { calls.push(["client"]); return client; } },
    "./supabase/student-portal-authority": portalAuthority,
    "./v3/student-application-source": source,
  });
  return { ...actions, createPublicStudentAccount: publicRegistration.createPublicStudentAccount, resume: () => runtime.resumeStudentApplication(client), entryRedirect: (user = identity()) => runtime.studentApplicationEntryRedirect(client, user), calls };
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

test("authenticated applicants submit revisioned drafts without creating another Auth account", async () => {
  const run = harness({ identities: [verified()] });
  await assert.rejects(run.registerStudentAction({ status: "idle" }, registration({ password: "", expected_revision: "3" })), redirectsTo("/apply/status"));
  assert.deepEqual(run.calls.find(([name]) => name === "submit"), ["submit", draft(), 3]);
  assert.deepEqual(run.calls.find(([name]) => name === "updateUser"), ["updateUser", { data: { [contract.STUDENT_APPLICATION_METADATA_KEY]: null } }]);
  for (const user of [identity({ email_confirmed_at: null }), identity({ email: "different@example.test" })]) {
    const blocked = harness({ identities: [verified(user)] });
    assert.deepEqual(await blocked.registerStudentAction({ status: "idle" }, registration()), { status: "conflict" });
    assert.deepEqual(callNames(blocked), user.email_confirmed_at
      ? ["client", "getUser", "getClaims", "staffAuthority", "portalAuthority"]
      : ["client", "getUser"]);
  }
});

test("verified existing Student access leaves application entry and stale forms before any submission", async () => {
  const entry = harness({ authority: { status: "authenticated" } });
  assert.equal(await entry.entryRedirect(), "/portal");
  assert.deepEqual(callNames(entry), ["getClaims", "staffAuthority", "portalAuthority"]);
  for (const email of [EMAIL, "stale-form@example.test"]) {
    const stale = harness({ identities: [verified()], authority: { status: "authenticated" } });
    await assert.rejects(stale.registerStudentAction({ status: "idle" }, registration({ email })), redirectsTo("/portal"));
    assert.deepEqual(callNames(stale), ["client", "getUser", "getClaims", "staffAuthority", "portalAuthority"]);
  }
});

test("application entry and stale submissions fail closed on unavailable or mismatched authority", async () => {
  for (const options of [
    { claims: { data: null, error: null } },
    { claims: { data: { claims: { sub: REQUEST } }, error: null } },
    { claims: { data: { claims: { sub: USER } }, error: new Error("Claims unavailable") } },
    { staffAuthority: { status: "unavailable" } },
    { authority: { status: "unavailable" } },
  ]) {
    const entry = harness(options);
    await assert.rejects(entry.entryRedirect(), /Student registration is unavailable/);
    const stale = harness({ ...options, identities: [verified()] });
    assert.deepEqual(await stale.registerStudentAction({ status: "idle" }, registration()), { status: "unavailable" });
    assert.equal(callNames(stale).includes("submit"), false);
    assert.equal(callNames(stale).includes("updateUser"), false);
  }
});

test("staff authority and protected staff identities retain their staff destinations", async () => {
  for (const [user, options, destination] of [
    [identity(), { staffAuthority: { status: "authenticated" } }, `${origins.PRODUCTION_STAFF_ORIGIN}/`],
    [identity({ app_metadata: { evo_staff_password_request_id: REQUEST } }), {}, `${origins.PRODUCTION_STAFF_ORIGIN}/login?error=staffAccessDenied`],
  ]) {
    const entry = harness(options);
    assert.equal(await entry.entryRedirect(user), destination);
    const stale = harness({ ...options, identities: [verified(user)] });
    await assert.rejects(stale.registerStudentAction({ status: "idle" }, registration()), redirectsTo(destination));
    assert.deepEqual(callNames(stale), ["client", "getUser", "getClaims", "staffAuthority"]);
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

test("account helper rejects a short password before service access; action stops on uncertain identity", async () => {
  const short = harness();
  assert.deepEqual(await short.createPublicStudentAccount(EMAIL, "short", draft(), "a".repeat(32)), { status: "password" });
  assert.deepEqual(callNames(short), []);
  const broken = harness({ identities: [{ data: { user: null }, error: new Error("Auth unavailable") }] });
  assert.deepEqual(await broken.registerStudentAction({ status: "idle" }, registration()), { status: "unavailable" });
  assert.deepEqual(callNames(broken), ["client", "getUser"]);
});

test("341: the website makes no new account without the personal registration link", async () => {
  const run = harness();
  assert.deepEqual(await run.registerStudentAction({ status: "idle" }, registration()), { status: "invite" });
  assert.equal(callNames(run).some((name) => name === "submit" || name === "updateUser"), false);
});

test("resume requires live Auth eligibility before any RPC and routes authenticated orphans to a real draft", async () => {
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
  // 356: an approved applicant with no privacy decision goes straight to the consent screen.
  const undecided = harness({ existing: { status: "approved" }, authority: { status: "authenticated" }, portalTarget: "/portal/privacy" });
  await assert.rejects(undecided.refreshStudentApplicationAction(), redirectsTo("/portal/privacy"));
});

function proxyHarness({ claimsError = null } = {}) {
  const calls = [];
  const loaded = compile("src/proxy.ts", {
    "next/server": { NextRequest, NextResponse },
    "@/lib/platform-route-contract": routes,
    "@/lib/platform-public-origin": origins,
    "@/lib/request-id": requestIds,
    "@/lib/session-cookie": sessionCookie,
    "@/lib/request-timing": requestTiming,
    "@/lib/account-deletion-contract": accountDeletion,
    "@/lib/student-invite-callback-contract": callback,
    "@/lib/student-signup-confirmation-contract": signupContract,
    "@/lib/student-password-recovery-contract": recoveryContract,
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
    "@/lib/supabase/platform-authority": { readPlatformAuthoritySnapshot: async () => { calls.push("staffAuthority"); return { result: { status: "invalid", authority: null }, rows: { staff: null } }; } },
    "@/lib/supabase/student-portal-authority": {
      readStudentPortalAuthorityRows: async () => { calls.push("studentAuthority"); return { result: { status: "invalid", authority: null }, rows: { actor: [] } }; },
      isStudentAuthorityRow: () => false,
    },
    // One live check per request: the proxy hands its rows to the render (план A).
    "@/lib/supabase/access-handoff": { ACCESS_HANDOFF_HEADER: "x-evo-access-handoff", createAccessHandoff: async () => null },
  });
  return { proxy: loaded.proxy, calls };
}
function publicRequest(path, { host = "app.evoadmissions.com", method = "GET", cookie } = {}) {
  return new NextRequest(`https://${host}${path}`, { method, headers: { host, "x-request-id": "signup-proxy-test", ...(cookie ? { cookie } : {}) } });
}

const AI_KEY = contract.STUDENT_AI_CONSENT_METADATA_KEY;
const aiChoice = (overrides = {}) => ({ status: "granted", policyVersion: aiConsentContract.AI_CONSENT_POLICY_VERSION,
  requestId: "10000000-0000-4000-8000-0000000000a1", ...overrides });

test("345: the last step needs both boxes — without the AI box or with the old consent text nothing reaches Auth", async () => {
  for (const fieldsOverride of [{ ai_consent: "" }, { ai_consent: "declined" },
    { questionnaire: JSON.stringify(draft({ consentVersion: "2026-09-18" })) }]) {
    const run = harness({ identities: [verified()] });
    assert.deepEqual(await run.registerStudentAction({ status: "idle" }, registration(fieldsOverride)), { status: "invalid" },
      JSON.stringify(fieldsOverride).slice(0, 60));
    assert.deepEqual(run.calls, [], "refused before any client is opened");
  }
  const missing = registration();
  missing.delete("ai_consent");
  const run = harness({ identities: [verified()] });
  assert.deepEqual(await run.registerStudentAction({ status: "idle" }, missing), { status: "invalid" }, "a form without the box (old tab)");
  assert.ok(contract.validateStudentApplicationDraft(draft({ consentVersion: "2026-09-18" })), "the server still reads stored and native анкеты");
  assert.equal(contract.validateStudentApplicationDraft(draft({ consentVersion: "2026-01-01" })), null);
});

test("345: a signed-in applicant's AI consent is written as the student right after the анкета", async () => {
  const run = harness({ identities: [verified()] });
  await assert.rejects(run.registerStudentAction({ status: "idle" }, registration({ password: "" })), redirectsTo("/apply/status"));
  const names = callNames(run);
  assert.ok(names.indexOf("aiConsent") > names.indexOf("submit"), "after the анкета is saved");
  const [, status, requestId] = run.calls.find(([name]) => name === "aiConsent");
  assert.equal(status, "granted");
  assert.ok(aiConsentContract.isAiConsentRequestId(requestId) && requestId !== REQUEST);
  const again = harness({ identities: [verified()] });
  await assert.rejects(again.registerStudentAction({ status: "idle" }, registration({ password: "" })), redirectsTo("/apply/status"));
  assert.equal(again.calls.find(([name]) => name === "aiConsent")[2], requestId, "a retry repeats the same request");
  const failed = harness({ identities: [verified()], aiConsentWrite: { ok: false } });
  await assert.rejects(failed.registerStudentAction({ status: "idle" }, registration({ password: "" })), redirectsTo("/apply/status"),
    "a failed AI write never undoes the анкета");
});

test("345: the confirmed sign-in writes the saved AI choice once and clears only its key", async () => {
  const fresh = harness({ identities: [verified(identity({ user_metadata: { [contract.STUDENT_APPLICATION_METADATA_KEY]: draft(), [AI_KEY]: aiChoice() } }))] });
  assert.equal(await fresh.resume(), "saved");
  assert.deepEqual(callNames(fresh), ["getUser", "readOwn", "submit", "updateUser", "aiConsentRead", "aiConsent", "updateUser"]);
  assert.deepEqual(fresh.calls.at(-2), ["aiConsent", "granted", aiChoice().requestId]);
  assert.deepEqual(fresh.calls.at(-1), ["updateUser", { data: { [AI_KEY]: null } }]);
  const existing = harness({ identities: [verified(identity({ user_metadata: { [AI_KEY]: aiChoice() } }))], existing: { id: REQUEST, status: "pending" } });
  assert.equal(await existing.resume(), "saved");
  assert.deepEqual(callNames(existing), ["getUser", "readOwn", "aiConsentRead", "aiConsent", "updateUser"], "a lost answer after submit still records the choice");
  // Review 07.11: a choice that outlived a failure never overwrites the student's own decision; only the key goes.
  const decided = harness({ identities: [verified(identity({ user_metadata: { [AI_KEY]: aiChoice() } }))], existing: { id: REQUEST, status: "approved" },
    aiConsentRead: { status: "declined", policyVersion: aiConsentContract.AI_CONSENT_POLICY_VERSION, decidedAt: "2026-11-08T10:00:00Z",
      currentPolicyVersion: aiConsentContract.AI_CONSENT_POLICY_VERSION } });
  assert.equal(await decided.resume(), "saved");
  assert.deepEqual(callNames(decided), ["getUser", "readOwn", "aiConsentRead", "updateUser"]);
  assert.deepEqual(decided.calls.at(-1), ["updateUser", { data: { [AI_KEY]: null } }]);
  const unread = harness({ identities: [verified(identity({ user_metadata: { [AI_KEY]: aiChoice() } }))], existing: { id: REQUEST, status: "pending" },
    aiConsentRead: null });
  assert.equal(await unread.resume(), "saved");
  assert.deepEqual(callNames(unread), ["getUser", "readOwn", "aiConsentRead"], "no read, no write, the key stays");
  for (const stale of [aiChoice({ policyVersion: "2026-01-01" }), aiChoice({ status: "declined" }), aiChoice({ requestId: "x" })]) {
    const run = harness({ identities: [verified(identity({ user_metadata: { [AI_KEY]: stale } }))], existing: { id: REQUEST, status: "pending" } });
    assert.equal(await run.resume(), "saved");
    assert.deepEqual(callNames(run), ["getUser", "readOwn"], "only a well-formed choice for the current text is written");
  }
  const failed = harness({ identities: [verified(identity({ user_metadata: { [AI_KEY]: aiChoice() } }))], existing: { id: REQUEST, status: "pending" },
    aiConsentWrite: { ok: false } });
  assert.equal(await failed.resume(), "saved");
  assert.deepEqual(callNames(failed), ["getUser", "readOwn", "aiConsentRead", "aiConsent"], "the key stays until the database confirms");
});

test("345: the wizard posts both required boxes and the new account carries the AI choice (review 07.11)", () => {
  const wizard = readFileSync(new URL("../src/components/student-application/ApplicationWizard.tsx", import.meta.url), "utf8");
  const start = wizard.indexOf("{s === LAST_STEP && <div");
  const account = wizard.slice(start, wizard.indexOf("\n", start));
  assert.equal((account.match(/<input type="checkbox" required /gu) ?? []).length, 2, "both boxes on the last step are required");
  assert.match(account, /checked=\{aiConsent\} onChange=\{\(e\) => \{ setAiConsent\(e\.target\.checked\);/u);
  assert.match(wizard, /<input name="ai_consent" type="hidden" value=\{aiConsent \? "granted" : ""\} \/>/u);
  assert.match(wizard, /values\.destinationCountries = currentDestinations\(values\.destinationCountries\);\n\s*\/\/ 345:[^\n]*\n\s*values\.consent = false;/u,
    "a tick restored from the tab draft was given to the old text");
  assert.match(wizard, /<a href=\{AI_CONSENT_PRIVACY_URL\} target="_blank" rel="noopener noreferrer"/u);
  const actions = readFileSync(new URL("../src/lib/student-signup-actions.ts", import.meta.url), "utf8");
  assert.match(actions, /beginStudentSignup\(email, password, draft, invite, true\)/u, "the website account always carries the AI box");
  const begin = readFileSync(new URL("../src/lib/server/student-signup-confirmation-runtime.ts", import.meta.url), "utf8");
  assert.match(begin, /createPublicStudentAccount\(email, password, draft, invite, aiConsent\)/u);
});

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

// Ревью 280, п. 4: Auth отвечает user_not_found (аккаунт удалён), прокси ведёт
// страницы на /auth/account-deleted, а сам этот путь открывает без проверки сессии.
test("actual proxy sends a deleted account's session to the sign-out route and opens that route without a session gate", async () => {
  const deleted = { message: "User from sub claim in JWT does not exist", code: "user_not_found", status: 403 };
  for (const path of ["/apply", "/apply/status", "/auth/account-pending", "/portal"]) {
    const run = proxyHarness({ claimsError: deleted });
    const response = await run.proxy(publicRequest(path, { cookie: "sb-test-auth-token=expired-cookie" }));
    assert.equal(response.status, 307, path);
    assert.equal(new URL(response.headers.get("location")).pathname, "/auth/account-deleted", path);
  }
  const other = proxyHarness({ claimsError: { message: "session refresh failed" } });
  const invalid = await other.proxy(publicRequest("/apply/status", { cookie: "sb-test-auth-token=expired-cookie" }));
  assert.equal(new URL(invalid.headers.get("location")).pathname, "/login", "any other Auth error keeps the sign-in route");
  const api = await proxyHarness({ claimsError: deleted }).proxy(publicRequest("/api/v3/notifications", { cookie: "sb-test-auth-token=expired-cookie" }));
  assert.notEqual(api.status, 307, "APIs never redirect");
  const route = proxyHarness({ claimsError: deleted });
  const open = await route.proxy(publicRequest("/auth/account-deleted", { cookie: "sb-test-auth-token=expired-cookie" }));
  assert.equal(open.status, 200);
  assert.equal(open.headers.get("x-middleware-next"), "1");
  assert.deepEqual(route.calls, [], "the route handler asks Auth itself");
  const post = await route.proxy(publicRequest("/auth/account-deleted", { method: "POST" }));
  assert.equal(post.status, 405);
});

test("actual callback proxy establishes CSRF before authority and never refreshes stale Auth over a new callback", async () => {
  const run = proxyHarness();
  const request = publicRequest(`/auth/callback?token_hash=${"a".repeat(64)}&type=invite`, { cookie: "sb-test-auth-token=expired-cookie" });
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

test("actual proxy opens Student password recovery pages without reading or refreshing product Auth", async () => {
  const run = proxyHarness();
  for (const path of [recoveryContract.STUDENT_PASSWORD_FORGOT_PATH, recoveryContract.STUDENT_PASSWORD_RESET_PATH]) {
    for (const method of ["GET", "POST"]) {
      const response = await run.proxy(publicRequest(path, { method, cookie: "sb-test-auth-token=expired-cookie" }));
      assert.equal(response.status, 200, `${method} ${path}`);
      assert.equal(response.headers.get("x-middleware-next"), "1");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.cookies.get("sb-test-auth-token"), undefined);
    }
    const wrongHost = await run.proxy(publicRequest(path, { host: "crm.evoadmissions.com" }));
    assert.equal(wrongHost.status, 307);
    assert.equal(wrongHost.headers.get("location"), `https://app.evoadmissions.com${path}`);
    const wrongHostPost = await run.proxy(publicRequest(path, { host: "crm.evoadmissions.com", method: "POST" }));
    assert.equal(wrongHostPost.status, 404);
    const put = await run.proxy(publicRequest(path, { method: "PUT" }));
    assert.equal(put.status, 405);
  }
  assert.deepEqual(run.calls, []);
});

// #1362: seven steps instead of nine and a local draft that survives closing the tab.
test("1362: the wizard has seven steps with merged education/level and nationality/English questions", () => {
  const wizard = readFileSync(new URL("../src/components/student-application/ApplicationWizard.tsx", import.meta.url), "utf8");
  assert.match(wizard, /const STEP_KEYS = \["countries", "intake", "educationLevels", "fields", "nationalityEnglish", "budget", "account"\] as const;/u);
  assert.match(wizard, /const LAST_STEP = STEP_KEYS\.length - 1;/u);
  assert.doesNotMatch(wizard, /\bstep (?:===|!==) 8\b|\bs === 8\b|Math\.min\(8,/u, "no leftover nine-step indexes");
  // The merged education step asks education, grade, scale and the study levels; the merged language step asks nationality and English.
  const education = wizard.slice(wizard.indexOf("{s === 2 && <div"), wizard.indexOf("{s === 3 &&"));
  assert.match(education, /select\("educationLevel"/u);
  assert.match(education, /STUDENT_APPLICATION_STUDY_LEVELS\.map/u);
  assert.match(education, /toggle\("studyLevels", level\)/u);
  const language = wizard.slice(wizard.indexOf("{s === 4 && <div"), wizard.indexOf("{s === 5 &&"));
  assert.match(language, /nationalityLabel/u);
  assert.match(language, /englishLegend/u);
  // The server contract is untouched: the same questionnaire fields in the same payload, account at the end.
  assert.match(wizard, /<input name="questionnaire" type="hidden" value=\{JSON\.stringify\(questionnaire\(values\)\)\} \/>/u);
  assert.match(wizard, /\{s === LAST_STEP && <div/u);
});

test("1362: the draft is in localStorage without password and consents, with createdAt and a 30-day expiry, cleared after success", async () => {
  const storage = await import("../src/lib/student-application-draft-storage.ts");
  const stored = JSON.parse(storage.serializeApplicationDraft(
    Object.fromEntries([["firstName", "Test"], ["consent", true], ["pass" + "word", "typed-in-form"], ["aiConsent", true], ["destinationCountries", ["CN"]]]),
    2, "student@example.test", "student@example.test", 1_000,
  ));
  assert.deepEqual(Object.keys(stored.values).sort(), ["destinationCountries", "firstName"], "no consent, password or AI box");
  assert.equal(stored.createdAt, 1_000);
  assert.equal(stored.step, 2);
  assert.doesNotMatch(JSON.stringify(stored), /typed-in-form|consent|password/iu);
  assert.equal(storage.applicationDraftFresh(stored, 1_000 + storage.APPLICATION_DRAFT_MAX_AGE_MS), true);
  assert.equal(storage.applicationDraftFresh(stored, 1_001 + storage.APPLICATION_DRAFT_MAX_AGE_MS), false, "older than 30 days is dropped");
  assert.equal(storage.applicationDraftFresh({ step: 1 }, 1), false, "no createdAt (old format) is dropped");
  assert.equal(storage.APPLICATION_DRAFT_MAX_AGE_MS, 30 * 24 * 60 * 60 * 1000);

  const wizard = readFileSync(new URL("../src/components/student-application/ApplicationWizard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(wizard, /sessionStorage\.(?:getItem|setItem)/u, "the draft is no longer tab-local");
  assert.match(wizard, /localStorage\.setItem\(storageKey, serializeApplicationDraft\(/u);
  assert.match(wizard, /sessionStorage\.removeItem\(LEGACY_SESSION_KEY\)/u, "the nine-step tab draft is not read, only removed");
  assert.match(wizard, /if \(result\.status === "pending_confirmation"\) \{[\s\S]*?localStorage\.removeItem\(storageKey\)/u, "cleared once the server accepted the signup");
  assert.match(wizard, /\{savedHere && <p role="status" data-testid="application-draft-hint"/u, "the hint appears only after a real write");

  // The status screen (the application was accepted) removes the anonymous draft and drafts of older revisions.
  const removed = [];
  const keys = [`${storage.APPLICATION_DRAFT_KEY}:u1:1`, `${storage.APPLICATION_DRAFT_KEY}:u1:2`, `${storage.APPLICATION_DRAFT_KEY}:other:1`];
  storage.clearObsoleteApplicationDrafts({ length: keys.length, key: (index) => keys[index] ?? null, removeItem: (key) => removed.push(key) }, "u1", 2);
  assert.deepEqual(removed, [`${storage.APPLICATION_DRAFT_KEY}:u1:1`, storage.APPLICATION_DRAFT_KEY]);
  assert.match(readFileSync(new URL("../src/components/student-application/ApplicationStatus.tsx", import.meta.url), "utf8"), /clearObsoleteApplicationDrafts\(localStorage, draftOwnerId, application\.revision\)/u);

  const { PORTAL_DICTIONARIES } = await import("../src/lib/portal/i18n.ts");
  for (const locale of ["ru", "ky"]) {
    const apply = PORTAL_DICTIONARIES.apply[locale];
    for (const key of ["step.educationLevels", "step.nationalityEnglish", "question.educationLevels", "question.nationalityEnglish", "draftHint"]) assert.ok(apply[key], `${locale} ${key}`);
    assert.match(apply.stepOf, /\{step\}/u);
    assert.match(apply.stepOf, /\{total\}/u);
  }
  assert.match(PORTAL_DICTIONARIES.apply.ru.draftHint, /^Ответы сохранены на этом устройстве\./u);
});
