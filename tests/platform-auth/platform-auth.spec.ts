import { expect, test, type Locator, type Page } from "@playwright/test";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

type Identity = Readonly<{ email: string; password: string }>;
type ProvisionableIdentity = Identity & Readonly<{ authUserId: string }>;
type ConversationFixture = Readonly<{
  id: string;
  subject: string;
  messages: readonly string[];
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
  u2: Readonly<{
    clientId: string;
    leadId: string;
    clientDisplayName: string;
    leadStageKey: string;
    ownerDisplayName: string;
    clientExternalIdentifier: string;
    leadExternalIdentifier: string;
    provenanceSourceSystem: string;
    linkedConversationSubject: string;
  }>;
  identities: Readonly<{
    admin: Identity;
    curator: Identity;
    crossOrgAdmin: Identity;
    staleAdmin: Identity;
    inactiveAdmin: Identity;
    suspendedAdmin: Identity;
    salesScoped: Identity;
    responsibleSales: Identity;
    p5dSales: Identity;
    finance: Identity;
    student: Identity;
    studentNoCase: Identity;
    p6bStudent: Identity;
    crossOrgStudent: Identity;
    lifecycleStudent: Identity;
    blocked: Identity;
    noMembership: ProvisionableIdentity;
    revocableCurator: Identity;
  }>;
  conversations: Readonly<{
    orgA: ConversationFixture;
    orgB: ConversationFixture;
    orgAManual: ConversationFixture;
    orgBAiRequest: ConversationFixture;
    orgBAiReview: ConversationFixture;
    sameOrgOutsideSalesScope: ConversationFixture;
  }>;
  p3c: Readonly<{
    orgA: Readonly<{
      organizationId: string;
      studentCaseId: string;
      conversationId: string;
      selectedKnowledgeVersionId: string;
      aiDraftRequestId: string;
      aiDraftId: string;
      manualSendAuthorizationId: string;
      outboxWorkItemId: string;
      outboxKind: string;
      outboxState: string;
      outboxAttemptCount: number;
      outboxMaxAttempts: number;
      latestAuditAction: string;
      aiReadiness: string;
      aiEvidenceKind: string;
      wahaReadiness: string;
      wahaEvidenceKind: string;
      reviewedText: string;
      knowledgeTitle: string;
      knowledgeVersion: string;
      staleSalesAccessToken: string;
    }>;
    mutations: Readonly<{
      manualAiUnavailable: Readonly<{
        organizationId: string;
        conversationId: string;
        sourceMessageId: string;
        aiReadiness: string;
        wahaReadiness: string;
      }>;
      aiRequest: Readonly<{
        organizationId: string;
        conversationId: string;
        sourceMessageId: string;
        knowledgeVersionId: string;
      }>;
      aiReview: Readonly<{
        organizationId: string;
        conversationId: string;
        sourceMessageId: string;
        aiDraftId: string;
        generatedText: string;
      }>;
    }>;
  }>;
  p2r3: Readonly<{
    organizationId: string;
    revocableMembershipId: string;
  }>;
  bw3: Readonly<{
    orgA: Readonly<{
      organizationId: string;
      studentCaseId: string;
      studentProfileId: string;
      studentIdentityProfileId: string;
      sourceRegistryId: string;
      countryRequirementSourceLinkId: string;
      countryRequirementVersionId: string;
      documentRequirementId: string;
      documentSlotId: string;
      appliedDocumentSlotCount: number;
      profileRevision: number;
      checklist: Readonly<{
        targetCountry: string;
        targetDegree: string;
        programDirection: string;
        version: number;
        sourceCount: number;
        requiredProfileFields: readonly string[];
      }>;
      profile: Readonly<{
        preferredDisplayName: string;
        legalDisplayName: string | null;
        dateOfBirth: string | null;
        communicationLanguage: string;
        citizenshipCountry: string;
        residencyCountry: string | null;
        currentEducationSummary: string | null;
        academicSummary: string;
        languageSummary: string;
        budgetBand: string;
        decisionParticipantLabels: readonly string[];
        consentStatus: string;
        consentEvidenceRef: string | null;
        nextStep: string;
      }>;
      document: Readonly<{
        requirementKey: string;
        label: string;
        instructions: string;
        status: string;
      }>;
    }>;
    noCaseStudent: Readonly<{
      membershipId: string;
      profileId: string;
      displayName: string;
    }>;
  }>;
  bw4: Readonly<{
    orgA: Readonly<{
      organizationId: string;
      conversationId: string;
      studentCaseId: string;
      decisionId: string;
      decisionQuestion: string;
      reviewedSourceId: string;
      sourceKey: string;
      sourceUrl: string;
      answerText: string;
      reopenedStatus: string;
      promptPolicyTitle: string;
      promptPolicyVersion: string;
      promptPolicySha: string;
      businessContextTitle: string;
      businessContextVersion: string;
      businessContextSha: string;
      rawContentSentinel: string;
      handoffNextStep: string;
      responsibleRole: string;
    }>;
    noCase: Readonly<{
      organizationId: string;
      conversationId: string;
      studentCaseId: null;
    }>;
    languages: Readonly<{
      ruConversationId: string;
      enConversationId: string;
      undeterminedConversationId: string;
    }>;
    negative: Readonly<{
      formerSalesMembershipId: string;
      crossOrgOrganizationId: string;
      unrelatedStudentCaseId: string;
    }>;
  }>;
  bw6: Readonly<{
    orgA: Readonly<{
      organizationId: string;
      activeStudentCaseId: string;
      contractTemplateVersionId: string;
      studentCaseContractDraftId: string;
      postContractItemId: string;
      postContractReportId: string;
      templateKey: string;
      templateTitle: string;
    }>;
    salesPending: Readonly<{
      organizationId: string;
      studentCaseId: string;
      responsibleSalesMembershipId: string;
    }>;
    negative: Readonly<{
      crossOrgOrganizationId: string;
      unassignedActiveStudentCaseId: string;
    }>;
  }>;
  bw7: Readonly<{
    orgA: Readonly<{
      organizationId: string;
      studentCaseId: string;
      studentMembershipId: string;
      studentProfileId: string;
      curatorMembershipId: string;
      studentDisplayName: string;
    }>;
  }>;
}>;

const fixturePath = process.env.EVO_PLATFORM_AUTH_FIXTURE_PATH;
if (!fixturePath || !path.isAbsolute(fixturePath)) {
  throw new Error("EVO_PLATFORM_AUTH_FIXTURE_PATH must be an absolute path");
}
if ((statSync(fixturePath).mode & 0o777) !== 0o600) {
  throw new Error("Platform Auth fixture must use mode 0600");
}
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
const appOrigin = "http://127.0.0.1:3311";
const platformAuthCookieBaseName = `sb-${new URL(fixture.apiUrl).hostname.split(".")[0]}-auth-token`;

function isCurrentPlatformAuthCookie(name: string) {
  if (name === platformAuthCookieBaseName) return true;
  const chunkPrefix = `${platformAuthCookieBaseName}.`;
  return (
    name.startsWith(chunkPrefix) &&
    /^\d+$/.test(name.slice(chunkPrefix.length))
  );
}

function p7aPlatformSessionCookie(accessToken: string): string {
  const parts = accessToken.split(".");
  if (parts.length !== 3) throw new Error("P7A proof token is not a JWT");

  let claims: { exp?: unknown };
  try {
    claims = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { exp?: unknown };
  } catch {
    throw new Error("P7A proof token claims are invalid");
  }
  if (typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp)) {
    throw new Error("P7A proof token expiry is invalid");
  }

  const session = JSON.stringify({
    access_token: accessToken,
    refresh_token: "p7a-local-proof-refresh-disabled",
    expires_at: claims.exp,
    token_type: "bearer",
  });
  return `base64-${Buffer.from(session, "utf8").toString("base64url")}`;
}

async function installP7APlatformSession(page: Page, accessToken: string) {
  await page.context().addCookies([
    {
      name: platformAuthCookieBaseName,
      value: p7aPlatformSessionCookie(accessToken),
      url: appOrigin,
      sameSite: "Lax",
    },
  ]);
}
const configuredLegacyDatabaseSentinel =
  process.env.EVO_PLATFORM_LEGACY_DB_SENTINEL;
if (
  !configuredLegacyDatabaseSentinel ||
  !path.isAbsolute(configuredLegacyDatabaseSentinel)
) {
  throw new Error(
    "EVO_PLATFORM_LEGACY_DB_SENTINEL must be an absolute path",
  );
}
const legacyDatabaseSentinel = configuredLegacyDatabaseSentinel;

async function login(page: Page, identity: Identity) {
  await page.goto("/login");
  await page.locator("#login-email").fill(identity.email);
  await page.locator("#login-password").fill(identity.password);
  await page.getByRole("button", { name: "Войти" }).click();
}

function expectedStaffHome(identity: Identity): RegExp {
  if (identity === fixture.identities.curator) return /\/clients$/;
  if (identity === fixture.identities.finance) return /\/login$/;
  if (identity === fixture.identities.student) return /\/portal$/;
  if (identity === fixture.identities.studentNoCase) {
    return /\/platform-pending(?:\?.*)?$/;
  }
  return /\/sales$/;
}

async function loginToMessaging(page: Page, identity: Identity) {
  await login(page, identity);
  await expect(page).toHaveURL(expectedStaffHome(identity));
  await page.goto("/whatsapp");
  await expect(page).toHaveURL(/\/whatsapp$/);
}

async function localAccessToken(identity: Identity): Promise<string> {
  const response = await fetch(
    `${fixture.apiUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: fixture.publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(identity),
    },
  );
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("Local Auth did not return an admin access token");
  }
  return payload.access_token;
}

async function applicationCreateAudit(
  token: string,
  applicationId: string,
  requestId: string,
) {
  const result = await safeAuditSearch(token, {
    actions: ["application.create"],
    resourceTypes: ["university_application"],
    resourceId: applicationId,
  });
  expect(result.status).toBe(200);
  return safeAuditRows(result.payload).filter(
    (row) => row.request_id === requestId,
  );
}

function escapePathForRegex(pathname: string) {
  return pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function p7bObservabilityHeaders(
  pathname: "/api/readiness" | "/metrics",
  overrides: Readonly<{
    requestId?: string;
    timestamp?: string;
    secret?: string;
  }> = {},
) {
  const requestId = overrides.requestId ?? randomUUID();
  const timestamp = overrides.timestamp ?? Date.now().toString();
  const secret = overrides.secret ?? fixture.p7b.observabilitySecret;

  return Object.freeze({
    requestId,
    headers: Object.freeze({
      "x-evo-observability-request-id": requestId,
      "x-evo-observability-timestamp": timestamp,
      "x-evo-observability-hmac-algorithm": "sha256",
      "x-evo-observability-hmac": createHmac("sha256", secret)
        .update(`GET\n${pathname}\n${requestId}\n${timestamp}`)
        .digest("hex"),
    }),
  });
}

async function expectDeniedConversationRoute(page: Page, pathname: string) {
  await page.goto(pathname);
  await expect(page).toHaveURL(new RegExp(`${escapePathForRegex(pathname)}$`));
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "This page could not be found." }),
  ).toBeVisible();
  await expect(page.getByTestId("platform-conversation-thread")).toHaveCount(0);
}

async function workflowRpc(
  token: string,
  conversationId: string,
) {
  const response = await fetch(`${fixture.apiUrl}/rest/v1/rpc/staff_conversation_workflow`, {
    method: "POST",
    headers: {
      apikey: fixture.publishableKey,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Profile": "platform",
      "Content-Profile": "platform",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_organization_id: fixture.p3c.orgA.organizationId,
      p_conversation_id: conversationId,
    }),
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) payload = JSON.parse(text);
  return { status: response.status, payload };
}

async function platformRpc(
  token: string,
  routineName: string,
  body: Readonly<Record<string, unknown>>,
  apiKey = fixture.publishableKey,
) {
  const response = await fetch(
    `${fixture.apiUrl}/rest/v1/rpc/${routineName}`,
    {
      method: "POST",
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Profile": "platform",
        "Content-Profile": "platform",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text();
  let payload: unknown = null;
  if (text) payload = JSON.parse(text);
  return { status: response.status, payload };
}

type SafeAuditSearchOptions = Readonly<{
  actions?: readonly string[];
  resourceTypes?: readonly string[];
  resourceId?: string;
  startAt?: string;
  endAt?: string;
}>;

async function safeAuditSearch(
  token: string,
  options: SafeAuditSearchOptions = {},
) {
  return platformRpc(token, "search_audit_events", {
    p_start_at: options.startAt ?? null,
    p_end_at: options.endAt ?? null,
    p_actions: options.actions ?? null,
    p_resource_types: options.resourceTypes ?? null,
    p_resource_id: options.resourceId ?? null,
    p_page_size: 100,
    p_snapshot_created_at: null,
    p_snapshot_id: null,
    p_cursor_created_at: null,
    p_cursor_id: null,
  });
}

function safeAuditRows(payload: unknown): Array<Record<string, unknown>> {
  expect(payload).toEqual(
    expect.objectContaining({ rows: expect.any(Array) }),
  );
  const rows = (payload as { rows: unknown }).rows;
  if (!Array.isArray(rows)) {
    throw new Error("Safe audit search did not return a row array");
  }
  return rows as Array<Record<string, unknown>>;
}

async function platformRows(
  token: string,
  resource: string,
  query: URLSearchParams,
) {
  const response = await fetch(
    `${fixture.apiUrl}/rest/v1/${resource}?${query.toString()}`,
    {
      headers: {
        apikey: fixture.publishableKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Profile": "platform",
      },
    },
  );
  const text = await response.text();
  let payload: unknown = null;
  if (text) payload = JSON.parse(text);
  return { status: response.status, payload };
}

function expectLegacyDatabaseUntouched() {
  expect(existsSync(legacyDatabaseSentinel)).toBe(false);
}

async function openOrgAConversation(page: Page, identity: Identity) {
  await loginToMessaging(page, identity);
  await page.goto(`/whatsapp/${fixture.p3c.orgA.conversationId}`);
  await expect(page).toHaveURL(
    new RegExp(`/whatsapp/${fixture.p3c.orgA.conversationId}$`),
  );
}

async function openConversation(
  page: Page,
  identity: Identity,
  conversationId: string,
) {
  await loginToMessaging(page, identity);
  await page.goto(`/whatsapp/${conversationId}`);
  await expect(page).toHaveURL(new RegExp(`/whatsapp/${conversationId}$`));
  await expect(page.getByTestId("platform-messaging-workflow")).toBeVisible();
}

async function assertPersistedP3cWorkflow(page: Page) {
  const thread = page.getByTestId("platform-conversation-thread");
  await expect(thread).toBeVisible();
  await expect(thread).toHaveAttribute("data-provider-proof", "not-proved");

  const workflow = page.getByTestId("platform-messaging-workflow");
  await expect(workflow).toBeVisible();
  await expect(workflow).toHaveAttribute("data-provider-proof", "not-proved");

  const health = page.getByTestId("platform-workflow-health");
  await expect(health).toBeVisible();
  await expect(
    health.locator(
      `[data-integration-readiness="${fixture.p3c.orgA.aiReadiness}"][data-provider-proof="not-proved"]`,
    ),
  ).toHaveCount(1);
  await expect(
    health.locator(
      `[data-integration-readiness="${fixture.p3c.orgA.wahaReadiness}"][data-provider-proof="proved"]`,
    ),
  ).toHaveCount(1);
  await expect(workflow).not.toContainText("synthetic:health:");

  await expect(page.getByTestId("platform-workflow-audit")).toContainText(
    fixture.p3c.orgA.latestAuditAction,
  );
  await expect(
    workflow.getByText(fixture.p3c.orgA.reviewedText, { exact: true }),
  ).toBeVisible();
  await expect(workflow).toContainText(fixture.p3c.orgA.knowledgeTitle);

  const outbox = page.getByTestId("platform-outbox-state");
  await expect(outbox).toBeVisible();
  await expect(
    outbox.locator(
      `[data-outbox-kind="${fixture.p3c.orgA.outboxKind}"][data-outbox-state="${fixture.p3c.orgA.outboxState}"]`,
    ),
  ).toHaveCount(1);

  await expect(page.getByTestId("platform-knowledge-select")).toHaveCount(0);
  await expect(page.getByTestId("platform-request-draft")).toHaveCount(0);
  await expect(page.getByTestId("platform-draft-editor")).toHaveCount(0);
  await expect(page.getByTestId("platform-review-approve")).toHaveCount(0);
  await expect(page.getByTestId("platform-manual-send")).toHaveCount(0);
}

test("RU and EN draft requests work while uncertain language stops for manual selection", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await loginToMessaging(page, fixture.identities.crossOrgAdmin);

  for (const [conversationId, language] of [
    [fixture.bw4.languages.ruConversationId, "ru"],
    [fixture.bw4.languages.enConversationId, "en"],
  ] as const) {
    await page.goto(`/whatsapp/${conversationId}`);
    await expect(page.getByTestId("platform-language-gate")).toHaveAttribute(
      "data-language-gate",
      language,
    );
    await expect(page.locator("#platform-draft-language")).toHaveValue(language);
    await page
      .locator("#platform-draft-reason")
      .fill(`Browser proof for the ${language.toUpperCase()} draft path`);
    await page.getByTestId("platform-request-draft").click();
    await expect(page.getByTestId("platform-draft-awaiting")).toBeVisible();
    await expect(
      page
        .getByTestId("platform-outbox-state")
        .locator('[data-outbox-kind="ai_draft_generate"]'),
    ).toHaveCount(1);
    await expect(
      page
        .getByTestId("platform-outbox-state")
        .locator('[data-outbox-kind="manual_whatsapp_send"]'),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("platform-language-gate")).toHaveAttribute(
      "data-language-gate",
      language,
    );
  }

  await page.goto(
    `/whatsapp/${fixture.bw4.languages.undeterminedConversationId}`,
  );
  const languageGate = page.getByTestId("platform-language-gate");
  await expect(languageGate).toHaveAttribute(
    "data-language-gate",
    "manual-selection-required",
  );
  const languageSelect = page.locator("#platform-draft-language");
  await expect(languageSelect).toHaveValue("");
  await expect(languageSelect).toBeEnabled();
  await expect(languageSelect.locator('option[value="ky"]')).toHaveCount(0);
  await expect(page.getByTestId("platform-request-draft")).toBeDisabled();

  await languageSelect.selectOption("ru");
  await expect(languageGate).toHaveAttribute("data-language-gate", "ru");
  await expect(page.getByTestId("platform-request-draft")).toBeEnabled();
});

test("self-registration is disabled before any account write", async ({
  page,
}) => {
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Доступ по приглашению" })).toBeVisible();
  await expect(page.locator('input[id^="register-"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Вернуться ко входу" })).toBeVisible();
});

test("wrong password and unprovisioned authorities fail closed", async ({
  page,
}) => {
  await login(page, {
    email: fixture.identities.admin.email,
    password: `${fixture.identities.admin.password}-wrong`,
  });
  await expect(page.locator("#login-error")).toHaveText(
    "Неверная почта или пароль",
  );
  await expect(page).toHaveURL(/\/login$/);

  for (const identity of [
    fixture.identities.blocked,
    fixture.identities.suspendedAdmin,
    fixture.identities.finance,
    fixture.identities.noMembership,
  ]) {
    await login(page, identity);
    await expect(page.locator("#login-error")).toContainText(
      "не назначен активный доступ",
    );
    await expect(page).toHaveURL(/\/login$/);
  }
});

test("the three U1 pilot roles use one login and one EVO staff shell", async ({
  browser,
}) => {
  for (const [label, identity, destination] of [
    ["Director/Admin", fixture.identities.admin, "/sales"],
    ["Sales Manager", fixture.identities.salesScoped, "/sales"],
    ["Admissions Manager", fixture.identities.curator, "/clients"],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, identity);
    await expect(page, label).toHaveURL(new RegExp(`${destination}$`));
    await expect(
      page.getByRole("navigation", {
        name: /Основная навигация|Негизги навигация|Primary navigation/,
      }).first(),
      label,
    ).toBeVisible();
    await context.close();
  }
});

test("U2 reads canonical EVO clients and leads through real Supabase with tenant isolation", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  expectLegacyDatabaseUntouched();

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, fixture.identities.admin);
  await expect(adminPage).toHaveURL(/\/sales$/);
  await expect(adminPage.getByTestId("canonical-sales-page")).toBeVisible();
  await expect(adminPage.getByTestId("canonical-evo-authority")).toContainText(
    /Источник истины — EVO|Чындыктын булагы — EVO|Source of truth — EVO/,
  );

  const leadRow = adminPage.locator(
    `[data-testid="canonical-lead-row"][data-lead-id="${fixture.u2.leadId}"]`,
  );
  await expect(leadRow).toBeVisible();
  await expect(leadRow).toContainText(fixture.u2.clientDisplayName);
  await expect(leadRow.getByTestId("canonical-lead-stage")).toContainText(
    "Qualified",
  );
  await expect(leadRow.getByTestId("canonical-lead-owner")).toContainText(
    fixture.u2.ownerDisplayName,
  );
  await expect(
    adminPage.getByText(/amoCRM.*(?:источник истины|source of truth)/i),
  ).toHaveCount(0);

  await adminPage.goto(`/sales/${fixture.u2.leadId}`);
  const leadDetail = adminPage.getByTestId("canonical-lead-detail");
  await expect(leadDetail).toBeVisible();
  await expect(leadDetail.getByTestId("canonical-lead-stage")).toContainText(
    "Qualified",
  );
  await expect(leadDetail.getByTestId("canonical-lead-owner")).toContainText(
    fixture.u2.ownerDisplayName,
  );
  await expect(
    leadDetail.getByTestId("canonical-external-identifiers"),
  ).toContainText(fixture.u2.leadExternalIdentifier);
  await expect(leadDetail.getByTestId("canonical-provenance")).toContainText(
    "Local Test",
  );
  await expect(
    leadDetail.getByTestId("canonical-linked-context"),
  ).toContainText(fixture.u2.linkedConversationSubject);

  await adminPage.goto("/sales?q=one&q=two");
  await expect(
    adminPage.getByTestId("canonical-records-unavailable"),
  ).toContainText(/не подставляются|ордуна коюлбайт|not substituted/);

  await adminPage.goto("/clients");
  await expect(adminPage.getByTestId("canonical-clients-page")).toBeVisible();
  const clientRow = adminPage.locator(
    `[data-testid="canonical-client-row"][data-client-id="${fixture.u2.clientId}"]`,
  );
  await expect(clientRow).toBeVisible();
  await expect(clientRow).toContainText(fixture.u2.clientDisplayName);

  await adminPage.goto(`/clients/${fixture.u2.clientId}`);
  const clientDetail = adminPage.getByTestId("canonical-client-detail");
  await expect(clientDetail).toBeVisible();
  await expect(clientDetail).toContainText(fixture.u2.clientDisplayName);
  await expect(
    clientDetail.getByTestId("canonical-external-identifiers"),
  ).toContainText(fixture.u2.clientExternalIdentifier);
  await expect(clientDetail.getByTestId("canonical-provenance")).toContainText(
    "Local Test",
  );
  await expect(
    clientDetail.getByTestId("canonical-linked-context"),
  ).toContainText(fixture.u2.linkedConversationSubject);

  await adminPage.goto("/clients?unexpected=1");
  await expect(
    adminPage.getByTestId("canonical-records-unavailable"),
  ).toContainText(/не подставляются|ордуна коюлбайт|not substituted/);
  await adminContext.close();

  const crossOrgContext = await browser.newContext();
  const crossOrgPage = await crossOrgContext.newPage();
  await login(crossOrgPage, fixture.identities.crossOrgAdmin);
  await expect(crossOrgPage).toHaveURL(/\/sales$/);
  await expect(crossOrgPage.getByTestId("canonical-leads-empty")).toContainText(
    /не подставляются|ордуна коюлбайт|not substituted/,
  );
  await crossOrgPage.goto(`/sales/${fixture.u2.leadId}`);
  await expect(crossOrgPage.getByTestId("canonical-lead-not-found")).toBeVisible();
  await expect(crossOrgPage.locator("body")).not.toContainText(
    fixture.u2.clientDisplayName,
  );

  await crossOrgPage.goto("/clients");
  await expect(crossOrgPage.getByTestId("canonical-clients-empty")).toContainText(
    /не подставляются|ордуна коюлбайт|not substituted/,
  );
  await crossOrgPage.goto(`/clients/${fixture.u2.clientId}`);
  await expect(
    crossOrgPage.getByTestId("canonical-client-not-found"),
  ).toBeVisible();
  await expect(crossOrgPage.locator("body")).not.toContainText(
    fixture.u2.clientDisplayName,
  );
  await crossOrgContext.close();

  expectLegacyDatabaseUntouched();
});

test("route-level auth failures surface an explicit login error", async ({
  page,
}) => {
  await page.goto("/login?error=authority_not_found");
  await expect(page.locator("#login-error")).toContainText(
    "не назначен активный доступ",
  );

  await page.goto("/login?error=platform_unavailable");
  await expect(page.locator("#login-error")).toContainText(
    "не может проверить вход",
  );
});

test("a direct stale-session handler request preserves a valid Admin session", async ({
  page,
}) => {
  expectLegacyDatabaseUntouched();
  await login(page, fixture.identities.admin);
  await expect(page).toHaveURL(`${appOrigin}/sales`);

  const before = (await page.context().cookies()).filter(({ name }) =>
    isCurrentPlatformAuthCookie(name),
  );
  expect(before.length).toBeGreaterThan(0);

  await page.goto(
    "/auth/platform-session?reason=fake&next=https://evil.test",
  );
  await expect(page).toHaveURL(`${appOrigin}/sales`);

  const after = (await page.context().cookies()).filter(({ name }) =>
    isCurrentPlatformAuthCookie(name),
  );
  expect(after.length).toBeGreaterThan(0);
  expectLegacyDatabaseUntouched();
});

test("a revoked live authority clears only this Platform session", async ({
  page,
}) => {
  expectLegacyDatabaseUntouched();
  await login(page, fixture.identities.revocableCurator);
  await expect(page).toHaveURL(`${appOrigin}/clients`);

  const authenticatedCookies = (await page.context().cookies()).filter(
    ({ name }) => isCurrentPlatformAuthCookie(name),
  );
  expect(authenticatedCookies.length).toBeGreaterThan(0);

  const legacySentinelValue = `p2r3-legacy-${randomUUID()}`;
  const foreignSupabaseSentinelValue = `p2r3-foreign-${randomUUID()}`;
  await page.context().addCookies([
    {
      name: "edu_session",
      value: legacySentinelValue,
      url: appOrigin,
      sameSite: "Lax",
    },
    {
      name: "sb-other-auth-token",
      value: foreignSupabaseSentinelValue,
      url: appOrigin,
      sameSite: "Lax",
    },
  ]);

  const adminToken = await localAccessToken(fixture.identities.admin);
  const revocation = await platformRpc(
    adminToken,
    "change_pilot_staff_status",
    {
      p_organization_id: fixture.p2r3.organizationId,
      p_membership_id: fixture.p2r3.revocableMembershipId,
      p_new_status: "blocked",
      p_reason: "P2R3 local browser stale-authority proof",
      p_request_id: randomUUID(),
    },
  );
  expect(revocation.status).toBe(200);

  await page.goto("/whatsapp");
  await expect(page).toHaveURL(
    `${appOrigin}/login?error=authority_not_found`,
  );

  const finalCookies = await page.context().cookies();
  expect(
    finalCookies.filter(({ name }) => isCurrentPlatformAuthCookie(name)),
  ).toEqual([]);
  expect(
    finalCookies.find(({ name }) => name === "edu_session")?.value,
  ).toBe(legacySentinelValue);
  expect(
    finalCookies.find(({ name }) => name === "sb-other-auth-token")?.value,
  ).toBe(foreignSupabaseSentinelValue);
  expectLegacyDatabaseUntouched();
});

test("U1 Admin manages individual sensitive permissions while UI, RPC and RLS deny non-Admin access", async ({
  browser,
  page,
}) => {
  const settingsPath = "/settings?tab=staff";
  const salesTokenBefore = await localAccessToken(fixture.identities.salesScoped);

  for (const permission of [
    "contract.evidence.confirm",
    "finance.first.payment.confirm",
  ] as const) {
    const denied = await platformRpc(
      salesTokenBefore,
      "assert_sensitive_permission",
      {
        p_organization_id: fixture.p5b.organizationId,
        p_permission_key: permission,
      },
    );
    expect(denied.status, `${permission}-default-deny`).toBe(403);
  }

  const nonAdminDirectory = await platformRpc(
    salesTokenBefore,
    "staff_directory",
    { p_organization_id: fixture.p5b.organizationId },
  );
  expect(nonAdminDirectory.status).toBe(403);
  const nonAdminDirectRead = await platformRows(
    salesTokenBefore,
    "membership_permission_events",
    new URLSearchParams({ select: "id" }),
  );
  expect([401, 403]).toContain(nonAdminDirectRead.status);

  const deniedMembershipId = randomUUID();
  for (const [rpcName, args] of [
    [
      "provision_pilot_staff_member",
      {
        p_organization_id: fixture.p5b.organizationId,
        p_member_auth_user_id: randomUUID(),
        p_member_display_name: "Denied non-Admin provision",
        p_role: "sales",
        p_reason: "U1 non-Admin provisioning denial",
        p_request_id: randomUUID(),
      },
    ],
    [
      "change_pilot_staff_role",
      {
        p_organization_id: fixture.p5b.organizationId,
        p_membership_id: deniedMembershipId,
        p_new_role: "curator",
        p_reason: "U1 non-Admin role denial",
        p_request_id: randomUUID(),
      },
    ],
    [
      "change_pilot_staff_status",
      {
        p_organization_id: fixture.p5b.organizationId,
        p_membership_id: deniedMembershipId,
        p_new_status: "suspended",
        p_reason: "U1 non-Admin status denial",
        p_request_id: randomUUID(),
      },
    ],
    [
      "change_membership_permission",
      {
        p_organization_id: fixture.p5b.organizationId,
        p_membership_id: deniedMembershipId,
        p_permission_key: "contract.evidence.confirm",
        p_granted: true,
        p_reason: "U1 non-Admin permission denial",
        p_request_id: randomUUID(),
      },
    ],
  ] as const) {
    const deniedMutation = await platformRpc(salesTokenBefore, rpcName, args);
    expect(deniedMutation.status, `${rpcName}-non-admin-denial`).toBe(403);
  }

  const deniedContext = await browser.newContext();
  const deniedPage = await deniedContext.newPage();
  await login(deniedPage, fixture.identities.salesScoped);
  await deniedPage.goto(settingsPath);
  await expect(deniedPage.getByTestId("platform-staff-settings")).toHaveCount(0);
  await expect(deniedPage).toHaveURL(/\/platform-pending/);
  await deniedContext.close();

  await login(page, fixture.identities.admin);
  const settingsNav = page
    .locator(".staff-sidebar")
    .getByRole("link", { name: "Настройки", exact: true });
  await expect(settingsNav).toHaveAttribute("href", settingsPath);
  await settingsNav.click();
  await expect(page.getByTestId("platform-staff-settings")).toBeVisible();
  await expect(page.getByTestId("platform-audit-settings-link")).toHaveCount(0);

  const lifecycleDisplayName = "Synthetic U1 UI lifecycle";
  const provisionForm = page.getByTestId("platform-staff-provision");
  await provisionForm
    .locator('input[name="auth_user_id"]')
    .fill(fixture.identities.noMembership.authUserId);
  await provisionForm
    .locator('input[name="display_name"]')
    .fill(lifecycleDisplayName);
  await provisionForm.locator('select[name="role"]').selectOption("sales");
  await provisionForm
    .locator('input[name="reason"]')
    .fill("U1 browser provisioning lifecycle proof");
  await provisionForm.getByRole("button", { name: "Добавить" }).click();
  await expect(page).toHaveURL(/staff_result=provisioned/);

  const lifecycleRow = page.getByTestId("platform-staff-row").filter({
    hasText: lifecycleDisplayName,
  });
  await expect(lifecycleRow).toHaveCount(1);
  await expect(lifecycleRow).toContainText("Sales Manager");

  const provisionedContext = await browser.newContext();
  const provisionedPage = await provisionedContext.newPage();
  await login(provisionedPage, fixture.identities.noMembership);
  await expect(provisionedPage).toHaveURL(/\/sales$/);
  await provisionedContext.close();

  const roleForm = lifecycleRow.getByTestId("platform-staff-role");
  await roleForm.locator('select[name="role"]').selectOption("curator");
  await roleForm
    .locator('input[name="reason"]')
    .fill("U1 browser role lifecycle proof");
  await roleForm.getByRole("button", { name: "Изменить роль" }).click();
  await expect(page).toHaveURL(/staff_result=role_changed/);
  await expect(lifecycleRow).toContainText("Admissions Manager");

  for (const [status, label] of [
    ["invited", "Приглашён"],
    ["active", "Активен"],
    ["suspended", "Приостановлен"],
    ["active", "Активен"],
    ["inactive", "Неактивен"],
    ["active", "Активен"],
    ["blocked", "Заблокирован"],
  ] as const) {
    const statusForm = lifecycleRow.getByTestId("platform-staff-status");
    await statusForm.locator('select[name="status"]').selectOption(status);
    await statusForm
      .locator('input[name="reason"]')
      .fill(`U1 browser ${status} lifecycle proof`);
    await statusForm.getByRole("button", { name: "Изменить статус" }).click();
    await expect(page).toHaveURL(/staff_result=status_changed/);
    await expect(lifecycleRow).toContainText(label);
  }

  const salesRow = page.getByTestId("platform-staff-row").filter({
    hasText: "Synthetic sales-scoped",
  });
  await expect(salesRow).toHaveCount(1);

  for (const permission of [
    "contract.evidence.confirm",
    "finance.first.payment.confirm",
  ] as const) {
    const form = salesRow.getByTestId(`platform-staff-permission-${permission}`);
    await form.locator('input[name="reason"]').fill(`U1 grant ${permission}`);
    await form.getByRole("button", { name: "Выдать" }).click();
    await expect(page).toHaveURL(/staff_result=permission_changed/);
  }

  const staleAfterGrant = await platformRpc(
    salesTokenBefore,
    "assert_sensitive_permission",
    {
      p_organization_id: fixture.p5b.organizationId,
      p_permission_key: "contract.evidence.confirm",
    },
  );
  expect(staleAfterGrant.status).toBe(403);

  const grantedSalesToken = await localAccessToken(fixture.identities.salesScoped);
  for (const permission of [
    "contract.evidence.confirm",
    "finance.first.payment.confirm",
  ] as const) {
    const allowed = await platformRpc(
      grantedSalesToken,
      "assert_sensitive_permission",
      {
        p_organization_id: fixture.p5b.organizationId,
        p_permission_key: permission,
      },
    );
    expect(allowed.status, `${permission}-explicit-grant`).toBe(200);
    expect(allowed.payload).toMatchObject({
      organization_id: fixture.p5b.organizationId,
      permission_key: permission,
      authorized: true,
    });
    const crossOrganization = await platformRpc(
      grantedSalesToken,
      "assert_sensitive_permission",
      {
        p_organization_id: fixture.p6d.crossOrgOrganizationId,
        p_permission_key: permission,
      },
    );
    expect(crossOrganization.status, `${permission}-cross-org`).toBe(403);
  }

  for (const permission of [
    "contract.evidence.confirm",
    "finance.first.payment.confirm",
  ] as const) {
    const form = salesRow.getByTestId(`platform-staff-permission-${permission}`);
    await form.locator('input[name="reason"]').fill(`U1 revoke ${permission}`);
    await form.getByRole("button", { name: "Отозвать" }).click();
    await expect(page).toHaveURL(/staff_result=permission_changed/);
  }

  const staleAfterRevoke = await platformRpc(
    grantedSalesToken,
    "assert_sensitive_permission",
    {
      p_organization_id: fixture.p5b.organizationId,
      p_permission_key: "finance.first.payment.confirm",
    },
  );
  expect(staleAfterRevoke.status).toBe(403);
  const revokedSalesToken = await localAccessToken(fixture.identities.salesScoped);
  const revoked = await platformRpc(
    revokedSalesToken,
    "assert_sensitive_permission",
    {
      p_organization_id: fixture.p5b.organizationId,
      p_permission_key: "finance.first.payment.confirm",
    },
  );
  expect(revoked.status).toBe(403);

  const adminToken = await localAccessToken(fixture.identities.admin);
  const auditRows = await safeAuditSearch(adminToken, {
    actions: ["membership.permission.change"],
    resourceTypes: ["organization_membership"],
    resourceId: fixture.bw6.salesPending.responsibleSalesMembershipId,
  });
  expect(auditRows.status).toBe(200);
  expect(safeAuditRows(auditRows.payload)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        action: "membership.permission.change",
        resource_id: fixture.bw6.salesPending.responsibleSalesMembershipId,
        changed_field_codes: ["sensitive_permission"],
      }),
    ]),
  );
  expect(safeAuditRows(auditRows.payload).length).toBeGreaterThanOrEqual(4);
});

test("admin opens ordered synthetic inbound messages through Supabase RLS", async ({
  page,
}) => {
  await loginToMessaging(page, fixture.identities.admin);

  const list = page.getByTestId("platform-conversation-list");
  await expect(list).toBeVisible();
  await expect(
    list.getByText(fixture.conversations.orgA.subject, { exact: true }),
  ).toBeVisible();
  await expect(
    list.getByText(fixture.conversations.orgB.subject, { exact: true }),
  ).toHaveCount(0);

  await list
    .locator(`a[href="/whatsapp/${fixture.conversations.orgA.id}"]`)
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/whatsapp/${fixture.conversations.orgA.id}$`),
  );

  const thread = page.getByTestId("platform-conversation-thread");
  await expect(thread).toBeVisible();
  await expect(thread).toHaveAttribute("data-provider-proof", "not-proved");
  const disclosure = page.getByTestId("platform-synthetic-data-disclosure");
  await expect(disclosure).toContainText("Синтетические локальные данные");
  await expect(disclosure).toContainText("не получена от клиента");
  await expect(disclosure).toContainText(
    "не подтверждает работу внешних провайдеров",
  );

  const inboundMessages = thread.locator(
    '[data-message-direction="inbound"]',
  );
  await expect(inboundMessages).toHaveCount(
    fixture.conversations.orgA.messages.length,
  );
  for (const [index, body] of fixture.conversations.orgA.messages.entries()) {
    await expect(inboundMessages.nth(index)).toContainText(body);
  }

  await expectDeniedConversationRoute(
    page,
    `/whatsapp/${fixture.conversations.orgB.id}`,
  );
});

