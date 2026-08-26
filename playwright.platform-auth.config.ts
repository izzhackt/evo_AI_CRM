import { defineConfig, devices } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = __dirname;

type Identity = Readonly<{
  email: string;
  password: string;
  authUserId?: string;
}>;
type Fixture = Readonly<{
  apiUrl: string;
  publishableKey: string;
  p5b: Readonly<{
    organizationId: string;
    intakeSalesMembershipId: string;
    supabaseSecretKey: string;
    ingressHmacSecret: string;
    workerTriggerSecret: string;
  }>;
  p5c: Readonly<{
    wahaApiKey: string;
    historyTriggerSecret: string;
  }>;
  p5d: Readonly<{
    organizationId: string;
    intakeSalesMembershipId: string;
    supabaseSecretKey: string;
    ingressHmacSecret: string;
    workerTriggerSecret: string;
    wahaApiKey: string;
    mediaTriggerSecret: string;
  }>;
  p5f3: Readonly<{
    autonomousReplyTriggerSecret: string;
  }>;
  p6a: Readonly<{
    studentCaseId: string;
    sameOrgOtherStudentCaseId: string;
    sameOrgOtherStudentDisplayName: string;
    overduePaymentObligationId: string;
    overduePaymentLabel: string;
    overduePaymentNextAction: string;
  }>;
  p6b: Readonly<{
    organizationId: string;
    studentCaseId: string;
    documentSlotId: string;
    documentVersionId: string;
    recipientStudentMembershipId: string;
    sameOrgOtherStudentMembershipId: string;
    crossOrgOrganizationId: string;
    crossOrgStudentMembershipId: string;
    requirementKey: string;
    requirementLabel: string;
    reviewReason: string;
  }>;
  p6c: Readonly<{
    organizationId: string;
    supabaseSecretKey: string;
    workerTriggerSecret: string;
    taskStudentCaseId: string;
    taskStudentMembershipId: string;
    taskId: string;
    taskTitle: string;
    taskDueAt: string;
    paymentStudentCaseId: string;
    paymentStudentMembershipId: string;
    paymentObligationId: string;
    paymentLabel: string;
    paymentDueAt: string;
  }>;
  p6d: Readonly<{
    organizationId: string;
    primaryStudentCaseId: string;
    primaryStudentMembershipId: string;
    secondaryStudentCaseId: string;
    secondaryStudentMembershipId: string;
    crossOrgOrganizationId: string;
    crossOrgStudentCaseId: string;
    crossOrgStudentMembershipId: string;
    applicationIds: readonly [string, string];
    applicationLabels: readonly [string, string];
    documentSlotId: string;
    documentRequirementLabel: string;
    documentReviewReason: string;
    taskId: string;
    taskTitle: string;
    paymentObligationId: string;
    paymentLabel: string;
  }>;
  p7a: Readonly<{
    eventId: string;
    requestId: string;
    resourceId: string;
    action: string;
    resourceType: string;
    startAt: string;
    endAt: string;
    privatePrincipal: string;
    privatePhone: string;
    privateReason: string;
    privateBefore: string;
    privateAfter: string;
    staleAdminAccessToken: string;
    inactiveAdminAccessToken: string;
    suspendedAdminAccessToken: string;
    blockedAdminAccessToken: string;
  }>;
  p7b: Readonly<{
    supabaseSecretKey: string;
    observabilitySecret: string;
  }>;
  identities: Readonly<Record<string, Identity>>;
}>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const jwtShape = /^[^.]+\.[^.]+\.[^.]+$/;

