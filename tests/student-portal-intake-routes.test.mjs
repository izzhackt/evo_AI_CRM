import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createStudentPortalInviteAcceptanceHandler,
  createStudentPortalRegistrationHandler,
  createStudentPortalRegistrationResendHandler,
} from "../src/lib/server/student-portal-intake-route-handlers.ts";
import { STUDENT_APPLICATION_CONSENT_VERSION } from "../src/lib/student-application-contract.ts";

// PORT-9a (docs/PLAN_CHANGES.md): the two narrow intake route handlers of the
// iPhone анкета path. Both are thin adapters — these tests pin the adapter
// boundary (transport, exact-key contract, status mapping, reuse call shapes)
// while the business rules stay in the untouched shared functions
// (createPublicStudentAccount, resolveStudentInviteReceiptIdentity).

const BEARER_TOKEN = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln";
const PASSWORD = randomUUID();
const AUTH_USER_ID = "3f6a1e9c-2b3d-4c5e-8f90-123456789abc";

// A draft that passes the real validateStudentApplicationDraft
// (src/lib/student-application-contract.ts:55-84) — the handler runs the
// SAME validator the web wizard and createPublicStudentAccount use.
function validDraft() {
  return {
    schemaVersion: 1,
    requestId: AUTH_USER_ID,
    firstName: "Айдана",
    lastName: "Осмонова",
    phone: "+996 555 112233",
    destinationCountries: ["CN", "MY"],
    intakeSeason: "autumn",
    intakeYear: 2027,
    educationLevel: "high_school",
    averageGrade: 4.5,
    gradeScale: "5",
    studyFields: ["Инженерия"],
    studyLevels: ["bachelor"],
    nationality: "KG",
    english: { mode: "self", level: "intermediate" },
    tuitionBudget: "5000_10000",
    fundingSource: "family",
    consent: true,
    consentVersion: STUDENT_APPLICATION_CONSENT_VERSION,
  };
}

function registrationRequest({
  body = { questionnaire: validDraft(), email: "user@example.com", password: PASSWORD },
  contentType = "application/json",
  raw,
} = {}) {
  return new Request("https://app.evoadmissions.com/api/portal/registration", {
    method: "POST",
    headers: { "X-EVO-Registration-Flow": "email-confirmation-v1", ...(contentType === null ? {} : { "content-type": contentType }) },
    body: raw ?? JSON.stringify(body),
  });
}

const PENDING = { status: "pending_confirmation", maskedEmail: "u***@example.com", expiresAt: "2026-09-22T00:00:00Z", retryAfterSeconds: null, dispatch: "accepted", resendCapability: `v1.${"A".repeat(16)}.AA.${"A".repeat(22)}` };

function accountStub(status = "pending_confirmation") {
  const calls = [];
  return {
    calls,
    async createAccount(email, password, draft) {
      calls.push({ email, password, draft });
      return status === "pending_confirmation"
        ? PENDING
        : { status };
    },
  };
}

test("registration rejects a non-JSON content type before touching the account path", async () => {
  const account = accountStub();
  const handler = createStudentPortalRegistrationHandler(account);
  const response = await handler(registrationRequest({ contentType: "text/plain" }));
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { status: "invalid" });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(account.calls.length, 0);
});

test("registration accepts the charset-suffixed JSON content type", async () => {
  const account = accountStub();
  const handler = createStudentPortalRegistrationHandler(account);
  const response = await handler(
    registrationRequest({ contentType: "application/json; charset=utf-8" }),
  );
  assert.equal(response.status, 202);
  assert.equal(account.calls.length, 1);
});

test("registration rejects unparseable JSON and non-object bodies", async () => {
  const account = accountStub();
  const handler = createStudentPortalRegistrationHandler(account);
  for (const raw of ["not-json{", "null", "[]", "\"string\""]) {
    const response = await handler(registrationRequest({ raw }));
    assert.equal(response.status, 400, raw);
    assert.deepEqual(await response.json(), { status: "invalid" });
  }
  assert.equal(account.calls.length, 0);
});