test("admin reads the persisted local P3C workflow without proving providers", async ({
  page,
}) => {
  await openOrgAConversation(page, fixture.identities.admin);
  await assertPersistedP3cWorkflow(page);
});

test("assigned Curator reads the same persisted local P3C workflow", async ({
  page,
}) => {
  await openOrgAConversation(page, fixture.identities.curator);
  await assertPersistedP3cWorkflow(page);
});

test("same-organization Sales cannot open another Sales scope", async ({
  page,
}) => {
  await loginToMessaging(page, fixture.identities.salesScoped);

  const list = page.getByTestId("platform-conversation-list");
  await expect(list).toBeVisible();
  await expect(
    list.getByText(fixture.conversations.sameOrgOutsideSalesScope.subject, {
      exact: true,
    }),
  ).toHaveCount(0);

  await expectDeniedConversationRoute(
    page,
    `/whatsapp/${fixture.conversations.sameOrgOutsideSalesScope.id}`,
  );
});

test("active staff reaches only connected Supabase-backed surfaces", async ({
  page,
}) => {
  await login(page, fixture.identities.admin);
  await expect(page).toHaveURL(/\/sales$/);
  await expect(page.getByTestId("platform-sales-page")).toBeVisible();
  await expect(
    page
      .getByTestId("platform-sales-intake")
      .getByText(fixture.conversations.orgA.subject, { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("platform-sales-intake-row").first()).toBeVisible();
  await expect(
    page.getByRole("navigation", {
      name: /Основная навигация|Негизги навигация|Primary navigation/,
    }).first(),
  ).toBeVisible();
  await expect(page.getByText(/Контракт OP утверждён · v\d+/)).toBeVisible();

  await page.goto("/clients");
  const clientsPage = page.getByTestId("platform-clients-page");
  await expect(clientsPage).toBeVisible();
  await expect(
    clientsPage.getByRole("heading", { name: "Student 360" }),
  ).toBeVisible();
  await expect(
    clientsPage.getByText("Synthetic Org A Student", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: /Synthetic Org A Student/ }).first(),
  ).toBeVisible();

  await page.goto("/applications");
  const applicationsPage = page.getByTestId("platform-applications-page");
  await expect(applicationsPage).toBeVisible();
  await expect(
    page.getByRole("navigation", {
      name: /Статусы заявок|Арыз статустары|Application statuses/,
    }),
  ).toBeVisible();
  for (const [index, applicationLabel] of fixture.p6d.applicationLabels.entries()) {
    const [institution, program] = applicationLabel.split(" — ");
    const applicationRow = applicationsPage.getByRole("row").filter({
      has: page.getByRole("link", {
        name: institution,
        exact: true,
      }),
    });
    await expect(applicationRow).toHaveCount(1);
    await expect(applicationRow).toContainText(program);
    await expect(applicationRow).not.toContainText(
      fixture.p6d.applicationIds[index],
    );
  }
  await expect(
    page.getByText("Заявок по выбранному фильтру нет."),
  ).toHaveCount(0);
  await expect(applicationsPage).not.toContainText(
    "synthetic:p6d:application:1",
  );
  await expect(applicationsPage).not.toContainText(
    "synthetic:p6d:application:2",
  );
  await expect(
    applicationsPage.locator('input[name="evidence_reference"]'),
  ).toHaveValue("");

  await page.goto("/whatsapp");
  await expect(page).toHaveURL(/\/whatsapp$/);
  await expect(page.getByTestId("platform-conversation-list")).toBeVisible();
  await expect(
    page.getByText(fixture.conversations.orgA.subject, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/локальных таблиц CRM wa_/i)).toHaveCount(0);

  for (const legacyRoute of [
    "/dashboard",
    "/documents",
    "/visa",
    "/calls",
    "/notifications",
    "/tasks",
    "/chat",
    "/reports",
    "/finance",
    "/settings",
  ]) {
    await page.goto(legacyRoute);
    const destination = new URL(page.url());
    expect(destination.pathname, legacyRoute).toBe("/platform-pending");
    expect(destination.searchParams.get("from"), legacyRoute).toBe(legacyRoute);
    await expect(page.getByTestId("platform-pending")).toBeVisible();
  }

  const apiResults = await page.evaluate(
    async (requests) =>
      Promise.all(
        requests.map(async ({ path, method }) => {
          const response = await fetch(path, { method });
          return {
            path,
            status: response.status,
            body: await response.json(),
          };
        }),
      ),
    [
      { path: "/api/readiness", method: "GET" },
      { path: "/api/ai/draft", method: "POST" },
      { path: "/api/transcription/jobs", method: "POST" },
      { path: "/api/waha/qr", method: "GET" },
      { path: "/api/webhooks/waha", method: "POST" },
      { path: "/api/webhooks/whatsapp", method: "POST" },
      { path: "/api/webhooks/telephony", method: "POST" },
    ],
  );
  for (const result of apiResults) {
    expect(result.status, result.path).toBe(403);
    expect(result.body, result.path).toEqual(
      expect.objectContaining({ error: "platform_route_not_connected" }),
    );
  }

  const staffAssistantBoundary = await page.evaluate(async () => {
    const request = async (path: string) => {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          audience: "internal",
          question: "Non-customer disabled-boundary check",
        }),
      });
      return { path, status: response.status, body: await response.json() };
    };
    return Promise.all([
      request("/api/platform-ai/staff-assistant"),
      request("/api/platform-ai/staff-assistant/preview"),
      request("/api/platform-ai/draft"),
    ]);
  });
  expect(staffAssistantBoundary[0]).toEqual({
    path: "/api/platform-ai/staff-assistant",
    status: 503,
    body: { error: { code: "assistant_disabled" } },
  });
  for (const result of staffAssistantBoundary.slice(1)) {
    expect(result.status, result.path).toBe(403);
    expect(result.body, result.path).toEqual(
      expect.objectContaining({ error: "platform_route_not_connected" }),
    );
  }

  const connectedPrivateApis = await page.evaluate(async () => {
    const request = async (path: string) => {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      return { path, status: response.status, body: await response.json() };
    };
    return Promise.all([
      request("/api/internal/lead-agent/whatsapp"),
      request("/api/internal/platform-ai/gemini/proposal"),
      request("/api/internal/lead-agent/whatsapp/extra"),
      request("/api/internal/platform-ai/gemini/proposal/extra"),
      request("/api/internal/platform-messaging/waha/events/extra"),
    ]);
  });
  expect(connectedPrivateApis[0]).toEqual({
    path: "/api/internal/lead-agent/whatsapp",
    status: 503,
    body: { error: "not_configured", missing: ["lead_agent_sync_secret"] },
  });
  expect(connectedPrivateApis[1]).toEqual({
    path: "/api/internal/platform-ai/gemini/proposal",
    status: 503,
    body: { error: "proposal_disabled" },
  });
  for (const result of connectedPrivateApis.slice(2)) {
    expect(result.status, result.path).toBe(403);
    expect(result.body, result.path).toEqual(
      expect.objectContaining({ error: "platform_route_not_connected" }),
    );
  }

  const privateWahaIngress = await page.evaluate(async () => {
    const response = await fetch(
      "/api/internal/platform-messaging/waha/events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    return { status: response.status, body: await response.json() };
  });
  expect(privateWahaIngress.status).toBe(503);
  expect(privateWahaIngress.body).toEqual(
    expect.objectContaining({ error: "ingress_disabled" }),
  );

  const privateWahaWorker = await page.evaluate(async () => {
    const response = await fetch(
      "/api/internal/platform-messaging/waha/work",
      { method: "POST" },
    );
    return { status: response.status, body: await response.json() };
  });
  expect(privateWahaWorker.status).toBe(503);
  expect(privateWahaWorker.body).toEqual(
    expect.objectContaining({ error: "worker_disabled" }),
  );

  const actionBoundaryStatus = await page.evaluate(async () => {
    const response = await fetch("/finance", { method: "POST" });
    return response.status;
  });
  expect(actionBoundaryStatus).toBe(403);

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect
    .poll(async () =>
      (await page.context().cookies()).filter(({ name }) =>
        /^sb-[A-Za-z0-9_-]+-auth-token(?:\.\d+)?$/.test(name),
      ),
    )
    .toEqual([]);
  await page.goto("/whatsapp");
  await expect(page).toHaveURL(/\/login$/);
});

