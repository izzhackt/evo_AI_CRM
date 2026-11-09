// Регистрация по ссылке (341, 07.11.2026): новый аккаунт на сайте — только по личной ссылке менеджера.
// Production functions run here against observed fakes of the service client; the database side (hash, one use,
// the анкета at the link's lead) is proven by supabase/tests/platform_student_registration_links.sql.
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import * as contract from "../src/lib/student-application-contract.ts";
import * as aiConsentContract from "../src/lib/portal/ai-consent.ts";

const EMAIL = "student@example.test";
const PASSWORD = "a-long-enough-password";
const USER = "10000000-0000-4000-8000-000000000002";

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

function draft() {
  return { schemaVersion: 1, requestId: "10000000-0000-4000-8000-000000000001", firstName: "Айдай", lastName: "Чынарова",
    phone: "+996555000000", destinationCountries: ["CN"], intakeSeason: "autumn", intakeYear: 2027, educationLevel: "high_school",
    averageGrade: 4.5, gradeScale: "5", studyFields: ["Инженерия"], studyLevels: ["bachelor"], nationality: "KG",
    english: { mode: "self", level: "intermediate" }, tuitionBudget: "5000_10000", fundingSource: "family", consent: true,
    consentVersion: contract.STUDENT_APPLICATION_CONSENT_VERSION };
}

