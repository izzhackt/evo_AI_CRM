#!/usr/bin/env node
// Bounded synthetic acceptance on the harness-owned local Auth/DB/application.
// Upstream synthetic data uses normal authenticated Sales→Admissions commands;
// every profile/export mutation uses the actual product UI, never a mocked route.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { DOMParser } from "@xmldom/xmldom";
import PizZip from "pizzip";
import postgres from "postgres";
import { parse } from "smol-toml";
import { PROFILE_FIELDS, PROFILE_GROUP_LABELS, PROFILE_REQUIRED_FIELD_KEYS } from "../../src/lib/student-profile-fields.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TEMPLATE_HASH = "2fdbacc33511b05f4d130a5882589afe3698bc1b7665a5f746aef6f4281a04c0";
const DRAFT_WARNING = "ЧЕРНОВИК — данные требуют проверки; не для подачи";
export const SYNTHETIC_REQUIRED_VALUES = Object.freeze({
  student_first_name: "Амина", student_last_name: "Пример", date_of_birth: "2008-04-12",
  nationality: "Kyrgyzstan", passport_number: "QA0001234",
  permanent_address: "Example Street 10, Bishkek", mobile_phone: "+1 202 555 0101",
  student_email: "student-profile@example.test", field_major: "Computer Science",
});
export const SYNTHETIC_EXPECTED_VALUES = Object.freeze({
  ...SYNTHETIC_REQUIRED_VALUES, mobile_phone: "+12025550101",
});
export class ProofError extends Error { constructor(code) { super(code); this.code = code; } }
export function requireProof(condition, code) { if (!condition) throw new ProofError(code); }
export function proofScope(kind = "student-profile-fields") {
  requireProof(["student-profile-fields", "document-recognition"].includes(kind), "PROOF_SCOPE_INVALID");
  return { kind, prefix: kind === "document-recognition" ? "EVO_D3" : "EVO_D2",
    marker: kind === "document-recognition" ? "DOCUMENT_RECOGNITION" : "STUDENT_PROFILE_FIELDS" };
}
function env(name) { const value = process.env[name]; requireProof(typeof value === "string" && value.length > 0, "ENVIRONMENT_MISSING"); return value; }
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 512 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  requireProof(!result.error && result.status === 0, "LOCAL_RUNTIME_INSPECTION_FAILED");
  return result.stdout.trim();
}
export function localOrigin(raw) {
  const url = new URL(raw);
  requireProof(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    && url.port && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash, "LOCAL_ORIGIN_INVALID");
  return url.origin;
}

export function proofPathClass(raw, appOrigin) {
  let url;
  try { url = new URL(raw); } catch { return "UNAVAILABLE"; }
  if (url.origin !== appOrigin) return "OTHER_ORIGIN";
  return ({ "/login": "LOGIN", "/v3/main": "MAIN", "/v3/profile": "PROFILE",
    "/platform-pending": "PENDING_ACCESS", "/auth/staff": "STAFF_CALLBACK" })[url.pathname] ?? "OTHER_APP_PATH";
}

export function proofExceptionCategory(error) {
  if (error instanceof ProofError) return "PROOF_ASSERTION";
  const categories = { TimeoutError: "TIMEOUT", AssertionError: "ASSERTION", TypeError: "TYPE_ERROR", Error: "ERROR" };
  return Object.hasOwn(categories, error?.name) ? categories[error.name] : "OTHER_ERROR";
}

// This is an allowlist, not a raw-log redactor. Unknown text is never retained.
const SERVER_ERROR_CLASSES = new Set(["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError",
  "PlatformStudentHandoffRepositoryError", "PlatformAdmissionsRepositoryError", "PlatformCaseOperationsRepositoryError",
  "PlatformStudentProfileRepositoryError", "PlatformStudentProfileFieldsError", "PlatformPrivateDocumentsRepositoryError",
  "PlatformContractRepositoryError", "PlatformFinanceControlRepositoryError", "HandoffResponseError"]);
const SERVER_STATIC_MESSAGES = new Set(["Platform Student handoff data is unavailable.",
  "Platform admissions data is unavailable.", "Platform case operations data is unavailable.",
  "Platform student profile data is unavailable.", "Student profile fields are unavailable",
  "Platform private-document data is unavailable.", "Platform contract workspace is unavailable.",
  "Platform finance control data is unavailable.", "Handoff response is unavailable.",
  "case_access_unavailable", "case_operations_response_invalid",
  "V3 profile document workspace does not match the requested case.",
  "V3 profile contract workspace does not match the requested case.",
  "V3 profile handoff context does not match the requested case.",
  "V3 profile handoff lead does not match the canonical case link."]);