test("registration enforces the exact-key contract of the web action", async () => {
  const account = accountStub();
  const handler = createStudentPortalRegistrationHandler(account);
  for (const body of [
    { questionnaire: validDraft(), email: "user@example.com" },
    { questionnaire: validDraft(), email: "user@example.com", password: PASSWORD, extra: 1 },
    { questionnaire: validDraft(), email: 5, password: PASSWORD },
    { questionnaire: "{}", email: "user@example.com", password: PASSWORD },
  ]) {
    const response = await handler(registrationRequest({ body }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { status: "invalid" });
  }
  assert.equal(account.calls.length, 0);
});

test("registration mirrors the 12000-character questionnaire ceiling", async () => {
  const account = accountStub();
  const handler = createStudentPortalRegistrationHandler(account);
  const oversized = validDraft();
  oversized.studyFields = [`Инженерия${"x".repeat(90)}`];
  oversized.firstName = "x".repeat(60);
  // Inflate above 12 000 serialized characters while staying a JSON object.
  const body = {
    questionnaire: { ...oversized, padding: "y".repeat(12001) },
    email: "user@example.com",
    password: PASSWORD,
  };
  const response = await handler(registrationRequest({ body }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { status: "invalid" });
  assert.equal(account.calls.length, 0);
});

test("registration caps the whole body at 16 KiB", async () => {
  const account = accountStub();
  const handler = createStudentPortalRegistrationHandler(account);
  const response = await handler(
    registrationRequest({ raw: `{"questionnaire":{"a":"${"y".repeat(17000)}"}}` }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { status: "invalid" });
  assert.equal(account.calls.length, 0);
});

test("registration revalidates the draft with the shared contract validator", async () => {
  const account = accountStub();
  const handler = createStudentPortalRegistrationHandler(account);
  const noConsent = validDraft();
  noConsent.consent = false;
  const response = await handler(
    registrationRequest({ body: { questionnaire: noConsent, email: "user@example.com", password: PASSWORD } }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { status: "invalid" });
  assert.equal(account.calls.length, 0);
});

test("registration normalizes email exactly like the web action and passes the draft through", async () => {
  const account = accountStub();
  const handler = createStudentPortalRegistrationHandler(account);
  const response = await handler(
    registrationRequest({
      body: { questionnaire: validDraft(), email: "  User@Example.COM ", password: PASSWORD },
    }),
  );
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), PENDING);
  assert.equal(account.calls.length, 1);
  assert.equal(account.calls[0].email, "user@example.com");
  assert.equal(account.calls[0].password, PASSWORD);
  assert.deepEqual(account.calls[0].draft, validDraft());
});

test("registration maps every account-creation status to its HTTP code", async () => {
  for (const [status, httpStatus] of [
    ["invalid", 400],
    ["password", 400],
    ["password_too_long", 400],
    ["conflict", 409],
    ["rate_limit", 429],
    ["unavailable", 503],
    ["create_unknown", 503],
  ]) {
    const account = accountStub(status);
    const handler = createStudentPortalRegistrationHandler(account);
    const response = await handler(registrationRequest());
    assert.equal(response.status, httpStatus, status);
    assert.deepEqual(await response.json(), { status });
    assert.equal(account.calls.length, 1, status);
  }
});

// --- invite acceptance ---

function acceptedReceipt(overrides = {}) {
  return {
    status: "matched",
    receiptId: "20000000-0000-4000-8000-000000000002",
    receiptVersion: 3,
    inviteGeneration: 1,
    provisioningState: "invite_succeeded",
    inviteDeliveryStatus: "accepted",
    accountPending: true,
    authorityActivated: false,
    intakeFlow: "anketa_v1",
    displayName: "Айдана Осмонова",
    ...overrides,
  };
}

function inviteStub({
  claimsError = null,
  claims = { sub: AUTH_USER_ID, email: "User@Example.com " },
  receipt = acceptedReceipt(),
  resolveResult,
} = {}) {
  const clientCalls = [];
  const claimsCalls = [];
  const resolveCalls = [];
  return {
    clientCalls,
    claimsCalls,
    resolveCalls,
    dependencies: {
      createClient(accessToken) {
        clientCalls.push(accessToken);
        return {
          auth: {
            async getClaims(jwt) {
              claimsCalls.push(jwt);
              return claimsError
                ? { data: null, error: claimsError }
                : { data: { claims }, error: null };
            },
          },
        };
      },
      createReceiptStore: () => ({
        async resolveIdentity(input) {
          resolveCalls.push(input);
          return resolveResult ?? receipt;
        },
      }),
    },
  };
}

function inviteRequest(authorization) {
  return new Request(
    "https://app.evoadmissions.com/api/portal/invite-acceptance",
    {
      method: "POST",
      headers: authorization === undefined ? {} : { authorization },
    },
  );
}

test("invite acceptance is bearer-only: absent and malformed credentials are 401 without any client", async () => {
  for (const authorization of [undefined, "Bearer", "Bearer not-a-jwt", `Basic ${BEARER_TOKEN}`, "Bearer a.b.c extra"]) {
    const invite = inviteStub();
    const handler = createStudentPortalInviteAcceptanceHandler(invite.dependencies);
    const response = await handler(inviteRequest(authorization));
    assert.equal(response.status, 401, String(authorization));
    assert.deepEqual(await response.json(), { status: "authentication_required" });
    assert.equal(invite.clientCalls.length, 0, String(authorization));
    assert.equal(invite.resolveCalls.length, 0, String(authorization));
  }
});

test("invite acceptance verifies the exact token with Supabase Auth and stops on rejection", async () => {
  const invite = inviteStub({ claimsError: { name: "AuthInvalidJwtError", message: "invalid JWT" } });
  const handler = createStudentPortalInviteAcceptanceHandler(invite.dependencies);
  const response = await handler(inviteRequest(`Bearer ${BEARER_TOKEN}`));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { status: "authentication_required" });
  assert.deepEqual(invite.clientCalls, [BEARER_TOKEN]);
  assert.deepEqual(invite.claimsCalls, [BEARER_TOKEN]);
  assert.equal(invite.resolveCalls.length, 0);
});

test("invite acceptance rejects claims that do not normalize to an invite identity", async () => {
  for (const claims of [
    { sub: AUTH_USER_ID },
    { email: "user@example.com" },
    { sub: "not-a-uuid", email: "user@example.com" },
    { sub: AUTH_USER_ID, email: "not an email" },
  ]) {
    const invite = inviteStub({ claims });
    const handler = createStudentPortalInviteAcceptanceHandler(invite.dependencies);
    const response = await handler(inviteRequest(`Bearer ${BEARER_TOKEN}`));
    assert.equal(response.status, 401, JSON.stringify(claims));
    assert.equal(invite.resolveCalls.length, 0, JSON.stringify(claims));
  }
});

test("invite acceptance resolves the receipt with markAccepted=true and returns the receipt facts", async () => {
  const invite = inviteStub();
  const handler = createStudentPortalInviteAcceptanceHandler(invite.dependencies);
  const response = await handler(inviteRequest(`Bearer ${BEARER_TOKEN}`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "accepted",
    intakeFlow: "anketa_v1",
    accountPending: true,
    displayName: "Айдана Осмонова",
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  // The same normalization the web callback applies (trim + lowercase), and
  // the same acceptance semantics (student-invite-session.ts:70-93).
  assert.deepEqual(invite.resolveCalls, [
    {
      authUserId: AUTH_USER_ID,
      normalizedEmail: "user@example.com",
      markAccepted: true,
    },
  ]);
});

test("invite acceptance passes legacy receipts through with their honest flow", async () => {
  const invite = inviteStub({
    receipt: acceptedReceipt({ intakeFlow: "legacy", accountPending: false, displayName: null }),
  });
  const handler = createStudentPortalInviteAcceptanceHandler(invite.dependencies);
  const response = await handler(inviteRequest(`Bearer ${BEARER_TOKEN}`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "accepted",
    intakeFlow: "legacy",
    accountPending: false,
    displayName: null,
  });
});

test("invite acceptance requires an accepted matched receipt", async () => {
  for (const resolveResult of [
    { status: "mismatch" },
    acceptedReceipt({ inviteDeliveryStatus: "issued" }),
  ]) {
    const invite = inviteStub({ resolveResult });
    const handler = createStudentPortalInviteAcceptanceHandler(invite.dependencies);
    const response = await handler(inviteRequest(`Bearer ${BEARER_TOKEN}`));
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { status: "mismatch" });
  }
});

test("invite acceptance maps store unavailability to 503", async () => {
  const invite = inviteStub({ resolveResult: { status: "unavailable" } });
  const handler = createStudentPortalInviteAcceptanceHandler(invite.dependencies);
  const response = await handler(inviteRequest(`Bearer ${BEARER_TOKEN}`));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "unavailable" });
});

