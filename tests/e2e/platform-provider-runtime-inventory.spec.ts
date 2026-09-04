import { chmod, mkdir, open } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA40_PATTERN = /^[0-9a-f]{40}$/u;
const AUTHORITY_ROLE_PATTERN = /^(admin|sales|admissions)$/u;

type TestRole = "admin" | "sales";

type Snapshot = Readonly<{
  admissionsClientId: string;
  admissionsLeadId: string;
  aiDraftEventCount: number;
  auditEventCount: number;
  amoCrmAttemptCount: number;
  amoCrmContactBindingCount: number;
  amoCrmDiscoveryCount: number;
  amoCrmLeadBindingCount: number;
  amoCrmReceiptCount: number;
  communicationMessageCount: number;
  durableWorkAttemptCount: number;
  durableWorkEventCount: number;
  durableWorkItemCount: number;
  geminiProposalReceiptCount: number;
  geminiProposalRequestCount: number;
  geminiProposalResultCount: number;
  geminiReviewCount: number;
  manualSendAuthorizationCount: number;
  manualSendProviderBindingCount: number;
  manualSendRuntimeBindingCount: number;
  manualWhatsAppReconciliationRequestCount: number;
  manualWhatsAppReconciliationResultCount: number;
  providerReconciliationEventCount: number;
  providerWebhookEventCount: number;
  sessionHealthCount: number;
  wahaMessageBindingCount: number;
  wahaObservationCount: number;
  workReviewEventCount: number;
}>;

type SanitizedSnapshot = Omit<
  Snapshot,
  "admissionsClientId" | "admissionsLeadId"
>;

type PageProof = Readonly<{
  route: string;
  authorityRole: string;
  checks: Readonly<Record<string, boolean>>;
  statuses: Readonly<Record<string, string>>;
}>;

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requiredText(name: string): string {
  const value = process.env[name];
  if (!value || value !== value.trim()) throw new Error(`${name} is required`);
  return value;
}

function requiredUuid(name: string): string {
  const value = requiredText(name);
  if (!UUID_PATTERN.test(value)) throw new Error(`${name} must be a UUID`);
  return value.toLowerCase();
}

function requiredSha(name: string): string {
  const value = requiredText(name);
  if (!SHA40_PATTERN.test(value)) throw new Error(`${name} must be a 40-char SHA`);
  return value;
}