const fixturePath = process.env.EVO_PLATFORM_AUTH_FIXTURE_PATH;
if (!fixturePath || !path.isAbsolute(fixturePath)) {
  throw new Error("EVO_PLATFORM_AUTH_FIXTURE_PATH must be an absolute path");
}
if ((statSync(fixturePath).mode & 0o777) !== 0o600) {
  throw new Error("Platform Auth fixture must use mode 0600");
}

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
const p5bBrowserProofFlag = process.env.EVO_P5B_BROWSER_PROOF;
if (
  p5bBrowserProofFlag !== undefined &&
  p5bBrowserProofFlag !== "0" &&
  p5bBrowserProofFlag !== "1"
) {
  throw new Error("EVO_P5B_BROWSER_PROOF must be 0 or 1");
}
const p5bBrowserProof = p5bBrowserProofFlag === "1";
const p5cBrowserProofFlag = process.env.EVO_P5C_BROWSER_PROOF;
if (
  p5cBrowserProofFlag !== undefined &&
  p5cBrowserProofFlag !== "0" &&
  p5cBrowserProofFlag !== "1"
) {
  throw new Error("EVO_P5C_BROWSER_PROOF must be 0 or 1");
}
const p5cBrowserProof = p5cBrowserProofFlag === "1";
const p5dBrowserProofFlag = process.env.EVO_P5D_BROWSER_PROOF;
if (
  p5dBrowserProofFlag !== undefined &&
  p5dBrowserProofFlag !== "0" &&
  p5dBrowserProofFlag !== "1"
) {
  throw new Error("EVO_P5D_BROWSER_PROOF must be 0 or 1");
}
const p5dBrowserProof = p5dBrowserProofFlag === "1";
const p5eBrowserProofFlag = process.env.EVO_P5E_BROWSER_PROOF;
if (
  p5eBrowserProofFlag !== undefined &&
  p5eBrowserProofFlag !== "0" &&
  p5eBrowserProofFlag !== "1"
) {
  throw new Error("EVO_P5E_BROWSER_PROOF must be 0 or 1");
}
const p5eBrowserProof = p5eBrowserProofFlag === "1";
const p5f1BrowserProofFlag = process.env.EVO_P5F1_BROWSER_PROOF;
if (
  p5f1BrowserProofFlag !== undefined &&
  p5f1BrowserProofFlag !== "0" &&
  p5f1BrowserProofFlag !== "1"
) {
  throw new Error("EVO_P5F1_BROWSER_PROOF must be 0 or 1");
}
const p5f1BrowserProof = p5f1BrowserProofFlag === "1";
const p5f3BrowserProofFlag = process.env.EVO_P5F3_BROWSER_PROOF;
if (
  p5f3BrowserProofFlag !== undefined &&
  p5f3BrowserProofFlag !== "0" &&
  p5f3BrowserProofFlag !== "1"
) {
  throw new Error("EVO_P5F3_BROWSER_PROOF must be 0 or 1");
}
const p5f3BrowserProof = p5f3BrowserProofFlag === "1";
const p6aBrowserProofFlag = process.env.EVO_P6A_BROWSER_PROOF;
if (
  p6aBrowserProofFlag !== undefined &&
  p6aBrowserProofFlag !== "0" &&
  p6aBrowserProofFlag !== "1"
) {
  throw new Error("EVO_P6A_BROWSER_PROOF must be 0 or 1");
}
const p6aBrowserProof = p6aBrowserProofFlag === "1";
const p6bBrowserProofFlag = process.env.EVO_P6B_BROWSER_PROOF;
if (
  p6bBrowserProofFlag !== undefined &&
  p6bBrowserProofFlag !== "0" &&
  p6bBrowserProofFlag !== "1"
) {
  throw new Error("EVO_P6B_BROWSER_PROOF must be 0 or 1");
}
const p6bBrowserProof = p6bBrowserProofFlag === "1";
const p6cBrowserProofFlag = process.env.EVO_P6C_BROWSER_PROOF;
if (
  p6cBrowserProofFlag !== undefined &&
  p6cBrowserProofFlag !== "0" &&
  p6cBrowserProofFlag !== "1"
) {
  throw new Error("EVO_P6C_BROWSER_PROOF must be 0 or 1");
}
const p6cBrowserProof = p6cBrowserProofFlag === "1";
const p6dBrowserProofFlag = process.env.EVO_P6D_BROWSER_PROOF;
if (
  p6dBrowserProofFlag !== undefined &&
  p6dBrowserProofFlag !== "0" &&
  p6dBrowserProofFlag !== "1"
) {
  throw new Error("EVO_P6D_BROWSER_PROOF must be 0 or 1");
}
const p6dBrowserProof = p6dBrowserProofFlag === "1";
const p7aBrowserProofFlag = process.env.EVO_P7A_BROWSER_PROOF;
if (
  p7aBrowserProofFlag !== undefined &&
  p7aBrowserProofFlag !== "0" &&
  p7aBrowserProofFlag !== "1"
) {
  throw new Error("EVO_P7A_BROWSER_PROOF must be 0 or 1");
}
const p7aBrowserProof = p7aBrowserProofFlag === "1";
const p7bBrowserProofFlag = process.env.EVO_P7B_BROWSER_PROOF;
if (
  p7bBrowserProofFlag !== undefined &&
  p7bBrowserProofFlag !== "0" &&
  p7bBrowserProofFlag !== "1"
) {
  throw new Error("EVO_P7B_BROWSER_PROOF must be 0 or 1");
}
const p7bBrowserProof = p7bBrowserProofFlag === "1";
const u6BrowserProofFlag = process.env.EVO_U6_BROWSER_PROOF;
if (
  u6BrowserProofFlag !== undefined &&
  u6BrowserProofFlag !== "0" &&
  u6BrowserProofFlag !== "1"
) {
  throw new Error("EVO_U6_BROWSER_PROOF must be 0 or 1");
}
const u6BrowserProof = u6BrowserProofFlag === "1";
const u7BrowserProofFlag = process.env.EVO_U7_BROWSER_PROOF;
if (
  u7BrowserProofFlag !== undefined &&
  u7BrowserProofFlag !== "0" &&
  u7BrowserProofFlag !== "1"
) {
  throw new Error("EVO_U7_BROWSER_PROOF must be 0 or 1");
}
const u7BrowserProof = u7BrowserProofFlag === "1";
const u8BrowserProofFlag = process.env.EVO_U8_BROWSER_PROOF;
if (
  u8BrowserProofFlag !== undefined &&
  u8BrowserProofFlag !== "0" &&
  u8BrowserProofFlag !== "1"
) {
  throw new Error("EVO_U8_BROWSER_PROOF must be 0 or 1");
}
const u8BrowserProof = u8BrowserProofFlag === "1";
const u9BrowserProofFlag = process.env.EVO_U9_BROWSER_PROOF;
if (
  u9BrowserProofFlag !== undefined &&
  u9BrowserProofFlag !== "0" &&
  u9BrowserProofFlag !== "1"
) {
  throw new Error("EVO_U9_BROWSER_PROOF must be 0 or 1");
}
const u9BrowserProof = u9BrowserProofFlag === "1";
const u10BrowserProofFlag = process.env.EVO_U10_BROWSER_PROOF;
if (
  u10BrowserProofFlag !== undefined &&
  u10BrowserProofFlag !== "0" &&
  u10BrowserProofFlag !== "1"
) {
  throw new Error("EVO_U10_BROWSER_PROOF must be 0 or 1");
}
const u10BrowserProof = u10BrowserProofFlag === "1";
const platformAuthDevRunKey = process.env.EVO_PLATFORM_AUTH_DEV_RUN_KEY;
const platformAuthBrowserPartition =
  process.env.EVO_PLATFORM_AUTH_BROWSER_PARTITION;
