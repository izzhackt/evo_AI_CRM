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

test("sensitive-permission browser mutations wait for rendered state before checking authority", () => {
  const proofStart = platformAuthSpec.indexOf(
    'test("U1 Admin manages individual sensitive permissions',
  );
  const proofEnd = platformAuthSpec.indexOf(
    'test("admin opens ordered synthetic inbound messages',
    proofStart,
  );
  const proof = platformAuthSpec.slice(proofStart, proofEnd);
  const grant = proof.indexOf("`U1 grant ${permission}`");
  const grantClick = proof.indexOf(
    'getByRole("button", { name: "Выдать" }).click()',
    grant,
  );
  const grantRendered = proof.indexOf(
    'getByRole("button", { name: "Отозвать" })',
    grantClick + 1,
  );
  const staleAfterGrant = proof.indexOf("const staleAfterGrant");
  const revoke = proof.indexOf("`U1 revoke ${permission}`");
  const revokeClick = proof.indexOf(
    'getByRole("button", { name: "Отозвать" }).click()',
    revoke,
  );
  const revokeRendered = proof.indexOf(
    'getByRole("button", { name: "Выдать" })',
    revokeClick + 1,
  );
  const staleAfterRevoke = proof.indexOf("const staleAfterRevoke");

  for (const index of [
    proofStart,
    proofEnd,
    grant,
    grantClick,
    grantRendered,
    staleAfterGrant,
    revoke,
    revokeClick,
    revokeRendered,
    staleAfterRevoke,
  ]) {
    assert.notEqual(index, -1);
  }
  assert.ok(grantClick < grantRendered);
  assert.ok(grantRendered < staleAfterGrant);
  assert.ok(revokeClick < revokeRendered);
  assert.ok(revokeRendered < staleAfterRevoke);
});

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

test("Auth smoke relies on atomic pilot scope provisioning without duplicate assignment", () => {
  const helperStart = authHook.indexOf("const provisionMembership = async");
  const helperEnd = authHook.indexOf(
    "const persistSyntheticFixtureEvent",
    helperStart,
  );
  const helper = authHook.slice(helperStart, helperEnd);

  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);
  assert.match(
    helper,
    /provisioned\?\.organization_scope_assigned === true/,
  );
  assert.match(
    helper,
    /if \(!\["admin", "sales", "curator"\]\.includes\(role\)\) \{/,
  );
  assert.equal(
    (helper.match(/"assign_organization_scope"/g) ?? []).length,
    1,
  );
  assert.ok(
    helper.indexOf('if (!["admin", "sales", "curator"].includes(role)) {') <
      helper.indexOf('"assign_organization_scope"'),
  );
});

test("P7B browser proof receives a runtime-random private collector secret", () => {
  const generation = authHook.indexOf(
    'const p7bObservabilitySecret = randomBytes(48).toString("base64url")',
  );
  const fixtureWrite = authHook.indexOf(
    "writeFileSync(\n      browserFixturePath",
  );
  const fixtureBinding = authHook.indexOf(
    "observabilitySecret: p7bObservabilitySecret", // gitleaks:allow -- source-code binding, not a credential
    generation,
  );

  assert.notEqual(generation, -1);
  assert.notEqual(fixtureWrite, -1);
  assert.notEqual(fixtureBinding, -1);
  assert.ok(generation < fixtureWrite);
  assert.ok(fixtureWrite < fixtureBinding);
  assert.equal(authHook.match(/p7bObservabilitySecret\s*=/g)?.length, 1);
  assert.doesNotMatch(
    authHook.slice(generation, fixtureWrite),
    /EVO_PLATFORM_P7B_OBSERVABILITY_SECRET/,
  );
});

