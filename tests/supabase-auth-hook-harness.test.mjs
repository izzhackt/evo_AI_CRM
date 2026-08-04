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