const SERVER_FRAME_FILES = new Set(["src/lib/platform-student-handoff.ts", "src/lib/platform-admissions.ts",
  "src/lib/platform-case-operations.ts", "src/lib/platform-student-profile.ts", "src/lib/platform-student-profile-fields.ts",
  "src/lib/platform-private-documents.ts", "src/lib/platform-contract-workflow.ts", "src/lib/platform-finance-control.ts",
  "src/lib/platform-handoff-acknowledgement.ts", "src/lib/v3/profile-source.ts", "src/app/(v3)/v3/profile/page.tsx"]);
const SERVER_FRAME_FUNCTIONS = new Set(["failure", "fail", "invalidShape", "oneRow", "failClosed", "requireExactRecord",
  "getPlatformStudentCaseHandoffContext", "normalizePlatformStudentCaseHandoffContext", "normalizeStarterTaskItem",
  "getPlatformCaseFinanceControl", "getPlatformStudentProfile", "getPlatformStudentProfileFields",
  "getPlatformCaseDocumentWorkspace", "getPlatformCaseContractWorkspace", "listPlatformApplicationsForStudentCase",
  "getPlatformCaseVisa", "getHandoffAcknowledgement", "loadFullCase", "readCaseProfile", "readLeadProfile", "readProfileTarget"]);