function requiredLoopbackOrigin(name: string): string {
  const value = requiredText(name);
  const parsed = new URL(value);
  if (
    parsed.protocol !== "http:" ||
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${name} must be a credential-free loopback HTTP origin`);
  }
  return parsed.origin;
}

function requiredDatabaseUrl(): string {
  const value = requiredText("SUPABASE_DB_URL");
  const parsed = new URL(value);
  if (
    parsed.protocol !== "postgresql:" ||
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
    !parsed.username ||
    !parsed.password ||
    parsed.pathname.length <= 1
  ) {
    throw new Error("SUPABASE_DB_URL must address the private local Supabase database");
  }
  return value;
}

function credentials(role: TestRole) {
  const prefix = `EVO_STAFF_AUTH_${role.toUpperCase()}`;
  return {
    email: requiredText(`${prefix}_EMAIL`),
    password: requiredText(`${prefix}_PASSWORD`),
  };
}

function evidenceInputs() {
  const gitSha = requiredSha("EVO_PLATFORM_RUNTIME_INVENTORY_MAIN_SHA");
  const root = path.resolve(
    process.cwd(),
    "output",
    "provider-runtime-inventory",
    gitSha,
  );
  const browserEvidencePath = path.resolve(
    requiredText("EVO_PLATFORM_RUNTIME_INVENTORY_BROWSER_EVIDENCE_FILE"),
  );
  const databaseEvidencePath = path.resolve(
    requiredText("EVO_PLATFORM_RUNTIME_INVENTORY_DATABASE_EVIDENCE_FILE"),
  );
  for (const filePath of [browserEvidencePath, databaseEvidencePath]) {
    ensure(
      filePath.startsWith(`${root}${path.sep}`),
      "Runtime inventory evidence path escaped the exact-SHA output root",
    );
  }
  return Object.freeze({
    gitSha,
    browserEvidencePath,
    databaseEvidencePath,
  });
}

async function writePrivateJson(
  filePath: string,
  value: Readonly<Record<string, unknown>>,
) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(filePath, 0o600);
  const directory = await open(path.dirname(filePath), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function signInAs(page: Page, role: TestRole) {
  const { email, password } = credentials(role);
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("#staff-email").fill(email);
  await page.locator("#staff-password").fill(password);
  await page.getByRole("button", { name: "Войти в CRM" }).click();
  await expect(page.getByTestId("staff-entry-workspace")).toBeVisible();
  await page.getByTestId("open-role-workspace").click();
  await expect(page.getByTestId("active-role")).toHaveAttribute(
    "data-authority-role",
    role,
  );
}

async function activeRole(page: Page) {
  const v3Shell = page.getByTestId("v3-shell");
  const shell = (await v3Shell.count()) > 0
    ? v3Shell
    : page.getByTestId("staff-shell");
  const value = await shell.getAttribute("data-authority-role");
  ensure(
    typeof value === "string" && AUTHORITY_ROLE_PATTERN.test(value),
    "The active role marker is invalid",
  );
  return value;
}

function count(value: unknown, field: string): number {
  ensure(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, `${field} must be a safe non-negative integer`);
  return value;
}

function equalSnapshots(before: Snapshot, after: Snapshot): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

function sanitizedSnapshot(snapshot: Snapshot): SanitizedSnapshot {
  return Object.freeze({
    aiDraftEventCount: snapshot.aiDraftEventCount,
    auditEventCount: snapshot.auditEventCount,
    amoCrmAttemptCount: snapshot.amoCrmAttemptCount,
    amoCrmContactBindingCount: snapshot.amoCrmContactBindingCount,
    amoCrmDiscoveryCount: snapshot.amoCrmDiscoveryCount,
    amoCrmLeadBindingCount: snapshot.amoCrmLeadBindingCount,
    amoCrmReceiptCount: snapshot.amoCrmReceiptCount,
    communicationMessageCount: snapshot.communicationMessageCount,
    durableWorkAttemptCount: snapshot.durableWorkAttemptCount,
    durableWorkEventCount: snapshot.durableWorkEventCount,
    durableWorkItemCount: snapshot.durableWorkItemCount,
    geminiProposalReceiptCount: snapshot.geminiProposalReceiptCount,
    geminiProposalRequestCount: snapshot.geminiProposalRequestCount,
    geminiProposalResultCount: snapshot.geminiProposalResultCount,
    geminiReviewCount: snapshot.geminiReviewCount,
    manualSendAuthorizationCount: snapshot.manualSendAuthorizationCount,
    manualSendProviderBindingCount: snapshot.manualSendProviderBindingCount,
    manualSendRuntimeBindingCount: snapshot.manualSendRuntimeBindingCount,
    manualWhatsAppReconciliationRequestCount:
      snapshot.manualWhatsAppReconciliationRequestCount,
    manualWhatsAppReconciliationResultCount:
      snapshot.manualWhatsAppReconciliationResultCount,
    providerReconciliationEventCount: snapshot.providerReconciliationEventCount,
    providerWebhookEventCount: snapshot.providerWebhookEventCount,
    sessionHealthCount: snapshot.sessionHealthCount,
    wahaMessageBindingCount: snapshot.wahaMessageBindingCount,
    wahaObservationCount: snapshot.wahaObservationCount,
    workReviewEventCount: snapshot.workReviewEventCount,
  });
}

async function readSnapshot(
  connectionString: string,
  input: Readonly<{
    organizationId: string;
    salesLeadId: string;
    salesClientId: string;
    conversationId: string;
    studentCaseId: string;
  }>,
): Promise<Snapshot> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => undefined });
  try {
    const caseRows = await sql<
      Array<{ canonical_lead_id: string; canonical_client_id: string }>
    >`
      select canonical_lead_id::text, canonical_client_id::text
      from platform.student_cases
      where organization_id = ${input.organizationId}::uuid
        and id = ${input.studentCaseId}::uuid
      limit 1
    `;
    ensure(caseRows.length === 1, "The seeded student case context is missing");
    const admissionsLeadId = caseRows[0].canonical_lead_id;
    const admissionsClientId = caseRows[0].canonical_client_id;
    ensure(UUID_PATTERN.test(admissionsLeadId), "The student case lead id is invalid");
    ensure(UUID_PATTERN.test(admissionsClientId), "The student case client id is invalid");

    const rows = await sql<Array<Record<string, unknown>>>`
      with target_leads as (
        select unnest(array[
          ${input.salesLeadId}::uuid,
          ${admissionsLeadId}::uuid
        ]) as lead_id
      ),
      target_clients as (
        select unnest(array[
          ${input.salesClientId}::uuid,
          ${admissionsClientId}::uuid
        ]) as client_id
      ),
      target_authorizations as (
        select authz.id
        from platform.manual_send_authorizations as authz
        where authz.organization_id = ${input.organizationId}::uuid
          and authz.conversation_id = ${input.conversationId}::uuid
      ),
      target_work_items as (
        select item.id
        from platform_private.durable_work_items as item
        join target_authorizations as authz
          on authz.id = item.manual_send_authorization_id
        where item.organization_id = ${input.organizationId}::uuid
      ),
      target_attempts as (
        select attempt.id, attempt.command_receipt_id
        from platform_private.amocrm_command_attempts as attempt
        join target_leads as lead
          on lead.lead_id = attempt.workflow_lead_id
        where attempt.organization_id = ${input.organizationId}::uuid
      )
      select
        (
          select count(*)::int
          from platform_private.gemini_proposal_requests
          where organization_id = ${input.organizationId}::uuid
            and conversation_id = ${input.conversationId}::uuid
        ) as gemini_proposal_request_count,
        (
          select count(*)::int
          from platform_private.gemini_proposal_results
          where organization_id = ${input.organizationId}::uuid
            and proposal_request_id in (
              select id
              from platform_private.gemini_proposal_requests
              where organization_id = ${input.organizationId}::uuid
                and conversation_id = ${input.conversationId}::uuid
            )
        ) as gemini_proposal_result_count,
        (
          select count(*)::int
          from platform_private.gemini_proposal_request_receipts
          where organization_id = ${input.organizationId}::uuid
            and conversation_id = ${input.conversationId}::uuid
        ) as gemini_proposal_receipt_count,
        (
          select count(*)::int
          from platform.gemini_proposal_reviews
          where organization_id = ${input.organizationId}::uuid
            and conversation_id = ${input.conversationId}::uuid
        ) as gemini_review_count,
        (
          select count(*)::int
          from platform.manual_send_authorizations
          where organization_id = ${input.organizationId}::uuid
            and conversation_id = ${input.conversationId}::uuid
        ) as manual_send_authorization_count,
        (
          select count(*)::int
          from platform_private.manual_send_provider_bindings
          where organization_id = ${input.organizationId}::uuid
            and manual_send_authorization_id in (
              select id from target_authorizations
            )
        ) as manual_send_provider_binding_count,
        (
          select count(*)::int
          from platform_private.manual_send_waha_runtime_bindings
          where organization_id = ${input.organizationId}::uuid
        ) as manual_send_runtime_binding_count,
        (
          select count(*)::int
          from platform_private.manual_whatsapp_reconciliation_requests
          where organization_id = ${input.organizationId}::uuid
            and conversation_id = ${input.conversationId}::uuid
        ) as manual_whatsapp_reconciliation_request_count,
        (
          select count(*)::int
          from platform_private.manual_whatsapp_reconciliation_results
          where organization_id = ${input.organizationId}::uuid
            and conversation_id = ${input.conversationId}::uuid
        ) as manual_whatsapp_reconciliation_result_count,
        (
          select count(*)::int
          from platform_private.durable_work_items
          where id in (select id from target_work_items)
        ) as durable_work_item_count,
        (
          select count(*)::int
          from platform_private.durable_work_attempts
          where organization_id = ${input.organizationId}::uuid
            and work_item_id in (select id from target_work_items)
        ) as durable_work_attempt_count,
        (
          select count(*)::int
          from platform_private.durable_work_events
          where organization_id = ${input.organizationId}::uuid
            and work_item_id in (select id from target_work_items)
        ) as durable_work_event_count,
        (
          select count(*)::int
          from platform_private.waha_message_bindings as binding
          join platform.communication_messages as message
            on message.organization_id = binding.organization_id
            and message.id = binding.communication_message_id
          where binding.organization_id = ${input.organizationId}::uuid
            and binding.waha_session_name = 'crm_primary'
            and message.conversation_id = ${input.conversationId}::uuid
        ) as waha_message_binding_count,
        (
          select count(*)::int
          from platform_private.provider_webhook_events
          where organization_id = ${input.organizationId}::uuid
            and waha_session_name = 'crm_primary'
        ) as provider_webhook_event_count,
        (
          select count(*)::int
          from platform.communication_messages
          where organization_id = ${input.organizationId}::uuid
            and conversation_id = ${input.conversationId}::uuid
        ) as communication_message_count,
        (
          select count(*)::int
          from platform.waha_session_health
          where organization_id = ${input.organizationId}::uuid
            and waha_session_name = 'crm_primary'
        ) as session_health_count,
        (
          select count(*)::int
          from platform_private.waha_session_observations
          where organization_id = ${input.organizationId}::uuid
            and waha_session_name = 'crm_primary'
        ) as waha_observation_count,
        (
          select count(*)::int
          from platform_private.provider_reconciliation_events
          where organization_id = ${input.organizationId}::uuid
            and conversation_id = ${input.conversationId}::uuid
        ) as provider_reconciliation_event_count,
        (
          select count(*)::int
          from platform.ai_draft_events
          where organization_id = ${input.organizationId}::uuid
            and conversation_id = ${input.conversationId}::uuid
        ) as ai_draft_event_count,
        (
          select count(*)::int
          from platform.work_review_events
          where organization_id = ${input.organizationId}::uuid
            and work_review_case_id in (
              select id
              from platform.work_review_cases
              where organization_id = ${input.organizationId}::uuid
                and manual_send_authorization_id in (
                  select id from target_authorizations
                )
            )
        ) as work_review_event_count,
        (
          select count(*)::int
          from platform.audit_events
          where organization_id = ${input.organizationId}::uuid
        ) as audit_event_count,
        (
          select count(*)::int
          from platform_private.amocrm_command_attempts
          where id in (select id from target_attempts)
        ) as amocrm_attempt_count,
        (
          select count(*)::int
          from platform_private.amocrm_command_receipts
          where id in (
            select command_receipt_id
            from target_attempts
            where command_receipt_id is not null
          )
        ) as amocrm_receipt_count,
        (
          select count(*)::int
          from platform_private.amocrm_contact_bindings
          where organization_id = ${input.organizationId}::uuid
            and person_id in (select client_id from target_clients)
        ) as amocrm_contact_binding_count,
        (
          select count(*)::int
          from platform_private.amocrm_lead_bindings
          where organization_id = ${input.organizationId}::uuid
            and lead_id in (select lead_id from target_leads)
        ) as amocrm_lead_binding_count,
        (
          select count(*)::int
          from platform_private.amocrm_mapping_discovery_versions
          where organization_id = ${input.organizationId}::uuid
        ) as amocrm_discovery_count
    `;

    ensure(rows.length === 1, "The runtime inventory snapshot query returned an unexpected shape");
    const row = rows[0];
    return Object.freeze({
      admissionsClientId,
      admissionsLeadId,
      aiDraftEventCount: count(row.ai_draft_event_count, "ai_draft_event_count"),
      auditEventCount: count(row.audit_event_count, "audit_event_count"),
      amoCrmAttemptCount: count(row.amocrm_attempt_count, "amocrm_attempt_count"),
      amoCrmContactBindingCount: count(
        row.amocrm_contact_binding_count,
        "amocrm_contact_binding_count",
      ),
      amoCrmDiscoveryCount: count(
        row.amocrm_discovery_count,
        "amocrm_discovery_count",
      ),
      amoCrmLeadBindingCount: count(
        row.amocrm_lead_binding_count,
        "amocrm_lead_binding_count",
      ),
      amoCrmReceiptCount: count(row.amocrm_receipt_count, "amocrm_receipt_count"),
      communicationMessageCount: count(
        row.communication_message_count,
        "communication_message_count",
      ),
      durableWorkAttemptCount: count(
        row.durable_work_attempt_count,
        "durable_work_attempt_count",
      ),
      durableWorkEventCount: count(
        row.durable_work_event_count,
        "durable_work_event_count",
      ),
      durableWorkItemCount: count(
        row.durable_work_item_count,
        "durable_work_item_count",
      ),
      geminiProposalReceiptCount: count(
        row.gemini_proposal_receipt_count,
        "gemini_proposal_receipt_count",
      ),
      geminiProposalRequestCount: count(
        row.gemini_proposal_request_count,
        "gemini_proposal_request_count",
      ),
      geminiProposalResultCount: count(
        row.gemini_proposal_result_count,
        "gemini_proposal_result_count",
      ),
      geminiReviewCount: count(row.gemini_review_count, "gemini_review_count"),
      manualSendAuthorizationCount: count(
        row.manual_send_authorization_count,
        "manual_send_authorization_count",
      ),
      manualSendProviderBindingCount: count(
        row.manual_send_provider_binding_count,
        "manual_send_provider_binding_count",
      ),
      manualSendRuntimeBindingCount: count(
        row.manual_send_runtime_binding_count,
        "manual_send_runtime_binding_count",
      ),
      manualWhatsAppReconciliationRequestCount: count(
        row.manual_whatsapp_reconciliation_request_count,
        "manual_whatsapp_reconciliation_request_count",
      ),
      manualWhatsAppReconciliationResultCount: count(
        row.manual_whatsapp_reconciliation_result_count,
        "manual_whatsapp_reconciliation_result_count",
      ),
      providerReconciliationEventCount: count(
        row.provider_reconciliation_event_count,
        "provider_reconciliation_event_count",
      ),
      providerWebhookEventCount: count(
        row.provider_webhook_event_count,
        "provider_webhook_event_count",
      ),
      sessionHealthCount: count(row.session_health_count, "session_health_count"),
      wahaMessageBindingCount: count(
        row.waha_message_binding_count,
        "waha_message_binding_count",
      ),
      wahaObservationCount: count(
        row.waha_observation_count,
        "waha_observation_count",
      ),
      workReviewEventCount: count(
        row.work_review_event_count,
        "work_review_event_count",
      ),
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function captureSalesWhatsAppPage(
  page: Page,
  conversationId: string,
): Promise<PageProof> {
  await page.goto(`/v3/inbox?conversation=${conversationId}`);
  await expect(page).toHaveURL(
    new RegExp(`/v3/inbox\\?conversation=${conversationId}$`, "u"),
  );
  await expect(page.getByTestId("v3-inbox")).toBeVisible();
  await expect(page.getByTestId("v3-inbox-thread")).toBeVisible();
  await expect(
    page.getByTestId("v3-inbox-provider-workflow-controls"),
  ).toBeVisible();
  await expect(page.getByTestId("v3-inbox-send")).toBeVisible();

  const authorityRole = await activeRole(page);
  const sendDisabled = await page
    .getByTestId("v3-inbox-send")
    .isDisabled();
  const reconcileVisible = await page
    .getByTestId("v3-inbox-reconcile")
    .count()
    .then((value) => value > 0);

  return Object.freeze({
    route: "/v3/inbox?conversation=:conversationId",
    authorityRole,
    checks: Object.freeze({
      pageVisible: true,
      threadVisible: true,
      controlsVisible: true,
      sendVisible: true,
      reconcileRendered: reconcileVisible,
    }),
    statuses: Object.freeze({
      sendDisabled: sendDisabled ? "true" : "false",
    }),
  });
}

async function captureAdminAmoCrmPage(
  page: Page,
  route: string,
  scope: "sales" | "admissions",
  workspaceTestId: string,
): Promise<PageProof> {
  await page.goto(route);
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  await expect(page).toHaveURL(new RegExp(`${escapedRoute}$`, "u"));
  await expect(page.getByTestId(workspaceTestId)).toBeVisible();
  const panel = page.getByTestId("canonical-amocrm-command-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-scope", scope);
  const availability = page.getByTestId("canonical-amocrm-provider-availability");
  await expect(availability).toBeVisible();
  await expect(page.getByTestId("canonical-amocrm-sync-form")).toBeVisible();
  await expect(page.getByTestId("canonical-amocrm-note-text")).toBeVisible();
  await expect(page.getByTestId("canonical-amocrm-task-text")).toBeVisible();
  await expect(page.getByTestId("canonical-amocrm-task-deadline")).toBeVisible();
  await expect(page.getByTestId("canonical-amocrm-sync")).toBeVisible();

  const authorityRole = await activeRole(page);
  const availabilityStatus = await availability.getAttribute("data-status");
  const syncDisabled = await page.getByTestId("canonical-amocrm-sync").isDisabled();
  ensure(
    availabilityStatus === "ready" || availabilityStatus === "blocked",
    "The amoCRM provider availability state is invalid",
  );

  return Object.freeze({
    route:
      scope === "sales"
        ? "/v3/inbox?conversation=:conversationId"
        : "/clients/:studentCaseId",
    authorityRole,
    checks: Object.freeze({
      workspaceVisible: true,
      panelVisible: true,
      formVisible: true,
      syncVisible: true,
    }),
    statuses: Object.freeze({
      panelScope: scope,
      providerAvailability: availabilityStatus,
      syncDisabled: syncDisabled ? "true" : "false",
    }),
  });
}

test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe.configure({ mode: "serial" });

test("read-only browser inventory preserves exact provider and event counts", async ({
  page,
  baseURL,
}) => {
  if (!baseURL) {
    throw new Error("Platform provider runtime inventory is not configured");
  }
  ensure(
    baseURL === requiredLoopbackOrigin("PLAYWRIGHT_BASE_URL"),
    "Playwright base URL drifted from the loopback runtime contract",
  );

  const { gitSha, browserEvidencePath, databaseEvidencePath } = evidenceInputs();
  const organizationId = requiredUuid("EVO_PLATFORM_ORGANIZATION_ID");
  const salesLeadId = requiredUuid("EVO_SUPABASE_SALES_PROOF_LEAD_ID");
  const salesClientId = requiredUuid("EVO_SUPABASE_SALES_PROOF_CLIENT_ID");
  const studentCaseId = requiredUuid("EVO_CANONICAL_STUDENT_CASE_ID");
  const conversationId = requiredUuid("EVO_PLATFORM_COMMUNICATIONS_CONVERSATION_ID");
  const databaseUrl = requiredDatabaseUrl();

  const before = await readSnapshot(databaseUrl, {
    organizationId,
    salesLeadId,
    salesClientId,
    conversationId,
    studentCaseId,
  });

  await signInAs(page, "sales");
  const salesPage = await captureSalesWhatsAppPage(page, conversationId);

  await signInAs(page, "admin");
  const salesAmoCrmPage = await captureAdminAmoCrmPage(
    page,
    `/v3/inbox?conversation=${conversationId}`,
    "sales",
    "v3-inbox",
  );
  const admissionsAmoCrmPage = await captureAdminAmoCrmPage(
    page,
    `/clients/${studentCaseId}`,
    "admissions",
    "platform-student-case-workspace",
  );

  const after = await readSnapshot(databaseUrl, {
    organizationId,
    salesLeadId,
    salesClientId,
    conversationId,
    studentCaseId,
  });
  ensure(
    equalSnapshots(before, after),
    "Read-only browser inventory changed provider or event table counts",
  );

  await writePrivateJson(browserEvidencePath, {
    schemaVersion: 1,
    kind: "evo-v2-provider-browser-readonly",
    status: "passed",
    gitSha,
    completedAt: new Date().toISOString(),
    routes: Object.freeze({
      salesWhatsApp: salesPage,
      adminSales: salesAmoCrmPage,
      adminAdmissions: admissionsAmoCrmPage,
    }),
    boundaries: Object.freeze({
      liveGeminiCall: false,
      liveWhatsAppSend: false,
      liveAmoCrmWrite: false,
      clickedProviderMutationControl: false,
      v1RuntimeUsed: false,
    }),
  });

  await writePrivateJson(databaseEvidencePath, {
    schemaVersion: 1,
    kind: "evo-v2-provider-database-readonly",
    status: "passed",
    gitSha,
    completedAt: new Date().toISOString(),
    authority: "local_supabase_postgresql",
    syntheticTargetsVerified: true,
    countsBefore: sanitizedSnapshot(before),
    countsAfter: sanitizedSnapshot(after),
    exactEquality: true,
    boundaries: Object.freeze({
      liveGeminiCall: false,
      liveWhatsAppSend: false,
      liveAmoCrmWrite: false,
      selectedInboundReplay: false,
    }),
  });
});
