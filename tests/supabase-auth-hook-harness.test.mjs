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

test("P4B Auth smoke proves a real concurrent exact-prior single winner", () => {
  const raceStart = authHook.indexOf("const p4bRaceBodies = [");
  const parallelRequests = authHook.indexOf(
    "const p4bRaceResults = await Promise.all(",
    raceStart,
  );
  const singleWinnerAssertion = authHook.indexOf(
    'p4bRaceWinners.length === 1 &&',
    parallelRequests,
  );
  const staleStatusAssertion = authHook.indexOf(
    "p4bRaceLosers[0].status === 409",
    singleWinnerAssertion,
  );
  const staleCodeAssertion = authHook.indexOf(
    'p4bRaceLosers[0].payload?.code === "PT409"',
    staleStatusAssertion,
  );
  const fixtureWrite = authHook.indexOf(
    "writeFileSync(\n      browserFixturePath",
  );

  assert.notEqual(raceStart, -1);
  assert.notEqual(parallelRequests, -1);
  assert.notEqual(singleWinnerAssertion, -1);
  assert.notEqual(staleStatusAssertion, -1);
  assert.notEqual(staleCodeAssertion, -1);
  assert.notEqual(fixtureWrite, -1);
  assert.ok(raceStart < parallelRequests);
  assert.ok(parallelRequests < singleWinnerAssertion);
  assert.ok(singleWinnerAssertion < staleCodeAssertion);
  assert.ok(staleCodeAssertion < fixtureWrite);
  assert.match(
    authHook.slice(raceStart, parallelRequests),
    /p_expected_prior_event_id: null/g,
  );
  assert.match(
    authHook.slice(parallelRequests, fixtureWrite),
    /amocrm_mapping_state_for_conversation/,
  );
  assert.match(
    authHook.slice(fixtureWrite),
    /p4b:[\s\S]*approvalEventId: p4bApprovalEventId/,
  );
});

test("synthetic conversation fixture reuses an overridden amoCRM account id for recorded messages", () => {
  const fixtureStart = authHook.indexOf(
    "const createSyntheticConversationFixture = ({",
  );
  const fixtureEnd = authHook.indexOf(
    "\nconst authenticatedPlatformRpcRows = async (",
    fixtureStart,
  );
  const fixtureBody = authHook.slice(fixtureStart, fixtureEnd);

  assert.notEqual(fixtureStart, -1);
  assert.notEqual(fixtureEnd, -1);
  assert.match(
    fixtureBody,
    /amocrmAccountId = accountSeed \+ 10_000/,
  );
  assert.match(
    fixtureBody,
    /create_communication_conversation\([\s\S]*\$\{amocrmAccountId\}/,
  );
  assert.match(
    fixtureBody,
    /record_communication_message\([\s\S]*\$\{amocrmAccountId\}/,
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