const platformAuthTsconfigPath =
  process.env.EVO_PLATFORM_AUTH_TSCONFIG_PATH;
const platformAuthTsconfigAbsolutePath = platformAuthTsconfigPath
  ? path.resolve(projectRoot, platformAuthTsconfigPath)
  : undefined;
if (
  !platformAuthDevRunKey ||
  !/^[A-Za-z0-9_-]{1,96}$/.test(platformAuthDevRunKey)
) {
  throw new Error("EVO_PLATFORM_AUTH_DEV_RUN_KEY is invalid");
}
if (
  !platformAuthBrowserPartition ||
  ![
    "provider",
    "p5b",
    "p5c",
    "p5d",
    "p5e",
    "p5f1",
    "p5f3",
    "p6a",
    "p6b",
    "p6c",
    "p6d",
    "p7a",
    "p7b",
    "u6",
    "u7",
    "u8",
    "u9",
    "u10",
    "u2",
    "remaining",
  ].includes(
    platformAuthBrowserPartition,
  )
) {
  throw new Error("EVO_PLATFORM_AUTH_BROWSER_PARTITION is invalid");
}
if ((platformAuthBrowserPartition === "p5c") !== p5cBrowserProof) {
  throw new Error(
    "EVO_P5C_BROWSER_PROOF must be enabled only for the p5c browser partition",
  );
}
if (p5bBrowserProof && p5cBrowserProof) {
  throw new Error(
    "P5B and P5C browser proof partitions are mutually exclusive",
  );
}
if (
  Number(p5bBrowserProof) +
    Number(p5cBrowserProof) +
    Number(p5dBrowserProof) +
    Number(p5eBrowserProof) +
    Number(p5f1BrowserProof) +
    Number(p5f3BrowserProof) +
    Number(p6aBrowserProof) +
    Number(p6bBrowserProof) +
    Number(p6cBrowserProof) +
    Number(p6dBrowserProof) +
    Number(p7aBrowserProof) +
    Number(p7bBrowserProof) +
    Number(u6BrowserProof) +
    Number(u7BrowserProof) +
    Number(u8BrowserProof) +
    Number(u9BrowserProof) +
    Number(u10BrowserProof) >
  1
) {
  throw new Error(
    "P5B, P5C, P5D, P5E, P5F1, P5F3, P6A, P6B, P6C, P6D, P7A, P7B, U6, U7, U8, U9 and U10 browser proof partitions are mutually exclusive",
  );
}
if (
  (platformAuthBrowserPartition === "p5b") !== p5bBrowserProof
) {
  throw new Error(
    "EVO_P5B_BROWSER_PROOF must be enabled only for the p5b browser partition",
  );
}
if ((platformAuthBrowserPartition === "p5d") !== p5dBrowserProof) {
  throw new Error(
    "EVO_P5D_BROWSER_PROOF must be enabled only for the p5d browser partition",
  );
}
if ((platformAuthBrowserPartition === "p5e") !== p5eBrowserProof) {
  throw new Error(
    "EVO_P5E_BROWSER_PROOF must be enabled only for the p5e browser partition",
  );
}
if ((platformAuthBrowserPartition === "p5f1") !== p5f1BrowserProof) {
  throw new Error(
    "EVO_P5F1_BROWSER_PROOF must be enabled only for the p5f1 browser partition",
  );
}
if ((platformAuthBrowserPartition === "p5f3") !== p5f3BrowserProof) {
  throw new Error(
    "EVO_P5F3_BROWSER_PROOF must be enabled only for the p5f3 browser partition",
  );
}
if ((platformAuthBrowserPartition === "p6a") !== p6aBrowserProof) {
  throw new Error(
    "EVO_P6A_BROWSER_PROOF must be enabled only for the p6a browser partition",
  );
}
if ((platformAuthBrowserPartition === "p6b") !== p6bBrowserProof) {
  throw new Error(
    "EVO_P6B_BROWSER_PROOF must be enabled only for the p6b browser partition",
  );
}
if ((platformAuthBrowserPartition === "p6c") !== p6cBrowserProof) {
  throw new Error(
    "EVO_P6C_BROWSER_PROOF must be enabled only for the p6c browser partition",
  );
}
if ((platformAuthBrowserPartition === "p6d") !== p6dBrowserProof) {
  throw new Error(
    "EVO_P6D_BROWSER_PROOF must be enabled only for the p6d browser partition",
  );
}
if ((platformAuthBrowserPartition === "p7a") !== p7aBrowserProof) {
  throw new Error(
    "EVO_P7A_BROWSER_PROOF must be enabled only for the p7a browser partition",
  );
}
if ((platformAuthBrowserPartition === "p7b") !== p7bBrowserProof) {
  throw new Error(
    "EVO_P7B_BROWSER_PROOF must be enabled only for the p7b browser partition",
  );
}
if ((platformAuthBrowserPartition === "u6") !== u6BrowserProof) {
  throw new Error(
    "EVO_U6_BROWSER_PROOF must be enabled only for the u6 browser partition",
  );
}
if ((platformAuthBrowserPartition === "u7") !== u7BrowserProof) {
  throw new Error(
    "EVO_U7_BROWSER_PROOF must be enabled only for the u7 browser partition",
  );
}
if ((platformAuthBrowserPartition === "u8") !== u8BrowserProof) {
  throw new Error(
    "EVO_U8_BROWSER_PROOF must be enabled only for the u8 browser partition",
  );
}
if ((platformAuthBrowserPartition === "u9") !== u9BrowserProof) {
  throw new Error(
    "EVO_U9_BROWSER_PROOF must be enabled only for the u9 browser partition",
  );
}
if ((platformAuthBrowserPartition === "u10") !== u10BrowserProof) {
  throw new Error(
    "EVO_U10_BROWSER_PROOF must be enabled only for the u10 browser partition",
  );
}
if (
  !platformAuthTsconfigPath ||
  path.isAbsolute(platformAuthTsconfigPath) ||
  !platformAuthTsconfigAbsolutePath ||
  path.dirname(platformAuthTsconfigAbsolutePath) !==
    path.join(projectRoot, ".next", "platform-auth", platformAuthDevRunKey) ||
  path.basename(platformAuthTsconfigPath) !==
    "tsconfig-platform-auth-" + platformAuthBrowserPartition + ".json" ||
  (statSync(platformAuthTsconfigAbsolutePath).mode & 0o777) !== 0o600
) {
  throw new Error("EVO_PLATFORM_AUTH_TSCONFIG_PATH is invalid");
}
if (
  !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(fixture.apiUrl) ||
  !fixture.publishableKey.startsWith("sb_publishable_") ||
  !uuidPattern.test(fixture.identities.noMembership.authUserId ?? "")
) {
  throw new Error("Platform Auth fixture must target disposable local Supabase");
}
if (
  p5bBrowserProof &&
  (!uuidPattern.test(fixture.p5b.organizationId) ||
    !uuidPattern.test(fixture.p5b.intakeSalesMembershipId) ||
    fixture.p5b.supabaseSecretKey.length === 0 ||
    fixture.p5b.ingressHmacSecret.length < 32 ||
    fixture.p5b.workerTriggerSecret.length < 32)
) {
  throw new Error("P5B browser proof fixture is invalid");
}
if (
  p5cBrowserProof &&
  (!uuidPattern.test(fixture.p5b.organizationId) ||
    !uuidPattern.test(fixture.p5b.intakeSalesMembershipId) ||
    fixture.p5b.supabaseSecretKey.length === 0 ||
    fixture.p5c.wahaApiKey.length < 32 ||
    fixture.p5c.historyTriggerSecret.length < 32)
) {
  throw new Error("P5C browser proof fixture is invalid");
}
if (
  p5dBrowserProof &&
  (!uuidPattern.test(fixture.p5d.organizationId) ||
    !uuidPattern.test(fixture.p5d.intakeSalesMembershipId) ||
    fixture.p5d.supabaseSecretKey.length === 0 ||
    fixture.p5d.ingressHmacSecret.length < 32 ||
    fixture.p5d.workerTriggerSecret.length < 32 ||
    fixture.p5d.wahaApiKey.length < 32 ||
    fixture.p5d.mediaTriggerSecret.length < 32)
) {
  throw new Error("P5D browser proof fixture is invalid");
}
if (
  p5eBrowserProof &&
  (!uuidPattern.test(fixture.p5b.organizationId) ||
    !uuidPattern.test(fixture.p5b.intakeSalesMembershipId) ||
    fixture.p5b.supabaseSecretKey.length === 0 ||
    fixture.p5b.ingressHmacSecret.length < 32 ||
    fixture.p5b.workerTriggerSecret.length < 32)
) {
  throw new Error("P5E browser proof fixture is invalid");
}
if (
  p5f3BrowserProof &&
  (!uuidPattern.test(fixture.p5b.organizationId) ||
    !uuidPattern.test(fixture.p5b.intakeSalesMembershipId) ||
    fixture.p5b.supabaseSecretKey.length === 0 ||
    fixture.p5b.ingressHmacSecret.length < 32 ||
    fixture.p5b.workerTriggerSecret.length < 32 ||
    fixture.p5c.wahaApiKey.length < 32 ||
    fixture.p5f3.autonomousReplyTriggerSecret.length < 32)
) {
  throw new Error("P5F3 browser proof fixture is invalid");
}
if (
  p6aBrowserProof &&
  (!uuidPattern.test(fixture.p6a.studentCaseId) ||
    !uuidPattern.test(fixture.p6a.sameOrgOtherStudentCaseId) ||
    !uuidPattern.test(fixture.p6a.overduePaymentObligationId) ||
    fixture.p6a.sameOrgOtherStudentDisplayName.length === 0 ||
    fixture.p6a.overduePaymentLabel.length === 0 ||
    fixture.p6a.overduePaymentNextAction.length === 0)
) {
  throw new Error("P6A browser proof fixture is invalid");
}
if (
  p6bBrowserProof &&
  (!uuidPattern.test(fixture.p6b.organizationId) ||
    !uuidPattern.test(fixture.p6b.studentCaseId) ||
    !uuidPattern.test(fixture.p6b.documentSlotId) ||
    !uuidPattern.test(fixture.p6b.documentVersionId) ||
    !uuidPattern.test(fixture.p6b.recipientStudentMembershipId) ||
    !uuidPattern.test(fixture.p6b.sameOrgOtherStudentMembershipId) ||
    !uuidPattern.test(fixture.p6b.crossOrgOrganizationId) ||
    !uuidPattern.test(fixture.p6b.crossOrgStudentMembershipId) ||
    fixture.p6b.requirementKey.length === 0 ||
    fixture.p6b.requirementLabel.length === 0 ||
    fixture.p6b.reviewReason.length === 0 ||
    !fixture.identities.p6bStudent ||
    !fixture.identities.crossOrgStudent)
) {
  throw new Error("P6B browser proof fixture is invalid");
}
if (
  p6cBrowserProof &&
  (!uuidPattern.test(fixture.p6c.organizationId) ||
    fixture.p6c.supabaseSecretKey.length === 0 ||
    !uuidPattern.test(fixture.p6c.taskStudentCaseId) ||
    !uuidPattern.test(fixture.p6c.taskStudentMembershipId) ||
    !uuidPattern.test(fixture.p6c.taskId) ||
    fixture.p6c.taskTitle.length === 0 ||
    !Number.isFinite(Date.parse(fixture.p6c.taskDueAt)) ||
    !uuidPattern.test(fixture.p6c.paymentStudentCaseId) ||
    !uuidPattern.test(fixture.p6c.paymentStudentMembershipId) ||
    !uuidPattern.test(fixture.p6c.paymentObligationId) ||
    fixture.p6c.paymentLabel.length === 0 ||
    !Number.isFinite(Date.parse(fixture.p6c.paymentDueAt)) ||
    Buffer.byteLength(fixture.p6c.workerTriggerSecret, "utf8") < 32)
) {
  throw new Error("P6C browser proof fixture is invalid");
}
if (
  p6dBrowserProof &&
  (!uuidPattern.test(fixture.p6d.organizationId) ||
    !uuidPattern.test(fixture.p6d.primaryStudentCaseId) ||
    !uuidPattern.test(fixture.p6d.primaryStudentMembershipId) ||
    !uuidPattern.test(fixture.p6d.secondaryStudentCaseId) ||
    !uuidPattern.test(fixture.p6d.secondaryStudentMembershipId) ||
    !uuidPattern.test(fixture.p6d.crossOrgOrganizationId) ||
    !uuidPattern.test(fixture.p6d.crossOrgStudentCaseId) ||
    !uuidPattern.test(fixture.p6d.crossOrgStudentMembershipId) ||
    fixture.p6d.applicationIds.length !== 2 ||
    fixture.p6d.applicationIds.some((id) => !uuidPattern.test(id)) ||
    fixture.p6d.applicationLabels.length !== 2 ||
    fixture.p6d.applicationLabels.some((label) => label.length === 0) ||
    !uuidPattern.test(fixture.p6d.documentSlotId) ||
    fixture.p6d.documentRequirementLabel.length === 0 ||
    fixture.p6d.documentReviewReason.length === 0 ||
    !uuidPattern.test(fixture.p6d.taskId) ||
    fixture.p6d.taskTitle.length === 0 ||
    !uuidPattern.test(fixture.p6d.paymentObligationId) ||
    fixture.p6d.paymentLabel.length === 0 ||
    fixture.p6c.supabaseSecretKey.length === 0 ||
    Buffer.byteLength(fixture.p6c.workerTriggerSecret, "utf8") < 32 ||
    !fixture.identities.admin ||
    !fixture.identities.curator ||
    !fixture.identities.student ||
    !fixture.identities.p6bStudent ||
    !fixture.identities.crossOrgAdmin ||
    !fixture.identities.crossOrgStudent)
) {
  throw new Error("P6D browser proof fixture is invalid");
}
if (
  p7aBrowserProof &&
  (!fixture.p7a ||
    !uuidPattern.test(fixture.p7a.eventId) ||
    !uuidPattern.test(fixture.p7a.requestId) ||
    !uuidPattern.test(fixture.p7a.resourceId) ||
    !nonEmptyString(fixture.p7a.action) ||
    !nonEmptyString(fixture.p7a.resourceType) ||
    !nonEmptyString(fixture.p7a.startAt) ||
    !nonEmptyString(fixture.p7a.endAt) ||
    !Number.isFinite(Date.parse(fixture.p7a.startAt)) ||
    !Number.isFinite(Date.parse(fixture.p7a.endAt)) ||
    Date.parse(fixture.p7a.startAt) >= Date.parse(fixture.p7a.endAt) ||
    !nonEmptyString(fixture.p7a.privatePrincipal) ||
    !nonEmptyString(fixture.p7a.privatePhone) ||
    !nonEmptyString(fixture.p7a.privateReason) ||
    !nonEmptyString(fixture.p7a.privateBefore) ||
    !nonEmptyString(fixture.p7a.privateAfter) ||
    !nonEmptyString(fixture.p7a.staleAdminAccessToken) ||
    !jwtShape.test(fixture.p7a.staleAdminAccessToken) ||
    !nonEmptyString(fixture.p7a.inactiveAdminAccessToken) ||
    !jwtShape.test(fixture.p7a.inactiveAdminAccessToken) ||
    !nonEmptyString(fixture.p7a.suspendedAdminAccessToken) ||
    !jwtShape.test(fixture.p7a.suspendedAdminAccessToken) ||
    !nonEmptyString(fixture.p7a.blockedAdminAccessToken) ||
    !jwtShape.test(fixture.p7a.blockedAdminAccessToken) ||
    !fixture.identities.admin ||
    !fixture.identities.crossOrgAdmin ||
    !fixture.identities.staleAdmin ||
    !fixture.identities.inactiveAdmin ||
    !fixture.identities.suspendedAdmin ||
    !fixture.identities.blocked)
) {
  throw new Error("P7A browser proof fixture is invalid");
}
if (
  p7bBrowserProof &&
  (!fixture.p7b ||
    !nonEmptyString(fixture.p7b.supabaseSecretKey) ||
    !nonEmptyString(fixture.p7b.observabilitySecret) ||
    Buffer.byteLength(fixture.p7b.observabilitySecret, "utf8") < 32 ||
    Buffer.byteLength(fixture.p7b.observabilitySecret, "utf8") > 128 ||
    /[\u0000-\u001f\u007f]/.test(fixture.p7b.observabilitySecret))
) {
  throw new Error("P7B browser proof fixture is invalid");
}