function harness({ check = { status: "valid", displayName: null }, consume = "consumed", claimError = null } = {}) {
  const calls = [];
  const metadata = [];
  const rpc = (name, args) => ({
    abortSignal: async () => {
      calls.push(["rpc", name, args]);
      if (name === "reserve_student_signup_attempt_v1") return { data: true, error: null };
      if (name === "claim_student_login_v1") return claimError ? { data: null, error: claimError } : { data: args.p_base, error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
  });
  const service = {
    schema: (schema) => { assert.equal(schema, "platform"); return { rpc }; },
    auth: { admin: {
      async createUser(input) {
        calls.push(["createUser", input.email]);
        metadata.push(input.user_metadata);
        return { data: { user: { id: USER, email: input.email, email_confirmed_at: null, is_anonymous: false, invited_at: null } }, error: null };
      },
      async deleteUser(id) { calls.push(["deleteUser", id]); return { data: {}, error: null }; },
    } },
  };
  const registration = compile("src/lib/server/student-public-registration.ts", {
    "../student-login": compile("src/lib/student-login.ts"),
    "../student-application-contract": contract,
    "./platform-supabase-backend-config": { getPlatformSupabaseBackendConfig: () => ({}) },
    "./platform-supabase-service-client": { createPlatformSupabaseServiceClient: () => service },
    "./student-signup-runtime": { isPasswordProvisionedStaff: () => false, logStudentSignupFailure: (stage) => calls.push(["log", stage]) },
    "./student-signup-confirmation-config.ts": { getStudentSignupConfirmationRuntimeConfig: () => ({}) },
    "./student-registration-ai-consent": compile("src/lib/server/student-registration-ai-consent.ts", {
      "node:crypto": crypto, "../portal/ai-consent": aiConsentContract, "../student-application-contract": contract,
      "../portal/ai-consent-rpc": { writeAiConsentWith: async () => { throw new Error("no AI write while creating the account"); } },
    }),
    "./student-registration-link": {
      checkRegistrationLink: async (token) => { calls.push(["check", token]); return check; },
      consumeRegistrationLink: async (token, id) => { calls.push(["consume", token, id]); return consume; },
    },
  });
  return { calls, metadata, create: (invite, aiConsent) => registration.createPublicStudentAccount(EMAIL, PASSWORD, draft(), invite, aiConsent) };
}
const names = (calls) => calls.map((call) => (call[0] === "rpc" ? `rpc:${call[1]}` : call[0]));

test("a valid link: checked first, used right after the account exists, then the login name.surname is claimed", async () => {
  const run = harness();
  assert.deepEqual(await run.create("TOKEN"), { status: "created", authUserId: USER });
  assert.deepEqual(names(run.calls), ["check", "rpc:reserve_student_signup_attempt_v1", "createUser", "consume", "rpc:claim_student_login_v1"]);
  assert.deepEqual(run.calls.find((call) => call[0] === "consume"), ["consume", "TOKEN", USER]);
  assert.equal(run.calls.find((call) => call[1] === "claim_student_login_v1")[2].p_base, "aidai.chynarova");
});

test("no usable link: nothing is reserved or created", async () => {
  for (const status of ["unknown", "used", "expired"]) {
    const run = harness({ check: { status } });
    assert.deepEqual(await run.create("TOKEN"), { status: "invite" }, status);
    assert.deepEqual(names(run.calls), ["check"], status);
  }
  const down = harness({ check: { status: "unavailable" } });
  assert.deepEqual(await down.create("TOKEN"), { status: "unavailable" });
  assert.deepEqual(names(down.calls), ["check"]);
});

test("the link cannot be used after the account exists: that fresh account is removed again", async () => {
  for (const [consume, status] of [["used", "invite"], ["expired", "invite"], ["unknown", "invite"], ["unavailable", "unavailable"]]) {
    const run = harness({ consume });
    assert.deepEqual(await run.create("TOKEN"), { status }, consume);
    assert.deepEqual(names(run.calls), ["check", "rpc:reserve_student_signup_attempt_v1", "createUser", "consume", "log", "deleteUser"], consume);
    assert.deepEqual(run.calls.at(-1), ["deleteUser", USER]);
  }
});

test("a login that cannot be claimed never undoes the account: the student signs in by e-mail", async () => {
  const run = harness({ claimError: { code: "XX000", message: "down" } });
  assert.deepEqual(await run.create("TOKEN"), { status: "created", authUserId: USER });
  assert.deepEqual(names(run.calls).slice(-2), ["rpc:claim_student_login_v1", "log"]);
});

test("no client registers without a link: an empty or unknown invite creates nothing", async () => {
  for (const invite of ["", "short"]) {
    const run = harness({ check: { status: "unknown" } });
    assert.deepEqual(await run.create(invite), { status: "invite" });
    assert.ok(!names(run.calls).includes("createUser"), "no account is created");
  }
});

test("the link itself: 32 random base64url characters; only its sha256 leaves the server; the address is /apply?invite=", () => {
  const link = compile("src/lib/server/student-registration-link.ts", {
    "node:crypto": { createHash, randomBytes: (size) => Buffer.alloc(size, 7) },
    "../student-invite-callback-contract.ts": { studentInviteCallbackUrl: () => "https://app.example.test/auth/callback" },
    "./platform-supabase-backend-config": { getPlatformSupabaseBackendConfig: () => ({}) },
    "./platform-supabase-service-client": { createPlatformSupabaseServiceClient: () => { throw new Error("no service here"); } },
  });
  const { token, hash } = link.newRegistrationToken();
  assert.match(token, /^[A-Za-z0-9_-]{32}$/u);
  assert.equal(hash, createHash("sha256").update(token, "utf8").digest("hex"));
  assert.equal(link.registrationTokenHash("short"), null);
  assert.equal(link.registrationTokenHash(`${token}!`), null);
  assert.equal(link.registrationLinkUrl(token), `https://app.example.test/apply?invite=${token}`);
});

test("345: the website account keeps the required AI choice next to the анкета draft until the confirmed sign-in", async () => {
  const web = harness();
  assert.equal((await web.create("TOKEN", true)).status, "created");
  const [saved] = web.metadata;
  assert.deepEqual(Object.keys(saved).sort(), [contract.STUDENT_AI_CONSENT_METADATA_KEY, contract.STUDENT_APPLICATION_METADATA_KEY].sort());
  const choice = saved[contract.STUDENT_AI_CONSENT_METADATA_KEY];
  assert.equal(choice.status, "granted");
  assert.equal(choice.policyVersion, aiConsentContract.AI_CONSENT_POLICY_VERSION, "the same text version as the cabinet card");
  assert.ok(aiConsentContract.isAiConsentRequestId(choice.requestId) && choice.requestId !== draft().requestId);
  const again = harness();
  await again.create("TOKEN", true);
  assert.equal(again.metadata[0][contract.STUDENT_AI_CONSENT_METADATA_KEY].requestId, choice.requestId, "one анкета, one consent request");
  const phone = harness();
  await phone.create("TOKEN");
  assert.deepEqual(Object.keys(phone.metadata[0]), [contract.STUDENT_APPLICATION_METADATA_KEY], "without the AI box only the draft is stored");
});