export function summarizeStudentProfileAppLog(raw) {
  const errorClasses = new Set(); const staticMessages = new Set(); const repositoryFrames = new Map();
  for (const rawLine of String(raw).split("\n")) {
    if (rawLine.length > 4096) continue;
    const line = rawLine.trim();
    const header = /^(?:⨯\s*)?(?:Error \[([A-Za-z]+)\]|([A-Za-z]+)):\s*(.*)$/u.exec(line);
    if (header && SERVER_ERROR_CLASSES.has(header[1] ?? header[2])) {
      errorClasses.add(header[1] ?? header[2]);
      const staticMessage = header[3].replace(/ \{$/u, "");
      if (SERVER_STATIC_MESSAGES.has(staticMessage)) staticMessages.add(staticMessage);
    }
    const frame = /^at (?:async )?([A-Za-z][A-Za-z0-9]*) \((.*):(\d{1,7}):(\d{1,7})\)$/u.exec(line);
    if (!frame || !SERVER_FRAME_FUNCTIONS.has(frame[1]) || repositoryFrames.size >= 12) continue;
    const file = [...SERVER_FRAME_FILES].find(candidate => frame[2] === candidate || frame[2].endsWith(`/${candidate}`));
    if (!file) continue;
    const item = { function: frame[1], file, line: Number(frame[3]), column: Number(frame[4]) };
    repositoryFrames.set(JSON.stringify(item), item);
  }
  return { errorClasses: [...errorClasses].sort(), staticMessages: [...staticMessages].sort(), repositoryFrames: [...repositoryFrames.values()] };
}

export function writeOwnedAppLogDiagnostic(kind = "student-profile-fields") {
  const scope = proofScope(kind);
  try {
    const runtimeDir = realpathSync(env(`${scope.prefix}_RUNTIME_DIR`));
    const logPath = env(`${scope.prefix}_APP_LOG`); const evidencePath = env(`${scope.prefix}_EVIDENCE_DIR`);
    const evidenceDir = realpathSync(evidencePath);
    requireProof(/\/evo-database-foundation\.[A-Za-z0-9]+$/u.test(runtimeDir)
      && !lstatSync(logPath).isSymbolicLink() && lstatSync(logPath).isFile()
      && realpathSync(logPath) === resolve(runtimeDir, "app.log") && lstatSync(logPath).size <= 4 * 1024 * 1024,
    "APP_LOG_NOT_OWNED");
    requireProof(evidenceDir.startsWith(`${REPO}/output/${scope.kind}/`)
      && /^[a-f0-9]{40}\/foundation-[0-9]+-[0-9]+$/u.test(evidenceDir.slice(`${REPO}/output/${scope.kind}/`.length))
      && !lstatSync(evidencePath).isSymbolicLink(), "EVIDENCE_DIRECTORY_INVALID");
    const summary = summarizeStudentProfileAppLog(readFileSync(logPath, "utf8"));
    writeFileSync(resolve(evidenceDir, "server-failure.json"), JSON.stringify({
      schema: scope.kind === "document-recognition" ? "evo-document-recognition-server-failure/v1" : "evo-student-profile-server-failure/v1", synthetic: true, businessAcceptance: false,
      rawLogRetained: false, ...summary,
    }, null, 2), { mode: 0o600, flag: "wx" });
    process.stdout.write(`${scope.marker}_SERVER_DIAGNOSTIC:SAVED\n`);
  } catch {
    process.stderr.write(`${scope.marker}_SERVER_DIAGNOSTIC:UNAVAILABLE\n`);
    process.exitCode = 1;
  }
}

export async function writeFailureEvidence({ config, page, stage, error, http, browserErrors, browserWarningCount, counts }) {
  if (!config) return;
  const snapshot = { schema: config.proofKind === "document-recognition" ? "evo-document-recognition-browser-failure/v1" : "evo-student-profile-browser-failure/v1", synthetic: true, businessAcceptance: false,
    stage, exceptionCategory: proofExceptionCategory(error), pathClass: "UNAVAILABLE", http,
    consoleErrorCount: counts.console, pageErrorCount: counts.page, browserWarningCount,
    browserErrorCodes: [...browserErrors].sort(), shellPresent: null, actualAdminShell: null,
    passwordControlPresent: null, loginErrorPresent: null, profileStartControlPresent: null,
    frameworkOverlayPresent: null, screenshotSaved: false };
  if (page && !page.isClosed()) {
    try {
      snapshot.pathClass = proofPathClass(page.url(), config.appOrigin);
      const shell = page.getByTestId("v3-shell");
      snapshot.shellPresent = await shell.count() === 1;
      if (snapshot.shellPresent) snapshot.actualAdminShell = await shell.getAttribute("data-system-role") === "admin"
        && await shell.getAttribute("data-presentation-role") === "actual";
      snapshot.passwordControlPresent = await page.locator('input[type="password"]').count() > 0;
      snapshot.loginErrorPresent = await page.locator("#login-error").count() > 0;
      snapshot.profileStartControlPresent = await page.getByRole("button", { name: "Начать анкету", exact: true }).count() > 0;
      snapshot.frameworkOverlayPresent = await page.locator("[data-nextjs-dialog-overlay], [data-nextjs-error-dialog]").count() > 0;
      // Never capture the login screen or a framework error containing raw diagnostics.
      // The only eligible pages belong to this verified isolated synthetic fixture.
      if (snapshot.actualAdminShell && ["MAIN", "PROFILE"].includes(snapshot.pathClass)
        && !snapshot.passwordControlPresent && !snapshot.frameworkOverlayPresent) {
        await page.screenshot({ path: resolve(config.evidenceDir, "failure.png"), fullPage: false,
          timeout: 5_000, mask: [page.locator("input, textarea")] });
        snapshot.screenshotSaved = true;
      }
    } catch { /* A failed page inspection cannot replace the original stage. */ }
  }
  writeFileSync(resolve(config.evidenceDir, "failure.json"), JSON.stringify(snapshot, null, 2), { mode: 0o600, flag: "wx" });
}

export function configuration(kind = "student-profile-fields") {
  const scope = proofScope(kind);
  const appOrigin = localOrigin(env(`${scope.prefix}_APP_ORIGIN`));
  const apiOrigin = localOrigin(env("NEXT_PUBLIC_SUPABASE_URL"));
  const workdir = realpathSync(env(`${scope.prefix}_SUPABASE_WORKDIR`));
  requireProof(/\/evo-database-foundation\.[^/]+\/local-supabase$/u.test(workdir), "LOCAL_WORKDIR_INVALID");
  const config = parse(readFileSync(resolve(workdir, "supabase/config.toml"), "utf8"));
  const projectId = config.project_id;
  requireProof(typeof projectId === "string" && /^evo-local-[a-f0-9]{16}$/u.test(projectId), "LOCAL_PROJECT_INVALID");
  const dbUrl = new URL(env("SUPABASE_DB_URL"));
  requireProof(dbUrl.protocol === "postgresql:" && ["127.0.0.1", "localhost"].includes(dbUrl.hostname)
    && Number(dbUrl.port) === config.db.port && dbUrl.pathname === "/postgres" && !dbUrl.search && !dbUrl.hash
    && Number(new URL(apiOrigin).port) === config.api.port && config.auth.site_url === appOrigin, "LOCAL_ENDPOINT_MISMATCH");
  requireProof(!process.env.DOCKER_HOST || process.env.DOCKER_HOST.startsWith("unix://"), "LOCAL_RUNTIME_NOT_OWNED");
  const context = run("docker", ["context", "show"]);
  requireProof(run("docker", ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"] ).startsWith("unix://"), "LOCAL_RUNTIME_NOT_OWNED");
  if (process.platform === "darwin") requireProof(context === "orbstack" && run("orb", ["status"]) === "Running", "ORBSTACK_REQUIRED");
  for (const service of ["db", "kong"]) {
    const container = JSON.parse(run("docker", ["inspect", `supabase_${service}_${projectId}`]))[0];
    requireProof(container.State.Running && container.Config.Labels["com.supabase.cli.project"] === projectId
      && container.Config.Labels["com.supabase.cli.workdir"] === workdir, "LOCAL_RUNTIME_NOT_OWNED");
    const port = service === "db" ? "5432/tcp" : "8000/tcp";
    const bindings = container.NetworkSettings.Ports[port] ?? [];
    requireProof(bindings.some(binding => ["127.0.0.1", "0.0.0.0", "::"].includes(binding.HostIp)
      && Number(binding.HostPort) === (service === "db" ? config.db.port : config.api.port)), "LOCAL_ENDPOINT_MISMATCH");
  }
  const evidenceDir = realpathSync(env(`${scope.prefix}_EVIDENCE_DIR`));
  const relative = evidenceDir.slice(`${REPO}/output/${scope.kind}/`.length);
  requireProof(evidenceDir.startsWith(`${REPO}/output/${scope.kind}/`) && /^[a-f0-9]{40}\/foundation-[0-9]+-[0-9]+$/u.test(relative)
    && !lstatSync(env(`${scope.prefix}_EVIDENCE_DIR`)).isSymbolicLink() && readdirSync(evidenceDir).length === 0, "EVIDENCE_DIRECTORY_INVALID");
  const organizationId = env(`${scope.prefix}_ORGANIZATION_ID`);
  requireProof(UUID.test(organizationId), "ORGANIZATION_INVALID");
  const email = env("EVO_STAFF_AUTH_ADMIN_EMAIL");
  requireProof(/^admin-[a-z0-9-]+@evo\.local\.test$/u.test(email), "SYNTHETIC_ADMIN_REQUIRED");
  return { appOrigin, apiOrigin, dbUrl: dbUrl.toString(), evidenceDir, organizationId, email, proofKind: scope.kind,
    password: env("EVO_STAFF_AUTH_ADMIN_PASSWORD"), publishableKey: env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), projectId };
}

export async function seedCase(sql, config, client, onStage) {
  const [actor] = await sql`
    SELECT member.id AS membership_id, profile.auth_user_id
    FROM platform.organization_memberships AS member
    JOIN platform.profiles AS profile ON profile.id = member.profile_id
    JOIN auth.users AS auth_user ON auth_user.id = profile.auth_user_id
    WHERE member.organization_id = ${config.organizationId}::uuid
      AND lower(auth_user.email) = ${config.email} AND member.is_system_admin
      AND member.status = 'active' AND profile.status = 'active'
  `;
  requireProof(actor && UUID.test(actor.membership_id), "BOOTSTRAPPED_ADMIN_REQUIRED");
  const login = async () => {
    const session = await client.auth.signInWithPassword({ email: config.email, password: config.password });
    requireProof(!session.error && session.data.user?.id === actor.auth_user_id, "REAL_ADMIN_AUTH_FAILED");
  };
  await login();
  const rpc = async (name, args) => {
    const response = await client.schema("platform").rpc(name, args);
    requireProof(!response.error, "CANONICAL_FIXTURE_RPC_FAILED"); return response.data;
  };
  const command = async (name, args) => {
    const requestId = randomUUID(); const result = await rpc(name, { ...args, p_request_id: requestId });
    requireProof(result && (result.request_id === undefined || result.request_id === requestId), "CANONICAL_FIXTURE_RECEIPT_INVALID");
    return result;
  };
  const recognition = config.proofKind === "document-recognition";
  const reason = recognition ? "Fictional isolated D3 pre-dispatch acceptance; no customer agreement, funds or provider call"
    : "Fictional isolated D2 profile acceptance; no customer agreement or funds";
  const day = new Date().toISOString().slice(0, 10); const changedPermissions = [];
  const personalPermission = async (key, granted) => {
    const receipt = await command("change_membership_permission", { p_organization_id: config.organizationId,
      p_membership_id: actor.membership_id, p_permission_key: key, p_granted: granted, p_reason: reason });
    requireProof(receipt.organization_id === config.organizationId && receipt.membership_id === actor.membership_id
      && receipt.permission_key === key && receipt.granted === granted, "FIXTURE_PERSONAL_GRANT_INVALID");
    await login();
  };
  try {
    onStage("FIXTURE_PERSONAL_PERMISSIONS");
    const directory = await rpc("staff_workspace_directory", { p_organization_id: config.organizationId });
    const members = directory?.members?.filter(member => member.membership_id === actor.membership_id);
    requireProof(members?.length === 1, "FIXTURE_ADMIN_DIRECTORY_INVALID");
    for (const [key, field] of [["contract.evidence.confirm", "contract_confirmation_granted"],
      ["finance.first.payment.confirm", "first_payment_confirmation_granted"]]) {
      requireProof(typeof members[0][field] === "boolean", "FIXTURE_PERSONAL_STATE_INVALID");
      if (!members[0][field]) { changedPermissions.push(key); await personalPermission(key, true); }
    }
    onStage("FIXTURE_LEAD");
    const lead = await command("create_manual_sales_lead", { p_organization_id: config.organizationId,
      p_display_name: recognition ? "D3 Synthetic Browser Student" : "D2 Synthetic Browser Student", p_phone: null,
      p_email: `${recognition ? "d3" : "d2"}-${randomUUID()}@evo.local.test`,
      p_source_key: "other", p_owner_membership_id: actor.membership_id, p_interest_direction: "CN",
      p_next_action: reason, p_next_action_due_date: day });
    requireProof(lead.status === "saved" && UUID.test(lead.lead_id), "FIXTURE_LEAD_INVALID");
    const leadId = lead.lead_id;
    const rows = await rpc("staff_sales_lead_detail", { p_lead_id: leadId });
    requireProof(rows?.length === 1 && rows[0].lead_id === leadId && rows[0].stage_key === "new"
      && rows[0].current_owner_membership_id === actor.membership_id && Number.isSafeInteger(rows[0].workflow_version), "FIXTURE_LEAD_READ_INVALID");
    onStage("FIXTURE_QUALIFY");
    const qualified = await command("mutate_sales_lead_workflow", { p_lead_id: leadId,
      p_expected_workflow_version: rows[0].workflow_version, p_stage_key: "qualified", p_owner_membership_id: actor.membership_id,
      p_next_action_text: reason, p_next_action_due_date: day, p_clear_next_action: false, p_reason: reason });
    requireProof(qualified.lead_id === leadId && qualified.stage_key === "qualified"
      && qualified.workflow_version === rows[0].workflow_version + 1, "FIXTURE_QUALIFICATION_INVALID");
    const readGate = async () => {
      const gates = await rpc("staff_lead_admissions_gate", { p_lead_id: leadId });
      requireProof(gates?.length === 1 && gates[0].lead_id === leadId && gates[0].organization_id === config.organizationId
        && Number.isSafeInteger(gates[0].gate_version), "FIXTURE_GATE_INVALID"); return gates[0];
    };
    onStage("FIXTURE_CONTRACT");
    const initialGate = await readGate();
    await command("mutate_lead_admissions_gate", { p_lead_id: leadId, p_expected_gate_version: initialGate.gate_version,
      p_action: "confirm_contract", p_amount: 1, p_currency: "USD", p_due_date: day, p_received_date: null,
      p_evidence_reference: "Fictional local contract: no customer agreement", p_reason: reason });
    const contractGate = await readGate();
    requireProof(contractGate.contract_confirmed && contractGate.gate_version === initialGate.gate_version + 1, "FIXTURE_CONTRACT_INVALID");
    onStage("FIXTURE_PAYMENT");
    await command("mutate_lead_admissions_gate", { p_lead_id: leadId, p_expected_gate_version: contractGate.gate_version,
      p_action: "confirm_first_payment", p_amount: null, p_currency: null, p_due_date: null, p_received_date: day,
      p_evidence_reference: "Fictional local payment: no funds transferred", p_reason: reason });
    const gate = await readGate();
    requireProof(gate.gate_version === contractGate.gate_version + 1 && gate.gate_state === "satisfied"
      && gate.normal_handoff_allowed === true, "FIXTURE_PAYMENT_INVALID");
    onStage("FIXTURE_HANDOFF");
    const handoff = await command("handoff_lead_to_admissions", { p_lead_id: leadId,
      p_expected_gate_version: gate.gate_version, p_admissions_owner_membership_id: actor.membership_id,
      p_handoff_mode: "normal", p_reason: reason });
    requireProof(UUID.test(handoff.case_id) && handoff.case_state === "active"
      && handoff.admissions_owner_membership_id === actor.membership_id, "FIXTURE_HANDOFF_INVALID");
    const handoffRows = await rpc("staff_student_case_handoff_context", { p_student_case_id: handoff.case_id });
    requireProof(handoffRows?.length === 1 && handoffRows[0].student_case_id === handoff.case_id
      && handoffRows[0].organization_id === config.organizationId && handoffRows[0].lead_id === leadId
      && handoffRows[0].starter_tasks?.length === 3, "FIXTURE_HANDOFF_READ_INVALID");
    return { caseId: handoff.case_id, actor };
  } finally {
    // Personal evidence grants belong only to this disposable Admin; restore them
    // before the D2 UI work. No role catalogue, employee, or provider is changed.
    for (const key of changedPermissions.reverse()) await personalPermission(key, false);
  }
}

export function verifyDocx(bytes, template, { draft, expectedValues }) {
  requireProof(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 5 * 1024 * 1024, "DOCX_SIZE_INVALID");
  const hash = value => createHash("sha256").update(value).digest("hex");
  requireProof(hash(template) === TEMPLATE_HASH, "REFERENCE_TEMPLATE_CHANGED");
  const original = new PizZip(template); const actual = new PizZip(bytes);
  const keys = Object.keys(original.files).sort();
  requireProof(JSON.stringify(Object.keys(actual.files).sort()) === JSON.stringify(keys), "DOCX_PACKAGE_CHANGED");
  for (const key of keys) if (key !== "word/document.xml") requireProof(actual.files[key].asNodeBuffer().equals(original.files[key].asNodeBuffer()), "DOCX_PRESERVE_PART_CHANGED");
  const doc = new DOMParser().parseFromString(actual.file("word/document.xml").asText(), "application/xml");
  const text = Array.from(doc.getElementsByTagName("w:t"), node => node.textContent ?? "").join("\n");
  requireProof(doc.getElementsByTagName("w:tbl").length === 19 && doc.getElementsByTagName("w:sectPr").length === 1, "DOCX_STRUCTURE_CHANGED");
  requireProof(text.includes(DRAFT_WARNING) === draft, "DOCX_DRAFT_MARKER_INVALID");
  for (const value of Object.values(expectedValues)) requireProof(text.includes(value), "DOCX_CONFIRMED_VALUE_MISSING");
  return { sha256: hash(bytes), bytes: bytes.length, draft, tableCount: 19 };
}

async function main() {
  let stage = "CONFIGURATION"; let browser; let sql; let client; let config; let diagnosticPage;
  const browserErrors = new Set(); let browserWarningCount = 0;
  const counts = { console: 0, page: 0 }; const http = { LOGIN: null, MAIN: null, PROFILE: null };
  try {
    config = configuration();
    requireProof(PROFILE_REQUIRED_FIELD_KEYS.length === 9 && PROFILE_REQUIRED_FIELD_KEYS.every(key => Object.hasOwn(SYNTHETIC_REQUIRED_VALUES, key)), "REQUIRED_FIELDS_CHANGED");
    sql = postgres(config.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} });
    stage = "FIXTURE";
    client = createClient(config.apiOrigin, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { caseId } = await seedCase(sql, config, client, nextStage => { stage = nextStage; });
    stage = "PROFILE_BASELINE";
    const snapshot = async () => {
      const result = await client.schema("platform").rpc("staff_student_profile_fields", { p_student_case_id: caseId });
      requireProof(!result.error && result.data?.student_case_id === caseId, "PROFILE_SNAPSHOT_FAILED");
      return result.data;
    };
    const field = async key => (await snapshot()).fields.find(item => item.field_key === key);
    requireProof((await snapshot()).profile === null, "PROFILE_NOT_ABSENT");
    const [initialCase] = await sql`SELECT applied_country_requirement_version_id FROM platform.student_cases WHERE id = ${caseId}::uuid`;
    requireProof(initialCase.applied_country_requirement_version_id === null, "CHECKLIST_NOT_ABSENT");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    context.on("page", page => {
      page.on("pageerror", () => { browserErrors.add("PAGE_ERROR"); counts.page += 1; });
      page.on("console", message => {
        if (message.type() === "error") { browserErrors.add("CONSOLE_ERROR"); counts.console += 1; }
        if (message.type() === "warning") browserWarningCount += 1;
      });
    });
    context.on("response", response => {
      const key = proofPathClass(response.url(), config.appOrigin);
      if (Object.hasOwn(http, key)) http[key] = response.status();
    });
    // No fulfilled/mocked traffic. Third-party origins are simply not exercised.
    await context.route("**/*", route => [config.appOrigin, config.apiOrigin].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const page = await context.newPage(); diagnosticPage = page; page.setDefaultTimeout(30_000);
    stage = "LOGIN_DOCUMENT";
    await page.goto(`${config.appOrigin}/login`, { waitUntil: "domcontentloaded" });
    stage = "LOGIN_EMAIL";
    await page.locator("#staff-email").fill(config.email);
    stage = "LOGIN_PASSWORD";
    await page.locator("#staff-password").fill(config.password);
    stage = "LOGIN_SUBMIT";
    await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    stage = "AUTHENTICATED_SHELL";
    await expect(page.getByTestId("v3-shell")).toHaveAttribute("data-system-role", "admin");
    stage = "ACTUAL_ROLE";
    await expect(page.getByTestId("v3-shell")).toHaveAttribute("data-presentation-role", "actual");
    const profileUrl = `${config.appOrigin}/v3/profile?case=${caseId}&tab=anketa`;
    stage = "PROFILE_NAVIGATION";
    await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
    stage = "PROFILE_URL";
    await expect(page).toHaveURL(profileUrl);
    stage = "PROFILE_TITLE";
    requireProof((await page.title()).includes("EVO Admissions CRM"), "PAGE_TITLE_INVALID");
    stage = "PROFILE_START_CONTROL";
    await page.getByRole("button", { name: "Начать анкету", exact: true }).waitFor();
    stage = "PROFILE_READ_ONLY";
    requireProof((await snapshot()).profile === null, "PROFILE_READ_CREATED_STATE");
    stage = "START_PROFILE";
    await page.getByRole("button", { name: "Начать анкету", exact: true }).click();
    await expect.poll(async () => (await snapshot()).profile?.revision).toBe(1);
    await expect(page.getByRole("button", { name: "Начать анкету", exact: true })).toHaveCount(0);
    const template = readFileSync(resolve(REPO, "assets/templates/student-profile.docx"));
    const download = async (mode, values) => {
      const before = await snapshot();
      const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: mode === "draft" ? "Скачать черновик" : "Скачать финальную анкету", exact: true }).click()]);
      requireProof(await file.failure() === null, "BROWSER_DOWNLOAD_FAILED");
      const bytes = readFileSync(await file.path());
      const proof = verifyDocx(bytes, template, { draft: mode === "draft", expectedValues: values });
      await expect.poll(async () => {
        const [attempt] = await sql`SELECT status, output_sha256, output_bytes, profile_revision, template_sha256
          FROM platform_private.student_profile_export_attempts WHERE organization_id = ${config.organizationId}::uuid
            AND student_case_id = ${caseId}::uuid AND mode = ${mode} ORDER BY attempted_at DESC LIMIT 1`;
        return Boolean(attempt?.status === "generated" && attempt.output_sha256 === proof.sha256
          && attempt.output_bytes === proof.bytes && Number(attempt.profile_revision) === before.profile.revision
          && attempt.template_sha256 === TEMPLATE_HASH);
      }).toBe(true);
      writeFileSync(resolve(config.evidenceDir, `${mode}.docx`), bytes, { mode: 0o600, flag: "wx" });
      return proof;
    };
    stage = "DRAFT_DOWNLOAD";
    await expect(page.getByRole("button", { name: "Скачать финальную анкету", exact: true })).toBeDisabled();
    const draft = await download("draft", {});
    const openField = async (target, key) => {
      const definition = PROFILE_FIELDS.find(item => item.key === key);
      const group = target.getByRole("button", { name: new RegExp(`^${PROFILE_GROUP_LABELS[definition.group]} ·`) });
      if (await group.getAttribute("aria-expanded") !== "true") await group.click();
      const toggle = target.locator(`button[aria-controls="profile-field-${key}-editor"]`);
      if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
      return target.locator(`#profile-field-${key}-editor`);
    };
    const confirm = async (target, key, value, expectedValue = value) => {
      const editor = await openField(target, key);
      await editor.locator(`#profile-field-${key}`).fill(value);
      await editor.getByRole("button", { name: "Подтвердить значение", exact: true }).click();
      await expect.poll(async () => { const current = await field(key); return current?.review_state === "confirmed" && current.value === expectedValue; }).toBe(true);
      await expect(editor.getByRole("button", { name: "Использовать актуальное", exact: true })).toHaveCount(0);
    };
    stage = "CONFIRM_REQUIRED_AND_EXTENDED";
    for (const [key, value] of Object.entries(SYNTHETIC_REQUIRED_VALUES)) await confirm(page, key, value, SYNTHETIC_EXPECTED_VALUES[key]);
    await confirm(page, "education_1_school_name", "Example Secondary School");
    stage = "CONFIRMED_EMPTY";
    const emptyEditor = await openField(page, "mother_employer");
    await emptyEditor.getByRole("button", { name: "Оставить поле пустым", exact: true }).click();
    await emptyEditor.getByRole("button", { name: "Подтвердить пустое значение", exact: true }).click();
    await expect.poll(async () => { const current = await field("mother_employer"); return current?.review_state === "confirmed" && current.value === null && current.reviewed_at !== null; }).toBe(true);
    stage = "STALE_SECOND_EDITOR";
    const second = await context.newPage(); diagnosticPage = second; second.setDefaultTimeout(30_000);
    await second.goto(profileUrl, { waitUntil: "domcontentloaded" });
    const secondEditor = await openField(second, "student_last_name");
    const unsaved = "Локальная правка";
    await secondEditor.locator("#profile-field-student_last_name").fill(unsaved);
    await confirm(page, "student_last_name", "Актуальная фамилия");
    const confirmedByFirst = await snapshot();
    await secondEditor.getByRole("button", { name: "Подтвердить значение", exact: true }).click();
    await expect(second.getByRole("button", { name: "Обновить анкету", exact: true })).toBeVisible();
    await expect(secondEditor.locator("#profile-field-student_last_name")).toHaveValue(unsaved);
    requireProof(JSON.stringify(await snapshot()) === JSON.stringify(confirmedByFirst), "STALE_WRITE_CHANGED_DATABASE");
    await second.getByRole("button", { name: "Обновить анкету", exact: true }).click();
    await expect(secondEditor.getByRole("button", { name: "Сверено, оставить мои правки", exact: true })).toBeVisible();
    await expect(secondEditor.locator("#profile-field-student_last_name")).toHaveValue(unsaved);
    await secondEditor.getByRole("button", { name: "Сверено, оставить мои правки", exact: true }).click();
    await secondEditor.getByRole("button", { name: "Подтвердить значение", exact: true }).click();
    await expect.poll(async () => (await field("student_last_name"))?.value).toBe(unsaved);
    requireProof((await field("student_first_name")).value === SYNTHETIC_REQUIRED_VALUES.student_first_name
      && (await field("student_first_name")).review_state === "confirmed", "OTHER_CONFIRMATION_LOST");
    stage = "REFRESH_AND_FINAL_DOWNLOAD";
    diagnosticPage = page;
    await page.reload({ waitUntil: "domcontentloaded" });
    const refreshedEditor = await openField(page, "student_last_name");
    await expect(refreshedEditor.locator("#profile-field-student_last_name")).toHaveValue(unsaved);
    requireProof((await field("mother_employer")).review_state === "confirmed" && (await field("mother_employer")).value === null, "CONFIRMED_EMPTY_NOT_PERSISTED");
    const finalValues = { ...SYNTHETIC_EXPECTED_VALUES, student_last_name: unsaved, education_1_school_name: "Example Secondary School" };
    await expect(page.getByRole("button", { name: "Скачать финальную анкету", exact: true })).toBeEnabled();
    const final = await download("final", finalValues);
    await expect(page.locator("[data-nextjs-dialog-overlay], [data-nextjs-error-dialog]")).toHaveCount(0);
    requireProof(browserErrors.size === 0, "BROWSER_RUNTIME_ERRORS");
    await page.screenshot({ path: resolve(config.evidenceDir, "profile-ready.png"), fullPage: true });
    const [databaseState] = await sql`SELECT count(profile.id)::integer AS profiles, max(profile.revision)::integer AS revision
      FROM platform.student_profiles AS profile WHERE profile.student_case_id = ${caseId}::uuid`;
    requireProof(databaseState.profiles === 1 && databaseState.revision === 14, "PROFILE_IDENTITY_OR_REVISION_INVALID");
    writeFileSync(resolve(config.evidenceDir, "acceptance.json"), JSON.stringify({ schema: "evo-student-profile-browser-proof/v1",
      synthetic: true, businessAcceptance: false, localProjectId: config.projectId, realAdminAuth: true,
      absentProfileWithoutChecklist: true, requiredFieldsConfirmed: 9, extendedFieldConfirmed: true,
      confirmedEmptyPersisted: true, staleEditDraftPreserved: true, otherConfirmationPreserved: true,
      pageIdentityVerified: true, frameworkOverlayAbsent: true, browserErrorCount: 0, browserWarningCount,
      profiles: databaseState.profiles, revision: databaseState.revision, draft, final }, null, 2), { mode: 0o600, flag: "wx" });
    process.stdout.write("STUDENT_PROFILE_FIELDS_BROWSER_VERIFIED\n");
  } catch (error) {
    try { await writeFailureEvidence({ config, page: diagnosticPage, stage, error, http, browserErrors, browserWarningCount, counts }); }
    catch { process.stderr.write("STUDENT_PROFILE_FIELDS_BROWSER_DIAGNOSTIC:UNAVAILABLE\n"); }
    // Never print raw Playwright/Postgres/provider errors, DOM, URLs or credentials.
    process.stderr.write(`STUDENT_PROFILE_FIELDS_BROWSER_ERROR:${error instanceof ProofError ? error.code : stage}\n`);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    client?.auth.stopAutoRefresh();
    await sql?.end({ timeout: 5 }).catch(() => {});
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--summarize-owned-app-log") writeOwnedAppLogDiagnostic();
  else await main();
}