test("admin Student 360 renders the persisted BW3 profile, provenance, and read-only requirement", async ({
  page,
}) => {
  test.slow();
  expectLegacyDatabaseUntouched();

  await login(page, fixture.identities.admin);
  await expect(page).toHaveURL(/\/sales$/);
  const clientPath = `/clients/${fixture.bw3.orgA.studentCaseId}`;
  await page.goto(clientPath);
  await expect(page).toHaveURL(
    new RegExp(`${escapePathForRegex(clientPath)}$`),
  );

  const student360 = page.getByTestId("platform-client-detail-page");
  await expect(student360).toBeVisible();
  await expect(
    student360.locator("p").filter({ hasText: /^Student 360$/ }),
  ).toBeVisible();

  const profileForm = student360.getByTestId("platform-student-profile-form");
  await expect(profileForm).toBeVisible();
  await expect(
    profileForm.locator('input[name="student_case_id"]'),
  ).toHaveValue(fixture.bw3.orgA.studentCaseId);
  await expect(
    profileForm.locator('input[name="expected_revision"]'),
  ).toHaveValue(String(fixture.bw3.orgA.profileRevision));
  await expect(
    profileForm.locator('input[name="preferred_display_name"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.preferredDisplayName);
  await expect(
    profileForm.locator('select[name="communication_language"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.communicationLanguage);
  await expect(
    profileForm.locator('input[name="citizenship_country"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.citizenshipCountry);
  await expect(
    profileForm.locator('input[name="residency_country"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.residencyCountry ?? "");
  await expect(
    profileForm.locator('input[name="budget_band"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.budgetBand);
  await expect(
    profileForm.locator('select[name="consent_status"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.consentStatus);
  await expect(
    profileForm.locator('input[name="consent_evidence_ref"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.consentEvidenceRef ?? "");
  await expect(
    profileForm.locator('textarea[name="current_education_summary"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.currentEducationSummary ?? "");
  await expect(
    profileForm.locator('textarea[name="academic_summary"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.academicSummary);
  await expect(
    profileForm.locator('textarea[name="language_summary"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.languageSummary);
  await expect(
    profileForm.locator('input[name="decision_participant_labels"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.decisionParticipantLabels.join(", "));
  const participantInput = profileForm.locator(
    'input[name="decision_participant_labels"]',
  );
  const twelveParticipants = Array.from(
    { length: 12 },
    (_, index) => `participant-${index + 1}`,
  );
  await participantInput.fill(twelveParticipants.join(", "));
  expect(
    await participantInput.evaluate((input: HTMLInputElement) => input.checkValidity()),
  ).toBe(true);
  await participantInput.fill([...twelveParticipants, "participant-13"].join(", "));
  expect(
    await participantInput.evaluate((input: HTMLInputElement) => input.checkValidity()),
  ).toBe(false);
  await participantInput.fill(
    fixture.bw3.orgA.profile.decisionParticipantLabels.join(", "),
  );
  await expect(
    profileForm.locator('textarea[name="profile_next_step"]'),
  ).toHaveValue(fixture.bw3.orgA.profile.nextStep);
  await expect(
    profileForm.locator('input[name="legal_display_name"]'),
  ).toHaveCount(0);
  await expect(
    profileForm.locator('input[name="date_of_birth"]'),
  ).toHaveCount(0);

  const checklist = student360.getByTestId("platform-country-checklist");
  await expect(checklist).toBeVisible();
  await expect(
    checklist.getByText(`v${fixture.bw3.orgA.checklist.version}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    checklist.getByText(
      `Подтверждённых источников: ${fixture.bw3.orgA.checklist.sourceCount}`,
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    checklist.locator('select[name="country_requirement_version_id"]'),
  ).toHaveCount(0);
  for (const requiredFieldLabel of [
    "Предпочитаемое имя",
    "Язык общения",
    "Гражданство",
    "Академический профиль",
    "Языковая подготовка",
    "Бюджетный диапазон",
    "Следующий шаг",
  ]) {
    await expect(checklist).toContainText(requiredFieldLabel);
  }

  const documents = student360.locator("section#documents");
  await expect(documents).toBeVisible();
  await expect(documents.locator("li")).toHaveCount(
    fixture.bw3.orgA.appliedDocumentSlotCount,
  );
  await expect(
    documents.getByText(fixture.bw3.orgA.document.label, { exact: true }),
  ).toHaveCount(1);
  await expect(
    documents.getByText(fixture.bw3.orgA.document.instructions, {
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(documents.getByText("Требуется", { exact: true })).toHaveCount(1);
  await expect(documents.locator('a[href^="/documents/"]')).toHaveCount(0);
  await expect(documents.locator('input[type="file"]')).toHaveCount(0);
  await expect(
    documents.getByRole("button", {
      name: /загрузить|отправить файл|добавить документ/i,
    }),
  ).toHaveCount(0);

  expectLegacyDatabaseUntouched();
});

test("P5B projects verified inbound WAHA work into the accepted conversation UI", async ({
  page,
}) => {
  test.skip(
    process.env.EVO_P5B_BROWSER_PROOF !== "1",
    "Runs only in the dedicated local P5B browser-proof partition.",
  );
  expectLegacyDatabaseUntouched();

  const chatId = "14155550199@c.us";
  const rawMessageId = `true_${chatId}_${randomUUID()}`;
  const rawMediaMessageId = `true_${chatId}_${randomUUID()}`;
  const bodyText = `P5B verified local inbound ${randomUUID()}`;
  const humanReviewMarker =
    "[Системное уведомление] Получено медиа или сообщение без текста. Требуется проверка сотрудником.";
  const occurredAtMs = Date.now();
  const rawBody = JSON.stringify({
    event: "message.any",
    session: "evo-inbox",
    payload: {
      id: rawMessageId,
      timestamp: Math.floor(occurredAtMs / 1_000),
      from: chatId,
      chatId,
      fromMe: false,
      source: "app",
      body: bodyText,
    },
  });
  const ingressResponse = await fetch(
    `${appOrigin}/api/internal/platform-messaging/waha/events`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-request-id": `p5b-browser-${randomUUID()}`,
        "x-webhook-timestamp": String(occurredAtMs),
        "x-webhook-hmac-algorithm": "sha512",
        "x-webhook-hmac": createHmac(
          "sha512",
          fixture.p5b.ingressHmacSecret,
        )
          .update(rawBody)
          .digest("hex"),
      },
      body: rawBody,
    },
  );
  expect(ingressResponse.status).toBe(202);
  expect(await ingressResponse.json()).toEqual(
    expect.objectContaining({
      ok: true,
      persisted: true,
      enqueued: true,
    }),
  );

  const workerTimestamp = String(Date.now());
  const workerRequestId = randomUUID();
  const workerResponse = await fetch(
    `${appOrigin}/api/internal/platform-messaging/waha/work`,
    {
      method: "POST",
      headers: {
        "x-evo-worker-request-id": workerRequestId,
        "x-evo-worker-timestamp": workerTimestamp,
        "x-evo-worker-hmac-algorithm": "sha256",
        "x-evo-worker-hmac": createHmac(
          "sha256",
          fixture.p5b.workerTriggerSecret,
        )
          .update(`${workerRequestId}.${workerTimestamp}`)
          .digest("hex"),
      },
    },
  );
  expect(workerResponse.status).toBe(200);
  expect(await workerResponse.json()).toEqual(
    expect.objectContaining({
      ok: true,
      processed: true,
      disposition: "succeeded",
      state: "succeeded",
    }),
  );

  const mediaOccurredAtMs = occurredAtMs + 2_000;
  const mediaRawBody = JSON.stringify({
    event: "message",
    session: "evo-inbox",
    payload: {
      id: rawMediaMessageId,
      timestamp: Math.floor(mediaOccurredAtMs / 1_000),
      from: chatId,
      chatId,
      fromMe: false,
      source: "app",
      body: "",
      hasMedia: true,
    },
  });
  const mediaIngressResponse = await fetch(
    `${appOrigin}/api/internal/platform-messaging/waha/events`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-request-id": `p5b-browser-media-${randomUUID()}`,
        "x-webhook-timestamp": String(mediaOccurredAtMs),
        "x-webhook-hmac-algorithm": "sha512",
        "x-webhook-hmac": createHmac(
          "sha512",
          fixture.p5b.ingressHmacSecret,
        )
          .update(mediaRawBody)
          .digest("hex"),
      },
      body: mediaRawBody,
    },
  );
  expect(mediaIngressResponse.status).toBe(202);
  expect(await mediaIngressResponse.json()).toEqual(
    expect.objectContaining({
      ok: true,
      persisted: true,
      enqueued: true,
    }),
  );

  const mediaWorkerTimestamp = String(Date.now());
  const mediaWorkerRequestId = randomUUID();
  const mediaWorkerResponse = await fetch(
    `${appOrigin}/api/internal/platform-messaging/waha/work`,
    {
      method: "POST",
      headers: {
        "x-evo-worker-request-id": mediaWorkerRequestId,
        "x-evo-worker-timestamp": mediaWorkerTimestamp,
        "x-evo-worker-hmac-algorithm": "sha256",
        "x-evo-worker-hmac": createHmac(
          "sha256",
          fixture.p5b.workerTriggerSecret,
        )
          .update(`${mediaWorkerRequestId}.${mediaWorkerTimestamp}`)
          .digest("hex"),
      },
    },
  );
  expect(mediaWorkerResponse.status).toBe(200);
  expect(await mediaWorkerResponse.json()).toEqual(
    expect.objectContaining({
      ok: true,
      processed: true,
      disposition: "succeeded",
      state: "succeeded",
    }),
  );

  await loginToMessaging(page, fixture.identities.responsibleSales);
  const list = page.getByTestId("platform-conversation-list");
  const projectedConversation = list.locator("a").filter({
    hasText: "WhatsApp ••••0199",
  });
  await expect(projectedConversation).toHaveCount(1);
  const href = await projectedConversation.getAttribute("href");
  expect(href).toMatch(/^\/whatsapp\/[0-9a-f-]{36}$/i);
  const conversationId = href?.split("/").at(-1);
  expect(conversationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

  await projectedConversation.click();
  await expect(page).toHaveURL(new RegExp(`/whatsapp/${conversationId}$`));
  const thread = page.getByTestId("platform-conversation-thread");
  await expect(thread).toBeVisible();
  await expect(thread).toHaveAttribute("data-provider-proof", "not-proved");
  await expect(
    thread.locator('[data-message-direction="inbound"]'),
  ).toContainText([bodyText, humanReviewMarker]);
  await expect(page.locator("body")).not.toContainText(chatId);
  await expect(page.locator("body")).not.toContainText(rawMessageId);
  await expect(page.locator("body")).not.toContainText(rawMediaMessageId);

  const responsibleSalesToken = await localAccessToken(
    fixture.identities.responsibleSales,
  );
  const messageRows = await platformRpc(
    responsibleSalesToken,
    "staff_conversation_message_page",
    {
      p_organization_id: fixture.p5b.organizationId,
      p_conversation_id: conversationId,
      p_limit: 201,
      p_before_created_at: null,
      p_before_message_id: null,
    },
  );
  expect(messageRows.status).toBe(200);
  expect(messageRows.payload).toEqual([
    expect.objectContaining({
      direction: "inbound",
      body_text: humanReviewMarker,
      language: "undetermined",
      student_visible: false,
      waha_session_name: null,
      waha_message_id: null,
      kommo_account_id: null,
      kommo_conversation_id: null,
      kommo_message_id: null,
      amocrm_account_id: null,
      amocrm_lead_id: null,
      amocrm_contact_id: null,
    }),
    expect.objectContaining({
      direction: "inbound",
      body_text: bodyText,
      waha_session_name: null,
      waha_message_id: null,
      kommo_account_id: null,
      kommo_conversation_id: null,
      kommo_message_id: null,
      amocrm_account_id: null,
      amocrm_lead_id: null,
      amocrm_contact_id: null,
    }),
  ]);

  const handoffRows = await platformRows(
    responsibleSalesToken,
    "conversation_handoff_events",
    new URLSearchParams({
      select:
        "conversation_id,previous_queue,new_queue,previous_owner_membership_id,new_owner_membership_id,reason,source_webhook_event_id,request_id",
      conversation_id: `eq.${conversationId}`,
      reason:
        "eq.Inbound WAHA content without text requires staff review",
    }),
  );
  expect(handoffRows.status).toBe(200);
  expect(handoffRows.payload).toEqual([
    expect.objectContaining({
      conversation_id: conversationId,
      previous_queue: "sales",
      new_queue: "sales",
      previous_owner_membership_id: fixture.p5b.intakeSalesMembershipId,
      new_owner_membership_id: fixture.p5b.intakeSalesMembershipId,
      reason: "Inbound WAHA content without text requires staff review",
      source_webhook_event_id: expect.stringMatching(
        /^[0-9a-f-]{36}$/i,
      ),
      request_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }),
  ]);
  expectLegacyDatabaseUntouched();
});

test("P5C reconciles available WAHA history into the accepted conversation UI", async ({
  page,
}) => {
  test.skip(
    process.env.EVO_P5C_BROWSER_PROOF !== "1",
    "Runs only in the dedicated local P5C browser-proof partition.",
  );
  expectLegacyDatabaseUntouched();

  const chatId = "14155550208@c.us";
  const inboundMessageId = `false_${chatId}_${randomUUID()}`;
  const outboundMessageId = `true_${chatId}_${randomUUID()}`;
  const mediaMessageId = `false_${chatId}_${randomUUID()}`;
  const inboundText = `P5C inbound history ${randomUUID()}`;
  const outboundText = `P5C outbound history ${randomUUID()}`;
  const mediaMarker =
    "[Медиа из истории — вложение ожидает безопасного архивирования]";
  const baseTimestamp = Math.floor(Date.now() / 1_000) - 60;
  const requests: Array<Readonly<{
    method: string | undefined;
    pathname: string;
    search: string;
    apiKey: string | undefined;
  }>> = [];
  const messagePath =
    `/api/evo-inbox/chats/${encodeURIComponent(chatId)}/messages`;
  const historyFixture = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1:3312");
    const apiKeyHeader = request.headers["x-api-key"];
    requests.push({
      method: request.method,
      pathname: url.pathname,
      search: url.search,
      apiKey: Array.isArray(apiKeyHeader)
        ? apiKeyHeader.join(",")
        : apiKeyHeader,
    });

    let payload: unknown;
    if (
      request.method === "GET" &&
      url.pathname === "/api/sessions/evo-inbox" &&
      url.search === ""
    ) {
      payload = {
        name: "evo-inbox",
        status: "WORKING",
        engine: { engine: "WEBJS" },
        config: {},
      };
    } else if (
      request.method === "GET" &&
      url.pathname === "/api/evo-inbox/chats"
    ) {
      const offset = url.searchParams.get("offset");
      if (offset === "0") {
        payload = [{ id: chatId }];
      } else if (offset === "25") {
        payload = [];
      } else {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unexpected_chat_offset" }));
        return;
      }
    } else if (
      request.method === "GET" &&
      url.pathname === messagePath
    ) {
      const offset = url.searchParams.get("offset");
      if (offset === "0") {
        // WAHA ordering is deliberately not trusted. The Platform must render
        // the stored history by occurred_at, not by this provider array order.
        payload = [
          {
            id: outboundMessageId,
            timestamp: baseTimestamp + 20,
            fromMe: true,
            body: outboundText,
            hasMedia: false,
          },
          {
            id: inboundMessageId,
            timestamp: baseTimestamp + 10,
            fromMe: false,
            body: inboundText,
            hasMedia: false,
          },
          {
            id: mediaMessageId,
            timestamp: baseTimestamp + 15,
            fromMe: false,
            body: "",
            hasMedia: true,
          },
        ];
      } else if (offset === "50") {
        payload = [];
      } else {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unexpected_message_offset" }));
        return;
      }
    } else {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });

  let fixtureListening = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        historyFixture.off("listening", onListening);
        if (error.code === "EADDRINUSE") {
          reject(new Error("P5C loopback WAHA fixture port 3312 is occupied"));
          return;
        }
        reject(error);
      };
      const onListening = () => {
        historyFixture.off("error", onError);
        fixtureListening = true;
        resolve();
      };
      historyFixture.once("error", onError);
      historyFixture.once("listening", onListening);
      historyFixture.listen(3312, "127.0.0.1");
    });

    const historyTimestamp = String(Date.now());
    const historyRequestId = randomUUID();
    const historyResponse = await fetch(
      `${appOrigin}/api/internal/platform-messaging/waha/history`,
      {
        method: "POST",
        headers: {
          "x-evo-history-request-id": historyRequestId,
          "x-evo-history-timestamp": historyTimestamp,
          "x-evo-history-hmac-algorithm": "sha256",
          "x-evo-history-hmac": createHmac(
            "sha256",
            fixture.p5c.historyTriggerSecret,
          )
            .update(`${historyRequestId}.${historyTimestamp}`)
            .digest("hex"),
        },
      },
    );
    const historyPayload = await historyResponse.json();
    const serializedHistoryPayload = JSON.stringify(historyPayload);
    expect(historyResponse.status).toBe(200);
    expect(historyPayload).toEqual({
      ok: true,
      state: "completed",
      projected: 3,
    });
    for (const rawIdentifier of [
      chatId,
      inboundMessageId,
      outboundMessageId,
      mediaMessageId,
    ]) {
      expect(serializedHistoryPayload).not.toContain(rawIdentifier);
    }

    expect(requests).toHaveLength(5);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(
      requests.every((request) => request.apiKey === fixture.p5c.wahaApiKey),
    ).toBe(true);
    expect(requests.map((request) => request.pathname)).toEqual([
      "/api/sessions/evo-inbox",
      "/api/evo-inbox/chats",
      messagePath,
      messagePath,
      "/api/evo-inbox/chats",
    ]);
    expect(
      Object.fromEntries(new URLSearchParams(requests[1]?.search)),
    ).toEqual({ limit: "25", offset: "0", sortBy: "id", sortOrder: "asc" });
    expect(
      Object.fromEntries(new URLSearchParams(requests[2]?.search)),
    ).toEqual({ limit: "50", offset: "0", downloadMedia: "false" });
    expect(
      Object.fromEntries(new URLSearchParams(requests[3]?.search)),
    ).toEqual({ limit: "50", offset: "50", downloadMedia: "false" });
    expect(
      Object.fromEntries(new URLSearchParams(requests[4]?.search)),
    ).toEqual({ limit: "25", offset: "25", sortBy: "id", sortOrder: "asc" });

    await loginToMessaging(page, fixture.identities.responsibleSales);
    const projectedConversation = page
      .getByTestId("platform-conversation-list")
      .locator("a")
      .filter({ hasText: "WhatsApp ••••0208" });
    await expect(projectedConversation).toHaveCount(1);
    const href = await projectedConversation.getAttribute("href");
    expect(href).toMatch(/^\/whatsapp\/[0-9a-f-]{36}$/i);
    const conversationId = href?.split("/").at(-1);
    expect(conversationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    await projectedConversation.click();
    await expect(page).toHaveURL(new RegExp(`/whatsapp/${conversationId}$`));
    const thread = page.getByTestId("platform-conversation-thread");
    await expect(thread).toBeVisible();
    await expect(thread).toHaveAttribute("data-provider-proof", "not-proved");
    const renderedMessages = thread.locator("[data-message-direction]");
    await expect(renderedMessages).toHaveCount(3);
    await expect(renderedMessages.nth(0)).toHaveAttribute(
      "data-message-direction",
      "inbound",
    );
    await expect(renderedMessages.nth(0)).toContainText(inboundText);
    await expect(renderedMessages.nth(1)).toHaveAttribute(
      "data-message-direction",
      "inbound",
    );
    await expect(renderedMessages.nth(1)).toContainText(mediaMarker);
    await expect(renderedMessages.nth(2)).toHaveAttribute(
      "data-message-direction",
      "outbound",
    );
    await expect(renderedMessages.nth(2)).toContainText(outboundText);

    const responsibleSalesToken = await localAccessToken(
      fixture.identities.responsibleSales,
    );
    const messageRows = await platformRpc(
      responsibleSalesToken,
      "staff_conversation_message_page",
      {
        p_organization_id: fixture.p5b.organizationId,
        p_conversation_id: conversationId,
        p_limit: 201,
        p_before_created_at: null,
        p_before_message_id: null,
      },
    );
    expect(messageRows.status).toBe(200);
    expect(messageRows.payload).toEqual([
      expect.objectContaining({
        direction: "outbound",
        body_text: outboundText,
        waha_session_name: null,
        waha_message_id: null,
        kommo_account_id: null,
        kommo_conversation_id: null,
        kommo_message_id: null,
        amocrm_account_id: null,
        amocrm_lead_id: null,
        amocrm_contact_id: null,
      }),
      expect.objectContaining({
        direction: "inbound",
        body_text: mediaMarker,
        waha_session_name: null,
        waha_message_id: null,
        kommo_account_id: null,
        kommo_conversation_id: null,
        kommo_message_id: null,
        amocrm_account_id: null,
        amocrm_lead_id: null,
        amocrm_contact_id: null,
      }),
      expect.objectContaining({
        direction: "inbound",
        body_text: inboundText,
        waha_session_name: null,
        waha_message_id: null,
        kommo_account_id: null,
        kommo_conversation_id: null,
        kommo_message_id: null,
        amocrm_account_id: null,
        amocrm_lead_id: null,
        amocrm_contact_id: null,
      }),
    ]);

    const pageBody = page.locator("body");
    for (const rawIdentifier of [
      chatId,
      inboundMessageId,
      outboundMessageId,
      mediaMessageId,
    ]) {
      await expect(pageBody).not.toContainText(rawIdentifier);
      expect(JSON.stringify(messageRows.payload)).not.toContain(rawIdentifier);
    }
    expectLegacyDatabaseUntouched();
  } finally {
    if (fixtureListening) {
      historyFixture.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        historyFixture.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }
});

test("student portal renders the persisted BW3 profile and one requirement without legacy SQLite", async ({
  page,
}) => {
  test.slow();
  expectLegacyDatabaseUntouched();
  expect(fixture.bw3.orgA.studentProfileId).not.toBe(
    fixture.bw3.orgA.studentIdentityProfileId,
  );
  await login(page, fixture.identities.student);
  await expect(page).toHaveURL(/\/portal$/);

  for (const [route, heading] of [
    ["/portal", "Главная"],
    ["/portal/profile", "Профиль"],
    ["/portal/documents", "Документы"],
    ["/portal/applications", "Заявки"],
    ["/portal/payments", "Оплаты"],
    ["/portal/visa", "Виза"],
    ["/portal/messages", "Сообщения"],
    ["/portal/team", "Моя команда"],
  ] as const) {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`${escapePathForRegex(route)}$`));
    await expect(
      page.locator("#portal-main").getByRole("heading", {
        level: 1,
        name: heading,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Навигация кабинета" })
        .first(),
    ).toBeVisible();
  }

  await page.goto("/portal/profile");
  for (const expectedValue of [
    fixture.bw3.orgA.profile.preferredDisplayName,
    fixture.bw3.orgA.profile.citizenshipCountry,
    fixture.bw3.orgA.profile.residencyCountry,
    fixture.bw3.orgA.profile.currentEducationSummary,
    fixture.bw3.orgA.profile.academicSummary,
    fixture.bw3.orgA.profile.languageSummary,
    fixture.bw3.orgA.profile.budgetBand,
    fixture.bw3.orgA.profile.nextStep,
    fixture.bw3.orgA.checklist.targetCountry,
    fixture.bw3.orgA.checklist.targetDegree,
    fixture.bw3.orgA.checklist.programDirection,
  ]) {
    if (!expectedValue) continue;
    await expect(
      page.getByText(expectedValue, { exact: true }).first(),
    ).toBeVisible();
  }

  await page.goto("/portal/documents");
  const documentList = page.locator('section[aria-label="Документы"]');
  await expect(documentList.locator("article")).toHaveCount(
    fixture.bw3.orgA.appliedDocumentSlotCount,
  );
  await expect(
    documentList.getByText(fixture.bw3.orgA.document.label, { exact: true }),
  ).toHaveCount(1);
  await expect(
    documentList.getByText("Требуется", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByText("Загрузка в кабинете пока недоступна", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "В этой версии кабинета нет защищённой загрузки или повторной отправки файлов. Не передавайте паспорт и другие чувствительные документы через обычный чат — уточните у куратора согласованный безопасный канал.",
      { exact: true },
    ).first(),
  ).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /загрузить|отправить файл/i }),
  ).toHaveCount(0);

  for (const route of ["/portal/profile", "/portal/documents"] as const) {
    await page.goto(
      `${route}?clientId=${encodeURIComponent(
        fixture.bw3.noCaseStudent.profileId,
      )}&studentCaseId=${encodeURIComponent(
        fixture.bw3.noCaseStudent.membershipId,
      )}`,
    );
    expect(new URL(page.url()).pathname).toBe(route);
    await expect(page.locator("#portal-main")).not.toContainText(
      fixture.bw3.noCaseStudent.displayName,
    );
    if (route === "/portal/profile") {
      await expect(
        page.getByText(fixture.bw3.orgA.profile.preferredDisplayName, {
          exact: true,
        }).first(),
      ).toBeVisible();
    } else {
      await expect(
        page.getByText(fixture.bw3.orgA.document.label, { exact: true }),
      ).toHaveCount(1);
    }
  }
  expectLegacyDatabaseUntouched();
});

test("P6A exposes read-only overdue Portal attention without notification or provider controls", async ({
  browser,
}) => {
  test.skip(
    process.env.EVO_P6A_BROWSER_PROOF !== "1",
    "P6A feature proof runs in its isolated browser partition.",
  );
  test.slow();
  expectLegacyDatabaseUntouched();

  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await login(studentPage, fixture.identities.student);
  await expect(studentPage).toHaveURL(/\/portal$/);
  await studentPage.goto("/portal/notifications");
  await expect(studentPage).toHaveURL(/\/portal\/notifications$/);

  const attentionRegion = studentPage.getByTestId(
    "portal-attention-read-only",
  );
  await expect(attentionRegion).toHaveAttribute(
    "aria-labelledby",
    "portal-attention-read-only-title",
  );
  await expect(
    studentPage.getByRole("region", {
      name: "Требует внимания",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    attentionRegion.getByRole("heading", {
      level: 2,
      name: "Требует внимания",
      exact: true,
    }),
  ).toBeVisible();
  await expect(attentionRegion).toContainText("Срочно");
  await expect(attentionRegion).toContainText("Просроченный платёж");
  await expect(attentionRegion).toContainText(
    fixture.p6a.overduePaymentNextAction,
  );
  const paymentLink = attentionRegion.locator('a[href="/portal/payments"]');
  await expect(paymentLink).toHaveCount(1);
  await expect(paymentLink).toHaveAttribute("href", "/portal/payments");
  await expect(attentionRegion.getByRole("button")).toHaveCount(0);
  await expect(
    attentionRegion.locator('input, textarea, select, [role="checkbox"]'),
  ).toHaveCount(0);
  await expect(
    studentPage.getByRole("button", {
      name: /прочитан|подтверд|acknowledge|mark as read/i,
    }),
  ).toHaveCount(0);

  const notificationText = await studentPage.locator("body").innerText();
  expect(notificationText).not.toMatch(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  );
  for (const rawValue of [
    fixture.p6a.studentCaseId,
    fixture.p6a.sameOrgOtherStudentCaseId,
    fixture.p6a.overduePaymentObligationId,
    "payment_obligation_id",
    "provider_observed",
    "WAHA",
  ]) {
    expect(notificationText).not.toContain(rawValue);
  }

  await paymentLink.click();
  await expect(studentPage).toHaveURL(/\/portal\/payments$/);
  const overduePaymentCard = studentPage
    .getByRole("article")
    .filter({ hasText: fixture.p6a.overduePaymentLabel });
  await expect(overduePaymentCard).toHaveCount(1);
  await expect(overduePaymentCard).toContainText("Просрочен");
  await expect(
    overduePaymentCard.getByTestId("portal-overdue-payment-helper"),
  ).toHaveText(
    "Срок оплаты прошёл. Для оплаты или сверки свяжитесь с ответственным сотрудником.",
  );
  await expect(
    overduePaymentCard.locator('button, input, textarea, select'),
  ).toHaveCount(0);

  await studentPage.goto(
    `/portal/notifications?studentCaseId=${encodeURIComponent(
      fixture.p6a.sameOrgOtherStudentCaseId,
    )}&caseId=${encodeURIComponent(
      fixture.p6a.sameOrgOtherStudentCaseId,
    )}`,
  );
  expect(new URL(studentPage.url()).pathname).toBe("/portal/notifications");
  await expect(
    studentPage.getByTestId("portal-attention-read-only"),
  ).toContainText(fixture.p6a.overduePaymentNextAction);
  await expect(studentPage.locator("#portal-main")).not.toContainText(
    fixture.p6a.sameOrgOtherStudentDisplayName,
  );
  await expect(studentPage.locator("body")).not.toContainText(
    fixture.p6a.sameOrgOtherStudentCaseId,
  );
  await studentContext.close();

  const noCaseContext = await browser.newContext();
  const noCasePage = await noCaseContext.newPage();
  await login(noCasePage, fixture.identities.studentNoCase);
  await expect.poll(() => new URL(noCasePage.url()).pathname).toBe(
    "/platform-pending",
  );
  await noCasePage.goto(
    `/portal/notifications?studentCaseId=${encodeURIComponent(
      fixture.p6a.studentCaseId,
    )}`,
  );
  await expect.poll(() => new URL(noCasePage.url()).pathname).toBe(
    "/platform-pending",
  );
  await expect(
    noCasePage.getByTestId("portal-attention-read-only"),
  ).toHaveCount(0);
  await expect(noCasePage.getByText(fixture.p6a.overduePaymentLabel)).toHaveCount(
    0,
  );
  await noCaseContext.close();

  expectLegacyDatabaseUntouched();
});

test("P6B turns an authenticated staff document review into one live durable Student notification", async ({
  browser,
}) => {
  test.skip(
    process.env.EVO_P6B_BROWSER_PROOF !== "1",
    "P6B feature proof runs in its isolated browser partition.",
  );
  test.slow();
  expectLegacyDatabaseUntouched();

  const adminToken = await localAccessToken(fixture.identities.admin);
  const studentToken = await localAccessToken(fixture.identities.p6bStudent);
  const sameOrgOtherStudentToken = await localAccessToken(
    fixture.identities.studentNoCase,
  );
  const crossOrgStudentToken = await localAccessToken(
    fixture.identities.crossOrgStudent,
  );
  const communicationQueueBefore = await platformRpc(
    adminToken,
    "staff_communication_page",
    {
      p_organization_id: fixture.p6b.organizationId,
      p_limit: 50,
      p_before_sort_at: null,
      p_before_conversation_id: null,
      p_queue: null,
      p_status: null,
      p_conversation_id: null,
    },
  );
  const wahaHealthBefore = await platformRpc(
    adminToken,
    "staff_waha_session_health",
    {
      p_organization_id: fixture.p6b.organizationId,
      p_waha_session_name: "evo-inbox",
    },
  );
  const legacyNotificationsBefore = await platformRpc(
    studentToken,
    "my_notifications",
    {},
  );
  const durableNotificationsBefore = await platformRpc(
    studentToken,
    "student_portal_notifications_v1",
    {},
  );

  expect(communicationQueueBefore.status).toBe(200);
  expect(wahaHealthBefore.status).toBe(200);
  expect(legacyNotificationsBefore).toEqual({ status: 200, payload: [] });
  expect(durableNotificationsBefore).toEqual({ status: 200, payload: [] });
  expect(JSON.stringify(communicationQueueBefore.payload)).not.toContain(
    fixture.p6b.studentCaseId,
  );

  for (const deniedToken of [
    sameOrgOtherStudentToken,
    crossOrgStudentToken,
  ]) {
    const denied = await platformRpc(
      deniedToken,
      "student_portal_notifications_v1",
      {},
    );
    expect(denied).toEqual({ status: 200, payload: [] });
  }

  const anonymousResponse = await fetch(
    `${fixture.apiUrl}/rest/v1/rpc/student_portal_notifications_v1`,
    {
      method: "POST",
      headers: {
        apikey: fixture.publishableKey,
        Accept: "application/json",
        "Accept-Profile": "platform",
        "Content-Profile": "platform",
        "Content-Type": "application/json",
      },
      body: "{}",
    },
  );
  expect([401, 403]).toContain(anonymousResponse.status);

  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await login(studentPage, fixture.identities.p6bStudent);
  await expect(studentPage).toHaveURL(/\/portal$/);
  await studentPage.goto("/portal/notifications");
  await expect(studentPage).toHaveURL(/\/portal\/notifications$/);
  const realtime = studentPage.getByTestId("portal-notifications-realtime");
  await expect(realtime).toHaveAttribute("data-realtime-state", "subscribed");
  await expect(studentPage.getByTestId("portal-notification-row")).toHaveCount(0);
  await expect(
    studentPage.getByTestId("portal-notifications-unread-badge"),
  ).toHaveCount(0);
  const pageInstance = randomUUID();
  await studentPage.evaluate((instance) => {
    (window as typeof window & { __p6bPageInstance?: string })
      .__p6bPageInstance = instance;
  }, pageInstance);

  const sameOrgContext = await browser.newContext();
  const sameOrgPage = await sameOrgContext.newPage();
  await login(sameOrgPage, fixture.identities.studentNoCase);
  await expect.poll(() => new URL(sameOrgPage.url()).pathname).toBe(
    "/platform-pending",
  );
  await sameOrgPage.goto("/portal/notifications");
  await expect.poll(() => new URL(sameOrgPage.url()).pathname).toBe(
    "/platform-pending",
  );
  await expect(sameOrgPage.getByTestId("portal-notification-row")).toHaveCount(0);
  await sameOrgContext.close();

  const crossOrgContext = await browser.newContext();
  const crossOrgPage = await crossOrgContext.newPage();
  await login(crossOrgPage, fixture.identities.crossOrgStudent);
  await expect.poll(() => new URL(crossOrgPage.url()).pathname).toBe(
    "/platform-pending",
  );
  await crossOrgPage.goto("/portal/notifications");
  await expect.poll(() => new URL(crossOrgPage.url()).pathname).toBe(
    "/platform-pending",
  );
  await expect(crossOrgPage.getByTestId("portal-notification-row")).toHaveCount(0);
  await crossOrgContext.close();

  const salesContext = await browser.newContext();
  const salesPage = await salesContext.newPage();
  await login(salesPage, fixture.identities.salesScoped);
  await expect(salesPage).toHaveURL(/\/sales$/);
  await salesPage.goto(`/clients/${fixture.p6b.studentCaseId}#documents`);
  await expect(
    salesPage.getByTestId("platform-sales-handoff-summary"),
  ).toBeVisible();
  await expect(
    salesPage.getByTestId("platform-client-detail-page"),
  ).toHaveCount(0);
  await expect(
    salesPage.getByTestId("platform-document-review-form"),
  ).toHaveCount(0);
  await salesContext.close();

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, fixture.identities.admin);
  await expect(adminPage).toHaveURL(/\/sales$/);
  await adminPage.goto(`/clients/${fixture.p6b.studentCaseId}#documents`);
  await expect(adminPage.getByTestId("platform-client-detail-page")).toBeVisible();
  const reviewForm = adminPage.getByTestId("platform-document-review-form");
  await expect(reviewForm).toHaveCount(1);
  await expect(
    reviewForm.locator('input[name="student_case_id"]'),
  ).toHaveValue(fixture.p6b.studentCaseId);
  await expect(
    reviewForm.locator('input[name="document_version_id"]'),
  ).toHaveValue(fixture.p6b.documentVersionId);
  await expect(reviewForm.locator('input[name="request_id"]')).toHaveValue(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await reviewForm
    .locator('select[name="decision"]')
    .selectOption("correction_required");
  await reviewForm
    .locator('[name="reason"]')
    .fill(fixture.p6b.reviewReason);
  await reviewForm.getByTestId("platform-document-review-submit").click();
  await expect(adminPage).toHaveURL(
    new RegExp(
      `/clients/${fixture.p6b.studentCaseId}\\?result=saved#documents$`,
    ),
  );
  await expect(
    adminPage.getByTestId("platform-document-review-form"),
  ).toHaveCount(0);
  await expect(adminPage.locator("#documents")).toContainText(
    fixture.p6b.reviewReason,
  );

  const notificationRow = studentPage.getByTestId("portal-notification-row");
  await expect(notificationRow).toHaveCount(1);
  await expect(notificationRow).toContainText(fixture.p6b.requirementLabel);
  await expect(notificationRow).toContainText(fixture.p6b.reviewReason);
  await expect(
    studentPage.getByTestId("portal-notifications-unread-badge"),
  ).toHaveText("1");
  expect(
    await studentPage.evaluate(
      () =>
        (window as typeof window & { __p6bPageInstance?: string })
          .__p6bPageInstance,
    ),
  ).toBe(pageInstance);

  const durableNotificationsAfterReview = await platformRpc(
    studentToken,
    "student_portal_notifications_v1",
    {},
  );
  expect(durableNotificationsAfterReview.status).toBe(200);
  const notificationRows = durableNotificationsAfterReview.payload as Array<
    Record<string, unknown>
  >;
  expect(notificationRows).toHaveLength(1);
  expect(Object.keys(notificationRows[0])).toEqual([
    "notification_id",
    "category",
    "review_decision",
    "requirement_key",
    "requirement_label",
    "reason",
    "created_at",
    "read_at",
  ]);
  expect(notificationRows[0]).toEqual({
    notification_id: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    ),
    category: "document.review",
    review_decision: "correction_required",
    requirement_key: fixture.p6b.requirementKey,
    requirement_label: fixture.p6b.requirementLabel,
    reason: fixture.p6b.reviewReason,
    created_at: expect.any(String),
    read_at: null,
  });
  const notificationId = String(notificationRows[0].notification_id);
  const privateTopic = `platform-portal-notifications:${fixture.p6b.organizationId}:${fixture.p6b.recipientStudentMembershipId}`;
  for (const privateValue of [
    notificationId,
    fixture.p6b.organizationId,
    fixture.p6b.studentCaseId,
    fixture.p6b.documentSlotId,
    fixture.p6b.documentVersionId,
    fixture.p6b.recipientStudentMembershipId,
    privateTopic,
  ]) {
    await expect(studentPage.locator("body")).not.toContainText(privateValue);
  }
  await expect(studentPage.locator("body")).not.toContainText(
    /WAHA|amoCRM|Kommo|provider/i,
  );

  for (const deniedToken of [
    sameOrgOtherStudentToken,
    crossOrgStudentToken,
  ]) {
    const denied = await platformRpc(
      deniedToken,
      "student_portal_notifications_v1",
      {},
    );
    expect(denied).toEqual({ status: 200, payload: [] });
  }

  await studentPage.getByTestId("portal-notification-mark-read").click();
  await expect(studentPage).toHaveURL(
    /\/portal\/notifications\?notification_result=read$/,
  );
  await expect(notificationRow).toHaveCount(1);
  await expect(
    studentPage.getByTestId("portal-notification-mark-read"),
  ).toHaveCount(0);
  await expect(
    studentPage.getByTestId("portal-notifications-unread-badge"),
  ).toHaveCount(0);
  await studentPage.reload();
  await expect(notificationRow).toHaveCount(1);
  await expect(
    studentPage.getByTestId("portal-notification-mark-read"),
  ).toHaveCount(0);
  await expect(
    studentPage.getByTestId("portal-notifications-unread-badge"),
  ).toHaveCount(0);

  const durableNotificationsAfterAck = await platformRpc(
    studentToken,
    "student_portal_notifications_v1",
    {},
  );
  expect(durableNotificationsAfterAck.status).toBe(200);
  const ackRows = durableNotificationsAfterAck.payload as Array<
    Record<string, unknown>
  >;
  expect(ackRows).toHaveLength(1);
  expect(ackRows[0].notification_id).toBe(notificationId);
  expect(ackRows[0].read_at).toEqual(expect.any(String));

  const legacyNotificationsAfter = await platformRpc(
    studentToken,
    "my_notifications",
    {},
  );
  const communicationQueueAfter = await platformRpc(
    adminToken,
    "staff_communication_page",
    {
      p_organization_id: fixture.p6b.organizationId,
      p_limit: 50,
      p_before_sort_at: null,
      p_before_conversation_id: null,
      p_queue: null,
      p_status: null,
      p_conversation_id: null,
    },
  );
  const wahaHealthAfter = await platformRpc(
    adminToken,
    "staff_waha_session_health",
    {
      p_organization_id: fixture.p6b.organizationId,
      p_waha_session_name: "evo-inbox",
    },
  );
  expect(legacyNotificationsAfter).toEqual({ status: 200, payload: [] });
  expect(communicationQueueAfter).toEqual(communicationQueueBefore);
  expect(wahaHealthAfter).toEqual(wahaHealthBefore);
  expect(JSON.stringify(communicationQueueAfter.payload)).not.toContain(
    fixture.p6b.studentCaseId,
  );
  expectLegacyDatabaseUntouched();

  await adminContext.close();
  await studentContext.close();
});

test("P6C publishes deterministic overdue task and payment notifications through the signed worker", async ({
  browser,
}) => {
  test.skip(
    process.env.EVO_P6C_BROWSER_PROOF !== "1",
    "P6C feature proof runs in its isolated browser partition.",
  );
  test.slow();
  expectLegacyDatabaseUntouched();

  const adminToken = await localAccessToken(fixture.identities.admin);
  const taskStudentToken = await localAccessToken(
    fixture.identities.p6bStudent,
  );
  const paymentStudentToken = await localAccessToken(
    fixture.identities.student,
  );
  const crossOrgStudentToken = await localAccessToken(
    fixture.identities.crossOrgStudent,
  );
  const v2Keys = [
    "notification_id",
    "category",
    "event_code",
    "subject_label",
    "detail",
    "due_at",
    "created_at",
    "read_at",
  ];

  let taskStudentBefore = await platformRpc(
    taskStudentToken,
    "student_portal_notifications_v2",
    {},
  );
  expect(taskStudentBefore.status).toBe(200);
  let taskStudentBeforeRows = taskStudentBefore.payload as Array<
    Record<string, unknown>
  >;

  // Make this partition independently runnable while retaining the accepted
  // P6B compatibility row when the full gate has already executed P6B.
  if (!taskStudentBeforeRows.some((row) => row.category === "document.review")) {
    const documentReview = await platformRpc(
      adminToken,
      "review_document_version_with_portal_notification_v1",
      {
        p_organization_id: fixture.p6b.organizationId,
        p_document_version_id: fixture.p6b.documentVersionId,
        p_decision: "correction_required",
        p_reason: fixture.p6b.reviewReason,
        p_request_id: randomUUID(),
      },
    );
    expect(documentReview.status).toBe(200);
    taskStudentBefore = await platformRpc(
      taskStudentToken,
      "student_portal_notifications_v2",
      {},
    );
    expect(taskStudentBefore.status).toBe(200);
    taskStudentBeforeRows = taskStudentBefore.payload as Array<
      Record<string, unknown>
    >;
  }

  const documentRowsBefore = taskStudentBeforeRows.filter(
    (row) => row.category === "document.review",
  );
  expect(documentRowsBefore).toHaveLength(1);
  expect(Object.keys(documentRowsBefore[0])).toEqual(v2Keys);
  expect(documentRowsBefore[0]).toMatchObject({
    category: "document.review",
    event_code: "correction_required",
    subject_label: fixture.p6b.requirementLabel,
    detail: fixture.p6b.reviewReason,
    due_at: null,
  });
  expect(
    taskStudentBeforeRows.some(
      (row) =>
        row.category === "task.overdue" ||
        row.category === "payment.overdue",
    ),
  ).toBe(false);

  const paymentStudentBefore = await platformRpc(
    paymentStudentToken,
    "student_portal_notifications_v2",
    {},
  );
  const crossOrgBefore = await platformRpc(
    crossOrgStudentToken,
    "student_portal_notifications_v2",
    {},
  );
  expect(paymentStudentBefore).toEqual({ status: 200, payload: [] });
  expect(crossOrgBefore).toEqual({ status: 200, payload: [] });

  const anonymousResponse = await fetch(
    `${fixture.apiUrl}/rest/v1/rpc/student_portal_notifications_v2`,
    {
      method: "POST",
      headers: {
        apikey: fixture.publishableKey,
        Accept: "application/json",
        "Accept-Profile": "platform",
        "Content-Profile": "platform",
        "Content-Type": "application/json",
      },
      body: "{}",
    },
  );
  expect([401, 403]).toContain(anonymousResponse.status);

  const taskContext = await browser.newContext();
  const taskPage = await taskContext.newPage();
  await login(taskPage, fixture.identities.p6bStudent);
  await expect(taskPage).toHaveURL(/\/portal$/);
  await taskPage.goto("/portal/notifications");
  await expect(taskPage).toHaveURL(/\/portal\/notifications$/);
  await expect(
    taskPage.getByTestId("portal-notifications-realtime"),
  ).toHaveAttribute("data-realtime-state", "subscribed");
  await expect(
    taskPage.locator('[data-notification-category="document.review"]'),
  ).toHaveCount(1);
  await expect(
    taskPage.locator('[data-notification-category="task.overdue"]'),
  ).toHaveCount(0);
  const taskPageInstance = randomUUID();
  await taskPage.evaluate((instance) => {
    (window as typeof window & { __p6cTaskPageInstance?: string })
      .__p6cTaskPageInstance = instance;
  }, taskPageInstance);

  const paymentContext = await browser.newContext();
  const paymentPage = await paymentContext.newPage();
  await login(paymentPage, fixture.identities.student);
  await expect(paymentPage).toHaveURL(/\/portal$/);
  await paymentPage.goto("/portal/notifications");
  await expect(paymentPage).toHaveURL(/\/portal\/notifications$/);
  await expect(
    paymentPage.getByTestId("portal-notifications-realtime"),
  ).toHaveAttribute("data-realtime-state", "subscribed");
  await expect(paymentPage.getByTestId("portal-notification-row")).toHaveCount(
    0,
  );
  const paymentPageInstance = randomUUID();
  await paymentPage.evaluate((instance) => {
    (window as typeof window & { __p6cPaymentPageInstance?: string })
      .__p6cPaymentPageInstance = instance;
  }, paymentPageInstance);

  const crossOrgContext = await browser.newContext();
  const crossOrgPage = await crossOrgContext.newPage();
  await login(crossOrgPage, fixture.identities.crossOrgStudent);
  await expect.poll(() => new URL(crossOrgPage.url()).pathname).toBe(
    "/platform-pending",
  );
  await crossOrgPage.goto("/portal/notifications");
  await expect.poll(() => new URL(crossOrgPage.url()).pathname).toBe(
    "/platform-pending",
  );
  await expect(crossOrgPage.getByTestId("portal-notification-row")).toHaveCount(
    0,
  );

  const appOrigin = new URL(taskPage.url()).origin;
  const unsignedResponse = await fetch(
    `${appOrigin}/api/internal/platform-operations/portal-overdue`,
    { method: "POST" },
  );
  expect(unsignedResponse.status).toBe(401);

  const requestId = randomUUID();
  const timestamp = String(Date.now());
  const workerResponse = await fetch(
    `${appOrigin}/api/internal/platform-operations/portal-overdue`,
    {
      method: "POST",
      headers: {
        "x-evo-portal-overdue-request-id": requestId,
        "x-evo-portal-overdue-timestamp": timestamp,
        "x-evo-portal-overdue-hmac-algorithm": "sha256",
        "x-evo-portal-overdue-hmac": createHmac(
          "sha256",
          fixture.p6c.workerTriggerSecret,
        )
          .update(`${requestId}.${timestamp}`)
          .digest("hex"),
      },
    },
  );
  expect(workerResponse.status).toBe(200);
  const workerPayload = (await workerResponse.json()) as Record<
    string,
    unknown
  >;
  expect(Object.keys(workerPayload)).toEqual([
    "ok",
    "requestId",
    "status",
    "organizationsProcessed",
    "taskCandidates",
    "taskPublished",
    "taskResolved",
    "paymentCandidates",
    "paymentPublished",
    "paymentResolved",
  ]);
  expect(workerPayload).toEqual({
    ok: true,
    requestId,
    status: "completed",
    organizationsProcessed: 1,
    taskCandidates: 1,
    taskPublished: 1,
    taskResolved: 0,
    paymentCandidates: 1,
    paymentPublished: 1,
    paymentResolved: 0,
  });

  const replayTimestamp = String(Date.now());
  const replayResponse = await fetch(
    `${appOrigin}/api/internal/platform-operations/portal-overdue`,
    {
      method: "POST",
      headers: {
        "x-evo-portal-overdue-request-id": requestId,
        "x-evo-portal-overdue-timestamp": replayTimestamp,
        "x-evo-portal-overdue-hmac-algorithm": "sha256",
        "x-evo-portal-overdue-hmac": createHmac(
          "sha256",
          fixture.p6c.workerTriggerSecret,
        )
          .update(`${requestId}.${replayTimestamp}`)
          .digest("hex"),
      },
    },
  );
  expect(replayResponse.status).toBe(200);
  expect(await replayResponse.json()).toEqual(workerPayload);

  const noOpRequestId = randomUUID();
  const noOpTimestamp = String(Date.now());
  const noOpResponse = await fetch(
    `${appOrigin}/api/internal/platform-operations/portal-overdue`,
    {
      method: "POST",
      headers: {
        "x-evo-portal-overdue-request-id": noOpRequestId,
        "x-evo-portal-overdue-timestamp": noOpTimestamp,
        "x-evo-portal-overdue-hmac-algorithm": "sha256",
        "x-evo-portal-overdue-hmac": createHmac(
          "sha256",
          fixture.p6c.workerTriggerSecret,
        )
          .update(`${noOpRequestId}.${noOpTimestamp}`)
          .digest("hex"),
      },
    },
  );
  expect(noOpResponse.status).toBe(200);
  expect(await noOpResponse.json()).toEqual({
    ok: true,
    requestId: noOpRequestId,
    status: "completed",
    organizationsProcessed: 1,
    taskCandidates: 0,
    taskPublished: 0,
    taskResolved: 0,
    paymentCandidates: 0,
    paymentPublished: 0,
    paymentResolved: 0,
  });

  const taskRow = taskPage.locator(
    '[data-notification-category="task.overdue"]',
  );
  await expect(taskRow).toHaveCount(1);
  await expect(taskRow.getByTestId("portal-notification-subject")).toContainText(
    fixture.p6c.taskTitle,
  );
  await expect(taskRow.getByTestId("portal-notification-detail")).toContainText(
    "task due time has passed",
  );
  await expect(taskRow.getByTestId("portal-notification-due-at")).toBeVisible();
  await expect(
    taskRow.getByTestId("portal-notification-destination"),
  ).toHaveAttribute("href", "/portal");
  await expect(
    taskPage.locator('[data-notification-category="payment.overdue"]'),
  ).toHaveCount(0);
  expect(
    await taskPage.evaluate(
      () =>
        (window as typeof window & { __p6cTaskPageInstance?: string })
          .__p6cTaskPageInstance,
    ),
  ).toBe(taskPageInstance);

  const paymentRow = paymentPage.locator(
    '[data-notification-category="payment.overdue"]',
  );
  await expect(paymentRow).toHaveCount(1);
  await expect(
    paymentRow.getByTestId("portal-notification-subject"),
  ).toContainText(fixture.p6c.paymentLabel);
  await expect(
    paymentRow.getByTestId("portal-notification-detail"),
  ).toContainText("payment due time has passed");
  await expect(
    paymentRow.getByTestId("portal-notification-due-at"),
  ).toBeVisible();
  await expect(
    paymentRow.getByTestId("portal-notification-destination"),
  ).toHaveAttribute("href", "/portal/payments");
  await expect(
    paymentPage.locator('[data-notification-category="task.overdue"]'),
  ).toHaveCount(0);
  expect(
    await paymentPage.evaluate(
      () =>
        (window as typeof window & { __p6cPaymentPageInstance?: string })
          .__p6cPaymentPageInstance,
    ),
  ).toBe(paymentPageInstance);

  const taskFeed = await platformRpc(
    taskStudentToken,
    "student_portal_notifications_v2",
    {},
  );
  const paymentFeed = await platformRpc(
    paymentStudentToken,
    "student_portal_notifications_v2",
    {},
  );
  const crossOrgFeed = await platformRpc(
    crossOrgStudentToken,
    "student_portal_notifications_v2",
    {},
  );
  expect(taskFeed.status).toBe(200);
  expect(paymentFeed.status).toBe(200);
  expect(crossOrgFeed).toEqual({ status: 200, payload: [] });

  const taskFeedRows = taskFeed.payload as Array<Record<string, unknown>>;
  const paymentFeedRows = paymentFeed.payload as Array<Record<string, unknown>>;
  const taskNotification = taskFeedRows.find(
    (row) => row.category === "task.overdue",
  );
  const paymentNotification = paymentFeedRows.find(
    (row) => row.category === "payment.overdue",
  );
  expect(taskNotification).toBeDefined();
  expect(paymentNotification).toBeDefined();
  expect(Object.keys(taskNotification ?? {})).toEqual(v2Keys);
  expect(Object.keys(paymentNotification ?? {})).toEqual(v2Keys);
  expect(taskNotification).toMatchObject({
    category: "task.overdue",
    event_code: "overdue",
    subject_label: fixture.p6c.taskTitle,
    due_at: expect.any(String),
    read_at: null,
  });
  expect(paymentNotification).toMatchObject({
    category: "payment.overdue",
    event_code: "overdue",
    subject_label: fixture.p6c.paymentLabel,
    due_at: expect.any(String),
    read_at: null,
  });
  const taskNotificationId = String(taskNotification?.notification_id);
  const paymentNotificationId = String(paymentNotification?.notification_id);
  for (const [deniedToken, deniedNotificationId] of [
    [paymentStudentToken, taskNotificationId],
    [taskStudentToken, paymentNotificationId],
    [crossOrgStudentToken, taskNotificationId],
  ] as const) {
    const deniedAck = await platformRpc(
      deniedToken,
      "mark_own_student_portal_notification_read_v2",
      {
        p_notification_id: deniedNotificationId,
        p_request_id: randomUUID(),
      },
    );
    expect([400, 403]).toContain(deniedAck.status);
  }
  expect(
    Date.parse(String(taskNotification?.created_at)),
  ).toBeLessThanOrEqual(Date.parse(String(paymentNotification?.created_at)));
  expect(taskFeedRows.some((row) => row.category === "payment.overdue")).toBe(
    false,
  );
  expect(paymentFeedRows.some((row) => row.category !== "payment.overdue")).toBe(
    false,
  );

  const publicEvidence = JSON.stringify([taskFeedRows, paymentFeedRows]);
  for (const privateValue of [
    fixture.p6c.organizationId,
    fixture.p6c.taskStudentCaseId,
    fixture.p6c.taskStudentMembershipId,
    fixture.p6c.taskId,
    fixture.p6c.paymentStudentCaseId,
    fixture.p6c.paymentStudentMembershipId,
    fixture.p6c.paymentObligationId,
    `platform-portal-notifications:${fixture.p6c.organizationId}:${fixture.p6c.taskStudentMembershipId}`,
    `platform-portal-notifications:${fixture.p6c.organizationId}:${fixture.p6c.paymentStudentMembershipId}`,
  ]) {
    expect(publicEvidence).not.toContain(privateValue);
    await expect(taskPage.locator("body")).not.toContainText(privateValue);
    await expect(paymentPage.locator("body")).not.toContainText(privateValue);
  }
  expect(publicEvidence).not.toMatch(
    /source_kind|source_record_id|transition_version|amount_minor|WAHA|amoCRM|Kommo|provider/i,
  );
  expect(publicEvidence).not.toContain("125000");
  await expect(taskPage.locator("body")).not.toContainText(
    /WAHA|amoCRM|Kommo|provider/i,
  );
  await expect(paymentPage.locator("body")).not.toContainText(
    /WAHA|amoCRM|Kommo|provider/i,
  );

  await taskRow.getByTestId("portal-notification-mark-read").click();
  await expect(taskPage).toHaveURL(
    /\/portal\/notifications\?notification_result=read$/,
  );
  const persistedTaskRow = taskPage.locator(
    '[data-notification-category="task.overdue"]',
  );
  await expect(persistedTaskRow).toHaveCount(1);
  await expect(
    persistedTaskRow.getByTestId("portal-notification-mark-read"),
  ).toHaveCount(0);

  await paymentRow.getByTestId("portal-notification-mark-read").click();
  await expect(paymentPage).toHaveURL(
    /\/portal\/notifications\?notification_result=read$/,
  );
  const persistedPaymentRow = paymentPage.locator(
    '[data-notification-category="payment.overdue"]',
  );
  await expect(persistedPaymentRow).toHaveCount(1);
  await expect(
    persistedPaymentRow.getByTestId("portal-notification-mark-read"),
  ).toHaveCount(0);

  const taskAfterAck = await platformRpc(
    taskStudentToken,
    "student_portal_notifications_v2",
    {},
  );
  const paymentAfterAck = await platformRpc(
    paymentStudentToken,
    "student_portal_notifications_v2",
    {},
  );
  expect(taskAfterAck.status).toBe(200);
  expect(paymentAfterAck.status).toBe(200);
  expect(
    (taskAfterAck.payload as Array<Record<string, unknown>>).find(
      (row) => row.category === "task.overdue",
    )?.read_at,
  ).toEqual(expect.any(String));
  expect(
    (paymentAfterAck.payload as Array<Record<string, unknown>>).find(
      (row) => row.category === "payment.overdue",
    )?.read_at,
  ).toEqual(expect.any(String));

  expectLegacyDatabaseUntouched();
  await crossOrgContext.close();
  await taskContext.close();
  await paymentContext.close();
});

test("P6D closes the real Student 360 and Portal cross-domain loop with tenant isolation", async ({
  browser,
}) => {
  test.skip(
    process.env.EVO_P6D_BROWSER_PROOF !== "1",
    "P6D feature proof runs in its isolated browser partition.",
  );
  test.setTimeout(180_000);
  expectLegacyDatabaseUntouched();

  const primaryPath = `/clients/${fixture.p6d.primaryStudentCaseId}`;
  const adminToken = await localAccessToken(fixture.identities.admin);
  const curatorToken = await localAccessToken(fixture.identities.curator);
  const primaryStudentToken = await localAccessToken(
    fixture.identities.student,
  );
  const secondaryStudentToken = await localAccessToken(
    fixture.identities.p6bStudent,
  );
  const crossOrgAdminToken = await localAccessToken(
    fixture.identities.crossOrgAdmin,
  );
  const exactVisaKeys = [
    "case_id",
    "note",
    "updated_at",
    "visa_case_id",
    "visa_status",
  ];
  const exactFinanceKeys = [
    "amount_minor",
    "case_id",
    "category",
    "currency",
    "derived_status",
    "due_at",
    "next_action",
    "obligation_label",
    "outstanding_minor",
    "overdue",
    "payment_obligation_id",
  ];
  const exactPortalNotificationKeys = [
    "category",
    "created_at",
    "detail",
    "due_at",
    "event_code",
    "notification_id",
    "read_at",
    "subject_label",
  ];

  const crossOrgVisa = await platformRpc(
    crossOrgAdminToken,
    "staff_case_visa",
    { p_student_case_id: fixture.p6d.primaryStudentCaseId },
  );
  expect(crossOrgVisa.status).toBe(200);
  expect(crossOrgVisa.payload).toEqual([]);
  const crossOrgFinance = await platformRpc(
    crossOrgAdminToken,
    "staff_case_finance",
    { p_student_case_id: fixture.p6d.primaryStudentCaseId },
  );
  expect(crossOrgFinance.status).toBe(200);
  expect(crossOrgFinance.payload).toEqual([]);

  const curatorContext = await browser.newContext();
  const curatorPage = await curatorContext.newPage();
  await login(curatorPage, fixture.identities.curator);
  await expect(curatorPage).toHaveURL(/\/clients$/);
  await curatorPage.goto(`${primaryPath}#applications`);
  await expect(curatorPage).toHaveURL(
    new RegExp(`${primaryPath}#applications$`),
  );
  for (const applicationLabel of fixture.p6d.applicationLabels) {
    const [institution, program] = applicationLabel.split(" — ");
    await expect(curatorPage.locator("#applications")).toContainText(
      institution,
    );
    await expect(curatorPage.locator("#applications")).toContainText(program);
  }
  for (const privateId of fixture.p6d.applicationIds) {
    await expect(curatorPage.locator("body")).not.toContainText(privateId);
  }

  await curatorPage.goto(`${primaryPath}#visa`);
  const visaForm = curatorPage.getByTestId("platform-visa-form");
  await expect(visaForm).toBeVisible();
  await expect(visaForm.locator('input[name="student_case_id"]')).toHaveValue(
    fixture.p6d.primaryStudentCaseId,
  );
  const visaEvidence = `synthetic:p6d:visa:${randomUUID()}`;
  const visaNote = "Prepare the verified local visa-document package";
  await visaForm.locator('select[name="status"]').selectOption("docs");
  await visaForm
    .locator('input[name="evidence_reference"]')
    .fill(visaEvidence);
  await visaForm.locator('input[name="note"]').fill(visaNote);
  await visaForm.getByRole("button").click();
  await expect(curatorPage).toHaveURL(/p6d_result=saved.*#visa$/);
  const visaRows = await platformRpc(curatorToken, "staff_case_visa", {
    p_student_case_id: fixture.p6d.primaryStudentCaseId,
  });
  expect(visaRows.status).toBe(200);
  expect(visaRows.payload).toHaveLength(1);
  const visaRow = (visaRows.payload as Array<Record<string, unknown>>)[0];
  expect(Object.keys(visaRow).sort()).toEqual(exactVisaKeys);
  expect(visaRow).toMatchObject({
    case_id: fixture.p6d.primaryStudentCaseId,
    visa_status: "docs",
    note: visaNote,
  });
  expect(visaRow).not.toHaveProperty("evidence_reference");
  await expect(curatorPage.locator("body")).not.toContainText(visaEvidence);

  await curatorPage.goto(`${primaryPath}#case-lifecycle`);
  const closeForm = curatorPage.getByTestId("student-case-close-form");
  await expect(closeForm).toBeVisible();
  await closeForm
    .locator('textarea[name="reason"]')
    .fill("Close the synthetic P6D case after the bounded review");
  await closeForm.getByRole("button").click();
  await expect(curatorPage).toHaveURL(/result=saved.*#case-lifecycle$/);
  const reopenForm = curatorPage.getByTestId("student-case-reopen-form");
  await expect(reopenForm).toBeVisible();
  await reopenForm
    .locator('textarea[name="reason"]')
    .fill("Reopen the synthetic P6D case for continued admissions work");
  await reopenForm.getByRole("button").click();
  await expect(curatorPage).toHaveURL(/result=saved.*#case-lifecycle$/);
  await expect(
    curatorPage.getByTestId("student-case-close-form"),
  ).toBeVisible();

  const p6dDocumentSeed = await platformRpc(
    fixture.p6c.supabaseSecretKey,
    "record_document_version_metadata",
    {
      p_organization_id: fixture.p6d.organizationId,
      p_document_slot_id: fixture.p6d.documentSlotId,
      p_submitted_by_membership_id: fixture.p6d.primaryStudentMembershipId,
      p_original_filename: "p6d-synthetic-current-passport.pdf",
      p_declared_mime_type: "application/pdf",
      p_byte_size: 4096,
      p_sha256_hex: "7".repeat(64),
      p_ingest_evidence_ref: "synthetic-non-storage:p6d-browser-proof",
      p_request_id: randomUUID(),
    },
    fixture.p6c.supabaseSecretKey,
  );
  expect(p6dDocumentSeed.status).toBe(200);
  const p6dDocumentVersionId = (
    p6dDocumentSeed.payload as Record<string, unknown>
  ).document_version_id;
  expect(p6dDocumentVersionId).toEqual(expect.any(String));
  if (typeof p6dDocumentVersionId !== "string") {
    throw new Error("P6D current private document version was unavailable");
  }
  await curatorPage.goto(`${primaryPath}#documents`);
  const reviewForm = curatorPage.getByTestId("platform-document-review-form");
  await expect(reviewForm).toBeVisible();
  await expect(
    reviewForm.locator('input[name="document_version_id"]'),
  ).toHaveValue(p6dDocumentVersionId);
  await reviewForm
    .locator('select[name="decision"]')
    .selectOption("correction_required");
  await reviewForm
    .locator('input[name="reason"]')
    .fill(fixture.p6d.documentReviewReason);
  await reviewForm.getByTestId("platform-document-review-submit").click();
  await expect(curatorPage).toHaveURL(/result=saved.*#documents$/);
  await expect(curatorPage.locator("#documents")).toContainText(
    fixture.p6d.documentReviewReason,
  );
  await curatorContext.close();

  const primaryNotificationsAfterReview = await platformRpc(
    primaryStudentToken,
    "student_portal_notifications_v2",
    {},
  );
  expect(primaryNotificationsAfterReview.status).toBe(200);
  const documentRowsAfterReview = (
    primaryNotificationsAfterReview.payload as Array<Record<string, unknown>>
  ).filter((row) => row.category === "document.review");
  expect(documentRowsAfterReview).toHaveLength(1);
  expect(Object.keys(documentRowsAfterReview[0]).sort()).toEqual(
    exactPortalNotificationKeys,
  );
  expect(documentRowsAfterReview[0]).toMatchObject({
    category: "document.review",
    event_code: "correction_required",
    subject_label: fixture.p6d.documentRequirementLabel,
    detail: fixture.p6d.documentReviewReason,
    due_at: null,
  });

  const ensureOverdueNotifications = async () => {
    const [primary, secondary] = await Promise.all([
      platformRpc(primaryStudentToken, "student_portal_notifications_v2", {}),
      platformRpc(
        secondaryStudentToken,
        "student_portal_notifications_v2",
        {},
      ),
    ]);
    const primaryRows = primary.payload as Array<Record<string, unknown>>;
    const secondaryRows = secondary.payload as Array<Record<string, unknown>>;
    if (
      primaryRows.some((row) => row.category === "payment.overdue") &&
      secondaryRows.some((row) => row.category === "task.overdue")
    ) {
      return;
    }
    const requestId = randomUUID();
    const timestamp = String(Date.now());
    const response = await fetch(
      `${appOrigin}/api/internal/platform-operations/portal-overdue`,
      {
        method: "POST",
        headers: {
          "x-evo-portal-overdue-request-id": requestId,
          "x-evo-portal-overdue-timestamp": timestamp,
          "x-evo-portal-overdue-hmac-algorithm": "sha256",
          "x-evo-portal-overdue-hmac": createHmac(
            "sha256",
            fixture.p6c.workerTriggerSecret,
          )
            .update(`${requestId}.${timestamp}`)
            .digest("hex"),
        },
      },
    );
    expect(response.status).toBe(200);
  };
  await ensureOverdueNotifications();

  const primaryNotificationsAfterOverdue = await platformRpc(
    primaryStudentToken,
    "student_portal_notifications_v2",
    {},
  );
  expect(primaryNotificationsAfterOverdue.status).toBe(200);
  const primaryNotificationRows =
    primaryNotificationsAfterOverdue.payload as Array<Record<string, unknown>>;
  expect(
    primaryNotificationRows.filter((row) => row.category === "document.review"),
  ).toHaveLength(1);
  expect(
    primaryNotificationRows.filter((row) => row.category === "payment.overdue"),
  ).toHaveLength(1);

  const assertPersistedRead = async (page: Page, category: string) => {
    const row = page.locator(`[data-notification-category="${category}"]`);
    await expect(row).toHaveCount(1);
    const markRead = row.getByTestId("portal-notification-mark-read");
    if ((await markRead.count()) === 1) {
      await markRead.click();
      await expect(page).toHaveURL(/notification_result=read/);
    }
    await page.reload();
    await expect(
      page
        .locator(`[data-notification-category="${category}"]`)
        .getByTestId("portal-notification-mark-read"),
    ).toHaveCount(0);
  };

  const primaryStudentContext = await browser.newContext();
  const primaryStudentPage = await primaryStudentContext.newPage();
  await login(primaryStudentPage, fixture.identities.student);
  await expect(primaryStudentPage).toHaveURL(/\/portal$/);
  await primaryStudentPage.goto("/portal/notifications");
  await expect(primaryStudentPage).toHaveURL(/\/portal\/notifications$/);
  const documentNotification = primaryStudentPage.locator(
    '[data-notification-category="document.review"]',
  );
  const paymentNotification = primaryStudentPage.locator(
    '[data-notification-category="payment.overdue"]',
  );
  await expect(documentNotification).toHaveCount(1);
  await expect(paymentNotification).toHaveCount(1);
  await expect(documentNotification).toContainText(
    fixture.p6d.documentRequirementLabel,
  );
  await expect(documentNotification).toContainText(
    fixture.p6d.documentReviewReason,
  );
  await expect(
    documentNotification.getByTestId("portal-notification-destination"),
  ).toHaveAttribute("href", "/portal/documents");
  await expect(paymentNotification).toContainText(fixture.p6d.paymentLabel);
  await expect(
    paymentNotification.getByTestId("portal-notification-destination"),
  ).toHaveAttribute("href", "/portal/payments");
  for (const privateValue of [
    fixture.p6d.organizationId,
    fixture.p6d.primaryStudentCaseId,
    fixture.p6d.primaryStudentMembershipId,
    fixture.p6d.paymentObligationId,
    p6dDocumentVersionId,
    "125000",
    "USD",
    "WAHA",
    "amoCRM",
    "Gemini",
    "manual_platform_p6d",
  ]) {
    await expect(primaryStudentPage.getByTestId("portal-notification-list"))
      .not.toContainText(privateValue);
  }
  await assertPersistedRead(primaryStudentPage, "document.review");
  await assertPersistedRead(primaryStudentPage, "payment.overdue");

  const secondaryStudentContext = await browser.newContext();
  const secondaryStudentPage = await secondaryStudentContext.newPage();
  await login(secondaryStudentPage, fixture.identities.p6bStudent);
  await expect(secondaryStudentPage).toHaveURL(/\/portal$/);
  await secondaryStudentPage.goto("/portal/notifications");
  await expect(secondaryStudentPage).toHaveURL(/\/portal\/notifications$/);
  const taskNotification = secondaryStudentPage.locator(
    '[data-notification-category="task.overdue"]',
  );
  await expect(taskNotification).toContainText(fixture.p6d.taskTitle);
  await expect(
    taskNotification.getByTestId("portal-notification-destination"),
  ).toHaveAttribute("href", "/portal");
  for (const privateValue of [
    fixture.p6d.organizationId,
    fixture.p6d.primaryStudentCaseId,
    fixture.p6d.secondaryStudentCaseId,
    fixture.p6d.secondaryStudentMembershipId,
    fixture.p6d.taskId,
    "WAHA",
    "amoCRM",
    "Gemini",
  ]) {
    await expect(secondaryStudentPage.getByTestId("portal-notification-list"))
      .not.toContainText(privateValue);
  }
  await assertPersistedRead(secondaryStudentPage, "task.overdue");

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, fixture.identities.admin);
  await expect(adminPage).toHaveURL(/\/sales$/);
  await adminPage.goto(`${primaryPath}#payments`);
  const paymentCreateForm = adminPage.getByTestId(
    "platform-payment-create-form",
  );
  await paymentCreateForm.locator("xpath=..").locator("summary").click();
  const manualPaymentLabel = `P6D manual evidence fee ${randomUUID()}`;
  const dueDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  await paymentCreateForm.locator('input[name="label"]').fill(manualPaymentLabel);
  await paymentCreateForm.locator('input[name="amount"]').fill("250.00");
  await paymentCreateForm.locator('select[name="currency"]').selectOption("USD");
  await paymentCreateForm.locator('input[name="due_date"]').fill(dueDate);
  await paymentCreateForm
    .locator('input[name="next_action"]')
    .fill("Record the verified manual payment evidence");
  await paymentCreateForm
    .locator('input[name="reason"]')
    .fill("Create the bounded P6D manual finance obligation");
  await paymentCreateForm.getByRole("button").click();
  await expect(adminPage).toHaveURL(/p6d_result=saved.*#payments$/);

  let financeRows = await platformRpc(adminToken, "staff_case_finance", {
    p_student_case_id: fixture.p6d.primaryStudentCaseId,
  });
  expect(financeRows.status).toBe(200);
  const createdPayment = (
    financeRows.payload as Array<Record<string, unknown>>
  ).find((row) => row.obligation_label === manualPaymentLabel);
  expect(createdPayment).toBeTruthy();
  if (!createdPayment) throw new Error("P6D payment was not created");
  expect(Object.keys(createdPayment).sort()).toEqual(exactFinanceKeys);
  expect(createdPayment).toMatchObject({
    case_id: fixture.p6d.primaryStudentCaseId,
    amount_minor: 25_000,
    currency: "USD",
    derived_status: "pending",
    outstanding_minor: 25_000,
  });
  const createdPaymentId = createdPayment.payment_obligation_id;
  expect(createdPaymentId).toEqual(expect.any(String));
  if (typeof createdPaymentId !== "string") {
    throw new Error("P6D payment ID was unavailable");
  }

  const wrongCaseSettlement = await platformRpc(
    adminToken,
    "settle_payment_obligation",
    {
      p_organization_id: fixture.p6d.organizationId,
      p_student_case_id: fixture.p6d.secondaryStudentCaseId,
      p_payment_obligation_id: createdPaymentId,
      p_source_key: "manual_platform_p6d",
      p_evidence_ref: `synthetic:p6d:wrong-case:${randomUUID()}`,
      p_reason: "Prove same-organization wrong-case binding is denied",
      p_request_id: randomUUID(),
    },
  );
  expect(wrongCaseSettlement.status).toBeGreaterThanOrEqual(400);

  const settlementEvidence = `synthetic:p6d:payment:${randomUUID()}`;
  const settlementForm = adminPage.getByTestId(
    `platform-payment-settle-form-${createdPaymentId}`,
  );
  await expect(settlementForm).toBeVisible();
  await settlementForm
    .locator('input[name="evidence_ref"]')
    .fill(settlementEvidence);
  await settlementForm
    .locator('input[name="reason"]')
    .fill("Settle the P6D obligation from verified manual evidence");
  await settlementForm.getByRole("button").click();
  await expect(adminPage).toHaveURL(/p6d_result=saved.*#payments$/);
  await expect(adminPage.locator("body")).not.toContainText(settlementEvidence);
  await expect(
    adminPage.getByTestId(`platform-payment-settle-form-${createdPaymentId}`),
  ).toHaveCount(0);
  financeRows = await platformRpc(adminToken, "staff_case_finance", {
    p_student_case_id: fixture.p6d.primaryStudentCaseId,
  });
  const settledPayment = (
    financeRows.payload as Array<Record<string, unknown>>
  ).find((row) => row.payment_obligation_id === createdPaymentId);
  expect(settledPayment).toMatchObject({
    derived_status: "paid",
    outstanding_minor: 0,
    overdue: false,
  });
  expect(Object.keys(settledPayment ?? {}).sort()).toEqual(exactFinanceKeys);

  const crossOrgContext = await browser.newContext();
  const crossOrgPage = await crossOrgContext.newPage();
  await login(crossOrgPage, fixture.identities.crossOrgAdmin);
  await expect(crossOrgPage).toHaveURL(/\/sales$/);
  await crossOrgPage.goto(primaryPath);
  await expect(crossOrgPage.getByTestId("platform-visa-form")).toHaveCount(0);
  await expect(crossOrgPage.locator("body")).not.toContainText(
    manualPaymentLabel,
  );
  await expect(crossOrgPage.locator("body")).not.toContainText(
    fixture.p6d.documentReviewReason,
  );

  const crossOrgStudentContext = await browser.newContext();
  const crossOrgStudentPage = await crossOrgStudentContext.newPage();
  await login(crossOrgStudentPage, fixture.identities.crossOrgStudent);
  await expect.poll(() => new URL(crossOrgStudentPage.url()).pathname).toBe(
    "/platform-pending",
  );
  await crossOrgStudentPage.goto("/portal/notifications");
  await expect.poll(() => new URL(crossOrgStudentPage.url()).pathname).toBe(
    "/platform-pending",
  );
  await expect(crossOrgStudentPage.getByTestId("portal-notification-row"))
    .toHaveCount(0);

  expectLegacyDatabaseUntouched();
  await crossOrgStudentContext.close();
  await crossOrgContext.close();
  await adminContext.close();
  await secondaryStudentContext.close();
  await primaryStudentContext.close();
});

test("P7A searches and exports safe organization audit evidence through connected Settings", async ({
  browser,
  page,
}) => {
  test.skip(
    process.env.EVO_P7A_BROWSER_PROOF !== "1",
    "Runs only in the dedicated local P7A browser-proof partition.",
  );
  test.setTimeout(120_000);
  expectLegacyDatabaseUntouched();

  const exportPath = "/api/platform-audit/export";
  const staffSettingsPath = "/settings?tab=staff";
  const settingsPath = "/settings?tab=audit";
  const safePrivateValues = [
    fixture.p7a.privatePrincipal,
    fixture.p7a.privatePhone,
    fixture.p7a.privateReason,
    fixture.p7a.privateBefore,
    fixture.p7a.privateAfter,
  ];
  const postExport = async (
    targetPage: Page,
    body: URLSearchParams,
    origin = appOrigin,
  ) => targetPage.request.post(`${appOrigin}${exportPath}`, {
    data: body.toString(),
    headers: {
      origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    maxRedirects: 0,
  });

  await login(page, fixture.identities.admin);
  await expect(page).toHaveURL(/\/sales$/);
  const settingsNav = page
    .locator(".staff-sidebar")
    .getByRole("link", { name: "Настройки", exact: true });
  await expect(settingsNav).toHaveAttribute("href", staffSettingsPath);
  await settingsNav.click();
  await expect(page).toHaveURL(
    new RegExp(`${escapePathForRegex(staffSettingsPath)}$`),
  );
  await expect(page.getByTestId("platform-staff-settings")).toBeVisible();
  const auditSettingsLink = page.getByTestId("platform-audit-settings-link");
  await expect(auditSettingsLink).toHaveAttribute("href", settingsPath);
  await auditSettingsLink.click();
  await expect(page).toHaveURL(new RegExp(`${escapePathForRegex(settingsPath)}$`));
  await expect(
    page
      .locator(".staff-sidebar")
      .getByRole("link", { name: "Настройки", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("platform-audit-settings")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Журнал аудита EVO Platform" }),
  ).toBeVisible();

  const searchForm = page.getByRole("form", {
    name: "Фильтры журнала аудита",
  });
  await searchForm.locator('input[name="start_at"]').fill(fixture.p7a.startAt);
  await searchForm.locator('input[name="end_at"]').fill(fixture.p7a.endAt);
  await searchForm.locator('select[name="actions"]').selectOption(
    fixture.p7a.action,
  );
  await searchForm.locator('select[name="resource_types"]').selectOption(
    fixture.p7a.resourceType,
  );
  await searchForm.locator('input[name="resource_id"]').fill(
    fixture.p7a.resourceId,
  );
  await searchForm.locator('input[name="page_size"]').fill("1");
  await searchForm.getByRole("button", { name: "Найти" }).click();

  await expect(page).toHaveURL(/\/settings\?[^#]*tab=audit/);
  const auditTable = page.getByRole("table", {
    name: "Безопасные события аудита EVO Platform",
  });
  await expect(auditTable).toBeVisible();
  await expect(auditTable.locator("tbody tr")).toHaveCount(1);
  const safeRow = auditTable.locator("tbody tr").first();
  await expect(safeRow).toContainText(fixture.p7a.action);
  await expect(safeRow).toContainText(fixture.p7a.resourceType);
  await expect(safeRow).toContainText(fixture.p7a.resourceId);
  await expect(safeRow).toContainText(fixture.p7a.eventId);
  await expect(safeRow).toContainText(fixture.p7a.requestId);
  await expect(safeRow).toContainText("Staff");
  await expect(safeRow).toContainText("restricted");
  await expect(safeRow).toContainText("record_status");
  for (const privateValue of safePrivateValues) {
    await expect(page.locator("body")).not.toContainText(privateValue);
  }
  const exportForm = page.getByRole("form", {
    name: "Экспорт журнала аудита в CSV",
  });
  await expect(exportForm).toHaveAttribute("action", exportPath);
  await expect(exportForm).toHaveAttribute("method", "post");
  await expect(exportForm).toHaveAttribute(
    "enctype",
    "application/x-www-form-urlencoded",
  );
  const exportFields = await exportForm.locator("input").evaluateAll(
    (inputs) => Object.fromEntries(
      inputs.map((input) => {
        const field = input as HTMLInputElement;
        return [field.name, field.value];
      }),
    ),
  );
  const exportBody = new URLSearchParams(exportFields);
  const exportRequestId = exportBody.get("request_id");
  expect(exportRequestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(exportBody.get("snapshot_created_at")).toBeTruthy();
  expect(exportBody.get("snapshot_id")).toBe(fixture.p7a.eventId);

  const downloadPromise = page.waitForEvent("download");
  await exportForm.getByRole("button", { name: "Скачать CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("evo-platform-audit.csv");
  expect(await download.failure()).toBeNull();
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  if (!downloadedPath) throw new Error("P7A CSV download path was unavailable");
  const firstCsv = readFileSync(downloadedPath, "utf8");
  const expectedHeader =
    '"audit_event_id","created_at","action","resource_type","resource_id","actor_kind","actor_display_label","request_id","reason_code","changed_field_codes"\r\n';
  expect(firstCsv.startsWith(expectedHeader)).toBe(true);
  expect(firstCsv.endsWith("\r\n")).toBe(true);
  expect(firstCsv.split("\r\n")).toHaveLength(3);
  for (const allowedValue of [
    fixture.p7a.eventId,
    fixture.p7a.requestId,
    fixture.p7a.resourceId,
    fixture.p7a.action,
    fixture.p7a.resourceType,
    "Staff",
    "restricted",
    "record_status",
  ]) {
    expect(firstCsv).toContain(allowedValue);
  }
  for (const privateValue of safePrivateValues) {
    expect(firstCsv).not.toContain(privateValue);
  }

  const replay = await postExport(page, exportBody);
  expect(replay.status()).toBe(200);
  expect(replay.headers()["content-type"]).toBe("text/csv; charset=utf-8");
  expect(replay.headers()["content-disposition"]).toBe(
    'attachment; filename="evo-platform-audit.csv"',
  );
  expect(replay.headers()["cache-control"]).toBe("private, no-store");
  expect(replay.headers()["x-content-type-options"]).toBe("nosniff");
  expect(await replay.text()).toBe(firstCsv);

  const conflictingBody = new URLSearchParams(exportBody);
  conflictingBody.set("resource_id", randomUUID());
  expect((await postExport(page, conflictingBody)).status()).toBe(400);
  expect(
    (await postExport(page, exportBody, "https://attacker.invalid")).status(),
  ).toBe(403);
  expect((await page.request.get(`${appOrigin}${exportPath}`)).status()).toBe(405);
  expect(
    (
      await page.request.post(`${appOrigin}${exportPath}/near`, {
        data: exportBody.toString(),
        headers: {
          origin: appOrigin,
          "content-type": "application/x-www-form-urlencoded",
        },
        maxRedirects: 0,
      })
    ).status(),
  ).toBe(403);

  const adminToken = await localAccessToken(fixture.identities.admin);
  const exportAudit = await safeAuditSearch(adminToken, {
    actions: ["audit.export"],
    resourceTypes: ["audit_export"],
    resourceId: exportRequestId ?? undefined,
  });
  expect(exportAudit.status).toBe(200);
  expect(safeAuditRows(exportAudit.payload)).toEqual([
    expect.objectContaining({
      action: "audit.export",
      resource_type: "audit_export",
      resource_id: exportRequestId,
      request_id: exportRequestId,
      actor_kind: "user",
      actor_display_label: "Staff",
      reason_code: "audit_export_requested",
      changed_field_codes: [
        "export_filters",
        "export_row_count",
        "export_row_set_sha256",
      ],
    }),
  ]);

  // Intentional negative seam: post-071 browser actors must not be able to
  // bypass the safe RPC projection by selecting the raw audit table.
  const rawAdminRead = await platformRows(
    adminToken,
    "audit_events",
    new URLSearchParams({ select: "id", limit: "1" }),
  );
  expect([401, 403]).toContain(rawAdminRead.status);

  for (const [label, identity] of [
    ["curator", fixture.identities.curator],
    ["sales", fixture.identities.salesScoped],
    ["finance", fixture.identities.finance],
    ["student", fixture.identities.student],
  ] as const) {
    const token = await localAccessToken(identity);
    const deniedRpc = await safeAuditSearch(token, {
      actions: [fixture.p7a.action],
      resourceTypes: [fixture.p7a.resourceType],
      resourceId: fixture.p7a.resourceId,
    });
    expect(deniedRpc.status, label).toBe(403);

    const context = await browser.newContext();
    const deniedPage = await context.newPage();
    await login(deniedPage, identity);
    await expect(deniedPage).toHaveURL(expectedStaffHome(identity));
    await deniedPage.goto(settingsPath);
    await expect(deniedPage.getByTestId("platform-audit-settings")).toHaveCount(0);
    await expect(deniedPage).not.toHaveURL(
      new RegExp(`${escapePathForRegex(settingsPath)}$`),
    );
    expect((await postExport(deniedPage, exportBody)).status(), label).toBe(403);
    await context.close();
  }

  for (const [label, accessToken] of [
    ["stale Admin", fixture.p7a.staleAdminAccessToken],
    ["inactive Admin", fixture.p7a.inactiveAdminAccessToken],
    ["suspended Admin", fixture.p7a.suspendedAdminAccessToken],
    ["blocked Admin", fixture.p7a.blockedAdminAccessToken],
  ] as const) {
    const deniedSearch = await safeAuditSearch(accessToken, {
      actions: [fixture.p7a.action],
      resourceTypes: [fixture.p7a.resourceType],
      resourceId: fixture.p7a.resourceId,
    });
    expect(deniedSearch.status, label).toBe(403);

    const deniedContext = await browser.newContext();
    const deniedPage = await deniedContext.newPage();
    await installP7APlatformSession(deniedPage, accessToken);
    const deniedExport = await postExport(deniedPage, exportBody);
    expect(deniedExport.status(), label).toBe(403);
    expect(deniedExport.headers()["content-type"], label).not.toBe(
      "text/csv; charset=utf-8",
    );
    expect(await deniedExport.text(), label).toBe("");

    await installP7APlatformSession(deniedPage, accessToken);
    await deniedPage.goto(settingsPath);
    await expect
      .poll(() => new URL(deniedPage.url()).pathname, { message: label })
      .toBe("/login");
    await expect(
      deniedPage.getByTestId("platform-audit-settings"),
      label,
    ).toHaveCount(0);
    for (const privateValue of safePrivateValues) {
      await expect(deniedPage.locator("body"), label).not.toContainText(
        privateValue,
      );
    }
    await deniedContext.close();
  }

  const crossOrgToken = await localAccessToken(fixture.identities.crossOrgAdmin);
  const crossOrgSearch = await safeAuditSearch(crossOrgToken, {
    actions: [fixture.p7a.action],
    resourceTypes: [fixture.p7a.resourceType],
    resourceId: fixture.p7a.resourceId,
  });
  expect(crossOrgSearch.status).toBe(200);
  expect(safeAuditRows(crossOrgSearch.payload)).toEqual([]);
  const crossOrgContext = await browser.newContext();
  const crossOrgPage = await crossOrgContext.newPage();
  await login(crossOrgPage, fixture.identities.crossOrgAdmin);
  await expect(crossOrgPage).toHaveURL(/\/sales$/);
  await crossOrgPage.goto(
    `${settingsPath}&actions=${encodeURIComponent(fixture.p7a.action)}` +
      `&resource_types=${encodeURIComponent(fixture.p7a.resourceType)}` +
      `&resource_id=${fixture.p7a.resourceId}`,
  );
  await expect(crossOrgPage.getByTestId("platform-audit-settings")).toBeVisible();
  await expect(crossOrgPage.locator("tbody tr")).toHaveCount(0);
  await expect(crossOrgPage.locator("body")).not.toContainText(
    fixture.p7a.resourceId,
  );

  const crossOrgExportBody = new URLSearchParams(exportBody);
  const crossOrgExportRequestId = randomUUID();
  crossOrgExportBody.set("request_id", crossOrgExportRequestId);
  const crossOrgExport = await postExport(crossOrgPage, crossOrgExportBody);
  expect(crossOrgExport.status()).toBe(400);
  expect(crossOrgExport.headers()["content-type"]).not.toBe(
    "text/csv; charset=utf-8",
  );
  const crossOrgExportBodyText = await crossOrgExport.text();
  expect(crossOrgExportBodyText).not.toContain(fixture.p7a.resourceId);
  for (const privateValue of safePrivateValues) {
    expect(crossOrgExportBodyText).not.toContain(privateValue);
  }
  await crossOrgContext.close();

  const orgAUnexpectedCrossOrgExportAudit = await safeAuditSearch(adminToken, {
    actions: ["audit.export"],
    resourceTypes: ["audit_export"],
    resourceId: crossOrgExportRequestId,
  });
  expect(orgAUnexpectedCrossOrgExportAudit.status).toBe(200);
  expect(safeAuditRows(orgAUnexpectedCrossOrgExportAudit.payload)).toEqual([]);
  const orgAOriginalExportAudit = await safeAuditSearch(adminToken, {
    actions: ["audit.export"],
    resourceTypes: ["audit_export"],
    resourceId: exportRequestId ?? undefined,
  });
  expect(orgAOriginalExportAudit.status).toBe(200);
  expect(safeAuditRows(orgAOriginalExportAudit.payload)).toHaveLength(1);

  const anonymousContext = await browser.newContext();
  const anonymousPage = await anonymousContext.newPage();
  await anonymousPage.goto(settingsPath);
  await expect(anonymousPage).toHaveURL(/\/login$/);
  await expect(anonymousPage.getByTestId("platform-audit-settings")).toHaveCount(0);
  expect((await postExport(anonymousPage, exportBody)).status()).toBe(403);
  // Repeat the raw-table negative without any resident Auth session.
  const anonymousRawRead = await fetch(
    `${fixture.apiUrl}/rest/v1/audit_events?select=id&limit=1`,
    {
      headers: {
        apikey: fixture.publishableKey,
        Accept: "application/json",
        "Accept-Profile": "platform",
      },
    },
  );
  expect([401, 403]).toContain(anonymousRawRead.status);
  const anonymousRpc = await fetch(
    `${fixture.apiUrl}/rest/v1/rpc/search_audit_events`,
    {
      method: "POST",
      headers: {
        apikey: fixture.publishableKey,
        Accept: "application/json",
        "Accept-Profile": "platform",
        "Content-Profile": "platform",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_page_size: 1 }),
    },
  );
  expect([401, 403]).toContain(anonymousRpc.status);
  await anonymousContext.close();

  expectLegacyDatabaseUntouched();
});

test("P7B exposes signed private readiness and metrics without claiming provider health", async ({
  page,
}) => {
  test.skip(
    process.env.EVO_P7B_BROWSER_PROOF !== "1",
    "Runs only in the dedicated local P7B browser-proof partition.",
  );
  test.setTimeout(120_000);
  expectLegacyDatabaseUntouched();

  const readinessPath = "/api/readiness" as const;
  const metricsPath = "/metrics" as const;
  const expectHidden = async (response: Awaited<ReturnType<typeof page.request.get>>) => {
    expect(response.status()).toBe(404);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.text()).toBe("");
  };

  await expectHidden(await page.request.get(`${appOrigin}${readinessPath}`));
  await expectHidden(await page.request.get(`${appOrigin}${metricsPath}`));

  const badSignature = p7bObservabilityHeaders(readinessPath, {
    secret: `${fixture.p7b.observabilitySecret}-wrong`,
  });
  await expectHidden(
    await page.request.get(`${appOrigin}${readinessPath}`, {
      headers: badSignature.headers,
    }),
  );

  const staleSignature = p7bObservabilityHeaders(readinessPath, {
    timestamp: (Date.now() - 300_001).toString(),
  });
  await expectHidden(
    await page.request.get(`${appOrigin}${readinessPath}`, {
      headers: staleSignature.headers,
    }),
  );

  const querySignature = p7bObservabilityHeaders(readinessPath);
  await expectHidden(
    await page.request.get(`${appOrigin}${readinessPath}?probe=1`, {
      headers: querySignature.headers,
    }),
  );

  const methodSignature = p7bObservabilityHeaders(readinessPath);
  await expectHidden(
    await page.request.post(`${appOrigin}${readinessPath}`, {
      headers: methodSignature.headers,
    }),
  );

  expect((await page.request.get(`${appOrigin}/api/readiness-near`)).status()).toBe(
    404,
  );
  expect((await page.request.get(`${appOrigin}/metrics/near`)).status()).toBe(
    404,
  );

  const readinessSignature = p7bObservabilityHeaders(readinessPath);
  const metricsSignature = p7bObservabilityHeaders(metricsPath);
  const [readinessResponse, metricsResponse] = await Promise.all([
    page.request.get(`${appOrigin}${readinessPath}`, {
      headers: readinessSignature.headers,
    }),
    page.request.get(`${appOrigin}${metricsPath}`, {
      headers: metricsSignature.headers,
    }),
  ]);

  expect(readinessResponse.status()).toBe(503);
  expect(readinessResponse.headers()["cache-control"]).toBe("no-store");
  expect(readinessResponse.headers()["x-content-type-options"]).toBe(
    "nosniff",
  );
  expect(readinessResponse.headers()["content-type"]).toMatch(
    /^application\/json(?:;|$)/,
  );

  const readiness = (await readinessResponse.json()) as Record<string, unknown>;
  expect(Object.keys(readiness).sort()).toEqual(
    [
      "alerts",
      "components",
      "observed_at",
      "ok",
      "request_id",
      "schema_version",
      "service",
      "signals",
      "status",
    ].sort(),
  );
  expect(readiness.schema_version).toBe("p7b-v1");
  expect(readiness.ok).toBe(false);
  expect(readiness.status).toBe("not_ready");
  expect(readiness.service).toBe("evo-crm");
  expect(readiness.request_id).toBe(readinessSignature.requestId);
  expect(Number.isNaN(Date.parse(String(readiness.observed_at)))).toBe(false);

  const components = readiness.components as Record<
    string,
    Record<string, unknown>
  >;
  expect(Object.keys(components).sort()).toEqual(
    [
      "ai",
      "audit_append",
      "restore_database",
      "restore_storage",
      "supabase",
      "waha",
    ].sort(),
  );
  const componentStatuses = new Set([
    "ready",
    "failed",
    "unavailable",
    "missing",
    "unverified",
    "stale",
  ]);
  for (const component of Object.values(components)) {
    expect(Object.keys(component).sort()).toEqual([
      "age_seconds",
      "status",
    ]);
    expect(componentStatuses.has(String(component.status))).toBe(true);
    expect(
      component.age_seconds === null ||
        (Number.isSafeInteger(component.age_seconds) &&
          Number(component.age_seconds) >= 0 &&
          Number(component.age_seconds) <= 31_536_000),
    ).toBe(true);
  }
  expect(components.supabase.status).toBe("ready");
  expect(components.audit_append.status).toBe("ready");
  expect(components.waha.status).toBe("unverified");
  expect(components.ai.status).toBe("unverified");
  expect(components.restore_database.status).toBe("missing");
  expect(components.restore_storage.status).toBe("missing");

  const expectedSignalKeys = [
    "ai_age_seconds",
    "ai_evidence_future",
    "ai_evidence_kind",
    "ai_readiness",
    "audit_append_status",
    "autonomy_dispatching_count",
    "autonomy_manual_review_count",
    "autonomy_oldest_dispatching_age_seconds",
    "autonomy_oldest_queued_age_seconds",
    "autonomy_queued_count",
    "autonomy_unknown_count",
    "dead_letter_count",
    "observed_at",
    "private_media_expired_lease_count",
    "private_media_oldest_unarchived_age_seconds",
    "private_media_pending_count",
    "private_media_processing_count",
    "private_media_retryable_error_count",
    "private_media_terminal_error_count",
    "provider_conflict_open_count",
    "queue_expired_lease_count",
    "queue_leased_count",
    "queue_oldest_ready_age_seconds",
    "queue_oldest_retry_wait_age_seconds",
    "queue_ready_count",
    "queue_retry_wait_count",
    "saturated",
    "schema_version",
    "unknown_delivery_open_count",
    "waha_age_seconds",
    "waha_evidence_future",
    "waha_evidence_kind",
    "waha_readiness",
  ].sort();
  const signals = readiness.signals as Record<string, unknown>;
  expect(Object.keys(signals).sort()).toEqual(expectedSignalKeys);
  expect(signals.schema_version).toBe("p7b-v1");
  expect(signals.waha_readiness).toBe("ready");
  expect(signals.waha_evidence_kind).toBe("local_non_provider");
  expect(signals.ai_readiness).toBe("ready");
  expect(signals.ai_evidence_kind).toBe("local_non_provider");
  expect(typeof signals.saturated).toBe("boolean");
  for (const [key, value] of Object.entries(signals)) {
    if (key.endsWith("_count")) {
      expect(Number.isSafeInteger(value), key).toBe(true);
      expect(Number(value), key).toBeGreaterThanOrEqual(0);
      expect(Number(value), key).toBeLessThanOrEqual(1_000_000);
    }
    if (key.endsWith("_age_seconds") && value !== null) {
      expect(Number.isSafeInteger(value), key).toBe(true);
      expect(Number(value), key).toBeGreaterThanOrEqual(0);
      expect(Number(value), key).toBeLessThanOrEqual(31_536_000);
    }
  }

  const alertContract = new Map<string, readonly [string, string, string]>([
    ["supabase_unavailable", ["critical", "server_operator", "RB-P7B-SUPABASE-UNAVAILABLE"]],
    ["audit_append_failed", ["critical", "server_operator", "RB-P7B-AUDIT-APPEND"]],
    ["waha_unavailable", ["critical", "whatsapp_operator", "RB-P7B-WAHA-DEGRADED"]],
    ["ai_unavailable", ["critical", "ai_operator", "RB-P7B-AI-UNAVAILABLE"]],
    ["queue_backlog_warning", ["warning", "server_operator", "RB-P7B-QUEUE-BACKLOG"]],
    ["queue_backlog_critical", ["critical", "server_operator", "RB-P7B-QUEUE-BACKLOG"]],
    ["queue_expired_lease", ["critical", "server_operator", "RB-P7B-QUEUE-BACKLOG"]],
    ["queue_dead_letter", ["critical", "server_operator", "RB-P7B-QUEUE-BACKLOG"]],
    ["unknown_delivery_open", ["critical", "whatsapp_operator", "RB-P7B-UNKNOWN-DELIVERY"]],
    ["provider_conflict_open", ["critical", "whatsapp_operator", "RB-P7B-UNKNOWN-DELIVERY"]],
    ["private_media_backlog", ["warning", "whatsapp_operator", "RB-P7B-PRIVATE-MEDIA"]],
    ["private_media_expired_lease", ["critical", "whatsapp_operator", "RB-P7B-PRIVATE-MEDIA"]],
    ["private_media_terminal_error", ["critical", "whatsapp_operator", "RB-P7B-PRIVATE-MEDIA"]],
    ["autonomy_queue_stalled_warning", ["warning", "whatsapp_operator", "RB-P7B-ROLLBACK-KILL-SWITCH"]],
    ["autonomy_queue_stalled_critical", ["critical", "whatsapp_operator", "RB-P7B-ROLLBACK-KILL-SWITCH"]],
    ["autonomy_dispatch_stalled", ["critical", "whatsapp_operator", "RB-P7B-ROLLBACK-KILL-SWITCH"]],
    ["autonomy_unknown", ["critical", "whatsapp_operator", "RB-P7B-ROLLBACK-KILL-SWITCH"]],
    ["autonomy_manual_review", ["warning", "whatsapp_operator", "RB-P7B-ROLLBACK-KILL-SWITCH"]],
    ["restore_evidence_missing", ["warning", "data_recovery_owner", "RB-P7B-RESTORE-EVIDENCE"]],
    ["restore_evidence_failed", ["critical", "data_recovery_owner", "RB-P7B-RESTORE-EVIDENCE"]],
    ["signal_saturated", ["critical", "server_operator", "RB-P7B-QUEUE-BACKLOG"]],
  ]);
  const alerts = readiness.alerts as Array<Record<string, unknown>>;
  expect(alerts.length).toBeGreaterThan(0);
  expect(new Set(alerts.map((alert) => alert.code)).size).toBe(alerts.length);
  for (const alert of alerts) {
    expect(Object.keys(alert).sort()).toEqual([
      "code",
      "owner_category",
      "runbook_id",
      "severity",
    ]);
    const expected = alertContract.get(String(alert.code));
    expect(expected, String(alert.code)).toBeDefined();
    expect([
      alert.severity,
      alert.owner_category,
      alert.runbook_id,
    ]).toEqual(expected);
  }

  expect(metricsResponse.status()).toBe(200);
  expect(metricsResponse.headers()["cache-control"]).toBe("no-store");
  expect(metricsResponse.headers()["x-content-type-options"]).toBe("nosniff");
  expect(metricsResponse.headers()["content-type"]).toBe(
    "text/plain; version=0.0.4; charset=utf-8",
  );
  const metrics = await metricsResponse.text();
  expect(metrics.endsWith("\n")).toBe(true);
  expect(metrics).toMatch(/^evo_platform_readiness 0$/m);
  expect(metrics).toMatch(
    /^evo_platform_component_ready\{component="supabase"\} 1$/m,
  );
  expect(metrics).toMatch(/^evo_platform_active_alerts\{severity="warning"\} /m);
  expect(metrics).toMatch(/^evo_platform_active_alerts\{severity="critical"\} /m);

  const allowedMetricFamilies = new Set([
    "evo_platform_readiness",
    "evo_platform_component_ready",
    "evo_platform_component_age_seconds",
    "evo_platform_queue_items",
    "evo_platform_queue_oldest_age_seconds",
    "evo_platform_review_items",
    "evo_platform_private_media_items",
    "evo_platform_private_media_oldest_age_seconds",
    "evo_platform_autonomy_items",
    "evo_platform_autonomy_oldest_queued_age_seconds",
    "evo_platform_autonomy_oldest_dispatching_age_seconds",
    "evo_platform_signal_saturated",
    "evo_platform_active_alerts",
  ]);
  for (const line of metrics.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    expect(line).toMatch(/^[a-z_:][a-zA-Z0-9_:]*(?:\{[^\r\n]*\})? -?\d+(?:\.\d+)?$/);
    const family = line.slice(0, line.search(/[ {]/));
    expect(allowedMetricFamilies.has(family), line).toBe(true);
  }

  const safeBodies = [JSON.stringify(readiness), metrics];
  for (const body of safeBodies) {
    for (const privateValue of [
      fixture.p7b.observabilitySecret,
      fixture.p7b.supabaseSecretKey,
      fixture.p5b.organizationId,
      fixture.p6b.studentCaseId,
    ]) {
      expect(body).not.toContain(privateValue);
    }
    expect(body).not.toMatch(
      /organization_id|student_case_id|provider_reference|object_key|phone|stack|exception/i,
    );
    expect(body).not.toContain(metricsSignature.requestId);
  }

  expectLegacyDatabaseUntouched();
});

test("P5D archives private WAHA media into the accepted conversation UI", async ({
  page,
}) => {
  test.skip(
    process.env.EVO_P5D_BROWSER_PROOF !== "1",
    "Runs only in the dedicated local P5D browser-proof partition.",
  );
  expectLegacyDatabaseUntouched();

  const chatId = "14155550288@c.us";
  const rawMessageId = `false_${chatId}_${randomUUID()}`;
  const fileName = "p5d-proof.png";
  const humanReviewMarker =
    "[Системное уведомление] Получено медиа или сообщение без текста. Требуется проверка сотрудником.";
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z5sAAAAASUVORK5CYII=",
    "base64",
  );
  const providerRequests: Array<
    Readonly<{ pathname: string; apiKey: string | undefined }>
  > = [];

  const mediaFixture = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1:3313");
    providerRequests.push({
      pathname: `${url.pathname}${url.search}`,
      apiKey:
        typeof request.headers["x-api-key"] === "string"
          ? request.headers["x-api-key"]
          : undefined,
    });
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }

    const match = url.pathname.match(
      /^\/api\/evo-inbox\/chats\/([^/]+)\/messages\/([^/]+)$/,
    );
    if (match) {
      const requestChatId = decodeURIComponent(match[1]);
      const requestMessageId = decodeURIComponent(match[2]);
      if (
        url.searchParams.get("downloadMedia") !== "true" ||
        request.headers["x-api-key"] !== fixture.p5d.wahaApiKey
      ) {
        response.writeHead(401).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          session: "evo-inbox",
          id: requestMessageId,
          from: requestChatId,
          to: "996555000001@c.us",
          chatId: requestChatId,
          fromMe: false,
          source: "app",
          hasMedia: true,
          media: {
            url: "http://127.0.0.1:3313/api/files/evo-inbox/p5d-proof",
            mimetype: "image/png",
            filename: fileName,
            error: null,
          },
        }),
      );
      return;
    }

    if (url.pathname === "/api/files/evo-inbox/p5d-proof") {
      if (request.headers["x-api-key"] !== fixture.p5d.wahaApiKey) {
        response.writeHead(401).end();
        return;
      }
      response.writeHead(200, {
        "content-type": "image/png",
        "content-length": String(pngBytes.byteLength),
      });
      response.end(pngBytes);
      return;
    }

    response.writeHead(404).end();
  });

  async function triggerMediaWorker() {
    const requestId = randomUUID();
    const timestamp = String(Date.now());
    const response = await fetch(
      `${appOrigin}/api/internal/platform-messaging/waha/media`,
      {
        method: "POST",
        headers: {
          "x-evo-media-request-id": requestId,
          "x-evo-media-timestamp": timestamp,
          "x-evo-media-hmac-algorithm": "sha256",
          "x-evo-media-hmac": createHmac(
            "sha256",
            fixture.p5d.mediaTriggerSecret,
          )
            .update(`${requestId}.${timestamp}`)
            .digest("hex"),
        },
      },
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Readonly<{
      ok?: unknown;
      claimed?: unknown;
      outcome?: unknown;
      state?: unknown;
    }>;
  }

  let fixtureListening = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        mediaFixture.off("listening", onListening);
        reject(
          error.code === "EADDRINUSE"
            ? new Error("P5D loopback WAHA fixture port 3313 is occupied")
            : error,
        );
      };
      const onListening = () => {
        mediaFixture.off("error", onError);
        fixtureListening = true;
        resolve();
      };
      mediaFixture.once("error", onError);
      mediaFixture.once("listening", onListening);
      mediaFixture.listen(3313, "127.0.0.1");
    });

    const occurredAtMs = Date.now();
    const rawBody = JSON.stringify({
      event: "message",
      session: "evo-inbox",
      payload: {
        id: rawMessageId,
        timestamp: Math.floor(occurredAtMs / 1_000),
        from: chatId,
        chatId,
        fromMe: false,
        source: "app",
        body: "",
        hasMedia: true,
      },
    });
    const ingressResponse = await fetch(
      `${appOrigin}/api/internal/platform-messaging/waha/events`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-request-id": `p5d-browser-${randomUUID()}`,
          "x-webhook-timestamp": String(occurredAtMs),
          "x-webhook-hmac-algorithm": "sha512",
          "x-webhook-hmac": createHmac(
            "sha512",
            fixture.p5d.ingressHmacSecret,
          )
            .update(rawBody)
            .digest("hex"),
        },
        body: rawBody,
      },
    );
    expect(ingressResponse.status).toBe(202);
    expect(await ingressResponse.json()).toEqual(
      expect.objectContaining({ ok: true, persisted: true, enqueued: true }),
    );

    const projectionRequestId = randomUUID();
    const projectionTimestamp = String(Date.now());
    const projectionResponse = await fetch(
      `${appOrigin}/api/internal/platform-messaging/waha/work`,
      {
        method: "POST",
        headers: {
          "x-evo-worker-request-id": projectionRequestId,
          "x-evo-worker-timestamp": projectionTimestamp,
          "x-evo-worker-hmac-algorithm": "sha256",
          "x-evo-worker-hmac": createHmac(
            "sha256",
            fixture.p5d.workerTriggerSecret,
          )
            .update(`${projectionRequestId}.${projectionTimestamp}`)
            .digest("hex"),
        },
      },
    );
    expect(projectionResponse.status).toBe(200);
    expect(await projectionResponse.json()).toEqual(
      expect.objectContaining({
        ok: true,
        processed: true,
        disposition: "succeeded",
        state: "succeeded",
      }),
    );

    const archiveResult = await triggerMediaWorker();
    expect(archiveResult).toEqual({
      ok: true,
      claimed: true,
      outcome: "archived",
      state: "archived",
    });
    expect(providerRequests).toHaveLength(2);
    expect(providerRequests.every((entry) => entry.apiKey === fixture.p5d.wahaApiKey)).toBe(true);
    expect(providerRequests[0]?.pathname).toContain("downloadMedia=true");
    expect(providerRequests[1]?.pathname).toBe(
      "/api/files/evo-inbox/p5d-proof",
    );

    await loginToMessaging(page, fixture.identities.p5dSales);
    const projectedConversation = page
      .getByTestId("platform-conversation-list")
      .locator("a")
      .filter({ hasText: "WhatsApp ••••0288" });
    await expect(projectedConversation).toHaveCount(1);
    const href = await projectedConversation.getAttribute("href");
    expect(href).toMatch(/^\/whatsapp\/[0-9a-f-]{36}$/i);
    const conversationId = href?.split("/").at(-1);
    expect(conversationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const p5dSalesToken = await localAccessToken(
      fixture.identities.p5dSales,
    );
    const messageRows = await platformRpc(
      p5dSalesToken,
      "staff_conversation_message_page",
      {
        p_organization_id: fixture.p5d.organizationId,
        p_conversation_id: conversationId,
        p_limit: 201,
        p_before_created_at: null,
        p_before_message_id: null,
      },
    );
    expect(messageRows.status).toBe(200);
    expect(Array.isArray(messageRows.payload)).toBe(true);
    const rows = messageRows.payload as Array<Record<string, unknown>>;
    const mediaMessage = rows.find(
      (row) => row.body_text === humanReviewMarker,
    );
    expect(mediaMessage).toBeDefined();
    expect(Array.isArray(mediaMessage?.media)).toBe(true);
    const mediaEntries = mediaMessage?.media as Array<Record<string, unknown>>;
    expect(mediaEntries).toHaveLength(1);
    expect(Object.keys(mediaEntries[0] ?? {}).sort()).toEqual(
      [
        "archival_status",
        "archived_at",
        "created_at",
        "file_name",
        "file_size_bytes",
        "id",
        "media_kind",
        "mime_type",
        "ordinal",
      ].sort(),
    );
    expect(mediaEntries[0]).toEqual(
      expect.objectContaining({
        ordinal: 0,
        media_kind: "image",
        mime_type: "image/png",
        file_name: fileName,
        file_size_bytes: pngBytes.byteLength,
        archival_status: "archived",
      }),
    );
    const mediaId = mediaEntries[0]?.id;
    expect(mediaId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const safePayload = JSON.stringify(messageRows.payload);
    expect(safePayload).not.toContain(chatId);
    expect(safePayload).not.toContain(rawMessageId);
    expect(safePayload).not.toContain("platform-whatsapp-media");

    await projectedConversation.click();
    await expect(page.getByTestId("platform-conversation-thread")).toContainText(
      humanReviewMarker,
    );
    const image = page.getByAltText(
      `Архивированное изображение: ${fileName}`,
    );
    await expect(image).toBeVisible();
    expect(await image.getAttribute("src")).toBe(
      `/api/platform-messaging/media/${mediaId}`,
    );
    await expect
      .poll(() =>
        image.evaluate(
          (element) =>
            element instanceof HTMLImageElement &&
            element.complete &&
            element.naturalWidth === 1,
        ),
      )
      .toBe(true);
    await expect(page.locator("body")).not.toContainText(chatId);
    await expect(page.locator("body")).not.toContainText(rawMessageId);

    const mediaResponse = await page.request.get(
      `/api/platform-messaging/media/${mediaId}`,
    );
    expect(mediaResponse.status()).toBe(200);
    expect(mediaResponse.headers()["content-type"]).toContain("image/png");
    expect(Buffer.compare(await mediaResponse.body(), pngBytes)).toBe(0);

    await page.context().clearCookies();
    const anonymousResponse = await page.request.get(
      `/api/platform-messaging/media/${mediaId}`,
      { maxRedirects: 0 },
    );
    expect(anonymousResponse.status()).toBe(404);

    await loginToMessaging(page, fixture.identities.admin);
    const crossOrganizationResponse = await page.request.get(
      `/api/platform-messaging/media/${mediaId}`,
      { maxRedirects: 0 },
    );
    expect(crossOrganizationResponse.status()).toBe(404);
  } finally {
    if (fixtureListening) {
      await new Promise<void>((resolve, reject) => {
        mediaFixture.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }

  expectLegacyDatabaseUntouched();
});

test("P5E projects WAHA ACK and session state into the live conversation UI", async ({
  page,
}) => {
  test.skip(
    process.env.EVO_P5E_BROWSER_PROOF !== "1",
    "Runs only in the dedicated local P5E browser-proof partition.",
  );
  expectLegacyDatabaseUntouched();

  const chatId = "14155550305@c.us";
  const rawOutboundMessageId = `true_${chatId}_${randomUUID()}`;
  const outboundText = `P5E local outbound observation ${randomUUID()}`;
  const privateSessionPayloadSentinel = `p5e-private-session-${randomUUID()}`;
  const historyOccurredAt = new Date(Date.now() - 60_000).toISOString();
  const serviceToken = fixture.p5b.supabaseSecretKey;

  const beginResult = await platformRpc(
    serviceToken,
    "begin_waha_history_reconciliation",
    {
      p_organization_id: fixture.p5b.organizationId,
      p_waha_session_name: "evo-inbox",
      p_engine: "NOWEB",
      p_intake_sales_membership_id: fixture.p5b.intakeSalesMembershipId,
      p_request_id: randomUUID(),
    },
    serviceToken,
  );
  expect(beginResult.status).toBe(200);
  const beginPayload = beginResult.payload as Record<string, unknown>;
  const runId = beginPayload.run_id;
  expect(runId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(beginPayload).toEqual(
    expect.objectContaining({
      state: "running",
      chat_offset: 0,
      message_offset: 0,
    }),
  );

  const historyResult = await platformRpc(
    serviceToken,
    "project_waha_history_page",
    {
      p_organization_id: fixture.p5b.organizationId,
      p_run_id: runId,
      p_waha_session_name: "evo-inbox",
      p_raw_chat_id: chatId,
      p_messages: [
        {
          raw_message_id: rawOutboundMessageId,
          direction: "outbound",
          occurred_at: historyOccurredAt,
          body_text: outboundText,
          has_media: false,
        },
      ],
      p_next_chat_offset: 0,
      p_next_message_offset: 1,
      p_request_id: randomUUID(),
    },
    serviceToken,
  );
  expect(historyResult.status).toBe(200);
  expect(historyResult.payload).toEqual(
    expect.objectContaining({
      run_id: runId,
      state: "running",
      projected_count: 1,
      chat_offset: 0,
      message_offset: 1,
    }),
  );

  const finishResult = await platformRpc(
    serviceToken,
    "finish_waha_history_reconciliation",
    {
      p_organization_id: fixture.p5b.organizationId,
      p_run_id: runId,
      p_outcome: "completed",
      p_request_id: randomUUID(),
    },
    serviceToken,
  );
  expect(finishResult.status).toBe(200);
  expect(finishResult.payload).toEqual(
    expect.objectContaining({ state: "completed", projected_count: 1 }),
  );

  await loginToMessaging(page, fixture.identities.responsibleSales);
  const projectedConversation = page
    .getByTestId("platform-conversation-list")
    .locator("a")
    .filter({ hasText: "WhatsApp ••••0305" });
  await expect(projectedConversation).toHaveCount(1);
  const href = await projectedConversation.getAttribute("href");
  expect(href).toMatch(/^\/whatsapp\/[0-9a-f-]{36}$/i);
  const conversationId = href?.split("/").at(-1);
  expect(conversationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

  await projectedConversation.click();
  await expect(page).toHaveURL(new RegExp(`/whatsapp/${conversationId}$`));
  const thread = page.getByTestId("platform-conversation-thread");
  await expect(thread).toContainText(outboundText);
  await expect(thread).toHaveAttribute("data-provider-proof", "not-proved");
  await expect(page.getByTestId("platform-messaging-realtime")).toHaveAttribute(
    "data-realtime-state",
    "subscribed",
    { timeout: 20_000 },
  );

  const browserInstanceMarker = `p5e-browser-${randomUUID()}`;
  await page.evaluate((marker) => {
    (
      window as Window & { __evoP5eBrowserInstance?: string }
    ).__evoP5eBrowserInstance = marker;
  }, browserInstanceMarker);

  async function persistSignedEvent(
    eventBody: Readonly<Record<string, unknown>>,
    requestPrefix: string,
  ) {
    const occurredAtMs = Date.now();
    const rawBody = JSON.stringify(eventBody);
    const response = await fetch(
      `${appOrigin}/api/internal/platform-messaging/waha/events`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-request-id": `${requestPrefix}-${randomUUID()}`,
          "x-webhook-timestamp": String(occurredAtMs),
          "x-webhook-hmac-algorithm": "sha512",
          "x-webhook-hmac": createHmac("sha512", fixture.p5b.ingressHmacSecret)
            .update(rawBody)
            .digest("hex"),
        },
        body: rawBody,
      },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(
      expect.objectContaining({ ok: true, persisted: true, enqueued: true }),
    );
  }

  async function projectOneSignedEvent() {
    const requestId = randomUUID();
    const timestamp = String(Date.now());
    const response = await fetch(
      `${appOrigin}/api/internal/platform-messaging/waha/work`,
      {
        method: "POST",
        headers: {
          "x-evo-worker-request-id": requestId,
          "x-evo-worker-timestamp": timestamp,
          "x-evo-worker-hmac-algorithm": "sha256",
          "x-evo-worker-hmac": createHmac(
            "sha256",
            fixture.p5b.workerTriggerSecret,
          )
            .update(`${requestId}.${timestamp}`)
            .digest("hex"),
        },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        ok: true,
        processed: true,
        disposition: "succeeded",
        state: "succeeded",
      }),
    );
  }

  await persistSignedEvent(
    {
      event: "message.ack",
      session: "evo-inbox",
      payload: {
        id: rawOutboundMessageId,
        from: chatId,
        participant: null,
        fromMe: true,
        ack: 3,
        ackName: "READ",
      },
    },
    "p5e-browser-ack",
  );
  await projectOneSignedEvent();
  const outboundMessage = thread
    .locator('[data-message-direction="outbound"]')
    .filter({ hasText: outboundText });
  await expect(outboundMessage).toHaveAttribute("data-waha-ack-name", "READ", {
    timeout: 20_000,
  });

  await persistSignedEvent(
    {
      event: "session.status",
      session: "evo-inbox",
      payload: {
        name: "evo-inbox",
        status: "WORKING",
        data: { privateEvidence: privateSessionPayloadSentinel },
      },
    },
    "p5e-browser-session",
  );
  await projectOneSignedEvent();
  const sessionHealth = page.getByTestId("platform-waha-session-health");
  await expect(sessionHealth).toHaveAttribute(
    "data-session-status",
    "WORKING",
    {
      timeout: 20_000,
    },
  );

  expect(
    await page.evaluate(
      () =>
        (window as Window & { __evoP5eBrowserInstance?: string })
          .__evoP5eBrowserInstance,
    ),
  ).toBe(browserInstanceMarker);
  await expect(page).toHaveURL(new RegExp(`/whatsapp/${conversationId}$`));

  const responsibleSalesToken = await localAccessToken(
    fixture.identities.responsibleSales,
  );
  const messageRows = await platformRpc(
    responsibleSalesToken,
    "staff_conversation_message_page",
    {
      p_organization_id: fixture.p5b.organizationId,
      p_conversation_id: conversationId,
      p_limit: 201,
      p_before_created_at: null,
      p_before_message_id: null,
    },
  );
  expect(messageRows.status).toBe(200);
  expect(Array.isArray(messageRows.payload)).toBe(true);
  const projectedMessage = (
    messageRows.payload as Array<Record<string, unknown>>
  ).find((row) => row.body_text === outboundText);
  expect(projectedMessage).toEqual(
    expect.objectContaining({
      direction: "outbound",
      waha_session_name: null,
      waha_message_id: null,
      waha_ack_name: "READ",
      waha_ack_observed_at: expect.any(String),
      kommo_message_id: null,
      amocrm_lead_id: null,
      amocrm_contact_id: null,
    }),
  );

  const sessionRows = await platformRpc(
    responsibleSalesToken,
    "staff_waha_session_health",
    {
      p_organization_id: fixture.p5b.organizationId,
      p_waha_session_name: "evo-inbox",
    },
  );
  expect(sessionRows.status).toBe(200);
  expect(sessionRows.payload).toEqual([
    {
      waha_session_name: "evo-inbox",
      status: "WORKING",
      observed_at: expect.any(String),
    },
  ]);

  const safePublicPayload = JSON.stringify({
    messages: messageRows.payload,
    session: sessionRows.payload,
  });
  for (const privateValue of [
    chatId,
    rawOutboundMessageId,
    privateSessionPayloadSentinel,
  ]) {
    expect(safePublicPayload).not.toContain(privateValue);
    await expect(page.locator("body")).not.toContainText(privateValue);
  }
  expectLegacyDatabaseUntouched();
});

test("P5F1 persists staff-controlled memory and degraded lexical evidence in the accepted conversation UI", async ({
  page,
}) => {
  test.skip(
    process.env.EVO_P5F1_BROWSER_PROOF !== "1",
    "Runs only in the dedicated local P5F1 browser-proof partition.",
  );
  expectLegacyDatabaseUntouched();

  const target = fixture.p3c.mutations.aiRequest;
  const approvedKnowledgeText = "Synthetic org B approved knowledge v1.";
  const approvedKnowledgeHash = createHash("sha256")
    .update(approvedKnowledgeText, "utf8")
    .digest("hex");
  const rawProviderMessageId =
    "synthetic-local-fixture-org-b-ai-request-message-1";
  const allowedToken = await localAccessToken(
    fixture.identities.crossOrgAdmin,
  );
  const deniedToken = await localAccessToken(fixture.identities.admin);

  const publishResult = await platformRpc(
    allowedToken,
    "publish_approved_knowledge_chunk_set",
    {
      p_organization_id: target.organizationId,
      p_knowledge_version_id: target.knowledgeVersionId,
      p_chunker_version: "p5f1-local-lexical-v1",
      p_chunks: [
        {
          chunk_index: 0,
          start_offset: 0,
          end_offset: approvedKnowledgeText.length,
          content_text: approvedKnowledgeText,
          content_sha256: approvedKnowledgeHash,
        },
      ],
      p_reason: "p5f1_local_non_provider_browser_proof",
      p_request_id: randomUUID(),
    },
  );
  expect(publishResult.status).toBe(200);
  const safePublishPayload = JSON.stringify(publishResult.payload);
  expect(safePublishPayload).not.toContain(approvedKnowledgeText);
  expect(safePublishPayload).not.toContain(approvedKnowledgeHash);

  const crossOrganizationRead = await platformRpc(
    deniedToken,
    "staff_conversation_ai_memory",
    {
      p_organization_id: target.organizationId,
      p_conversation_id: target.conversationId,
    },
  );
  expect([401, 403]).toContain(crossOrganizationRead.status);

  const initialMemory = await platformRpc(
    allowedToken,
    "staff_conversation_ai_memory",
    {
      p_organization_id: target.organizationId,
      p_conversation_id: target.conversationId,
    },
  );
  expect(initialMemory.status).toBe(200);
  expect(Array.isArray(initialMemory.payload)).toBe(true);
  const initialMemoryRow = (
    initialMemory.payload as Array<Record<string, unknown>>
  )[0];
  expect(initialMemoryRow).toEqual(
    expect.objectContaining({
      conversation_id: target.conversationId,
      facts: [],
      qualification_status: "collecting",
      control_state: "paused",
      autonomous_authority: false,
    }),
  );
  for (const version of [
    initialMemoryRow.memory_version,
    initialMemoryRow.qualification_version,
    initialMemoryRow.control_version,
  ]) {
    expect([0, "0"]).toContain(version);
  }

  await loginToMessaging(page, fixture.identities.crossOrgAdmin);
  await page.goto(`/whatsapp/${target.conversationId}`);
  await expect(page).toHaveURL(
    new RegExp(`/whatsapp/${target.conversationId}$`),
  );

  const memoryCard = page.locator(
    '[data-testid="platform-ai-memory-card"]:visible',
  );
  await expect(memoryCard).toBeVisible();
  await expect(memoryCard).toHaveAttribute("data-enabled", "true");
  await expect(
    memoryCard.getByTestId("platform-ai-memory-capabilities"),
  ).toHaveAttribute("data-autonomous-authority", "false");
  await expect(
    memoryCard.getByTestId("platform-ai-memory-capabilities"),
  ).toHaveAttribute("data-provider-proof-state", "blocked");
  await expect(
    memoryCard.getByTestId("platform-ai-memory-capabilities"),
  ).toHaveAttribute("data-lexical-preview-degraded", "true");

  const factForm = memoryCard.getByTestId("platform-ai-memory-fact-form");
  await factForm
    .locator("xpath=ancestor::details")
    .locator("summary")
    .click();
  await memoryCard
    .getByTestId("platform-ai-memory-fact-key")
    .selectOption("intake_target");
  await memoryCard
    .getByTestId("platform-ai-memory-fact-value")
    .fill("Fall 2027");
  await memoryCard.getByTestId("platform-ai-memory-fact-save").click();
  await expect(memoryCard.getByTestId("platform-ai-memory-facts")).toContainText(
    "Fall 2027",
  );

  const qualificationForm = memoryCard.getByTestId(
    "platform-ai-memory-qualification-form",
  );
  await qualificationForm
    .locator("xpath=ancestor::details")
    .locator("summary")
    .click();
  await memoryCard
    .getByTestId("platform-ai-memory-qualification-state")
    .selectOption("ready_for_staff_review");
  await memoryCard
    .getByTestId("platform-ai-memory-qualification-save")
    .click();
  await expect(
    memoryCard.getByTestId("platform-ai-memory-qualification-state"),
  ).toHaveValue("ready_for_staff_review");

  await memoryCard
    .getByTestId("platform-ai-memory-control-staff-takeover")
    .click();
  await expect(
    memoryCard.getByTestId("platform-ai-memory-control-state"),
  ).toHaveAttribute("data-control-state", "staff_takeover");

  await page.reload();
  await expect(memoryCard.getByTestId("platform-ai-memory-facts")).toContainText(
    "Fall 2027",
  );
  await expect(
    memoryCard.getByTestId("platform-ai-memory-qualification-state"),
  ).toHaveValue("ready_for_staff_review");
  await expect(
    memoryCard.getByTestId("platform-ai-memory-control-state"),
  ).toHaveAttribute("data-control-state", "staff_takeover");

  await memoryCard.getByTestId("platform-ai-memory-lexical-preview").click();
  const evidenceBlock = memoryCard.getByTestId(
    "platform-ai-memory-retrieval-evidence",
  );
  await expect(evidenceBlock).toBeVisible();
  await expect(evidenceBlock).toHaveAttribute(
    "data-retrieval-mode",
    "lexical_preview",
  );
  await expect(evidenceBlock).toHaveAttribute(
    "data-retrieval-outcome",
    "completed",
  );
  await expect(evidenceBlock).toHaveAttribute(
    "data-provider-proof-state",
    "blocked",
  );
  await expect(evidenceBlock).toHaveAttribute(
    "data-autonomous-authority",
    "false",
  );
  await expect(evidenceBlock).toContainText(
    "Synthetic org B admissions knowledge",
  );

  const finalMemory = await platformRpc(
    allowedToken,
    "staff_conversation_ai_memory",
    {
      p_organization_id: target.organizationId,
      p_conversation_id: target.conversationId,
    },
  );
  expect(finalMemory.status).toBe(200);
  expect(Array.isArray(finalMemory.payload)).toBe(true);
  const finalMemoryRow = (
    finalMemory.payload as Array<Record<string, unknown>>
  )[0];
  expect(finalMemoryRow).toEqual(
    expect.objectContaining({
      conversation_id: target.conversationId,
      qualification_status: "ready_for_staff_review",
      control_state: "staff_takeover",
      autonomous_authority: false,
      latest_retrieval_outcome: "completed",
    }),
  );
  expect(finalMemoryRow.latest_retrieval_request_id).toEqual(
    expect.any(String),
  );
  expect(Object.keys(finalMemoryRow).sort()).toEqual(
    [
      "autonomous_authority",
      "control_reason",
      "control_state",
      "control_version",
      "conversation_id",
      "facts",
      "latest_retrieval_created_at",
      "latest_retrieval_outcome",
      "latest_retrieval_request_id",
      "memory_long_summary",
      "memory_short_summary",
      "memory_source_message_id",
      "memory_version",
      "qualification_completeness",
      "qualification_missing_fact_keys",
      "qualification_notes",
      "qualification_source_message_id",
      "qualification_status",
      "qualification_version",
    ].sort(),
  );

  const evidenceResult = await platformRpc(
    allowedToken,
    "staff_ai_retrieval_evidence",
    {
      p_organization_id: target.organizationId,
      p_conversation_id: target.conversationId,
      p_retrieval_request_id: finalMemoryRow.latest_retrieval_request_id,
    },
  );
  expect(evidenceResult.status).toBe(200);
  expect(evidenceResult.payload).toEqual([
    expect.objectContaining({
      source_message_id: target.sourceMessageId,
      retrieval_mode: "lexical_preview",
      retrieval_outcome: "completed",
      degraded: true,
      provider_proof_state: "blocked",
      autonomous_authority: false,
      knowledge_key: "synthetic.orgb.admissions.general",
      knowledge_title: "Synthetic org B admissions knowledge",
      evidence_ordinal: 1,
    }),
  ]);
  for (const row of evidenceResult.payload as Array<Record<string, unknown>>) {
    expect([1, "1"]).toContain(row.knowledge_version);
    expect(Object.keys(row).sort()).toEqual(
      [
        "autonomous_authority",
        "created_at",
        "degraded",
        "evidence_ordinal",
        "knowledge_key",
        "knowledge_title",
        "knowledge_version",
        "provider_proof_state",
        "retrieval_mode",
        "retrieval_outcome",
        "retrieval_request_id",
        "source_message_id",
      ].sort(),
    );
  }

  const safeEvidencePayload = JSON.stringify(evidenceResult.payload);
  for (const privateValue of [
    target.knowledgeVersionId,
    approvedKnowledgeText,
    approvedKnowledgeHash,
    rawProviderMessageId,
  ]) {
    expect(safeEvidencePayload).not.toContain(privateValue);
    await expect(evidenceBlock).not.toContainText(privateValue);
  }
  await expect(page.locator("body")).not.toContainText(rawProviderMessageId);
  expectLegacyDatabaseUntouched();
});

test("P5F3 persists and reconciles one synthetic autonomous reply in the accepted conversation UI", async ({
  page,
}) => {
  test.skip(
    process.env.EVO_P5F3_BROWSER_PROOF !== "1",
    "Runs only in the dedicated local P5F3 browser-proof partition.",
  );
  expectLegacyDatabaseUntouched();
  expect(fixture.p5f3.autonomousReplyTriggerSecret).not.toBe(
    fixture.p5b.workerTriggerSecret,
  );

  const chatId = "996555120406@c.us";
  const rawInboundMessageId = `false_${chatId}_${randomUUID()}`;
  const rawOutboundMessageId = `true_${chatId}_${randomUUID()}`;
  const inboundText = `P5F3 verified inbound ${randomUUID()}`;
  const replyText = `P5F3 synthetic autonomous reply ${randomUUID()}`;
  const serviceToken = fixture.p5b.supabaseSecretKey;
  const loopbackRequests: Array<Readonly<{
    method: string | undefined;
    pathname: string;
    body: unknown;
  }>> = [];
  let observeSend: (() => void) | undefined;
  let releaseSend: (() => void) | undefined;
  const sendObserved = new Promise<void>((resolve) => {
    observeSend = resolve;
  });
  const sendReleased = new Promise<void>((resolve) => {
    releaseSend = resolve;
  });

  const loopbackWaha = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1:3314");
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    let body: unknown = null;
    if (rawBody.length > 0) body = JSON.parse(rawBody);
    loopbackRequests.push({ method: request.method, pathname: url.pathname, body });
    expect(request.headers["x-api-key"]).toBe(fixture.p5c.wahaApiKey);
    response.setHeader("content-type", "application/json");

    if (
      request.method === "GET" &&
      url.pathname === "/api/sessions/evo-inbox"
    ) {
      response.statusCode = 200;
      response.end(
        JSON.stringify({
          name: "evo-inbox",
          status: "WORKING",
          me: {
            id: "996555123456@c.us",
            pushName: "EVO",
            reachoutTimelock: null,
          },
        }),
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sendText") {
      observeSend?.();
      await sendReleased;
      response.statusCode = 201;
      response.end(JSON.stringify({ id: rawOutboundMessageId }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise<void>((resolve, reject) => {
    loopbackWaha.once("error", (error) => {
      reject(
        (error as NodeJS.ErrnoException).code === "EADDRINUSE"
          ? new Error("P5F3 loopback WAHA fixture port 3314 is occupied")
          : error,
      );
    });
    loopbackWaha.listen(3314, "127.0.0.1", resolve);
  });

  async function persistSignedEvent(
    eventBody: Readonly<Record<string, unknown>>,
    requestPrefix: string,
  ) {
    const occurredAtMs = Date.now();
    const rawBody = JSON.stringify(eventBody);
    const response = await fetch(
      `${appOrigin}/api/internal/platform-messaging/waha/events`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-request-id": `${requestPrefix}-${randomUUID()}`,
          "x-webhook-timestamp": String(occurredAtMs),
          "x-webhook-hmac-algorithm": "sha512",
          "x-webhook-hmac": createHmac(
            "sha512",
            fixture.p5b.ingressHmacSecret,
          )
            .update(rawBody)
            .digest("hex"),
        },
        body: rawBody,
      },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(
      expect.objectContaining({ ok: true, persisted: true, enqueued: true }),
    );
  }

  async function projectOneSignedEvent() {
    const requestId = randomUUID();
    const timestamp = String(Date.now());
    const response = await fetch(
      `${appOrigin}/api/internal/platform-messaging/waha/work`,
      {
        method: "POST",
        headers: {
          "x-evo-worker-request-id": requestId,
          "x-evo-worker-timestamp": timestamp,
          "x-evo-worker-hmac-algorithm": "sha256",
          "x-evo-worker-hmac": createHmac(
            "sha256",
            fixture.p5b.workerTriggerSecret,
          )
            .update(`${requestId}.${timestamp}`)
            .digest("hex"),
        },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        ok: true,
        processed: true,
        disposition: "succeeded",
        state: "succeeded",
      }),
    );
  }

  async function triggerAutonomousReply() {
    const requestId = randomUUID();
    const timestamp = String(Date.now());
    return fetch(
      `${appOrigin}/api/internal/platform-messaging/waha/autonomous-reply`,
      {
        method: "POST",
        headers: {
          "x-evo-autonomous-reply-request-id": requestId,
          "x-evo-autonomous-reply-timestamp": timestamp,
          "x-evo-autonomous-reply-hmac-algorithm": "sha256",
          "x-evo-autonomous-reply-hmac": createHmac(
            "sha256",
            fixture.p5f3.autonomousReplyTriggerSecret,
          )
            .update(`${requestId}.${timestamp}`)
            .digest("hex"),
        },
      },
    );
  }

  try {
    await persistSignedEvent(
      {
        event: "message.any",
        session: "evo-inbox",
        payload: {
          id: rawInboundMessageId,
          timestamp: Math.floor(Date.now() / 1_000),
          from: chatId,
          chatId,
          fromMe: false,
          source: "app",
          body: inboundText,
        },
      },
      "p5f3-browser-inbound",
    );
    await projectOneSignedEvent();
    await persistSignedEvent(
      {
        event: "session.status",
        session: "evo-inbox",
        payload: { name: "evo-inbox", status: "WORKING" },
      },
      "p5f3-browser-session",
    );
    await projectOneSignedEvent();

    await loginToMessaging(page, fixture.identities.responsibleSales);
    const projectedConversation = page
      .getByTestId("platform-conversation-list")
      .locator("a")
      .filter({ hasText: "••••0406" });
    await expect(projectedConversation).toHaveCount(1);
    const href = await projectedConversation.getAttribute("href");
    const conversationId = href?.split("/").at(-1);
    expect(conversationId).toMatch(/^[0-9a-f-]{36}$/i);
    await projectedConversation.click();
    await expect(page).toHaveURL(new RegExp(`/whatsapp/${conversationId}$`));
    const thread = page.getByTestId("platform-conversation-thread");
    await expect(thread).toContainText(inboundText);
    await expect(page.getByTestId("platform-messaging-realtime")).toHaveAttribute(
      "data-realtime-state",
      "subscribed",
      { timeout: 20_000 },
    );
    const card = page.getByTestId("platform-autonomous-reply-card");
    const browserInstanceMarker = `p5f3-browser-${randomUUID()}`;
    await page.evaluate((marker) => {
      (
        window as Window & { __evoP5f3BrowserInstance?: string }
      ).__evoP5f3BrowserInstance = marker;
    }, browserInstanceMarker);

    const responsibleSalesToken = await localAccessToken(
      fixture.identities.responsibleSales,
    );
    const messages = await platformRpc(
      responsibleSalesToken,
      "staff_conversation_message_page",
      {
        p_organization_id: fixture.p5b.organizationId,
        p_conversation_id: conversationId,
        p_limit: 201,
        p_before_created_at: null,
        p_before_message_id: null,
      },
    );
    expect(messages.status).toBe(200);
    const sourceMessage = (
      messages.payload as Array<Record<string, unknown>>
    ).find((row) => row.body_text === inboundText);
    expect(sourceMessage).toEqual(
      expect.objectContaining({
        message_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        direction: "inbound",
        waha_message_id: null,
      }),
    );
    const sourceMessageId = sourceMessage?.message_id;

    const begin = await platformRpc(
      serviceToken,
      "begin_gemini_proposal",
      {
        p_organization_id: fixture.p5b.organizationId,
        p_conversation_id: conversationId,
        p_source_message_id: sourceMessageId,
        p_request_id: randomUUID(),
        p_model_ref: "gemini-3.5-flash",
        p_schema_version: 1,
        p_prompt_policy_version: "p5f2-consultative-sales-v2",
      },
      serviceToken,
    );
    expect(begin.status).toBe(200);
    const proposalRequestId = (
      begin.payload as Array<Record<string, unknown>>
    )[0]?.proposal_request_id;
    expect(proposalRequestId).toMatch(/^[0-9a-f-]{36}$/i);

    const finish = await platformRpc(
      serviceToken,
      "finish_gemini_proposal",
      {
        p_organization_id: fixture.p5b.organizationId,
        p_conversation_id: conversationId,
        p_source_message_id: sourceMessageId,
        p_proposal_request_id: proposalRequestId,
        p_outcome: "proposal_ready",
        p_failure_code: null,
        p_prompt_text: "Synthetic local P5F3 proposal contract proof",
        p_provider_interaction_ref: `local-contract-${randomUUID()}`,
        p_provider_status: "completed",
        p_response_json: {
          schema_version: 1,
          language: "en",
          intent: "greeting",
          confidence: 96,
          risk: "low",
          handoff_required: false,
          handoff_reasons: [],
          citations: [],
          memory_changes: [],
          qualification: {
            status: "collecting",
            completeness: 10,
            missing_fact_keys: ["preferred_country"],
            notes: null,
          },
          reply_text: replyText,
        },
      },
      serviceToken,
    );
    expect(finish.status).toBe(200);
    expect(finish.payload).toEqual([
      expect.objectContaining({
        proposal_request_id: proposalRequestId,
        outcome: "proposal_ready",
        human_review_required: true,
        autonomous_authority: false,
        provider_proof_state: "blocked",
      }),
    ]);

    const blockedResponse = await triggerAutonomousReply();
    expect(blockedResponse.status).toBe(200);
    expect(await blockedResponse.json()).toEqual(
      expect.objectContaining({ ok: true, state: "blocked" }),
    );
    expect(loopbackRequests).toEqual([]);
    await expect(card).toHaveAttribute("data-control-state", "paused", {
      timeout: 20_000,
    });
    await expect(
      page.getByTestId("platform-autonomous-reply-block-reason"),
    ).toBeVisible({ timeout: 20_000 });

    await page
      .getByTestId("platform-autonomous-reply-control-reason")
      .fill("Local synthetic browser proof approved by staff");
    await page.getByTestId("platform-autonomous-reply-enable").click();
    await expect(card).toHaveAttribute("data-control-state", "enabled");

    const acceptedResponsePromise = triggerAutonomousReply();
    await sendObserved;
    expect(loopbackRequests).toEqual([
      expect.objectContaining({
        method: "GET",
        pathname: "/api/sessions/evo-inbox",
      }),
      expect.objectContaining({
        method: "POST",
        pathname: "/api/sendText",
        body: {
          session: "evo-inbox",
          chatId,
          text: replyText,
          reply_to: rawInboundMessageId,
        },
      }),
    ]);

    const dispatching = await platformRpc(
      responsibleSalesToken,
      "staff_conversation_autonomous_reply_state",
      {
        p_organization_id: fixture.p5b.organizationId,
        p_conversation_id: conversationId,
      },
    );
    expect(dispatching.status).toBe(200);
    expect(dispatching.payload).toEqual([
      expect.objectContaining({
        control_state: "enabled",
        decision_state: "queued",
        intent_state: "dispatching",
        communication_message_id: null,
        autonomous_authority: true,
      }),
    ]);
    releaseSend?.();
    const acceptedResponse = await acceptedResponsePromise;
    expect(acceptedResponse.status).toBe(200);
    expect(await acceptedResponse.json()).toEqual(
      expect.objectContaining({ ok: true, state: "accepted" }),
    );

    await expect(thread).toContainText(replyText, { timeout: 20_000 });
    await expect(card).toHaveAttribute("data-intent-state", "accepted");
    const acceptedState = await platformRpc(
      responsibleSalesToken,
      "staff_conversation_autonomous_reply_state",
      {
        p_organization_id: fixture.p5b.organizationId,
        p_conversation_id: conversationId,
      },
    );
    expect(acceptedState.status).toBe(200);
    expect(acceptedState.payload).toEqual([
      expect.objectContaining({
        intent_state: "accepted",
        attempt_outcome: "accepted",
        ack_name: null,
        communication_message_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      }),
    ]);

    await persistSignedEvent(
      {
        event: "message.ack",
        session: "evo-inbox",
        payload: {
          id: rawOutboundMessageId,
          from: chatId,
          participant: null,
          fromMe: true,
          ack: 3,
          ackName: "READ",
        },
      },
      "p5f3-browser-ack",
    );
    await projectOneSignedEvent();
    const outboundMessage = thread
      .locator('[data-message-direction="outbound"]')
      .filter({ hasText: replyText });
    await expect(outboundMessage).toHaveAttribute("data-waha-ack-name", "READ", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("platform-autonomous-reply-ack")).not.toBeEmpty();
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __evoP5f3BrowserInstance?: string })
            .__evoP5f3BrowserInstance,
      ),
    ).toBe(browserInstanceMarker);

    const safeStateJson = JSON.stringify(acceptedState.payload);
    const pageText = await page.locator("body").innerText();
    for (const privateValue of [
      chatId,
      rawInboundMessageId,
      rawOutboundMessageId,
      `local-contract-`,
    ]) {
      expect(safeStateJson).not.toContain(privateValue);
      expect(pageText).not.toContain(privateValue);
    }
    expectLegacyDatabaseUntouched();
  } finally {
    releaseSend?.();
    await new Promise<void>((resolve) => loopbackWaha.close(() => resolve()));
  }
});

test("BW3 RPCs deny cross-student reads and non-Admin checklist binding", async () => {
  const [studentToken, financeToken, salesToken, curatorToken] = await Promise.all([
    localAccessToken(fixture.identities.studentNoCase),
    localAccessToken(fixture.identities.finance),
    localAccessToken(fixture.identities.salesScoped),
    localAccessToken(fixture.identities.curator),
  ]);

  for (const routineName of [
    "staff_student_profile_snapshot",
    "staff_student_case_documents",
  ] as const) {
    const result = await platformRpc(studentToken, routineName, {
      p_student_case_id: fixture.bw3.orgA.studentCaseId,
    });
    expect(result.status, routineName).toBe(200);
    expect(result.payload, routineName).toEqual([]);
  }

  const financeProfile = await platformRpc(
    financeToken,
    "staff_student_profile_snapshot",
    { p_student_case_id: fixture.bw3.orgA.studentCaseId },
  );
  expect(financeProfile.status).toBe(403);

  for (const [label, token] of [
    ["sales", salesToken],
    ["curator", curatorToken],
  ] as const) {
    const result = await platformRpc(
      token,
      "apply_country_requirement_version",
      {
        p_organization_id: fixture.bw3.orgA.organizationId,
        p_student_case_id: fixture.bw3.orgA.studentCaseId,
        p_country_requirement_version_id:
          fixture.bw3.orgA.countryRequirementVersionId,
        p_reason: `${label} direct RPC must remain denied`,
        p_request_id: randomUUID(),
      },
    );
    expect(result.status, label).toBe(403);
  }
});

test("admin creates a preparation application with one RLS-visible audit event", async ({
  page,
}) => {
  const runId = randomUUID();
  const institutionName = `Synthetic BW2 University ${runId.slice(0, 8)}`;
  const programName = `Synthetic admissions program ${runId.slice(9, 17)}`;

  await login(page, fixture.identities.admin);
  await expect(page).toHaveURL(/\/sales$/);
  await page.goto("/applications");
  await expect(page.getByTestId("platform-applications-page")).toBeVisible();

  await page.locator("#add > summary").click();
  const form = page.locator("#add form");
  const requestId = await form.locator('input[name="request_id"]').inputValue();
  expect(requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await form
    .locator('select[name="student_case_id"]')
    .selectOption(fixture.p3c.orgA.studentCaseId);
  await expect(form.locator('select[name="student_case_id"]')).toHaveValue(
    fixture.p3c.orgA.studentCaseId,
  );
  await form.locator('select[name="status"]').selectOption("preparation");
  await form.locator('input[name="institution_name"]').fill(institutionName);
  await form.locator('input[name="program_name"]').fill(programName);
  await form
    .locator('textarea[name="note"]')
    .fill("Synthetic local BW2 application proof; no provider was called.");
  await form.getByRole("button", { name: "Создать с аудитом" }).click();

  await expect(page).toHaveURL(/\/applications\?result=saved$/);
  await expect(page.getByText("Заявка сохранена", { exact: true })).toBeVisible();
  const applicationLink = page.locator('a[href^="/applications/"]:visible', {
    hasText: institutionName,
  });
  await expect(applicationLink).toHaveCount(1);
  const applicationRecord = applicationLink
    .locator("xpath=ancestor::tr | ancestor::article")
    .first();
  await expect(applicationRecord).toContainText(programName);
  const applicationHref = await applicationLink.getAttribute("href");
  const applicationId = applicationHref?.match(
    /^\/applications\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  )?.[1];
  expect(applicationId).toBeTruthy();
  if (!applicationId) {
    throw new Error("Created application link did not contain a UUID");
  }

  await applicationLink.click();
  await expect(page).toHaveURL(new RegExp(`/applications/${applicationId}$`));
  await expect(page.getByTestId("platform-application-detail-page")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: institutionName, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(programName, { exact: true })).toBeVisible();

  const adminToken = await localAccessToken(fixture.identities.admin);
  const audit = await applicationCreateAudit(
    adminToken,
    applicationId,
    requestId,
  );
  expect(audit).toEqual([
    expect.objectContaining({
      action: "application.create",
      resource_type: "university_application",
      resource_id: applicationId,
      request_id: requestId,
    }),
  ]);
  expect(audit[0]).not.toHaveProperty("organization_id");
});

test("admin promotes a reviewed catalog batch before creating a catalog-linked application", async ({
  browser,
  page,
}) => {
  // This is one deliberate vertical-flow proof across source review, two
  // batches, publication/rejection, application creation, RLS and audit.
  test.setTimeout(90_000);
  const runId = randomUUID();
  const notionPageId = runId.replaceAll("-", "");
  const rejectedNotionPageId = `${notionPageId.startsWith("a") ? "b" : "a"}${notionPageId.slice(1)}`;
  const sourceUrl = `https://notion.so/${notionPageId}`;
  const rejectedSourceUrl = `https://notion.so/${rejectedNotionPageId}`;
  const sourceRevision = `bw5-${runId.slice(0, 8)}`;
  const rejectedSourceRevision = `bw5-reject-${runId.slice(0, 8)}`;
  const sourceRecordReference = `notion-row-${runId}`;
  const rejectedSourceRecordReference = `notion-row-rejected-${runId}`;
  const institutionName = `Synthetic BW5 University ${runId.slice(0, 8)}`;
  const rejectedInstitutionName = `Synthetic rejected college ${runId.slice(0, 8)}`;
  const programName = `Synthetic catalog program ${runId.slice(9, 17)}`;
  const adminToken = await localAccessToken(fixture.identities.admin);
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const expectCatalogWorkspaceAccessible = async () => {
    const results = await new AxeBuilder({ page })
      .include('[data-testid="platform-catalog-import-workspace"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      results.violations,
      results.violations
        .map(
          ({ id, impact, help, nodes }) =>
            `${id} (${impact ?? "unknown"}): ${help}\n${nodes
              .map(
                ({ target, failureSummary }) =>
                  `  ${target.join(" ")}: ${failureSummary ?? "No failure summary"}`,
              )
              .join("\n")}`,
        )
        .join("\n\n"),
    ).toEqual([]);
  };
  const registerSource = async (
    source: string,
    revision: string,
    reason: string,
  ) => {
    await page.getByText("Зарегистрировать метаданные источника").click();
    const form = page.getByTestId("platform-catalog-register-source-form");
    await form.locator('select[name="source_kind"]').selectOption("notion_database");
    await form.locator('input[name="source_url"]').fill(source);
    await form.locator('input[name="source_revision"]').fill(revision);
    await form.locator('input[name="reason"]').fill(reason);
    await form
      .getByRole("button", { name: "Сохранить source metadata" })
      .click();
    await expect(page).toHaveURL(/catalog_result=source_saved/);
  };

  await login(page, fixture.identities.admin);
  await expect(page).toHaveURL(/\/sales$/);
  await page.goto("/applications#catalog-import");
  await expect(
    page.getByTestId("platform-catalog-import-workspace"),
  ).toBeVisible();

  await registerSource(
    rejectedSourceUrl,
    rejectedSourceRevision,
    "Register source metadata for the rejection-path proof",
  );
  const rejectedSourceContainer = page
    .getByText(rejectedSourceUrl, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'space-y-3')]")
    .first();
  const rejectedSourceReviewForm = rejectedSourceContainer.getByTestId(
    "platform-catalog-source-review-form",
  );
  await expectCatalogWorkspaceAccessible();
  await rejectedSourceReviewForm
    .locator('input[name="reason"]')
    .fill("Reject unauthorized disposable source metadata");
  await rejectedSourceReviewForm
    .getByRole("button", { name: "Отклонить" })
    .click();
  await expect(page).toHaveURL(/catalog_result=source_rejected/);
  await expect(page.getByText("Источник отклонён", { exact: true })).toBeVisible();

  await registerSource(
    sourceUrl,
    sourceRevision,
    "Register disposable BW5 browser-proof source metadata",
  );
  const sourceContainer = page
    .getByText(sourceUrl, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'space-y-3')]")
    .first();
  const reviewForm = sourceContainer.getByTestId(
    "platform-catalog-source-review-form",
  );
  const sourceRegistryId = await reviewForm
    .locator('input[name="source_registry_id"]')
    .inputValue();
  expect(sourceRegistryId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await reviewForm
    .locator('input[name="reason"]')
    .fill("Review synthetic source metadata for local BW5 proof");
  await reviewForm.getByRole("button", { name: "Подтвердить" }).click();

  await expect(page).toHaveURL(/catalog_result=source_reviewed/);
  const createBatchForm = page.getByTestId(
    "platform-catalog-create-batch-form",
  );
  await expect(
    createBatchForm.locator(`option[value="${sourceRegistryId}"]`),
  ).toContainText(sourceUrl);
  await createBatchForm
    .locator('select[name="source_registry_id"]')
    .selectOption(sourceRegistryId);
  await createBatchForm
    .locator('select[name="institution_kind"]')
    .selectOption("university");
  await createBatchForm
    .locator('input[name="reason"]')
    .fill("Create disposable BW5 staging batch");
  await createBatchForm.getByRole("button", { name: "Создать batch" }).click();

  await expect(page).toHaveURL(/catalog_result=batch_created/);
  const batchId = new URL(page.url()).searchParams.get("catalog_batch_id");
  expect(batchId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await expect(page.getByTestId("platform-catalog-batch-list")).toContainText(
    sourceUrl,
  );
  await expect(page.getByTestId("platform-catalog-batch-detail")).toContainText(
    sourceUrl,
  );
  const stageForm = page.getByTestId("platform-catalog-stage-candidate-form");
  await stageForm
    .locator('input[name="source_record_reference"]')
    .fill(sourceRecordReference);
  await stageForm
    .locator('input[name="institution_name"]')
    .fill(institutionName);
  await stageForm.locator('input[name="country_code"]').fill("MY");
  await stageForm.locator('input[name="city"]').fill("Kuala Lumpur");
  await stageForm
    .locator('input[name="reason"]')
    .fill("Stage one synthetic institution candidate");
  await stageForm
    .getByRole("button", { name: "Добавить в staging" })
    .click();

  await expect(page).toHaveURL(/catalog_result=candidate_staged/);
  await expect(page.getByText(institutionName, { exact: true })).toBeVisible();
  await expect(page.getByText(sourceRecordReference, { exact: true })).toHaveCount(0);
  const beforeApproval = await platformRpc(
    adminToken,
    "staff_catalog_institutions",
    {},
  );
  expect(beforeApproval.status).toBe(200);
  expect(Array.isArray(beforeApproval.payload)).toBe(true);
  expect(
    (beforeApproval.payload as Array<Record<string, unknown>>).some(
      (row) => row.institution_name === institutionName,
    ),
  ).toBe(false);
  await expect(
    page.getByTestId("platform-catalog-approve-batch-form"),
  ).toHaveCount(0);

  const validateForm = page.getByTestId("platform-catalog-validate-batch-form");
  await validateForm
    .locator('input[name="reason"]')
    .fill("Validate typed candidate fields without publication");
  await validateForm
    .getByRole("button", { name: "Запустить validation" })
    .click();
  await expect(page).toHaveURL(/catalog_result=batch_validated/);
  await expect(page.getByText(institutionName, { exact: true })).toBeVisible();
  await expectCatalogWorkspaceAccessible();

  const approveForm = page.getByTestId("platform-catalog-approve-batch-form");
  await approveForm
    .locator('input[name="reason"]')
    .fill("Approve validated disposable catalog candidate");
  await approveForm
    .getByRole("button", { name: "Approve и опубликовать" })
    .click();
  await expect(page).toHaveURL(/catalog_result=batch_approved/);
  await expect(
    page
      .getByTestId("platform-approved-catalog")
      .locator("tbody tr", { hasText: institutionName }),
  ).toBeVisible();

  const approved = await platformRpc(
    adminToken,
    "staff_catalog_institutions",
    {},
  );
  expect(approved.status).toBe(200);
  expect(Array.isArray(approved.payload)).toBe(true);
  const approvedInstitution = (approved.payload as Array<Record<string, unknown>>).find(
    (row) => row.institution_name === institutionName,
  );
  expect(approvedInstitution).toBeTruthy();
  const catalogInstitutionId = approvedInstitution?.catalog_institution_id;
  expect(catalogInstitutionId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  if (typeof catalogInstitutionId !== "string") {
    throw new Error("Approved catalog row did not expose its UUID");
  }

  const rejectionBatchForm = page.getByTestId(
    "platform-catalog-create-batch-form",
  );
  await rejectionBatchForm
    .locator('select[name="source_registry_id"]')
    .selectOption(sourceRegistryId);
  await rejectionBatchForm
    .locator('select[name="institution_kind"]')
    .selectOption("college");
  await rejectionBatchForm
    .locator('input[name="reason"]')
    .fill("Create a disposable batch for the pre-validation rejection proof");
  await rejectionBatchForm
    .getByRole("button", { name: "Создать batch" })
    .click();
  await expect(page).toHaveURL(/catalog_result=batch_created/);
  const rejectedBatchId = new URL(page.url()).searchParams.get(
    "catalog_batch_id",
  );
  expect(rejectedBatchId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  const rejectedStageForm = page.getByTestId(
    "platform-catalog-stage-candidate-form",
  );
  await rejectedStageForm
    .locator('input[name="source_record_reference"]')
    .fill(rejectedSourceRecordReference);
  await rejectedStageForm
    .locator('input[name="institution_name"]')
    .fill(rejectedInstitutionName);
  await rejectedStageForm.locator('input[name="country_code"]').fill("KG");
  await rejectedStageForm.locator('input[name="city"]').fill("Bishkek");
  await rejectedStageForm
    .locator('input[name="reason"]')
    .fill("Stage a pending candidate before rejecting the batch");
  await rejectedStageForm
    .getByRole("button", { name: "Добавить в staging" })
    .click();
  await expect(page).toHaveURL(/catalog_result=candidate_staged/);
  await expect(
    page.getByText(rejectedInstitutionName, { exact: true }),
  ).toBeVisible();
  const rejectBatchForm = page.getByTestId(
    "platform-catalog-reject-batch-form",
  );
  await rejectBatchForm
    .locator('input[name="reason"]')
    .fill("Reject staging batch before candidate validation");
  await rejectBatchForm.getByRole("button", { name: "Отклонить" }).click();
  await expect(page).toHaveURL(/catalog_result=batch_rejected/);
  await expect(page.getByText("Batch отклонён", { exact: true })).toBeVisible();

  await page.locator("#add > summary").click();
  const applicationForm = page.locator("#add form");
  const applicationRequestId = await applicationForm
    .locator('input[name="request_id"]')
    .inputValue();
  await applicationForm
    .locator('select[name="student_case_id"]')
    .selectOption(fixture.p3c.orgA.studentCaseId);
  const catalogInstitutionSelect = applicationForm.locator(
    'select[name="catalog_institution_id"]',
  );
  const manualInstitutionInput = applicationForm.locator(
    'input[name="institution_name"]',
  );
  await expect(catalogInstitutionSelect).toHaveValue("");
  await expect(manualInstitutionInput).toBeEnabled();
  await expect(manualInstitutionInput).toHaveAttribute("required", "");
  await catalogInstitutionSelect.selectOption(catalogInstitutionId);
  await expect(manualInstitutionInput).toBeDisabled();
  await expect(manualInstitutionInput).not.toHaveAttribute("required", "");
  await catalogInstitutionSelect.selectOption("");
  await expect(manualInstitutionInput).toBeEnabled();
  await expect(manualInstitutionInput).toHaveAttribute("required", "");
  await catalogInstitutionSelect.selectOption(catalogInstitutionId);
  await applicationForm.locator('input[name="program_name"]').fill(programName);
  await applicationForm
    .locator('textarea[name="note"]')
    .fill("Catalog-linked local BW5 application proof; no provider was called.");
  await applicationForm
    .getByRole("button", { name: "Создать с аудитом" })
    .click();

  await expect(page).toHaveURL(/\/applications\?result=saved$/);
  const applicationLink = page.locator('a[href^="/applications/"]:visible', {
    hasText: institutionName,
  });
  await expect(applicationLink).toHaveCount(1);
  const applicationRows = await platformRows(
    adminToken,
    "university_applications",
    new URLSearchParams({
      select:
        "id,catalog_institution_id,institution_name,program_name,student_case_id",
      catalog_institution_id: `eq.${catalogInstitutionId}`,
      program_name: `eq.${programName}`,
    }),
  );
  expect(applicationRows.status).toBe(200);
  expect(applicationRows.payload).toEqual([
    expect.objectContaining({
      catalog_institution_id: catalogInstitutionId,
      institution_name: institutionName,
      program_name: programName,
      student_case_id: fixture.p3c.orgA.studentCaseId,
    }),
  ]);
  const linkedApplication = (applicationRows.payload as Array<Record<string, unknown>>)[0];
  const linkedApplicationId = linkedApplication?.id;
  expect(typeof linkedApplicationId).toBe("string");
  if (typeof linkedApplicationId !== "string") {
    throw new Error("Catalog-linked application did not expose its UUID");
  }
  await expect(
    applicationCreateAudit(
      adminToken,
      linkedApplicationId,
      applicationRequestId,
    ),
  ).resolves.toHaveLength(1);

  const curatorContext = await browser.newContext();
  const curatorPage = await curatorContext.newPage();
  await login(curatorPage, fixture.identities.curator);
  await expect(curatorPage).toHaveURL(/\/clients$/);
  await curatorPage.goto("/applications#catalog-import");
  await expect(
    curatorPage
      .getByTestId("platform-approved-catalog")
      .locator("tbody tr", { hasText: institutionName }),
  ).toBeVisible();
  await expect(
    curatorPage.getByTestId("platform-catalog-register-source-form"),
  ).toHaveCount(0);
  await expect(
    curatorPage.getByTestId("platform-catalog-create-batch-form"),
  ).toHaveCount(0);
  await curatorContext.close();
  expectLegacyDatabaseUntouched();
});

test("BW6 keeps contract drafts and post-contract reports versioned, authorized, and auditable", async ({
  browser,
  page,
}) => {
  test.setTimeout(150_000);
  expectLegacyDatabaseUntouched();

  const runId = randomUUID();
  const suffix = runId.replaceAll("-", "").slice(0, 10);
  const templateKey = `contract_bw6_${suffix}`;
  const templateTitle = `Synthetic BW6 contract ${suffix}`;
  const welcomeItemKey = `welcome_${suffix}`;
  const documentItemKey = `document_${suffix}`;
  const welcomeLabel = `Send synthetic welcome pack ${suffix}`;
  const documentLabel = `Review synthetic document plan ${suffix}`;
  const templateText = `Synthetic contract ${suffix}\nStudent: {{student_name}}`;
  const manifestLines =
    "student_name|student_case.student_display_name|text|true";
  const checklistLines = [
    `${welcomeItemKey}|${welcomeLabel}|curator|Send the synthetic non-provider welcome pack`,
    `${documentItemKey}|${documentLabel}|curator|Review the synthetic document plan`,
  ].join("\n");
  const activePath = `/clients/${fixture.bw6.orgA.activeStudentCaseId}`;
  const salesPendingPath = `/clients/${fixture.bw6.salesPending.studentCaseId}`;
  const adminToken = await localAccessToken(fixture.identities.admin);
  const auditedRequestIds: string[] = [];
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const requestIdFrom = async (form: Locator) => {
    const value = await form.locator('input[name="request_id"]').inputValue();
    expect(value).toMatch(uuidPattern);
    return value;
  };
  const expectWorkspaceAccessible = async (targetPage: Page) => {
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    const results = await new AxeBuilder({ page: targetPage })
      .include('[data-testid="platform-contract-draft-report-workspace"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      results.violations,
      results.violations
        .map(
          ({ id, impact, help, nodes }) =>
            `${id} (${impact ?? "unknown"}): ${help}\n${nodes
              .map(
                ({ target, failureSummary }) =>
                  `  ${target.join(" ")}: ${failureSummary ?? "No failure summary"}`,
              )
              .join("\n")}`,
        )
        .join("\n\n"),
    ).toEqual([]);
  };
  const expectOneAuditEvent = async (requestId: string) => {
    const result = await safeAuditSearch(adminToken);
    expect(result.status).toBe(200);
    expect(
      safeAuditRows(result.payload).filter(
        (row) => row.request_id === requestId,
      ),
    ).toEqual([
      expect.objectContaining({ request_id: requestId }),
    ]);
  };

  await login(page, fixture.identities.admin);
  await expect(page).toHaveURL(/\/sales$/);
  await page.goto(`${activePath}#contract-workflow`);
  const adminWorkspace = page.getByTestId(
    "platform-contract-draft-report-workspace",
  );
  await expect(adminWorkspace).toBeVisible();
  await expect(page.locator("#profile + #contract-workflow")).toBeVisible();
  await expectWorkspaceAccessible(page);

  await adminWorkspace
    .getByTestId("platform-contract-template-create-panel")
    .locator("summary")
    .click();
  const createTemplateForm = adminWorkspace.getByTestId(
    "platform-contract-template-create-form",
  );
  await createTemplateForm.locator('input[name="template_key"]').fill(templateKey);
  await createTemplateForm.locator('input[name="title"]').fill(templateTitle);
  await createTemplateForm
    .locator('select[name="source_registry_id"]')
    .selectOption(fixture.bw3.orgA.sourceRegistryId);
  const selectedSourceEvidence = await createTemplateForm
    .locator('select[name="source_registry_id"] option:checked')
    .textContent();
  expect(selectedSourceEvidence).toBeTruthy();
  await createTemplateForm
    .locator('textarea[name="template_text"]')
    .fill(templateText);
  await createTemplateForm
    .locator('textarea[name="manifest_lines"]')
    .fill(manifestLines);
  await createTemplateForm
    .locator('textarea[name="checklist_lines"]')
    .fill(checklistLines);
  await createTemplateForm
    .locator('input[name="reason"]')
    .fill("Create a reviewed synthetic BW6 template version");
  auditedRequestIds.push(await requestIdFrom(createTemplateForm));
  await createTemplateForm
    .getByRole("button", { name: "Создать неизменяемую версию" })
    .click();
  await expect(page).toHaveURL(/bw6_result=template_created/);

  let templateVersion = page
    .getByTestId("platform-contract-template-version")
    .filter({ hasText: templateTitle });
  await expect(templateVersion).toHaveCount(1);
  for (const sourcePart of (selectedSourceEvidence ?? "").split(" · ")) {
    await expect(templateVersion).toContainText(sourcePart);
  }
  const approveTemplateForm = templateVersion.getByTestId(
    "platform-contract-template-approve-form",
  );
  const contractTemplateVersionId = await approveTemplateForm
    .locator('input[name="contract_template_version_id"]')
    .inputValue();
  expect(contractTemplateVersionId).toMatch(uuidPattern);
  await approveTemplateForm
    .locator('input[name="reason"]')
    .fill("Approve reviewed synthetic typed template");
  auditedRequestIds.push(await requestIdFrom(approveTemplateForm));
  await approveTemplateForm
    .getByRole("button", { name: "Утвердить версию" })
    .click();
  await expect(page).toHaveURL(/bw6_result=template_approved/);
  templateVersion = page
    .getByTestId("platform-contract-template-version")
    .filter({ hasText: templateTitle });
  await expect(templateVersion.getByText("approved", { exact: true })).toBeVisible();

  const salesContext = await browser.newContext();
  const salesPage = await salesContext.newPage();
  await login(salesPage, fixture.identities.salesScoped);
  await expect(salesPage).toHaveURL(/\/sales$/);
  await salesPage.goto(`${salesPendingPath}#contract-workflow`);
  const salesWorkspace = salesPage.getByTestId(
    "platform-contract-draft-report-workspace",
  );
  await expect(salesWorkspace).toBeVisible();
  await expect(
    salesWorkspace.getByTestId("platform-contract-template-create-form"),
  ).toHaveCount(0);
  await expect(
    salesWorkspace.getByTestId("platform-post-contract-seed-form"),
  ).toHaveCount(0);

  let generateDraftForm = salesWorkspace.getByTestId(
    "platform-contract-draft-generate-form",
  );
  await generateDraftForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(contractTemplateVersionId);
  await generateDraftForm
    .locator('input[name="reason"]')
    .fill("Generate the first immutable synthetic contract draft");
  await generateDraftForm.getByRole("button", { name: /Сгенерировать/ }).click();
  await expect(salesPage).toHaveURL(/bw6_result=draft_generated/);

  const approveDraftForm = salesWorkspace.getByTestId(
    "platform-contract-draft-approved-form",
  );
  const firstDraftId = await approveDraftForm
    .locator('input[name="student_case_contract_draft_id"]')
    .inputValue();
  expect(firstDraftId).toMatch(uuidPattern);
  const firstDraft = salesWorkspace.locator(
    `[data-testid="platform-contract-draft-version"][data-draft-id="${firstDraftId}"]`,
  );
  const firstRenderedText = await firstDraft
    .getByTestId("platform-contract-rendered-draft")
    .textContent();
  const firstRenderedHash = await firstDraft
    .getByText("Rendered SHA-256", { exact: true })
    .locator("..")
    .locator("dd")
    .textContent();
  expect(firstRenderedText).toContain("Student:");
  expect(firstRenderedHash).toMatch(/^[0-9a-f]{64}$/i);
  await approveDraftForm
    .locator('input[name="reason"]')
    .fill("Approve the reviewed immutable synthetic draft");
  auditedRequestIds.push(await requestIdFrom(approveDraftForm));
  await approveDraftForm.getByRole("button", { name: "Утвердить" }).click();
  await expect(salesPage).toHaveURL(/bw6_result=draft_approved/);

  generateDraftForm = salesWorkspace.getByTestId(
    "platform-contract-draft-generate-form",
  );
  await generateDraftForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(contractTemplateVersionId);
  await generateDraftForm
    .locator('input[name="reason"]')
    .fill("Generate a second immutable version for rejection proof");
  await generateDraftForm.getByRole("button", { name: /Сгенерировать/ }).click();
  await expect(salesPage).toHaveURL(/bw6_result=draft_generated/);
  const rejectDraftForm = salesWorkspace.getByTestId(
    "platform-contract-draft-rejected-form",
  );
  const secondDraftId = await rejectDraftForm
    .locator('input[name="student_case_contract_draft_id"]')
    .inputValue();
  expect(secondDraftId).not.toBe(firstDraftId);
  await rejectDraftForm
    .locator('input[name="reason"]')
    .fill("Reject the second immutable version without rewriting the first");
  await rejectDraftForm.getByRole("button", { name: "Отклонить" }).click();
  await expect(salesPage).toHaveURL(/bw6_result=draft_rejected/);
  const preservedFirstDraft = salesWorkspace.locator(
    `[data-testid="platform-contract-draft-version"][data-draft-id="${firstDraftId}"]`,
  );
  await expect(preservedFirstDraft.getByText("approved", { exact: true })).toBeVisible();
  expect(
    await preservedFirstDraft
      .getByTestId("platform-contract-rendered-draft")
      .textContent(),
  ).toBe(firstRenderedText);
  expect(
    await preservedFirstDraft
      .getByText("Rendered SHA-256", { exact: true })
      .locator("..")
      .locator("dd")
      .textContent(),
  ).toBe(firstRenderedHash);

  await salesPage.goto(activePath);
  await expect(salesPage.getByText("404", { exact: true })).toBeVisible();
  await expect(
    salesPage.getByTestId("platform-contract-draft-report-workspace"),
  ).toHaveCount(0);
  await salesContext.close();

  const responsibleSalesContext = await browser.newContext();
  const responsibleSalesPage = await responsibleSalesContext.newPage();
  await login(responsibleSalesPage, fixture.identities.responsibleSales);
  await expect(responsibleSalesPage).toHaveURL(/\/sales$/);
  const responsibleSalesToken = await localAccessToken(
    fixture.identities.responsibleSales,
  );
  const responsibleSalesSummaries = await platformRpc(
    responsibleSalesToken,
    "staff_student_case_page",
    {
      p_limit: 101,
      p_before_sort_at: null,
      p_before_student_case_id: null,
      p_state: null,
      p_query: null,
      p_student_case_id: fixture.bw6.orgA.activeStudentCaseId,
    },
  );
  expect(responsibleSalesSummaries.status).toBe(200);
  expect(responsibleSalesSummaries.payload).toEqual([
    expect.objectContaining({
      access_mode: "sales_summary",
      student_case_id: fixture.bw6.orgA.activeStudentCaseId,
      state: "active",
    }),
  ]);
  await responsibleSalesPage.goto(activePath);
  await expect(
    responsibleSalesPage.getByTestId("platform-sales-handoff-summary"),
  ).toBeVisible();
  await expect(
    responsibleSalesPage.getByTestId("platform-contract-draft-report-workspace"),
  ).toHaveCount(0);
  await responsibleSalesContext.close();

  await page.goto(`${activePath}#contract-workflow`);
  const activeWorkspace = page.getByTestId(
    "platform-contract-draft-report-workspace",
  );
  const activeGenerateDraftForm = activeWorkspace.getByTestId(
    "platform-contract-draft-generate-form",
  );
  await activeGenerateDraftForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(contractTemplateVersionId);
  await activeGenerateDraftForm
    .locator('input[name="reason"]')
    .fill("Generate the reviewed active-case contract before post-contract work");
  auditedRequestIds.push(await requestIdFrom(activeGenerateDraftForm));
  await activeGenerateDraftForm
    .getByRole("button", { name: /Сгенерировать/ })
    .click();
  await expect(page).toHaveURL(/bw6_result=draft_generated/);

  const activeApproveDraftForm = activeWorkspace.getByTestId(
    "platform-contract-draft-approved-form",
  );
  await activeApproveDraftForm
    .locator('input[name="reason"]')
    .fill("Approve the active-case draft before seeding its checklist");
  auditedRequestIds.push(await requestIdFrom(activeApproveDraftForm));
  await activeApproveDraftForm
    .getByRole("button", { name: "Утвердить" })
    .click();
  await expect(page).toHaveURL(/bw6_result=draft_approved/);

  const seedItemsForm = page.getByTestId("platform-post-contract-seed-form");
  await seedItemsForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(contractTemplateVersionId);
  await seedItemsForm
    .locator('input[name="reason"]')
    .fill("Seed synthetic post-contract items from the approved blueprint");
  auditedRequestIds.push(await requestIdFrom(seedItemsForm));
  await seedItemsForm.getByRole("button", { name: "Создать пункты" }).click();
  await expect(page).toHaveURL(/bw6_result=items_seeded/);

  let welcomeItem = page.locator(
    `[data-testid="platform-post-contract-item"][data-item-key="${welcomeItemKey}"]`,
  );
  let welcomeForm = welcomeItem.getByTestId("platform-post-contract-item-form");
  await welcomeForm.locator('select[name="status"]').selectOption("delivered");
  await welcomeForm.locator('input[name="evidence_ref"]').fill("");
  await welcomeForm
    .locator('input[name="reason"]')
    .fill("Prove delivered fails closed without evidence");
  const deliveredRetryRequestId = await requestIdFrom(welcomeForm);
  await welcomeForm.getByRole("button", { name: "Сохранить пункт" }).click();
  await expect(page).toHaveURL(/bw6_result=invalid/);
  welcomeItem = page.locator(
    `[data-testid="platform-post-contract-item"][data-item-key="${welcomeItemKey}"]`,
  );
  welcomeForm = welcomeItem.getByTestId("platform-post-contract-item-form");
  expect(await requestIdFrom(welcomeForm)).toBe(deliveredRetryRequestId);
  await welcomeForm.locator('select[name="status"]').selectOption("delivered");
  await welcomeForm
    .locator('input[name="evidence_ref"]')
    .fill(`synthetic:evidence:welcome-pack:${suffix}`);
  await welcomeForm
    .locator('input[name="reason"]')
    .fill("Record delivered synthetic item with bounded evidence");
  auditedRequestIds.push(deliveredRetryRequestId);
  await welcomeForm.getByRole("button", { name: "Сохранить пункт" }).click();
  await expect(page).toHaveURL(/bw6_result=item_updated/);

  let documentItem = page.locator(
    `[data-testid="platform-post-contract-item"][data-item-key="${documentItemKey}"]`,
  );
  let documentForm = documentItem.getByTestId("platform-post-contract-item-form");
  const assignedCuratorMembershipId = await documentForm
    .locator('input[name="owner_membership_id"]')
    .inputValue();
  expect(assignedCuratorMembershipId).toMatch(uuidPattern);
  await documentForm.locator('select[name="status"]').selectOption("blocked");
  await documentForm.locator('input[name="owner_membership_id"]').fill("");
  await documentForm.locator('textarea[name="next_action"]').fill("");
  await documentForm
    .locator('input[name="reason"]')
    .fill("Prove blocked fails closed without owner and next action");
  const blockedRetryRequestId = await requestIdFrom(documentForm);
  await documentForm.getByRole("button", { name: "Сохранить пункт" }).click();
  await expect(page).toHaveURL(/bw6_result=invalid/);
  documentItem = page.locator(
    `[data-testid="platform-post-contract-item"][data-item-key="${documentItemKey}"]`,
  );
  documentForm = documentItem.getByTestId("platform-post-contract-item-form");
  expect(await requestIdFrom(documentForm)).toBe(blockedRetryRequestId);
  await documentForm.locator('select[name="status"]').selectOption("blocked");
  await documentForm
    .locator('input[name="owner_membership_id"]')
    .fill(assignedCuratorMembershipId);
  await documentForm
    .locator('textarea[name="next_action"]')
    .fill("Request synthetic missing input");
  await documentForm
    .locator('input[name="reason"]')
    .fill("Record blocked synthetic item with owner and next action");
  auditedRequestIds.push(blockedRetryRequestId);
  await documentForm.getByRole("button", { name: "Сохранить пункт" }).click();
  await expect(page).toHaveURL(/bw6_result=item_updated/);

  let generateReportForm = page.getByTestId(
    "platform-post-contract-report-generate-form",
  );
  await generateReportForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(contractTemplateVersionId);
  await generateReportForm
    .locator('input[name="reason"]')
    .fill("Generate an immutable report from validated synthetic items");
  auditedRequestIds.push(await requestIdFrom(generateReportForm));
  await generateReportForm
    .getByRole("button", { name: "Создать новую версию отчёта" })
    .click();
  await expect(page).toHaveURL(/bw6_result=report_generated/);
  const approveReportForm = page.getByTestId(
    "platform-contract-report-approved-form",
  );
  const generatedReportId = await approveReportForm
    .locator('input[name="post_contract_report_id"]')
    .inputValue();
  const generatedReport = page.locator(
    `[data-testid="platform-post-contract-report-version"][data-report-id="${generatedReportId}"]`,
  );
  await expect(generatedReport).toHaveAttribute(
    "data-template-id",
    contractTemplateVersionId,
  );
  const deliveredCount = Number(
    await generatedReport.getByText("Доставлено", { exact: true }).locator("..").locator("dd").textContent(),
  );
  const blockedCount = Number(
    await generatedReport.getByText("Заблокировано", { exact: true }).locator("..").locator("dd").textContent(),
  );
  expect(deliveredCount).toBe(1);
  expect(blockedCount).toBe(1);
  await expect(generatedReport).toContainText(
    `synthetic:evidence:welcome-pack:${suffix}`,
  );
  await expect(generatedReport).toContainText("Request synthetic missing input");
  expect(
    await generatedReport
      .getByTestId("platform-post-contract-report-item")
      .count(),
  ).toBe(2);
  await expect(
    generatedReport.locator(
      `[data-testid="platform-post-contract-report-item"][data-item-id="${fixture.bw6.orgA.postContractItemId}"]`,
    ),
  ).toHaveCount(0);
  await expect(
    page.locator(
      `[data-testid="platform-post-contract-report-version"][data-report-id="${fixture.bw6.orgA.postContractReportId}"]`,
    ),
  ).toHaveAttribute(
    "data-template-id",
    fixture.bw6.orgA.contractTemplateVersionId,
  );
  await approveReportForm
    .locator('input[name="reason"]')
    .fill("Approve report with delivered evidence and blocked ownership");
  auditedRequestIds.push(await requestIdFrom(approveReportForm));
  await approveReportForm.getByRole("button", { name: "Утвердить" }).click();
  await expect(page).toHaveURL(/bw6_result=report_approved/);
  await expectWorkspaceAccessible(page);

  const curatorContext = await browser.newContext();
  const curatorPage = await curatorContext.newPage();
  await login(curatorPage, fixture.identities.curator);
  await expect(curatorPage).toHaveURL(/\/clients$/);
  await curatorPage.goto(`${activePath}#contract-workflow`);
  const curatorWorkspace = curatorPage.getByTestId(
    "platform-contract-draft-report-workspace",
  );
  await expect(curatorWorkspace).toBeVisible();
  await expect(
    curatorWorkspace.getByTestId("platform-contract-template-create-form"),
  ).toHaveCount(0);
  const curatorItem = curatorWorkspace.locator(
    `[data-testid="platform-post-contract-item"][data-item-key="${documentItemKey}"]`,
  );
  const curatorItemForm = curatorItem.getByTestId(
    "platform-post-contract-item-form",
  );
  await curatorItemForm.locator('select[name="status"]').selectOption("in_progress");
  await curatorItemForm
    .locator('textarea[name="next_action"]')
    .fill("Continue synthetic review as assigned Curator");
  await curatorItemForm
    .locator('input[name="reason"]')
    .fill("Assigned Curator advances the synthetic item");
  await curatorItemForm.getByRole("button", { name: "Сохранить пункт" }).click();
  await expect(curatorPage).toHaveURL(/bw6_result=item_updated/);
  generateReportForm = curatorWorkspace.getByTestId(
    "platform-post-contract-report-generate-form",
  );
  await generateReportForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(contractTemplateVersionId);
  await generateReportForm
    .locator('input[name="reason"]')
    .fill("Assigned Curator snapshots the updated synthetic checklist");
  await generateReportForm
    .getByRole("button", { name: "Создать новую версию отчёта" })
    .click();
  await expect(curatorPage).toHaveURL(/bw6_result=report_generated/);
  const rejectReportForm = curatorWorkspace.getByTestId(
    "platform-contract-report-rejected-form",
  );
  await rejectReportForm
    .locator('input[name="reason"]')
    .fill("Reject Curator report version while preserving its audit history");
  await rejectReportForm.getByRole("button", { name: "Отклонить" }).click();
  await expect(curatorPage).toHaveURL(/bw6_result=report_rejected/);
  const deniedCuratorResponse = await curatorPage.goto(
    `/clients/${fixture.bw6.negative.unassignedActiveStudentCaseId}`,
  );
  expect(deniedCuratorResponse?.status()).toBe(404);
  await expect(
    curatorPage.getByTestId("platform-contract-draft-report-workspace"),
  ).toHaveCount(0);
  await curatorContext.close();

  for (const identity of [
    fixture.identities.crossOrgAdmin,
    fixture.identities.finance,
    fixture.identities.student,
  ]) {
    const context = await browser.newContext();
    const deniedPage = await context.newPage();
    await login(deniedPage, identity);
    await expect(deniedPage).toHaveURL(expectedStaffHome(identity));
    const response = await deniedPage.goto(activePath);
    await expect(
      deniedPage.getByTestId("platform-contract-draft-report-workspace"),
    ).toHaveCount(0);
    if (identity === fixture.identities.crossOrgAdmin) {
      expect(response?.status()).toBe(404);
    } else {
      await expect(deniedPage).not.toHaveURL(
        new RegExp(`${escapePathForRegex(activePath)}$`),
      );
    }
    await context.close();
  }

  for (const requestId of auditedRequestIds) {
    await expectOneAuditEvent(requestId);
  }
  expectLegacyDatabaseUntouched();
});

test("BW7 proves one Supabase case from Sales draft through Admin handoff to Curator, Portal, and Sales summary", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  expectLegacyDatabaseUntouched();

  const casePath = `/clients/${fixture.bw7.orgA.studentCaseId}`;
  const templateVersionId = fixture.bw6.orgA.contractTemplateVersionId;
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const requestIdFrom = async (form: Locator) => {
    const value = await form.locator('input[name="request_id"]').inputValue();
    expect(value).toMatch(uuidPattern);
    return value;
  };

  const salesContext = await browser.newContext();
  const salesPage = await salesContext.newPage();
  await login(salesPage, fixture.identities.salesScoped);
  await expect(salesPage).toHaveURL(/\/sales$/);
  await salesPage.goto(`${casePath}#contract-workflow`);
  const salesWorkspace = salesPage.getByTestId(
    "platform-contract-draft-report-workspace",
  );
  await expect(salesWorkspace).toBeVisible();
  const generateDraftForm = salesWorkspace.getByTestId(
    "platform-contract-draft-generate-form",
  );
  await generateDraftForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(templateVersionId);
  await generateDraftForm
    .locator('input[name="reason"]')
    .fill("Generate the BW7 one-case lifecycle draft");
  await generateDraftForm.getByRole("button", { name: /Сгенерировать/ }).click();
  await expect(salesPage).toHaveURL(/bw6_result=draft_generated/);
  const approveDraftForm = salesWorkspace.getByTestId(
    "platform-contract-draft-approved-form",
  ).first();
  await approveDraftForm
    .locator('input[name="reason"]')
    .fill("Approve the reviewed BW7 lifecycle draft");
  await approveDraftForm.getByRole("button", { name: "Утвердить" }).click();
  await expect(salesPage).toHaveURL(/bw6_result=draft_approved/);
  await salesContext.close();

  const pendingStudentContext = await browser.newContext();
  const pendingStudentPage = await pendingStudentContext.newPage();
  await login(pendingStudentPage, fixture.identities.lifecycleStudent);
  await expect(pendingStudentPage).toHaveURL(/\/platform-pending(?:\?.*)?$/);
  await expect(
    pendingStudentPage.getByTestId("platform-pending"),
  ).toBeVisible();
  await pendingStudentPage.goto("/portal");
  await expect(pendingStudentPage).toHaveURL(
    /\/platform-pending\?from=\/portal$/,
  );
  await pendingStudentContext.close();

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, fixture.identities.admin);
  await expect(adminPage).toHaveURL(/\/sales$/);
  await adminPage.goto(`${casePath}#case-lifecycle`);
  const assignmentForm = adminPage.getByTestId("curator-assignment-form");
  await expect(assignmentForm).toBeVisible();
  await assignmentForm
    .locator('select[name="curator_id"]')
    .selectOption(fixture.bw7.orgA.curatorMembershipId);
  await assignmentForm
    .locator('textarea[name="reason"]')
    .fill("Assign the Curator and activate the bounded BW7 lifecycle");
  const assignmentRequestId = await requestIdFrom(assignmentForm);
  await assignmentForm.getByRole("button", { name: "Назначить куратора" }).click();
  await expect(adminPage).toHaveURL(/result=saved/);
  await expect(adminPage.getByTestId("platform-client-detail-page")).toBeVisible();
  await expect(
    adminPage.getByTestId("curator-assignment-form")
      .locator('select[name="curator_id"]'),
  ).toHaveValue(fixture.bw7.orgA.curatorMembershipId);
  await expect(
    adminPage.locator("#case-lifecycle").getByText("Активно", { exact: true }),
  ).toBeVisible();

  const adminToken = await localAccessToken(fixture.identities.admin);
  const caseRows = await platformRows(
    adminToken,
    "student_cases",
    new URLSearchParams({
      select:
        "id,state,current_curator_membership_id,handoff_at,portal_activated_at",
      id: `eq.${fixture.bw7.orgA.studentCaseId}`,
    }),
  );
  expect(caseRows.status).toBe(200);
  expect(Array.isArray(caseRows.payload)).toBe(true);
  if (!Array.isArray(caseRows.payload)) {
    throw new Error("BW7 student case projection was not an array");
  }
  expect(caseRows.payload).toHaveLength(1);
  expect(caseRows.payload[0]).toMatchObject({
    id: fixture.bw7.orgA.studentCaseId,
    state: "active",
    current_curator_membership_id: fixture.bw7.orgA.curatorMembershipId,
  });
  expect(caseRows.payload[0].handoff_at).toEqual(expect.any(String));
  expect(caseRows.payload[0].portal_activated_at).toEqual(expect.any(String));
  const assignmentAudit = await safeAuditSearch(adminToken, {
    actions: ["case.curator.set"],
    resourceTypes: ["student_case"],
    resourceId: fixture.bw7.orgA.studentCaseId,
  });
  expect(assignmentAudit.status).toBe(200);
  expect(
    safeAuditRows(assignmentAudit.payload).filter(
      (row) => row.request_id === assignmentRequestId,
    ),
  ).toEqual([
    expect.objectContaining({
      action: "case.curator.set",
      resource_type: "student_case",
      resource_id: fixture.bw7.orgA.studentCaseId,
      request_id: assignmentRequestId,
    }),
  ]);
  await adminContext.close();

  const curatorContext = await browser.newContext();
  const curatorPage = await curatorContext.newPage();
  await login(curatorPage, fixture.identities.curator);
  await expect(curatorPage).toHaveURL(/\/clients$/);
  await curatorPage.goto(`${casePath}#contract-workflow`);
  const curatorWorkspace = curatorPage.getByTestId(
    "platform-contract-draft-report-workspace",
  );
  await expect(curatorWorkspace).toBeVisible();
  const seedForm = curatorWorkspace.getByTestId(
    "platform-post-contract-seed-form",
  );
  await seedForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(templateVersionId);
  await seedForm
    .locator('input[name="reason"]')
    .fill("Seed the assigned Curator checklist for BW7");
  await seedForm.getByRole("button", { name: "Создать пункты" }).click();
  await expect(curatorPage).toHaveURL(/bw6_result=items_seeded/);
  await expect(
    curatorWorkspace.getByTestId("platform-post-contract-item"),
  ).toHaveCount(2);

  const reportForm = curatorWorkspace.getByTestId(
    "platform-post-contract-report-generate-form",
  );
  await reportForm
    .locator('select[name="contract_template_version_id"]')
    .selectOption(templateVersionId);
  await reportForm
    .locator('input[name="reason"]')
    .fill("Snapshot the BW7 assigned Curator checklist");
  await reportForm
    .getByRole("button", { name: "Создать новую версию отчёта" })
    .click();
  await expect(curatorPage).toHaveURL(/bw6_result=report_generated/);
  const approveReportForm = curatorWorkspace.getByTestId(
    "platform-contract-report-approved-form",
  ).first();
  await approveReportForm
    .locator('input[name="reason"]')
    .fill("Approve the reviewed BW7 post-contract report");
  await approveReportForm.getByRole("button", { name: "Утвердить" }).click();
  await expect(curatorPage).toHaveURL(/bw6_result=report_approved/);
  await curatorContext.close();

  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await login(studentPage, fixture.identities.lifecycleStudent);
  await expect(studentPage).toHaveURL(/\/portal$/);
  await expect(
    studentPage.locator("#portal-main").getByRole("heading", {
      level: 1,
      name: "Главная",
      exact: true,
    }),
  ).toBeVisible();
  await studentPage.goto("/portal/profile");
  await expect(
    studentPage.locator("#portal-main").getByText(
      "BW7 Lifecycle Student",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    studentPage.getByTestId("platform-contract-draft-report-workspace"),
  ).toHaveCount(0);
  await studentPage.goto(casePath);
  await expect(studentPage).toHaveURL(/\/portal/);
  await studentContext.close();

  const summaryContext = await browser.newContext();
  const summaryPage = await summaryContext.newPage();
  await login(summaryPage, fixture.identities.salesScoped);
  await expect(summaryPage).toHaveURL(/\/sales$/);
  await summaryPage.goto(casePath);
  await expect(summaryPage.getByTestId("platform-sales-handoff-summary"))
    .toBeVisible();
  await expect(summaryPage.getByText(fixture.bw7.orgA.studentDisplayName, {
    exact: true,
  })).toBeVisible();
  await expect(
    summaryPage.getByTestId("platform-contract-draft-report-workspace"),
  ).toHaveCount(0);
  await expect(summaryPage.getByTestId("curator-assignment-form")).toHaveCount(0);
  await summaryContext.close();

  expectLegacyDatabaseUntouched();
});

test("staff cannot stay on the student portal and a Student without a case fails closed", async ({
  browser,
}) => {
  for (const [identity, expectedPath] of [
    [fixture.identities.admin, "/sales"],
    [fixture.identities.curator, "/clients"],
    [fixture.identities.finance, "/login"],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, identity);
    await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath);
    await page.goto("/portal");
    await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath);
    await expect(
      page.getByRole("navigation", { name: "Навигация кабинета" }),
    ).toHaveCount(0);
    if (identity === fixture.identities.curator) {
      await expect(page.getByTestId("platform-clients-page")).toBeVisible();
      await page.goto("/sales");
      await expect(page).toHaveURL(/\/platform-pending\?from=%2Fsales$/);
    }
    await context.close();
  }

  const noCaseContext = await browser.newContext();
  const noCasePage = await noCaseContext.newPage();
  await login(noCasePage, fixture.identities.studentNoCase);
  await expect
    .poll(() => new URL(noCasePage.url()).pathname)
    .toBe("/platform-pending");
  await expect(noCasePage.getByTestId("platform-pending")).toBeVisible();
  await expect(
    noCasePage.getByRole("link", { name: "Открыть сообщения" }),
  ).toHaveCount(0);
  await noCaseContext.close();
});

test("cross-organization admin is denied the org A P3C workflow route", async ({
  page,
}) => {
  await loginToMessaging(page, fixture.identities.crossOrgAdmin);
  const list = page.getByTestId("platform-conversation-list");
  await expect(
    list.getByText(fixture.conversations.orgA.subject, { exact: true }),
  ).toHaveCount(0);
  await expectDeniedConversationRoute(
    page,
    `/whatsapp/${fixture.p3c.orgA.conversationId}`,
  );
});

test("stale sales workflow claims fail closed at the live platform RPC seam", async () => {
  const result = await workflowRpc(
    fixture.p3c.orgA.staleSalesAccessToken,
    fixture.p3c.orgA.conversationId,
  );
  expect([401, 403]).toContain(result.status);
});

test("staff writes and persists a manual reply while AI is unavailable", async ({
  page,
}) => {
  const target = fixture.p3c.mutations.manualAiUnavailable;
  const finalText = "Ручной синтетический ответ сотрудника без AI.";
  await openConversation(page, fixture.identities.admin, target.conversationId);

  const health = page.getByTestId("platform-workflow-health");
  await expect(
    health.locator(
      `[data-integration-readiness="${target.aiReadiness}"][data-provider-proof="not-proved"]`,
    ),
  ).toHaveCount(1);
  await expect(
    health.locator(
      `[data-integration-readiness="${target.wahaReadiness}"][data-provider-proof="proved"]`,
    ),
  ).toHaveCount(1);
  await expect(page.getByTestId("platform-request-draft")).toBeDisabled();
  await expect(page.getByTestId("platform-manual-send")).toBeEnabled();

  await page.getByTestId("platform-manual-send-text").fill(finalText);
  await page
    .getByTestId("platform-manual-send-reason")
    .fill("Manual reply required while AI health is unavailable");
  await page.getByTestId("platform-manual-send").click();

  await expect(page.locator('[data-action-status="completed"]')).toBeVisible();
  await expect(page.getByText(finalText, { exact: true })).toBeVisible();
  await expect(
    page
      .getByTestId("platform-outbox-state")
      .locator(
        '[data-outbox-kind="manual_whatsapp_send"][data-outbox-state="queued"]',
      ),
  ).toHaveCount(1);
  await expect(page.getByTestId("platform-workflow-audit")).toContainText(
    "communication.manual.send.request",
  );

  await page.reload();
  await expect(page.getByText(finalText, { exact: true })).toBeVisible();
  await expect(
    page
      .getByTestId("platform-outbox-state")
      .locator('[data-outbox-kind="manual_whatsapp_send"]'),
  ).toHaveCount(1);
  await expect(page.getByTestId("platform-manual-send")).toHaveCount(0);
});

test("staff submits an approved-knowledge AI draft request through the real form", async ({
  page,
}) => {
  const target = fixture.p3c.mutations.aiRequest;
  await openConversation(
    page,
    fixture.identities.crossOrgAdmin,
    target.conversationId,
  );

  await expect(page.getByTestId("platform-messaging-workflow")).toHaveAttribute(
    "data-provider-proof",
    "proved",
  );
  await page
    .getByTestId("platform-knowledge-select")
    .selectOption(target.knowledgeVersionId);
  await page.locator("#platform-draft-language").selectOption("en");
  await page
    .locator("#platform-draft-reason")
    .fill("Prepare a grounded synthetic draft for browser mutation proof");
  await page.getByTestId("platform-request-draft").click();

  await expect(page.locator('[data-action-status="completed"]')).toBeVisible();
  await expect(page.getByTestId("platform-draft-awaiting")).toBeVisible();
  await expect(page.getByTestId("platform-selected-knowledge")).toBeVisible();
  await expect(
    page
      .getByTestId("platform-outbox-state")
      .locator(
        '[data-outbox-kind="ai_draft_generate"][data-outbox-state="queued"]',
      ),
  ).toHaveCount(1);
  await expect(page.getByTestId("platform-workflow-audit")).toContainText(
    "ai.draft.request.knowledge",
  );
});

test("staff reviews an AI draft then authorizes the edited final text", async ({
  page,
}) => {
  const target = fixture.p3c.mutations.aiReview;
  const reviewedText = "Staff-edited synthetic draft after human review.";
  const finalText = "Final staff-controlled synthetic message for manual send.";
  await openConversation(
    page,
    fixture.identities.crossOrgAdmin,
    target.conversationId,
  );

  await expect(page.getByTestId("platform-draft-editor")).toHaveValue(
    target.generatedText,
  );
  await page.getByTestId("platform-draft-editor").fill(reviewedText);
  await page
    .locator("#platform-review-reason")
    .fill("Human review edited and approved the synthetic draft");
  await page.getByTestId("platform-review-approve").click();

  await expect(page.getByTestId("platform-manual-send-text")).toHaveValue(
    reviewedText,
  );
  await page.getByTestId("platform-manual-send-text").fill(finalText);
  await page
    .getByTestId("platform-manual-send-reason")
    .fill("Human authorized the exact final text for the controlled outbox");
  await page.getByTestId("platform-manual-send").click();

  await expect(page.locator('[data-action-status="completed"]')).toBeVisible();
  await expect(page.getByText(finalText, { exact: true })).toBeVisible();
  await expect(
    page
      .getByTestId("platform-outbox-state")
      .locator(
        '[data-outbox-kind="manual_whatsapp_send"][data-outbox-state="queued"]',
      ),
  ).toHaveCount(1);
  await expect(page.getByTestId("platform-workflow-audit")).toContainText(
    "communication.manual.send.request",
  );

  await page.reload();
  await expect(page.getByText(finalText, { exact: true })).toBeVisible();
  await expect(
    page
      .getByTestId("platform-outbox-state")
      .locator('[data-outbox-kind="manual_whatsapp_send"]'),
  ).toHaveCount(1);
});

test("BW4 renders immutable handoff and metadata-only approved prompt evidence", async ({
  page,
}) => {
  await openConversation(
    page,
    fixture.identities.admin,
    fixture.bw4.orgA.conversationId,
  );

  const handoff = page.getByTestId("platform-handoff-context");
  await expect(handoff).toHaveAttribute("data-handoff-state", "recorded");
  await expect(handoff).toContainText(fixture.bw4.orgA.handoffNextStep);
  await expect(handoff).toContainText(
    new RegExp(fixture.bw4.orgA.responsibleRole, "i"),
  );

  const promptPolicy = page.getByTestId("platform-active-prompt-policy");
  await expect(promptPolicy).toHaveAttribute("data-artifact-state", "approved");
  await expect(promptPolicy).toContainText(fixture.bw4.orgA.promptPolicyTitle);
  await expect(promptPolicy).toContainText(
    fixture.bw4.orgA.promptPolicyVersion,
  );
  await expect(promptPolicy).toContainText(fixture.bw4.orgA.promptPolicySha);

  const businessContext = page.getByTestId("platform-active-business-context");
  await expect(businessContext).toHaveAttribute(
    "data-artifact-state",
    "approved",
  );
  await expect(businessContext).toContainText(
    fixture.bw4.orgA.businessContextTitle,
  );
  await expect(businessContext).toContainText(
    fixture.bw4.orgA.businessContextVersion,
  );
  await expect(businessContext).toContainText(
    fixture.bw4.orgA.businessContextSha,
  );

  expect(await page.content()).not.toContain(
    fixture.bw4.orgA.rawContentSentinel,
  );
});

test("Admin creates, answers, reopens, and retires one versioned BW4 decision", async ({
  page,
}) => {
  const question = `BW4 browser decision ${randomUUID()}`;
  const answer = "Reviewed BW4 browser answer grounded in the synthetic source.";
  await openConversation(
    page,
    fixture.identities.admin,
    fixture.bw4.orgA.conversationId,
  );

  const createDisclosure = page.getByTestId("platform-decision-create");
  await createDisclosure.locator("summary").click();
  await expect(
    createDisclosure.locator('select[name="owner_role"] option'),
  ).toHaveCount(3);
  const requirementKind = createDisclosure.locator(
    'select[name="affected_requirement_kind"]',
  );
  await expect(requirementKind.locator('option[value="country_requirement"]')).toHaveCount(1);
  await expect(requirementKind.locator('option[value="document_requirement"]')).toHaveCount(1);
  await requirementKind.selectOption("country_requirement");
  await expect(
    createDisclosure.getByTestId("platform-decision-requirement-target"),
  ).toContainText(fixture.bw3.orgA.checklist.targetCountry);
  await requirementKind.selectOption("document_requirement");
  await expect(
    createDisclosure.getByTestId("platform-decision-requirement-target"),
  ).toContainText(fixture.bw3.orgA.document.label);
  await createDisclosure.locator('textarea[name="question"]').fill(question);
  await requirementKind.selectOption("student_profile");
  const affectedProfileField = createDisclosure.locator(
    'select[name="affected_requirement_field"]',
  );
  await expect(affectedProfileField.locator("option")).toHaveCount(15);
  await affectedProfileField.selectOption("communication_language");
  await createDisclosure
    .locator('input[name="reason"]')
    .fill("Record a synthetic unresolved decision for browser lifecycle proof");
  await createDisclosure.getByTestId("platform-decision-create-submit").click();

  await expect(page.getByTestId("platform-decision-action-result")).toHaveAttribute(
    "data-decision-action-result",
    "saved",
  );
  let entry = page
    .getByTestId("platform-decision-entry")
    .filter({ hasText: question });
  await expect(entry).toHaveAttribute("data-decision-status", "unresolved");

  const answerDisclosure = entry
    .locator("details")
    .filter({ hasText: "Зафиксировать ответ" });
  await answerDisclosure.locator("summary").click();
  await answerDisclosure.locator('textarea[name="answer"]').fill(answer);
  await answerDisclosure
    .locator('select[name="source_registry_id"]')
    .selectOption(fixture.bw4.orgA.reviewedSourceId);
  await answerDisclosure
    .locator('input[name="evidence_ref"]')
    .fill("Synthetic reviewed source passage used for the exact answer");
  await answerDisclosure
    .locator('input[name="reason"]')
    .fill("Answer reviewed against the selected source");
  await answerDisclosure.getByTestId("platform-decision-answer-submit").click();

  entry = page
    .getByTestId("platform-decision-entry")
    .filter({ hasText: question });
  await expect(entry).toHaveAttribute("data-decision-status", "answered");
  await expect(entry).toContainText(answer);
  await expect(entry).toContainText(fixture.bw4.orgA.sourceKey);

  const historySummary = entry.locator("summary").filter({
    hasText: "История решения",
  });
  await historySummary.focus();
  await page.keyboard.press("Enter");
  await expect(entry.getByTestId("platform-decision-history")).toBeVisible();
  await expect(
    entry.getByTestId("platform-decision-history").locator("li"),
  ).toHaveCount(2);

  await entry
    .locator('input[id^="platform-decision-unresolved-reason-"]')
    .fill("Explicitly reopen after new information arrived");
  await entry.getByTestId("platform-decision-reopen-submit").click();

  entry = page
    .getByTestId("platform-decision-entry")
    .filter({ hasText: question });
  await expect(entry).toHaveAttribute("data-decision-status", "unresolved");
  await expect(entry).toContainText("Ответ ещё не зафиксирован");
  await entry
    .locator('input[id^="platform-decision-retired-reason-"]')
    .fill("Retire the synthetic question after lifecycle proof");
  await entry.getByTestId("platform-decision-retire-submit").click();

  entry = page
    .getByTestId("platform-decision-entry")
    .filter({ hasText: question });
  await expect(entry).toHaveAttribute("data-decision-status", "retired");
  await expect(entry.getByTestId("platform-decision-controls")).toHaveCount(0);
  await entry.locator("summary").filter({ hasText: "История решения" }).click();
  await expect(
    entry.getByTestId("platform-decision-history").locator("li"),
  ).toHaveCount(4);
});

test("responsible Sales gets a fixed owner role and a clear no-case handoff state", async ({
  page,
}) => {
  await openConversation(
    page,
    fixture.identities.salesScoped,
    fixture.bw4.noCase.conversationId,
  );

  await expect(page.getByTestId("platform-handoff-context")).toHaveAttribute(
    "data-handoff-state",
    "no-linked-case",
  );
  const createDisclosure = page.getByTestId("platform-decision-create");
  await createDisclosure.locator("summary").click();
  await expect(
    createDisclosure.locator('input[name="owner_role"]'),
  ).toHaveValue("sales");
  await expect(
    createDisclosure.locator('select[name="owner_role"]'),
  ).toHaveCount(0);
  await expect(
    createDisclosure.locator(
      'select[name="affected_requirement_kind"] option',
    ),
  ).toHaveCount(1);
});

test("Finance, Students, former Sales, and cross-org staff see no BW4 controls", async ({
  browser,
}) => {
  for (const identity of [
    fixture.identities.finance,
    fixture.identities.student,
    fixture.identities.studentNoCase,
  ]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, identity);
    await page.goto(`/whatsapp/${fixture.bw4.orgA.conversationId}`);
    await expect(page.getByTestId("platform-decision-create")).toHaveCount(0);
    await expect(page.getByTestId("platform-decision-controls")).toHaveCount(0);
    await expect(page.getByTestId("platform-decision-backlog")).toHaveCount(0);
    await expect(page.getByTestId("platform-handoff-context")).toHaveCount(0);
    await expect(page.getByTestId("platform-prompt-evidence")).toHaveCount(0);
    await context.close();
  }

  const crossOrgContext = await browser.newContext();
  const crossOrgPage = await crossOrgContext.newPage();
  await loginToMessaging(crossOrgPage, fixture.identities.crossOrgAdmin);
  await expectDeniedConversationRoute(
    crossOrgPage,
    `/whatsapp/${fixture.bw4.orgA.conversationId}`,
  );
  await expect(crossOrgPage.getByTestId("platform-decision-controls")).toHaveCount(
    0,
  );
  await expect(crossOrgPage.getByTestId("platform-decision-backlog")).toHaveCount(0);
  await expect(crossOrgPage.getByTestId("platform-handoff-context")).toHaveCount(0);
  await expect(crossOrgPage.getByTestId("platform-prompt-evidence")).toHaveCount(0);
  await crossOrgContext.close();

  const formerSalesResult = await platformRpc(
    fixture.p3c.orgA.staleSalesAccessToken,
    "staff_conversation_bw4_workspace",
    {
      p_organization_id: fixture.bw4.orgA.organizationId,
      p_conversation_id: fixture.bw4.orgA.conversationId,
    },
  );
  expect([401, 403]).toContain(formerSalesResult.status);
});