const platformMessagingProof =
  p5bBrowserProof ||
  p5cBrowserProof ||
  p5dBrowserProof ||
  p5eBrowserProof ||
  p5f3BrowserProof;

const port = 3311;
const baseURL = `http://127.0.0.1:${port}`;
const legacySentinel =
  process.env.EVO_PLATFORM_LEGACY_DB_SENTINEL ??
  path.join(path.dirname(fixturePath), "legacy-must-not-exist.db");

export default defineConfig({
  testDir: "./tests/platform-auth",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "output/playwright/platform-auth",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "platform-auth-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      EVO_PLATFORM_AUTH_DEV_RUN_KEY: platformAuthDevRunKey,
      EVO_PLATFORM_AUTH_BROWSER_PARTITION: platformAuthBrowserPartition,
      EVO_PLATFORM_AUTH_TSCONFIG_PATH: platformAuthTsconfigPath,
      NEXT_PUBLIC_SUPABASE_URL: fixture.apiUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: fixture.publishableKey,
      EVO_UI_CONTRACT_FIXTURES: "0",
      EVO_DB_PATH: legacySentinel,
      EVO_PLATFORM_P6A_PORTAL_ATTENTION_ENABLED:
        p6aBrowserProof || p6dBrowserProof ? "1" : "0",
      EVO_PLATFORM_P6B_PORTAL_NOTIFICATIONS_ENABLED:
        p6bBrowserProof || p6cBrowserProof || p6dBrowserProof ? "1" : "0",
      EVO_PLATFORM_P6C_OVERDUE_NOTIFICATIONS_ENABLED:
        p6cBrowserProof || p6dBrowserProof ? "1" : "0",
      EVO_PLATFORM_P6C_OVERDUE_TRIGGER_SECRET:
        p6cBrowserProof || p6dBrowserProof
          ? fixture.p6c.workerTriggerSecret
          : "",
      EVO_PLATFORM_P7A_AUDIT_ENABLED: p7aBrowserProof ? "1" : "0",
      EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: p7bBrowserProof ? "1" : "0",
      EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: p7bBrowserProof
        ? fixture.p7b.observabilitySecret
        : "",
      EVO_PLATFORM_WAHA_INGRESS_ENABLED:
        p5bBrowserProof ||
        p5dBrowserProof ||
        p5eBrowserProof ||
        p5f3BrowserProof
          ? "1"
          : "0",
      EVO_PLATFORM_WAHA_WORKER_ENABLED:
        p5bBrowserProof ||
        p5dBrowserProof ||
        p5eBrowserProof ||
        p5f3BrowserProof
          ? "1"
          : "0",
      EVO_PLATFORM_AI_MEMORY_ENABLED: p5f1BrowserProof ? "1" : "0",
      EVO_PLATFORM_ORGANIZATION_ID: platformMessagingProof
        ? p5dBrowserProof
          ? fixture.p5d.organizationId
          : fixture.p5b.organizationId
        : "",
      EVO_PLATFORM_SUPABASE_SECRET_KEY:
        platformMessagingProof || p6cBrowserProof || p6dBrowserProof || p7bBrowserProof
          ? p5dBrowserProof
            ? fixture.p5d.supabaseSecretKey
            : p6cBrowserProof || p6dBrowserProof
              ? fixture.p6c.supabaseSecretKey
              : p7bBrowserProof
                ? fixture.p7b.supabaseSecretKey
                : fixture.p5b.supabaseSecretKey
          : "",
      EVO_PLATFORM_WAHA_WEBHOOK_HMAC_SECRET:
        p5bBrowserProof || p5dBrowserProof || p5eBrowserProof || p5f3BrowserProof
        ? p5dBrowserProof
          ? fixture.p5d.ingressHmacSecret
          : fixture.p5b.ingressHmacSecret
        : "",
      EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID: platformMessagingProof
        ? p5dBrowserProof
          ? fixture.p5d.intakeSalesMembershipId
          : fixture.p5b.intakeSalesMembershipId
        : "",
      EVO_PLATFORM_WAHA_WORKER_TRIGGER_SECRET:
        p5bBrowserProof || p5dBrowserProof || p5eBrowserProof || p5f3BrowserProof
        ? p5dBrowserProof
          ? fixture.p5d.workerTriggerSecret
          : fixture.p5b.workerTriggerSecret
        : "",
      EVO_PLATFORM_WAHA_HISTORY_ENABLED: p5cBrowserProof ? "1" : "0",
      EVO_PLATFORM_WAHA_HISTORY_BASE_URL: p5cBrowserProof
        ? "http://127.0.0.1:3312"
        : "",
      EVO_PLATFORM_WAHA_HISTORY_API_KEY: p5cBrowserProof
        ? fixture.p5c.wahaApiKey
        : "",
      EVO_PLATFORM_WAHA_HISTORY_TRIGGER_SECRET: p5cBrowserProof
        ? fixture.p5c.historyTriggerSecret
        : "",
      EVO_PLATFORM_WAHA_MEDIA_ENABLED: p5dBrowserProof ? "1" : "0",
      EVO_PLATFORM_WAHA_MEDIA_BASE_URL: p5dBrowserProof
        ? "http://127.0.0.1:3313"
        : "",
      EVO_PLATFORM_WAHA_MEDIA_API_KEY: p5dBrowserProof
        ? fixture.p5d.wahaApiKey
        : "",
      EVO_PLATFORM_WAHA_MEDIA_TRIGGER_SECRET: p5dBrowserProof
        ? fixture.p5d.mediaTriggerSecret
        : "",
      EVO_PLATFORM_AUTONOMOUS_REPLIES_ENABLED: p5f3BrowserProof ? "1" : "0",
      EVO_PLATFORM_AUTONOMOUS_REPLIES_KILL_SWITCH: p5f3BrowserProof
        ? "0"
        : "1",
      EVO_PLATFORM_AUTONOMOUS_REPLIES_WAHA_BASE_URL: p5f3BrowserProof
        ? "http://127.0.0.1:3314"
        : "",
      EVO_PLATFORM_AUTONOMOUS_REPLIES_WAHA_API_KEY: p5f3BrowserProof
        ? fixture.p5c.wahaApiKey
        : "",
      EVO_PLATFORM_AUTONOMOUS_REPLIES_TRIGGER_SECRET: p5f3BrowserProof
        ? fixture.p5f3.autonomousReplyTriggerSecret
        : "",
    },
  },
});