test("U1 proves stale, inactive, suspended and blocked authority with otherwise-authorized Admin tokens", () => {
  const staleActor = authHook.indexOf(
    'staleAdmin: syntheticIdentity("p7a-stale-admin")',
  );
  const staleProvision = authHook.indexOf(
    "const staleAdminMembership = await provisionMembership(",
  );
  const staleSignIn = authHook.indexOf(
    'await signIn(identities.staleAdmin, "admin");',
  );
  const staleCapture = authHook.indexOf(
    "const staleAdminAccessToken = identities.staleAdmin.accessToken;",
  );
  const staleMutation = authHook.indexOf(
    'await rpc(identities.adminA, "change_pilot_staff_role", [',
    staleCapture,
  );
  const inactiveActor = authHook.indexOf(
    'inactiveAdmin: syntheticIdentity("p7a-inactive-admin")',
  );
  const inactiveProvision = authHook.indexOf(
    "const inactiveAdminMembership = await provisionMembership(",
  );
  const inactiveSignIn = authHook.indexOf(
    'await signIn(identities.inactiveAdmin, "admin");',
  );
  const inactiveCapture = authHook.indexOf(
    "const inactiveAdminAccessToken = identities.inactiveAdmin.accessToken;",
  );
  const inactiveReason = authHook.indexOf(
    '"P7A local browser inactive Admin proof"',
    inactiveCapture,
  );
  const inactiveMutation = authHook.lastIndexOf(
    'await rpc(identities.adminA, "change_pilot_staff_status", [',
    inactiveReason,
  );
  const blockedProvision = authHook.indexOf(
    "const blockedMembership = await provisionMembership(",
  );
  const blockedSignIn = authHook.indexOf(
    'await signIn(identities.blocked, "admin");',
  );
  const blockedCapture = authHook.indexOf(
    "const blockedAdminAccessToken = identities.blocked.accessToken;",
  );
  const blockedReason = authHook.indexOf(
    '"local Auth hook smoke block"',
    blockedCapture,
  );
  const blockedMutation = authHook.lastIndexOf(
    'await rpc(identities.adminA, "change_pilot_staff_status", [',
    blockedReason,
  );

  for (const location of [
    staleActor,
    staleProvision,
    staleSignIn,
    staleCapture,
    staleMutation,
    inactiveActor,
    inactiveProvision,
    inactiveSignIn,
    inactiveCapture,
    inactiveReason,
    inactiveMutation,
    blockedProvision,
    blockedSignIn,
    blockedCapture,
    blockedReason,
    blockedMutation,
  ]) {
    assert.notEqual(location, -1);
  }
  assert.ok(staleActor < staleProvision);
  assert.ok(staleProvision < staleSignIn);
  assert.ok(staleSignIn < staleCapture);
  assert.ok(staleCapture < staleMutation);
  assert.ok(inactiveActor < inactiveProvision);
  assert.ok(inactiveProvision < inactiveSignIn);
  assert.ok(inactiveSignIn < inactiveCapture);
  assert.ok(inactiveCapture < inactiveMutation);
  assert.ok(inactiveMutation < inactiveReason);
  assert.ok(blockedProvision < blockedSignIn);
  assert.ok(blockedSignIn < blockedCapture);
  assert.ok(blockedCapture < blockedMutation);
  assert.ok(blockedMutation < blockedReason);
  assert.match(
    authHook.slice(staleProvision, staleSignIn),
    /identities\.staleAdmin,[\s\S]*"admin"/,
  );
  assert.match(
    authHook.slice(inactiveProvision, inactiveSignIn),
    /identities\.inactiveAdmin,[\s\S]*"admin"/,
  );
  assert.match(
    authHook.slice(inactiveMutation, inactiveReason),
    /inactiveAdminMembership\.id,[\s\S]*"inactive"/,
  );
  assert.match(
    authHook.slice(blockedProvision, blockedSignIn),
    /identities\.blocked,[\s\S]*"admin"/,
  );
  assert.match(
    authHook.slice(blockedMutation, blockedReason),
    /blockedMembership\.id,[\s\S]*"blocked"/,
  );
  assert.match(
    platformAuthSpec,
    /\["stale Admin", fixture\.p7a\.staleAdminAccessToken\][\s\S]*\["inactive Admin", fixture\.p7a\.inactiveAdminAccessToken\][\s\S]*\["blocked Admin", fixture\.p7a\.blockedAdminAccessToken\]/,
  );
  assert.match(
    platformAuthSpec,
    /installP7APlatformSession\(deniedPage, accessToken\)[\s\S]*postExport\(deniedPage, exportBody\)[\s\S]*deniedPage\.goto\(settingsPath\)/,
  );
  assert.match(
    platformAuthSpec,
    /crossOrgExportBody\.set\("request_id", crossOrgExportRequestId\)[\s\S]*postExport\(crossOrgPage, crossOrgExportBody\)[\s\S]*orgAUnexpectedCrossOrgExportAudit/,
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

test("P6B seeds and proves an eligible Student Portal profile before browser handoff", () => {
  const requirementApplication = authHook.indexOf(
    '"p6b-country-requirement-application"',
  );
  const profileUpsert = authHook.indexOf(
    '"p6b-student-profile-upsert"',
    requirementApplication,
  );
  const profileProof = authHook.indexOf(
    '"p6b-student-portal-profile-ready"',
    profileUpsert,
  );
  const documentSubmission = authHook.indexOf(
    '"p6b-document-version-record"',
    profileProof,
  );
  const fixtureWrite = authHook.indexOf(
    "writeFileSync(\n      browserFixturePath",
  );

  assert.notEqual(requirementApplication, -1);
  assert.notEqual(profileUpsert, -1);
  assert.notEqual(profileProof, -1);
  assert.notEqual(documentSubmission, -1);
  assert.notEqual(fixtureWrite, -1);
  assert.ok(requirementApplication < profileUpsert);
  assert.ok(profileUpsert < profileProof);
  assert.ok(profileProof < documentSubmission);
  assert.ok(documentSubmission < fixtureWrite);
  assert.match(
    authHook.slice(requirementApplication, profileProof),
    /rpc\([\s\S]*"upsert_student_profile"[\s\S]*p6bStudentCaseId/,
  );
  assert.match(
    authHook.slice(profileUpsert, documentSubmission),
    /authenticatedPlatformRpcRows\([\s\S]*identities\.p6bStudent[\s\S]*"student_portal_profile"/,
  );
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
