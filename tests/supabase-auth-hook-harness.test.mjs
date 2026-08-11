import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authHook = readFileSync(
  new URL("../scripts/test-supabase-auth-hook.mjs", import.meta.url),
  "utf8",
);
const storageGate = readFileSync(
  new URL("../scripts/test-p2h-storage-api.mjs", import.meta.url),
  "utf8",
);
const platformAuthSpec = readFileSync(
  new URL("./platform-auth/platform-auth.spec.ts", import.meta.url),
  "utf8",
);

test("Auth readiness is proven before the first mutating request", () => {
  const mainStart = authHook.indexOf("const main = async () => {");
  const readinessCall = authHook.indexOf(
    "await waitForLocalSupabaseAuthAdmin({ apiUrl, serviceRoleKey });",
    mainStart,
  );
  const signupAssertion = authHook.indexOf(
    "await assertPublicSignupDisabled();",
    mainStart,
  );

  assert.match(
    authHook,
    /import \{[\s\S]*LocalSupabaseAuthReadinessError,[\s\S]*waitForLocalSupabaseAuthAdmin,[\s\S]*\} from "\.\/supabase-auth-readiness\.mjs";/,
  );
  assert.notEqual(mainStart, -1);
  assert.notEqual(readinessCall, -1);
  assert.notEqual(signupAssertion, -1);
  assert.ok(readinessCall < signupAssertion);
  assert.match(
    authHook.slice(readinessCall, signupAssertion),
    /error instanceof LocalSupabaseAuthReadinessError[\s\S]*fail\(error\.stage\)/,
  );
});

test("Auth smoke verifies issued claims before handing credentials to Playwright", () => {
  const signInCall = authHook.indexOf(
    'await signIn(identities.adminA, "admin");',
  );
  const verificationCall = authHook.indexOf(
    'await verifyClientClaims(identities.adminA, "admin");',
  );
  const fixtureWrite = authHook.indexOf(
    "writeFileSync(\n      browserFixturePath",
  );

  assert.match(authHook, /createClient/);
  assert.match(authHook, /client\.auth\.getClaims\(identity\.accessToken\)/);
  assert.notEqual(signInCall, -1);
  assert.notEqual(verificationCall, -1);
  assert.notEqual(fixtureWrite, -1);
  assert.ok(signInCall < verificationCall);
  assert.ok(verificationCall < fixtureWrite);
});

test("Auth smoke emits one dedicated revocable browser actor", () => {
  const actorDeclaration = authHook.indexOf(
    'revocableCurator: syntheticIdentity("revocable-curator")',
  );
  const membershipProvision = authHook.indexOf(
    "const revocableCuratorMembership = await provisionMembership(",
  );
  const actorSignIn = authHook.indexOf(
    'await signIn(identities.revocableCurator, "curator");',
  );
  const fixtureWrite = authHook.indexOf(
    "writeFileSync(\n      browserFixturePath",
  );

  assert.notEqual(actorDeclaration, -1);
  assert.notEqual(membershipProvision, -1);
  assert.notEqual(actorSignIn, -1);
  assert.notEqual(fixtureWrite, -1);
  assert.ok(actorDeclaration < membershipProvision);
  assert.ok(membershipProvision < actorSignIn);
  assert.ok(actorSignIn < fixtureWrite);
  assert.match(
    authHook.slice(fixtureWrite),
    /revocableMembershipId: revocableCuratorMembership\.id/,
  );
});

test("P6B scope mutation refreshes Curator auth before downstream P3C writes", () => {
  const p6bAssignment = authHook.indexOf(
    '"p6b-curator-assignment"',
  );
  const refreshedCuratorSignIn = authHook.indexOf(
    'await signIn(identities.curator, "curator");',
    p6bAssignment,
  );
  const p3cRequest = authHook.indexOf(
    '"p3c-org-a-ai-request"',
    p6bAssignment,
  );

  assert.notEqual(p6bAssignment, -1);
  assert.notEqual(refreshedCuratorSignIn, -1);
  assert.notEqual(p3cRequest, -1);
  assert.ok(p6bAssignment < refreshedCuratorSignIn);
  assert.ok(refreshedCuratorSignIn < p3cRequest);
});

test("P6B keeps its Sales fixture isolated from the BW6 handoff owner", () => {
  const p6bCaseStart = authHook.indexOf(
    "const p6bStudentCase = serviceFunctionResult(",
  );
  const p6bCaseEnd = authHook.indexOf(
    '"p6b-case-create"',
    p6bCaseStart,
  );
  const p6bCaseFixture = authHook.slice(p6bCaseStart, p6bCaseEnd);
  const p6bBrowserStart = platformAuthSpec.indexOf(
    'test("P6B turns an authenticated staff document review',
  );
  const p6bBrowserEnd = platformAuthSpec.indexOf(
    "\ntest(",
    p6bBrowserStart + 1,
  );
  const p6bBrowserProof = platformAuthSpec.slice(
    p6bBrowserStart,
    p6bBrowserEnd,
  );

  assert.notEqual(p6bCaseStart, -1);
  assert.notEqual(p6bCaseEnd, -1);
  assert.match(p6bCaseFixture, /salesScopedMembership\.id/);
  assert.doesNotMatch(p6bCaseFixture, /responsibleSalesMembership\.id/);
  assert.notEqual(p6bBrowserStart, -1);
  assert.notEqual(p6bBrowserEnd, -1);
  assert.match(
    p6bBrowserProof,
    /login\(salesPage, fixture\.identities\.salesScoped\)/,
  );
  assert.doesNotMatch(
    p6bBrowserProof,
    /login\(salesPage, fixture\.identities\.responsibleSales\)/,
  );
});

test("post-reset Storage waits longer for Auth without retrying mutations", () => {
  const mainStart = storageGate.indexOf("const main = async () => {");
  const readinessCall = storageGate.indexOf(
    "await waitForLocalSupabaseAuthAdmin({",
    mainStart,
  );
  const signupMutation = storageGate.indexOf(
    "await Promise.all(Object.values(identities).map(signUp));",
    mainStart,
  );
  const readinessBlock = storageGate.slice(readinessCall, signupMutation);

  assert.notEqual(mainStart, -1);
  assert.notEqual(readinessCall, -1);
  assert.notEqual(signupMutation, -1);
  assert.ok(readinessCall < signupMutation);
  assert.match(readinessBlock, /maxAttempts: 1_200/);
  assert.match(readinessBlock, /readinessTimeoutMs: 300_000/);
  assert.doesNotMatch(readinessBlock, /signUp\(/);
});