// --- route files stay 5-line delegators (PORT-8a source-pin style) ---

test("intake route files delegate to the shared handlers on the node runtime", () => {
  const registration = readFileSync(
    new URL("../src/app/api/portal/registration/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(registration, /createStudentPortalRegistrationHandler\(\)/u);
  assert.match(registration, /export const runtime = "nodejs";/u);
  assert.match(registration, /export const dynamic = "force-dynamic";/u);
  assert.doesNotMatch(registration, /GET|PUT|DELETE/u);

  const acceptance = readFileSync(
    new URL("../src/app/api/portal/invite-acceptance/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(acceptance, /createStudentPortalInviteAcceptanceHandler\(\)/u);
  assert.match(acceptance, /export const runtime = "nodejs";/u);
  assert.match(acceptance, /export const dynamic = "force-dynamic";/u);
  assert.doesNotMatch(acceptance, /GET|PUT|DELETE/u);
});

test("old registration transport stops before reading body or creating identity", async () => {
  const account = accountStub();
  const handler = createStudentPortalRegistrationHandler(account);
  for (const version of [null, "old", "email-confirmation-v1,old"]) {
    const request = registrationRequest();
    if (version === null) request.headers.delete("X-EVO-Registration-Flow");
    else request.headers.set("X-EVO-Registration-Flow", version);
    const response = await handler(request);
    assert.equal(response.status, 426);
    assert.equal(request.bodyUsed, false);
    assert.deepEqual(await response.json(), {status:"upgrade_required"});
  }
  assert.equal(account.calls.length,0);
});

test("resend accepts only exact bounded cap JSON and current transport", async () => {
  const calls=[];
  const handler=createStudentPortalRegistrationResendHandler({resend:async cap=>{calls.push(cap);return PENDING;}});
  const request=raw=>new Request("https://app.evoadmissions.com/api/portal/registration/resend",{method:"POST",headers:{"content-type":"application/json","X-EVO-Registration-Flow":"email-confirmation-v1"},body:raw});
  const valid=JSON.stringify({cap:PENDING.resendCapability});
  for(const raw of ["null","[]","{}",JSON.stringify({cap:PENDING.resendCapability,email:"x"}),JSON.stringify({cap:1}),JSON.stringify({cap:"x"}),`{"cap":"${PENDING.resendCapability}","cap":"${PENDING.resendCapability}"}`,`{"\\u0063ap":"${PENDING.resendCapability}"}`,"x".repeat(17000)]) {
    assert.equal((await handler(request(raw))).status,400);
  }
  assert.equal(calls.length,0);
  const old=request(valid);old.headers.delete("X-EVO-Registration-Flow");assert.equal((await handler(old)).status,426);assert.equal(old.bodyUsed,false);
  const response=await handler(request(valid));assert.equal(response.status,202);assert.deepEqual(await response.json(),PENDING);assert.deepEqual(calls,[PENDING.resendCapability]);
});

test("resend maps terminal statuses and errors without leaking internal fields",async()=>{
  for(const [status,code] of [["confirmed",200],["expired",410],["rate_limit",429],["account_conflict",409],["unavailable",503]]) {
    const handler=createStudentPortalRegistrationResendHandler({resend:async()=>({status,privateValue:"never return"})});
    const request=new Request("https://app.evoadmissions.com/api/portal/registration/resend",{method:"POST",headers:{"content-type":"application/json","X-EVO-Registration-Flow":"email-confirmation-v1"},body:JSON.stringify({cap:PENDING.resendCapability})});
    const response=await handler(request);assert.equal(response.status,code);assert.deepEqual(await response.json(),{status});assert.equal(response.headers.get("cache-control"),"no-store");
  }
});
