import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { parseStaffAccessSnapshot } from "../../src/lib/supabase/platform-authority.ts";
import { parseStaffRoleWorkspace, parseStaffRoleCommandResult, parseStaffRoleImpact,
  parseStaffRoleArchiveImpact, parseStaffRoleAssignmentInputs } from "../../src/lib/v3/staff-roles-contract.ts";
import { parseStaffAuthPreparation,
  parseStaffInviteAssignmentInputs } from "../../src/lib/v3/staff-workspace-contract.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMISSION = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;
const SCENARIOS = ["sales", "admissions"];
const REASON = "Isolated local scoped staff invitation verification";

export class ScopedStaffProvisioningError extends Error {
  constructor(code, requestId) {
    super(code);
    this.code = code;
    if (requestId) this.requestId = requestId;
  }
}
function requireValue(condition, code) { if (!condition) throw new ScopedStaffProvisioningError(code); }
function uuid(value) { requireValue(typeof value === "string" && UUID.test(value), "LOCAL_STAFF_ID_INVALID"); return value; }
function sameSet(left, right) { return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort()); }
function pair(row) { return JSON.stringify([row.roleId, row.scope.kind, row.scope.key, row.scope.resourceKind]); }
function strictParse(parser, code = "LOCAL_STAFF_CONTRACT_INVALID") {
  try { return parser(); } catch { throw new ScopedStaffProvisioningError(code); }
}

export function localStaffOrigin(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new ScopedStaffProvisioningError("LOCAL_STAFF_ORIGIN_INVALID"); }
  requireValue(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
    && url.pathname === "/" && !url.search && !url.hash, "LOCAL_STAFF_ORIGIN_NOT_LOOPBACK");
  return url.origin;
}
function localClient(client, apiUrl) {
  requireValue(client && localStaffOrigin(client.supabaseUrl) === apiUrl, "LOCAL_STAFF_CLIENT_ORIGIN_MISMATCH");
}
function localIdentity(identity, passwordRequired = false) {
  requireValue(identity && typeof identity.email === "string" && /^[^\s@]+@[^\s@]+\.local\.test$/u.test(identity.email)
    && identity.email === identity.email.toLowerCase() && identity.email.length <= 320, "LOCAL_STAFF_SYNTHETIC_EMAIL_REQUIRED");
  if (passwordRequired) requireValue(typeof identity.password === "string" && identity.password.length >= 12
    && identity.password.length <= 128 && !/[\r\n]/u.test(identity.password), "LOCAL_STAFF_PASSWORD_INVALID");
  else requireValue(typeof identity.displayName === "string" && identity.displayName.trim().length > 0
    && identity.displayName.length <= 160 && !/[\x00-\x1f\x7f]/u.test(identity.displayName), "LOCAL_STAFF_DISPLAY_NAME_INVALID");
}
async function rpc(client, name, args, requestId) {
  let result;
  try { result = await client.schema("platform").rpc(name, args); }
  catch { throw new ScopedStaffProvisioningError(requestId ? "LOCAL_STAFF_COMMAND_OUTCOME_UNKNOWN" : "LOCAL_STAFF_READ_FAILED", requestId); }
  if (result.error) throw new ScopedStaffProvisioningError(requestId ? "LOCAL_STAFF_COMMAND_NOT_CONFIRMED" : "LOCAL_STAFF_READ_FAILED", requestId);
  return result.data;
}
async function staffSnapshot(client) {
  const user = await client.auth.getUser();
  requireValue(!user.error && user.data?.user, "LOCAL_STAFF_AUTH_USER_UNVERIFIED");
  const snapshot = parseStaffAccessSnapshot(await rpc(client, "staff_access_snapshot", {}), user.data.user.id, user.data.user.email);
  requireValue(snapshot, "LOCAL_STAFF_SNAPSHOT_INVALID");
  return snapshot;
}
async function requireAdmin(client, organizationId) {
  const actor = await staffSnapshot(client);
  requireValue(actor.organizationId === organizationId && actor.systemRole === "admin", "LOCAL_STAFF_ADMIN_REQUIRED");
}

/** Exact migration155 preservation split, never a new product role policy. */
export function buildScopedStaffBaselines({ permissions, baseline }) {
  const catalogue = new Map(permissions.map((entry) => [entry.key, entry]));
  requireValue(catalogue.size === permissions.length, "LOCAL_STAFF_CATALOGUE_INVALID");
  const result = [];
  for (const scenario of SCENARIOS) {
    requireValue(Array.isArray(baseline[scenario]) && baseline[scenario].length > 0
      && baseline[scenario].every((key) => typeof key === "string" && PERMISSION.test(key)), "LOCAL_STAFF_BASELINE_INVALID");
    const old = new Set(baseline[scenario]);
    for (const kind of ["own", "organization"]) {
      const keys = new Set([...old].filter((key) => {
        const definition = catalogue.get(key);
        return definition && !definition.sensitive && !definition.systemOnly
          && (kind === "organization" ? sameSet(definition.allowedScopes, ["organization"]) : definition.allowedScopes.includes("own"))
          && !(scenario === "sales" && key === "task.manage");
      }));
      const add = (...values) => values.forEach((key) => keys.add(key));
      if (kind === "organization") {
        add("staff.task.create", "staff.assistant.use", "team.chat.general", `team.chat.${scenario}`);
        if (old.has("communication.manual.send")) add("reply.snippet.all", "reply.snippet.manage", `reply.snippet.${scenario}`);
        if (scenario === "admissions" && old.has("document.download")) add("company.file.read", "company.file.download");
        if (scenario === "admissions" && old.has("document.upload")) add("company.file.upload", "company.file.manage");
      } else {
        add("staff.task.read", "staff.task.edit", "staff.task.complete");
        if (old.has("task.manage")) add("task.create");
        if (old.has("workflow.contract.read")) add("case.workflow.read");
        if (old.has("lead.read") && (scenario === "sales" || old.has("case.read.full"))) add("amocrm.command.manage");
        if (scenario === "admissions" && old.has("case.read.full") && old.has("finance.read.summary")) add("finance.stop.create");
        if (scenario === "sales") add("sales.register.read", "sales.register.manage");
      }
      for (const key of keys) {
        const definition = catalogue.get(key);
        requireValue(definition && !definition.sensitive && !definition.systemOnly && definition.allowedScopes.includes(kind), "LOCAL_STAFF_BASELINE_SCOPE_DRIFT");
      }
      result.push({ scenario, kind, permissionKeys: [...keys].sort() });
    }
  }
  return result;
}

async function readBaselines(adminClient, organizationId) {
  const raw = await rpc(adminClient, "staff_role_workspace", { p_organization_id: organizationId });
  const catalogue = strictParse(() => parseStaffRoleWorkspace(raw), "LOCAL_STAFF_CATALOGUE_INVALID");
  const versions = await adminClient.schema("platform").from("role_bundle_versions")
    .select("id,role,version").eq("status", "published").in("role", ["sales", "curator"]).order("version", { ascending: false });
  requireValue(!versions.error && Array.isArray(versions.data), "LOCAL_STAFF_BASELINE_READ_FAILED");
  const selected = SCENARIOS.map((scenario) => {
    const role = scenario === "sales" ? "sales" : "curator";
    const rows = versions.data.filter((row) => row.role === role);
    requireValue(rows.length > 0 && rows.every((row) => UUID.test(row.id) && Number.isSafeInteger(row.version) && row.version > 0), "LOCAL_STAFF_BASELINE_MISSING");
    requireValue(rows.filter((row) => row.version === rows[0].version).length === 1, "LOCAL_STAFF_BASELINE_AMBIGUOUS");
    return { scenario, id: rows[0].id };
  });
  const grants = await adminClient.schema("platform").from("role_bundle_permissions")
    .select("bundle_id,permission_key").in("bundle_id", selected.map((row) => row.id));
  requireValue(!grants.error && Array.isArray(grants.data) && grants.data.every((row) => selected.some((entry) => entry.id === row.bundle_id)
    && typeof row.permission_key === "string" && PERMISSION.test(row.permission_key)), "LOCAL_STAFF_BASELINE_READ_FAILED");
  const baseline = Object.fromEntries(selected.map((row) => [row.scenario, grants.data.filter((grant) => grant.bundle_id === row.id).map((grant) => grant.permission_key)]));
  return buildScopedStaffBaselines({ permissions: catalogue.permissions, baseline });
}

/** Publish the four unchanged local baselines; this does not invite anyone. */
export async function prepareScopedStaffRoles({ adminClient, apiUrl, organizationId }) {
  try {
    apiUrl = localStaffOrigin(apiUrl);
    localClient(adminClient, apiUrl); uuid(organizationId);
    await requireAdmin(adminClient, organizationId);
    const baselines = await readBaselines(adminClient, organizationId);
    const roles = [];
    for (const baseline of baselines) {
      const roleId = randomUUID();
      const created = await rpc(adminClient, "staff_role_command", { p_organization_id: organizationId,
        p_role_id: roleId, p_expected_version: 0, p_operation: "create", p_payload: {
          label: `Local ${baseline.scenario} — ${baseline.kind}`,
          description: "Synthetic verification role preserving migration 155 baseline scopes",
          permissionKeys: baseline.permissionKeys,
        }, p_reason: REASON, p_request_id: randomUUID() }, roleId);
      const createReceipt = strictParse(() => parseStaffRoleCommandResult(created, "role"));
      requireValue(createReceipt.roleId === roleId && createReceipt.version === 1, "LOCAL_STAFF_ROLE_CREATE_MISMATCH");
      const rawImpact = await rpc(adminClient, "staff_role_impact", { p_organization_id: organizationId,
        p_role_id: roleId, p_expected_version: 1 }, roleId);
      const impact = strictParse(() => parseStaffRoleImpact(rawImpact));
      requireValue(impact.roleId === roleId && impact.version === 1 && impact.affectedMembershipIds.length === 0,
        "LOCAL_STAFF_ROLE_IMPACT_MISMATCH");
      const published = await rpc(adminClient, "staff_role_publish", { p_organization_id: organizationId,
        p_role_id: roleId, p_expected_version: 1, p_expected_impact_fingerprint: impact.impactFingerprint,
        p_reason: REASON, p_request_id: randomUUID() }, roleId);
      const publishReceipt = strictParse(() => parseStaffRoleCommandResult(published, "publish"));
      requireValue(publishReceipt.roleId === roleId && publishReceipt.version === 2, "LOCAL_STAFF_ROLE_PUBLISH_MISMATCH");
      roles.push({ ...baseline, roleId, roleVersion: publishReceipt.version,
        scope: { kind: baseline.kind, key: baseline.kind === "organization" ? organizationId : null, resourceKind: null } });
    }
    return { schemaVersion: 1, organizationId, roles };
  } catch (error) {
    if (error instanceof ScopedStaffProvisioningError) throw error;
    throw new ScopedStaffProvisioningError("LOCAL_STAFF_PREPARATION_FAILED");
  }
}

/** Submit each planned local recipient once through the actual Admin form. */
export async function prepareScopedStaffInvitations({ browser, adminClient, apiUrl, organizationId, appOrigin,
  identities, identity, rolePreparation }) {
  let context;
  let stage = "SETUP";
  let clientError = false;
  try {
    apiUrl = localStaffOrigin(apiUrl); appOrigin = localStaffOrigin(appOrigin);
    localClient(adminClient, apiUrl); uuid(organizationId); localIdentity(identity, true);
    SCENARIOS.forEach((scenario) => localIdentity(identities[scenario]));
    requireValue(identities.sales.email !== identities.admissions.email, "LOCAL_STAFF_IDENTITIES_NOT_DISTINCT");
    requireValue(rolePreparation?.schemaVersion === 1 && rolePreparation.organizationId === organizationId
      && Array.isArray(rolePreparation.roles) && rolePreparation.roles.length === 4, "LOCAL_STAFF_ROLES_REQUIRED");
    const { roles } = rolePreparation;
    requireValue(sameSet(roles.map((row) => `${row.scenario}:${row.scope.kind}`), ["sales:own", "sales:organization", "admissions:own", "admissions:organization"])
      && roles.every((row) => Array.isArray(row.permissionKeys) && row.permissionKeys.length > 0
        && row.permissionKeys.every((key) => typeof key === "string" && PERMISSION.test(key))), "LOCAL_STAFF_ROLES_INVALID");
    strictParse(() => parseStaffInviteAssignmentInputs(roles.map(({ roleId, roleVersion, scope }) => ({ roleId, roleVersion, scope })), false, organizationId));
    await requireAdmin(adminClient, organizationId);
    const history = async () => {
      const rows = await rpc(adminClient, "staff_workspace_auth_history", { p_organization_id: organizationId });
      requireValue(Array.isArray(rows) && rows.length <= 100 && rows.every((row) => row && UUID.test(row.request_id)
        && ["invite", "recovery"].includes(row.operation) && typeof row.display_name === "string"
        && ["dispatching", "reconciliation_required", "completed", "rejected"].includes(row.status))
        && new Set(rows.map((row) => row.request_id)).size === rows.length, "LOCAL_STAFF_HISTORY_INVALID");
      return rows;
    };
    stage = "LOGIN";
    context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", (route) => [appOrigin, apiUrl].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on("pageerror", () => { clientError = true; });
    page.on("console", (message) => { if (message.type() === "error") clientError = true; });
    await page.goto(`${appOrigin}/login`, { waitUntil: "domcontentloaded" });
    await page.locator("#staff-email").fill(identity.email);
    await page.locator("#staff-password").fill(identity.password);
    await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    await page.getByTestId("v3-shell").waitFor();
    requireValue(await page.getByTestId("v3-shell").getAttribute("data-system-role") === "admin"
      && await page.getByTestId("v3-shell").getAttribute("data-presentation-role") === "actual", "LOCAL_STAFF_INVITATION_ADMIN_UI_REQUIRED");
    stage = "FORM";
    await page.goto(`${appOrigin}/v3/settings?section=staff&view=people`, { waitUntil: "domcontentloaded" });
    await page.locator("summary").filter({ hasText: /^Пригласить сотрудника$/ }).click();
    const form = () => page.locator("form").filter({ has: page.getByRole("heading", { name: "Пригласить сотрудника", exact: true }) });
    const next = () => form().getByRole("button", { name: "Пригласить следующего сотрудника", exact: true });
    const invitations = [];
    for (const scenario of SCENARIOS) {
      stage = `${scenario.toUpperCase()}_FORM`;
      if (invitations.length) await next().click();
      const before = new Set((await history()).map((row) => row.request_id));
      const selectedRoles = roles.filter((row) => row.scenario === scenario);
      const assignments = selectedRoles.map(({ roleId, roleVersion, scope }) => ({ roleId, roleVersion, scope }));
      await form().getByRole("textbox", { name: "Основание подключения", exact: true }).fill(REASON);
      await form().getByRole("textbox", { name: "Имя", exact: true }).fill(identities[scenario].displayName);
      await form().getByRole("textbox", { name: "Рабочий email", exact: true }).fill(identities[scenario].email);
      for (const [index, assignment] of assignments.entries()) {
        await form().getByRole("button", { name: "Добавить роль", exact: true }).click();
        const row = form().getByRole("group", { name: `Роль ${index + 1}`, exact: true });
        await row.getByRole("combobox", { name: "Название роли", exact: true }).selectOption(assignment.roleId);
        await row.getByRole("combobox", { name: "Область доступа", exact: true }).selectOption(assignment.scope.kind);
      }
      const inputJson = await form().locator('input[name="assignments"]').inputValue();
      const inputs = strictParse(() => parseStaffInviteAssignmentInputs(JSON.parse(inputJson), false, organizationId));
      requireValue(await form().locator('input[name="no_access"]').inputValue() === "no"
        && sameSet(inputs.map(pair), assignments.map(pair)) && inputs.every((row) => assignments.some((expected) => pair(expected) === pair(row)
          && expected.roleVersion === row.roleVersion)), "LOCAL_STAFF_INVITATION_FIELDS_MISMATCH");
      // Other changes clear rights consent: recipient first, rights last, then one submit.
      await form().locator('input[name="recipient_confirmed"]').check();
      await form().locator('input[name="rights_confirmed"]').check();
      stage = `${scenario.toUpperCase()}_SUBMIT`;
      await form().getByRole("button", { name: "Отправить приглашение", exact: true }).click();
      await next().waitFor();
      stage = `${scenario.toUpperCase()}_READBACK`;
      const added = (await history()).filter((row) => !before.has(row.request_id));
      requireValue(added.length === 1 && added[0].operation === "invite" && added[0].status === "completed"
        && added[0].display_name === identities[scenario].displayName && added[0].rejection_code === null, "LOCAL_STAFF_INVITATION_RECEIPT_MISMATCH");
      const requestId = uuid(added[0].request_id);
      const raw = await rpc(adminClient, "staff_workspace_auth_preparation", { p_organization_id: organizationId, p_request_id: requestId });
      const preparation = strictParse(() => parseStaffAuthPreparation(raw, { organizationId, requestId }));
      const permissionKeys = [...new Set(preparation.assignments.flatMap((row) => row.permissionKeys))].sort();
      requireValue(preparation.status === "completed" && preparation.operation === "invite" && !preparation.noAccess && preparation.conflictCode === null
        && preparation.targetMembershipId && preparation.displayName === identities[scenario].displayName
        && sameSet(preparation.assignments.map(pair), assignments.map(pair)) && preparation.assignments.every((row) => assignments.some((expected) =>
          pair(expected) === pair(row) && expected.roleVersion === row.roleVersion))
        && sameSet(permissionKeys, new Set(selectedRoles.flatMap((row) => row.permissionKeys))) && !clientError, "LOCAL_STAFF_PREPARATION_MISMATCH");
      invitations.push({ scenario, requestId, membershipId: preparation.targetMembershipId, preparationVersion: preparation.preparationVersion, assignments, permissionKeys });
    }
    return { schemaVersion: 1, organizationId, invitations };
  } catch {
    throw new ScopedStaffProvisioningError(`LOCAL_STAFF_INVITATION_UI_${stage}_FAILED`);
  } finally { if (context) await context.close().catch(() => {}); }
}

export function staffInvitationLink(html, appOrigin) {
  appOrigin = localStaffOrigin(appOrigin);
  requireValue(typeof html === "string" && html.length <= 1_000_000, "LOCAL_STAFF_MAIL_INVALID");
  const links = [...html.matchAll(/href="([^"]+)"/gu)].map((match) => match[1].replaceAll("&amp;", "&"));
  requireValue(links.length === 1, "LOCAL_STAFF_INVITE_LINK_COUNT");
  let url;
  try { url = new URL(links[0]); } catch { throw new ScopedStaffProvisioningError("LOCAL_STAFF_INVITE_LINK_INVALID"); }
  requireValue(url.origin === appOrigin && url.pathname === "/auth/staff" && !url.username && !url.password && !url.hash
    && [...url.searchParams.keys()].sort().join(",") === "token_hash,type" && url.searchParams.get("type") === "invite"
    && /^[0-9a-f]{56}$/u.test(url.searchParams.get("token_hash")), "LOCAL_STAFF_INVITE_LINK_INVALID");
  return url.href; // Process-only: caller never writes this URL to evidence or logs.
}
async function mailJson(url) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  requireValue(response.ok, "LOCAL_STAFF_MAIL_UNAVAILABLE");
  const text = await response.text();
  requireValue(text.length <= 1_000_000, "LOCAL_STAFF_MAIL_TOO_LARGE");
  return strictParse(() => JSON.parse(text), "LOCAL_STAFF_MAIL_INVALID");
}
async function invitationEmail(mailpitOrigin, email, appOrigin) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const listing = await mailJson(`${mailpitOrigin}/api/v1/messages`);
    requireValue(Array.isArray(listing.messages), "LOCAL_STAFF_MAIL_INVALID");
    const matches = listing.messages.filter((item) => item.To?.some((to) => to.Address === email));
    requireValue(matches.length <= 1, "LOCAL_STAFF_DUPLICATE_INVITE_MAIL");
    if (matches.length === 1) {
      requireValue(typeof matches[0].ID === "string" && /^[a-z0-9-]{1,100}$/iu.test(matches[0].ID), "LOCAL_STAFF_MAIL_INVALID");
      const message = await mailJson(`${mailpitOrigin}/api/v1/message/${encodeURIComponent(matches[0].ID)}`);
      return staffInvitationLink(message.HTML, appOrigin);
    }
    await delay(250);
  }
  throw new ScopedStaffProvisioningError("LOCAL_STAFF_INVITE_MAIL_MISSING");
}
async function invitedUser(authAdminClient, authUserId, email, requestId) {
  const result = await authAdminClient.auth.admin.getUserById(authUserId);
  const user = result.data?.user;
  requireValue(!result.error && user && user.id === authUserId && user.email === email && user.invited_at
    && user.user_metadata?.evo_staff_invitation_request_id === requestId, "LOCAL_STAFF_INVITED_USER_MISMATCH");
  return user;
}
function assertPrepared(prepared) {
  requireValue(prepared?.schemaVersion === 1 && Array.isArray(prepared.invitations)
    && prepared.invitations.length === 2 && sameSet(prepared.invitations.map((row) => row.scenario), SCENARIOS), "LOCAL_STAFF_PREPARED_INVALID");
  uuid(prepared.organizationId);
  for (const row of prepared.invitations) {
    uuid(row.requestId); uuid(row.membershipId);
    requireValue(Number.isSafeInteger(row.preparationVersion) && row.preparationVersion > 0 && Array.isArray(row.permissionKeys)
      && row.permissionKeys.length > 0 && row.permissionKeys.every((key) => typeof key === "string" && PERMISSION.test(key)), "LOCAL_STAFF_PREPARED_INVALID");
    strictParse(() => parseStaffInviteAssignmentInputs(row.assignments, false, prepared.organizationId));
  }
}

/** Phase two proves real local mail + the normal staff callback and password UI. */
export async function acceptScopedStaffInvitations({ browser, adminClient, authAdminClient, apiUrl, publishableKey,
  mailpitOrigin, appOrigin, prepared, identities }) {
  let context;
  let loginPage;
  let loginClientError = null;
  let browserStage = "SETUP";
  try {
    apiUrl = localStaffOrigin(apiUrl); appOrigin = localStaffOrigin(appOrigin); mailpitOrigin = localStaffOrigin(mailpitOrigin);
    localClient(adminClient, apiUrl); localClient(authAdminClient, apiUrl); assertPrepared(prepared);
    requireValue(typeof publishableKey === "string" && publishableKey.length >= 16, "LOCAL_STAFF_PUBLIC_KEY_INVALID");
    SCENARIOS.forEach((scenario) => localIdentity(identities[scenario], true));
    await requireAdmin(adminClient, prepared.organizationId);
    const members = [];
    for (const invitation of prepared.invitations) {
      const identity = identities[invitation.scenario];
      const directory = await rpc(adminClient, "staff_directory", { p_organization_id: prepared.organizationId });
      requireValue(Array.isArray(directory), "LOCAL_STAFF_DIRECTORY_INVALID");
      const targets = directory.filter((row) => row.membership_id === invitation.membershipId);
      requireValue(targets.length === 1 && targets[0].membership_status === "active", "LOCAL_STAFF_DIRECTORY_TARGET_INVALID");
      const authUserId = uuid(targets[0].auth_user_id);
      const readUser = () => invitedUser(authAdminClient, authUserId, identity.email, invitation.requestId);
      requireValue(!(await readUser()).email_confirmed_at, "LOCAL_STAFF_INVITE_PRECONFIRMED");
      const link = await invitationEmail(mailpitOrigin, identity.email, appOrigin);
      browserStage = "CONTEXT";
      context = await browser.newContext({ serviceWorkers: "block" });
      // No trace, video, screenshot or request logging while the token is present.
      await context.route("**/*", (route) => {
        const origin = new URL(route.request().url()).origin;
        return [appOrigin, apiUrl].includes(origin) ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30_000);
      browserStage = "INVITE_OPEN";
      await page.goto(link, { waitUntil: "domcontentloaded" });
      requireValue(!(await readUser()).email_confirmed_at, "LOCAL_STAFF_GET_CONSUMED_INVITE");
      browserStage = "INVITE_CONTINUE";
      await page.getByRole("button", { name: "Продолжить", exact: true }).click();
      browserStage = "PASSWORD_READY";
      await page.getByLabel("Новый пароль", { exact: true }).waitFor();
      requireValue(page.url() === `${appOrigin}/auth/staff` && (await readUser()).email_confirmed_at, "LOCAL_STAFF_CALLBACK_NOT_CONFIRMED");
      browserStage = "PASSWORD_INPUT";
      await page.getByLabel("Новый пароль", { exact: true }).fill(identity.password);
      await page.getByLabel("Повторите пароль", { exact: true }).fill(identity.password);
      browserStage = "PASSWORD_SAVE";
      await page.getByRole("button", { name: "Сохранить пароль и перейти ко входу", exact: true }).click();
      browserStage = "PASSWORD_REDIRECT";
      await page.waitForURL(`${appOrigin}/login`);
      await context.close(); context = null;
      browserStage = "LOGIN_CONTEXT";
      context = await browser.newContext({ serviceWorkers: "block" });
      loginPage = await context.newPage();
      loginClientError = null;
      loginPage.on("pageerror", (error) => {
        loginClientError = ["TypeError", "ReferenceError", "SyntaxError", "RangeError"].includes(error.name)
          ? error.name.toUpperCase() : "OTHER";
      });
      loginPage.setDefaultTimeout(30_000);
      browserStage = "LOGIN_OPEN";
      await loginPage.goto(`${appOrigin}/login`);
      browserStage = "LOGIN_INPUT";
      await loginPage.locator("#staff-email").fill(identity.email);
      await loginPage.locator("#staff-password").fill(identity.password);
      browserStage = "LOGIN_SUBMIT";
      await loginPage.getByRole("button", { name: "Войти в CRM", exact: true }).click();
      browserStage = "LOGIN_SHELL";
      await loginPage.getByTestId("v3-shell").waitFor();
      requireValue(await loginPage.getByTestId("v3-shell").getAttribute("data-system-role") === "staff"
        && await loginPage.getByTestId("v3-shell").getAttribute("data-presentation-role") === "actual", "LOCAL_STAFF_BROWSER_AUTHORITY_MISMATCH");
      // Fresh password session and server-verified live authority; never craft JWT claims.
      // https://supabase.com/docs/reference/javascript/auth-signinwithpassword
      const client = createClient(apiUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const login = await client.auth.signInWithPassword({ email: identity.email, password: identity.password });
      requireValue(!login.error && login.data?.session && login.data.user?.id === authUserId, "LOCAL_STAFF_FRESH_LOGIN_FAILED");
      const actor = await staffSnapshot(client);
      requireValue(actor.membershipId === invitation.membershipId && actor.organizationId === prepared.organizationId && actor.systemRole === "staff"
        && sameSet(actor.permissionKeys, invitation.permissionKeys) && sameSet(actor.assignments.map(pair), invitation.assignments.map(pair)), "LOCAL_STAFF_EFFECTIVE_ACCESS_MISMATCH");
      members.push({ scenario: invitation.scenario, membershipId: actor.membershipId, profileId: actor.profileId,
        accessVersion: actor.platformAccessVersion, systemRole: actor.systemRole, permissionKeys: actor.permissionKeys, assignments: actor.assignments });
      await client.auth.signOut({ scope: "local" });
      await context.close(); context = null;
    }
    return { schemaVersion: 1, organizationId: prepared.organizationId, members,
      proof: { localMail: true, actualCallback: true, passwordSet: true, freshPasswordLogin: true } };
  } catch (error) {
    if (error instanceof ScopedStaffProvisioningError) throw error;
    // Playwright errors can contain the emailed URL or typed values: redact them.
    if (browserStage === "LOGIN_SHELL" && loginPage) {
      try {
        const pathname = new URL(loginPage.url()).pathname;
        const surface = new Map([["/login", "LOGIN"], ["/", "HOME"],
          ["/platform-pending", "STAFF_PENDING"], ["/access-denied", "ACCESS_DENIED"],
          ["/auth/account-pending", "STUDENT_PENDING"], ["/portal", "STUDENT_PORTAL"]]).get(pathname)
          ?? (pathname === "/v3" || pathname.startsWith("/v3/") ? "V3" : "OTHER");
        browserStage = `LOGIN_SHELL_${surface}`;
        if (loginClientError) browserStage += `_CLIENT_${loginClientError}`;
      } catch { /* Keep the fixed stage if the page has already closed. */ }
    }
    throw new ScopedStaffProvisioningError(`LOCAL_STAFF_BROWSER_${browserStage}_FAILED`);
  } finally { if (context) await context.close().catch(() => {}); }
}

function roleEditorEvidenceDirectory(value) {
  if (value === undefined || value === null) return null;
  requireValue(typeof value === "string" && isAbsolute(value), "LOCAL_ROLE_EDITOR_EVIDENCE_INVALID");
  const stat = lstatSync(value);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0
    && (typeof process.getuid !== "function" || stat.uid === process.getuid()), "LOCAL_ROLE_EDITOR_EVIDENCE_NOT_PRIVATE");
  const directory = realpathSync(value);
  const repository = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
  const descendant = (parent, child) => {
    const path = relative(parent, child);
    return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
  };
  requireValue(!descendant(repository, directory) && !descendant(directory, repository), "LOCAL_ROLE_EDITOR_EVIDENCE_IN_REPOSITORY");
  return directory;
}

/** Separate normal UI proof; only two unused synthetic roles may change.
 * Role/label locators: https://playwright.dev/docs/locators
 * Optional screenshot buffers: https://playwright.dev/docs/screenshots
 * No Auth dispatch, browser token injection, direct command RPC or default artifacts.
 */
export async function verifyScopedStaffRoleEditor({ browser, adminClient, apiUrl, appOrigin,
  organizationId, identity, evidenceDirectory }) {
  let context;
  let page;
  let stage = "SETUP";
  let clientError = false;
  let createClickHandlerBefore = null;
  let createClickStarted = false;
  let mainFrameNavigationsSinceCreateAttempt = null;
  const observeCreateClickHandler = async () => {
    try {
      // A native property observation only, not a React hydration assertion.
      // evaluateAll observes current matches without waiting for a button:
      // https://playwright.dev/docs/api/class-locator#locator-evaluate-all
      return await page.getByRole("button", { name: "Создать роль", exact: true })
        .evaluateAll((elements) => elements.length === 1 ? typeof elements[0].onclick === "function" : null);
    } catch { return null; }
  };
  try {
    apiUrl = localStaffOrigin(apiUrl); appOrigin = localStaffOrigin(appOrigin);
    localClient(adminClient, apiUrl); uuid(organizationId); localIdentity(identity, true);
    const evidence = roleEditorEvidenceDirectory(evidenceDirectory);
    await requireAdmin(adminClient, organizationId);
    const workspace = async () => {
      const raw = await rpc(adminClient, "staff_role_workspace", { p_organization_id: organizationId });
      return strictParse(() => parseStaffRoleWorkspace(raw), "LOCAL_ROLE_EDITOR_WORKSPACE_INVALID");
    };
    const baselineWorkspace = await workspace();
    const choices = baselineWorkspace.permissions.filter((permission) => !permission.systemOnly && !permission.sensitive
      && permission.allowedScopes.includes("organization")
      && baselineWorkspace.permissions.filter((other) => other.label === permission.label).length === 1).slice(0, 2);
    requireValue(choices.length === 2, "LOCAL_ROLE_EDITOR_CATALOGUE_INSUFFICIENT");
    const createdIds = new Set();
    const readback = async (id, expected) => {
      const current = await workspace();
      requireValue(JSON.stringify(current.members) === JSON.stringify(baselineWorkspace.members)
        && JSON.stringify(current.roles.filter((role) => !createdIds.has(role.id))) === JSON.stringify(baselineWorkspace.roles)
        && current.roles.length === baselineWorkspace.roles.length + createdIds.size, "LOCAL_ROLE_EDITOR_EXISTING_ACCESS_CHANGED");
      const role = current.roles.find((row) => row.id === id);
      requireValue(role && role.memberCount === 0 && Object.entries(expected).every(([key, value]) =>
        Array.isArray(value) ? sameSet(role[key], value) : role[key] === value), "LOCAL_ROLE_EDITOR_READBACK_MISMATCH");
      return role;
    };
    stage = "LOGIN_CONTEXT";
    context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", (route) => {
      const origin = new URL(route.request().url()).origin;
      return [appOrigin, apiUrl].includes(origin) ? route.continue() : route.abort();
    });
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on("pageerror", () => { clientError = true; });
    page.on("console", (message) => { if (message.type() === "error") clientError = true; });
    stage = "LOGIN";
    await page.goto(`${appOrigin}/login`, { waitUntil: "domcontentloaded" });
    await page.locator("#staff-email").fill(identity.email);
    await page.locator("#staff-password").fill(identity.password);
    await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    await page.getByTestId("v3-shell").waitFor();
    requireValue(await page.getByTestId("v3-shell").getAttribute("data-system-role") === "admin"
      && await page.getByTestId("v3-shell").getAttribute("data-presentation-role") === "actual", "LOCAL_ROLE_EDITOR_ADMIN_UI_REQUIRED");
    stage = "SETTINGS";
    await page.goto(`${appOrigin}/v3/settings?section=staff`, { waitUntil: "domcontentloaded" });
    const rolesTab = () => page.getByRole("navigation", { name: "Управление командой", exact: true })
      .getByRole("link", { name: "Роли и права", exact: true });
    await rolesTab().click();
    await page.getByRole("heading", { name: "Роли и права", exact: true }).waitFor();
    const details = () => page.getByRole("region", { name: "Выбранная роль", exact: true });
    const editor = () => page.getByRole("form", { name: "Редактор роли", exact: true });
    const savedDraft = "Черновик роли сохранён. Для изменения доступа опубликуйте его.";
    const savedAccess = "Изменение доступа сохранено.";
    const reason = "Isolated local unused role editor verification";
    const suffix = randomUUID().slice(0, 8);
    const draftLabel = `Local UI role ${suffix}`;
    const editedLabel = `${draftLabel} edited`;
    const copyLabel = `${draftLabel} copy`;
    const saveDraft = async (label, description, version, phase) => {
      stage = `${phase}_VERSION`;
      requireValue(await editor().locator('input[name="expected_version"]').inputValue() === String(version), "LOCAL_ROLE_EDITOR_UI_VERSION_MISMATCH");
      stage = `${phase}_FIELDS`;
      await editor().getByLabel("Название роли", { exact: true }).fill(label);
      // A prefilled textarea contributes text to its wrapping label. Target
      // the textbox's accessible name, which remains stable while editing.
      await editor().getByRole("textbox", { name: "Для какой работы", exact: true }).fill(description);
      await editor().getByLabel("Причина изменения", { exact: true }).fill(reason);
      stage = `${phase}_SUBMIT`;
      await editor().getByRole("button", { name: "Сохранить черновик", exact: true }).click();
      stage = `${phase}_CONFIRM`;
      await editor().getByText(savedDraft, { exact: true }).waitFor();
    };
    const openSavedRole = async (label) => {
      await editor().getByRole("link", { name: "Открыть роль", exact: true }).click();
      await details().getByRole("heading", { name: label, exact: true }).waitFor();
    };
    const reopenRole = async (label, archived = false) => {
      // Ordinary navigation resets the completed command form for the next command.
      await rolesTab().click();
      // The list remains visible beside a selected role on desktop. Wait for
      // the destination's empty detail state before selecting the role again.
      await details().getByText("Выберите роль, чтобы посмотреть и изменить разрешения.", { exact: true }).waitFor();
      const list = page.getByRole("region", { name: "Список ролей", exact: true });
      if (archived) await list.getByRole("checkbox", { name: "Показать архивные", exact: true }).check();
      await list.getByRole("link").filter({ hasText: label }).click();
      await details().getByRole("heading", { name: label, exact: true }).waitFor();
    };
    stage = "CREATE";
    try {
      // This Page's main frame only; no URL or frame content is recorded.
      // https://playwright.dev/docs/api/class-page#page-event-framenavigated
      page.on("framenavigated", (frame) => {
        try {
          if (createClickStarted && mainFrameNavigationsSinceCreateAttempt !== null && frame === page.mainFrame()) mainFrameNavigationsSinceCreateAttempt += 1;
        } catch { mainFrameNavigationsSinceCreateAttempt = null; }
      });
      mainFrameNavigationsSinceCreateAttempt = 0;
    } catch { /* Observations must never replace the actual UI failure. */ }
    createClickHandlerBefore = await observeCreateClickHandler();
    // Start at the click attempt, including Playwright's actionability wait.
    createClickStarted = true;
    await page.getByRole("button", { name: "Создать роль", exact: true }).click();
    stage = "CREATE_ID";
    const roleId = uuid(await editor().locator('input[name="role_id"]').inputValue());
    requireValue(!baselineWorkspace.roles.some((role) => role.id === roleId), "LOCAL_ROLE_EDITOR_ROLE_NOT_NEW");
    createdIds.add(roleId);
    stage = "CREATE_PERMISSION";
    await editor().getByRole("checkbox", { name: choices[0].label, exact: true }).check();
    await saveDraft(draftLabel, "Isolated role editor draft", 0, "CREATE");
    stage = "CREATE_READBACK";
    await readback(roleId, { label: draftLabel, description: "Isolated role editor draft", version: 1, status: "active",
      bundleId: null, bundleVersion: null, permissionKeys: [], draftPermissionKeys: [choices[0].key] });
    await openSavedRole(draftLabel);
    await details().getByText("Черновик · сотрудников: 0", { exact: true }).waitFor();
    stage = "EDIT_OPEN";
    await details().getByRole("button", { name: "Изменить", exact: true }).click();
    stage = "EDIT_PERMISSION";
    await editor().getByRole("checkbox", { name: choices[1].label, exact: true }).check();
    await saveDraft(editedLabel, "Isolated role editor edited draft", 1, "EDIT");
    const keys = choices.map(({ key }) => key);
    stage = "EDIT_READBACK";
    await readback(roleId, { label: editedLabel, description: "Isolated role editor edited draft", version: 2,
      status: "active", bundleId: null, bundleVersion: null, permissionKeys: [], draftPermissionKeys: keys });
    await openSavedRole(editedLabel);
    stage = "IMPACT";
    await details().getByRole("button", { name: "Публикация", exact: true }).click();
    await page.getByRole("form", { name: "Проверить публикацию роли", exact: true })
      .getByRole("button", { name: "Проверить и опубликовать", exact: true }).click();
    await details().getByRole("heading", { name: "Изменение доступа", exact: true }).waitFor();
    await details().getByText("Затронуто сотрудников: 0", { exact: true }).waitFor();
    // Impact is an independent read, never the publish command.
    const rawImpact = await rpc(adminClient, "staff_role_impact", { p_organization_id: organizationId, p_role_id: roleId, p_expected_version: 2 });
    const actualImpact = strictParse(() => parseStaffRoleImpact(rawImpact));
    requireValue(actualImpact.roleId === roleId && actualImpact.version === 2 && actualImpact.affectedMembershipIds.length === 0
      && sameSet(actualImpact.addedPermissionKeys, keys) && actualImpact.removedPermissionKeys.length === 0, "LOCAL_ROLE_EDITOR_IMPACT_MISMATCH");
    await details().getByText(`Добавятся: ${actualImpact.addedPermissionKeys.map((key) => choices.find((choice) => choice.key === key).label).join(", ")}.`, { exact: true }).waitFor();
    await readback(roleId, { version: 2, permissionKeys: [], draftPermissionKeys: keys });
    stage = "PUBLISH";
    const publication = page.getByRole("form", { name: "Опубликовать роль", exact: true });
    await publication.getByLabel("Причина публикации", { exact: true }).fill(reason);
    await publication.getByRole("checkbox", { name: "Я проверил изменение доступа", exact: true }).check();
    await publication.getByRole("button", { name: "Применить изменения", exact: true }).click();
    await publication.getByText(savedAccess, { exact: true }).waitFor();
    stage = "PUBLISH_READBACK";
    const published = await readback(roleId, { version: 3, status: "active", permissionKeys: keys, draftPermissionKeys: keys });
    uuid(published.bundleId); requireValue(published.bundleVersion === 1, "LOCAL_ROLE_EDITOR_PUBLISHED_BUNDLE_MISMATCH");
    await reopenRole(editedLabel);
    await details().getByText("Опубликована · сотрудников: 0", { exact: true }).waitFor();
    for (const choice of choices) await details().getByText(choice.label, { exact: true }).waitFor();
    stage = "COPY";
    await details().getByRole("button", { name: "Скопировать", exact: true }).click();
    const copyId = uuid(await editor().locator('input[name="role_id"]').inputValue());
    requireValue(!createdIds.has(copyId) && !baselineWorkspace.roles.some((role) => role.id === copyId), "LOCAL_ROLE_EDITOR_ROLE_NOT_NEW");
    createdIds.add(copyId);
    await saveDraft(copyLabel, "Isolated role editor copied draft", 0, "COPY");
    stage = "COPY_READBACK";
    await readback(copyId, { label: copyLabel, description: "Isolated role editor copied draft", version: 1,
      status: "active", bundleId: null, bundleVersion: null, permissionKeys: [], draftPermissionKeys: keys });
    await openSavedRole(copyLabel);
    stage = "ARCHIVE";
    await details().getByRole("button", { name: "Архивировать", exact: true }).click();
    await details().getByRole("button", { name: "Проверить архивирование", exact: true }).click();
    const archive = page.getByRole("form", { name: "Архивировать роль", exact: true });
    await archive.locator('input[name="expected_impact_fingerprint"]').waitFor({ state: "attached" });
    const rawArchiveImpact = await rpc(adminClient, "staff_role_archive_impact", { p_organization_id: organizationId,
      p_role_id: copyId, p_expected_version: 1, p_replacement_role_id: null, p_revoke_assignments: false });
    const archiveImpact = strictParse(() => parseStaffRoleArchiveImpact(rawArchiveImpact));
    requireValue(archiveImpact.roleId === copyId && archiveImpact.version === 1 && archiveImpact.replacementRoleId === null
      && archiveImpact.revokeAssignments === false && archiveImpact.affectedMembershipIds.length === 0
      && archiveImpact.addedPermissionKeys.length === 0 && archiveImpact.removedPermissionKeys.length === 0
      && await archive.locator('input[name="expected_impact_fingerprint"]').inputValue() === archiveImpact.impactFingerprint,
    "LOCAL_ROLE_EDITOR_ARCHIVE_IMPACT_MISMATCH");
    await archive.getByLabel("Причина", { exact: true }).fill(reason);
    await archive.locator('input[name="confirm_impact"]').check();
    await archive.getByRole("button", { name: "Перенести в архив", exact: true }).click();
    await details().getByText(savedAccess, { exact: true }).waitFor();
    stage = "ARCHIVE_READBACK";
    await readback(copyId, { version: 2, status: "archived", permissionKeys: [], draftPermissionKeys: keys });
    await reopenRole(copyLabel, true);
    await details().getByText("В архиве · сотрудников: 0", { exact: true }).waitFor();
    stage = "RESTORE_OPEN";
    await details().getByRole("button", { name: "Восстановить", exact: true }).click();
    const restore = page.getByRole("form", { name: "Восстановить роль", exact: true });
    stage = "RESTORE_FIELDS";
    await restore.getByLabel("Причина", { exact: true }).fill(reason);
    stage = "RESTORE_SUBMIT";
    await restore.getByRole("button", { name: "Восстановить роль", exact: true }).click();
    stage = "RESTORE_CONFIRM";
    await details().getByText(savedAccess, { exact: true }).waitFor();
    stage = "RESTORE_READBACK";
    await readback(copyId, { version: 3, status: "active", bundleId: null, bundleVersion: null, permissionKeys: [], draftPermissionKeys: keys });
    await reopenRole(copyLabel);
    await details().getByText("Черновик · сотрудников: 0", { exact: true }).waitFor();
    stage = "CLEAN_SETTINGS";
    const cleanSettings = async () => {
      const current = new URL(page.url());
      requireValue(current.origin === appOrigin && current.pathname === "/v3/settings" && current.searchParams.get("section") === "staff"
        && current.searchParams.get("view") === "roles" && [...current.searchParams.keys()].every((key) => ["section", "view", "role"].includes(key))
        && !current.hash && !clientError && await page.locator('input[type="password"]').count() === 0
        && await page.locator("[data-nextjs-dialog-overlay]").count() === 0, "LOCAL_ROLE_EDITOR_SETTINGS_NOT_CLEAN");
      await details().getByRole("heading", { name: copyLabel, exact: true }).waitFor();
    };
    await cleanSettings();
    const screenshots = [];
    if (evidence) {
      stage = "EVIDENCE";
      for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]]) {
        await page.setViewportSize(viewport);
        await cleanSettings();
        requireValue(roleEditorEvidenceDirectory(evidence) === evidence, "LOCAL_ROLE_EDITOR_EVIDENCE_INVALID");
        const path = join(evidence, `role-editor-${suffix}-${name}.png`);
        writeFileSync(path, await page.screenshot({ fullPage: false }), { flag: "wx", mode: 0o600 });
        screenshots.push(path);
      }
    }
    return { schemaVersion: 1, proof: { actualAdminPasswordLogin: true, draftCreated: true, draftEdited: true,
      impactReviewed: true, archiveImpactReviewed: true, published: true, copied: true, archived: true, restored: true, existingAccessUnchanged: true }, screenshots };
  } catch {
    // Fixed counters only: never print DOM text, URLs, inputs or raw errors.
    if (page) {
      try {
        const details = page.getByRole("region", { name: "Выбранная роль", exact: true });
        process.stderr.write(`LOCAL_ROLE_EDITOR_UI_STATE:${JSON.stringify({
          stage,
          roleEditors: await page.getByRole("form", { name: "Редактор роли", exact: true }).count(),
          createButtons: await page.getByRole("button", { name: "Создать роль", exact: true }).count(),
          archiveForms: await page.getByRole("form", { name: "Архивировать роль", exact: true }).count(),
          restoreForms: await page.getByRole("form", { name: "Восстановить роль", exact: true }).count(),
          emptyDetails: await details.getByText("Выберите роль, чтобы посмотреть и изменить разрешения.", { exact: true }).count(),
          createClickHandlerBefore,
          createClickHandlerAtFailure: await observeCreateClickHandler(),
          mainFrameNavigationsSinceCreateAttempt,
          clientError,
        })}\n`);
      } catch { /* Page setup or closure can make even fixed counters unavailable. */ }
    }
    // No raw Playwright diagnostics: they can contain passwords, request bodies or URLs.
    throw new ScopedStaffProvisioningError(`LOCAL_ROLE_EDITOR_${stage}_FAILED`);
  } finally { if (context) await context.close().catch(() => {}); }
}

/** Two ordinary saves in one existing accepted local member's card. No direct writes. */
export async function verifyScopedStaffMemberEditor({ browser, adminClient, apiUrl, appOrigin,
  organizationId, identity, accepted }) {
  let context;
  let stage = "SETUP";
  let clientError = false;
  try {
    apiUrl = localStaffOrigin(apiUrl); appOrigin = localStaffOrigin(appOrigin);
    localClient(adminClient, apiUrl); uuid(organizationId); localIdentity(identity, true);
    await requireAdmin(adminClient, organizationId);
    requireValue(accepted?.schemaVersion === 1 && accepted.organizationId === organizationId
      && ["localMail", "actualCallback", "passwordSet", "freshPasswordLogin"].every((key) => accepted.proof?.[key] === true),
    "LOCAL_MEMBER_EDITOR_ACCEPTANCE_REQUIRED");
    const acceptedMember = accepted.members?.find((row) => row.systemRole === "staff" && row.assignments.length === 2);
    requireValue(acceptedMember, "LOCAL_MEMBER_EDITOR_MEMBER_REQUIRED");
    const readWorkspace = async () => {
      const raw = await rpc(adminClient, "staff_role_workspace", { p_organization_id: organizationId });
      return strictParse(() => parseStaffRoleWorkspace(raw), "LOCAL_MEMBER_EDITOR_WORKSPACE_INVALID");
    };
    const baseline = await readWorkspace();
    const original = baseline.members.find((row) => row.membershipId === acceptedMember.membershipId);
    requireValue(original?.systemRole === "staff" && original.assignments.length === 2
      && original.accessVersion === acceptedMember.accessVersion
      && sameSet(original.assignments.map(pair), acceptedMember.assignments.map(pair))
      && original.assignments.every((row) => row.scope.resourceKind === null
        && (row.scope.kind === "own" && row.scope.key === null || row.scope.kind === "organization" && row.scope.key === organizationId)),
    "LOCAL_MEMBER_EDITOR_BASELINE_MISMATCH");
    const remaining = original.assignments.slice(0, 1), removed = original.assignments[1];
    const otherMembers = (members) => members.filter((row) => row.membershipId !== original.membershipId);
    const readback = async (version, assignments) => {
      const current = await readWorkspace();
      const target = current.members.find((row) => row.membershipId === original.membershipId);
      const expectedRoles = baseline.roles.map((role) => ({ ...role, memberCount: role.memberCount
        - Number(original.assignments.some((row) => row.roleId === role.id))
        + Number(assignments.some((row) => row.roleId === role.id)) }));
      requireValue(target?.systemRole === "staff" && target.displayName === original.displayName && target.accessVersion === version
        && sameSet(target.assignments.map(pair), assignments.map(pair))
        && target.assignments.every((row) => {
          const before = original.assignments.find((entry) => pair(entry) === pair(row));
          return before && row.label === before.label && row.bundleId === before.bundleId && row.bundleVersion === before.bundleVersion;
        }) && JSON.stringify(otherMembers(current.members)) === JSON.stringify(otherMembers(baseline.members))
        && JSON.stringify(current.roles) === JSON.stringify(expectedRoles)
        && JSON.stringify(current.permissions) === JSON.stringify(baseline.permissions)
        && JSON.stringify(current.departments) === JSON.stringify(baseline.departments), "LOCAL_MEMBER_EDITOR_READBACK_MISMATCH");
      return target;
    };
    stage = "LOGIN";
    context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", (route) => [appOrigin, apiUrl].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on("pageerror", () => { clientError = true; });
    page.on("console", (message) => { if (message.type() === "error") clientError = true; });
    await page.goto(`${appOrigin}/login`, { waitUntil: "domcontentloaded" });
    await page.locator("#staff-email").fill(identity.email);
    await page.locator("#staff-password").fill(identity.password);
    await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    await page.getByTestId("v3-shell").waitFor();
    requireValue(await page.getByTestId("v3-shell").getAttribute("data-system-role") === "admin"
      && await page.getByTestId("v3-shell").getAttribute("data-presentation-role") === "actual", "LOCAL_MEMBER_EDITOR_ADMIN_UI_REQUIRED");
    stage = "CARD";
    const memberUrl = `${appOrigin}/v3/settings?section=staff&view=people&member=${original.membershipId}`;
    await page.goto(memberUrl, { waitUntil: "domcontentloaded" });
    const card = page.getByRole("article", { name: `Сотрудник: ${original.displayName}`, exact: true });
    await card.getByText("Доступ", { exact: true }).click();
    const form = () => card.getByRole("form", { name: `Назначения: ${original.displayName}`, exact: true });
    const row = (index) => form().getByRole("group", { name: `Назначение ${index + 1}`, exact: true });
    const fields = async (version, assignments) => {
      requireValue(await form().locator('input[name="expected_version"]').inputValue() === String(version), "LOCAL_MEMBER_EDITOR_UI_VERSION_MISMATCH");
      const inputJson = await form().locator('input[name="assignments"]').inputValue();
      const inputs = strictParse(() => parseStaffRoleAssignmentInputs(JSON.parse(inputJson)), "LOCAL_MEMBER_EDITOR_UI_ASSIGNMENTS_INVALID");
      requireValue(sameSet(inputs.map(pair), assignments.map(pair)), "LOCAL_MEMBER_EDITOR_UI_ASSIGNMENTS_MISMATCH");
      for (const [index, input] of inputs.entries()) {
        const role = baseline.roles.find((entry) => entry.id === input.roleId);
        const roleSelect = row(index).getByRole("combobox", { name: "Роль", exact: true });
        const scopeSelect = row(index).getByRole("combobox", { name: "Область доступа", exact: true });
        requireValue(await roleSelect.inputValue() === input.roleId && await roleSelect.locator("option:checked").textContent() === role.label
          && await scopeSelect.inputValue() === input.scope.kind
          && await scopeSelect.locator("option:checked").textContent() === (input.scope.kind === "own" ? "Свои записи" : "Вся организация"),
        "LOCAL_MEMBER_EDITOR_UI_DISPLAY_MISMATCH");
      }
    };
    const save = async () => {
      await form().getByRole("textbox", { name: "Причина изменения", exact: true }).fill("Isolated local consecutive member assignment verification");
      await form().getByRole("button", { name: "Сохранить назначения", exact: true }).click();
      await form().getByText("Изменение доступа сохранено.", { exact: true }).waitFor();
    };
    await fields(original.accessVersion, original.assignments);
    stage = "REMOVE";
    await row(1).getByRole("button", { name: "Убрать назначение", exact: true }).click();
    await fields(original.accessVersion, remaining);
    await save();
    stage = "FIRST_READBACK";
    const first = await readback(original.accessVersion + 1, remaining);
    stage = "NEXT_EDIT";
    // click waits for the explicit next-action control to become enabled after revalidation.
    await form().getByRole("button", { name: "Изменить назначения", exact: true }).click();
    await fields(first.accessVersion, first.assignments);
    stage = "RESTORE";
    await form().getByRole("button", { name: "Добавить роль", exact: true }).click();
    await row(1).getByRole("combobox", { name: "Роль", exact: true }).selectOption(removed.roleId);
    await row(1).getByRole("combobox", { name: "Область доступа", exact: true }).selectOption(removed.scope.kind);
    await fields(first.accessVersion, original.assignments);
    await save();
    stage = "SECOND_READBACK";
    const restored = await readback(original.accessVersion + 2, original.assignments);
    stage = "REOPEN";
    await form().getByRole("button", { name: "Изменить назначения", exact: true }).click();
    await fields(restored.accessVersion, restored.assignments);
    requireValue(page.url() === memberUrl && !clientError, "LOCAL_MEMBER_EDITOR_UI_NOT_CONFIRMED");
    return { schemaVersion: 1, edits: 2, membersEdited: 1, proof: { actualAdminPasswordLogin: true, consecutiveAssignmentEdits: true,
      roleScopeDisplay: true, versionIncrements: 2, sameCard: true, finalAssignmentsRestored: true, otherMembersUnchanged: true, roleCatalogueUnchanged: true } };
  } catch {
    throw new ScopedStaffProvisioningError(`LOCAL_MEMBER_EDITOR_${stage}_FAILED`);
  } finally { if (context) await context.close().catch(() => {}); }
}

/** One ordinary local handoff, then independent department/direction full reads. */
export async function verifyScopedStaffBusinessScopes({ browser, adminClient, apiUrl, appOrigin,
  organizationId, identities, publishableKey, accepted }) {
  let context, initial, originalDetails, originalPersonal, admin, sales, admissions, departmentId;
  let stage = "SETUP", failure = null, clientError = false;
  const temporaryRoles = [], changedPermissions = [];
  const reason = "Fictional isolated local department and direction acceptance";
  const check = (condition) => requireValue(condition, "LOCAL_BUSINESS_SCOPES_READBACK_MISMATCH");
  const workspace = async () => {
    const raw = await rpc(adminClient, "staff_role_workspace", { p_organization_id: organizationId });
    return strictParse(() => parseStaffRoleWorkspace(raw));
  };
  const directory = () => rpc(adminClient, "staff_workspace_directory", { p_organization_id: organizationId });
  const details = (value, id) => {
    const matches = value?.members?.filter((member) => member.membership_id === id);
    check(matches?.length === 1); return matches[0];
  };
  const personalState = (member) => [member.contract_confirmation_granted, member.first_payment_confirmation_granted,
    member.admissions_gate_override_granted];
  const inputs = (assignments) => assignments.map(({ roleId, scope }) => ({ roleId, scope }));
  const bindings = (roles, assignments) => [...new Set(assignments.map((row) => row.roleId))].map((id) => {
    const role = roles.find((entry) => entry.id === id);
    check(role?.status === "active" && role.bundleId && role.bundleVersion);
    return { roleId: id, roleVersion: role.version, bundleId: role.bundleId, bundleVersion: role.bundleVersion };
  });
  const refreshAdmin = async () => {
    const login = await adminClient.auth.signInWithPassword({ email: identities.admin.email, password: identities.admin.password });
    check(!login.error && login.data?.session && login.data.user?.id === admin.authUserId);
    const current = await staffSnapshot(adminClient);
    check(current.membershipId === admin.membershipId && current.organizationId === organizationId && current.systemRole === "admin");
  };
  const command = async (name, args) => {
    const requestId = randomUUID();
    const result = await rpc(adminClient, name, { ...args, p_request_id: requestId }, requestId);
    check(result && (result.request_id === undefined || result.request_id === requestId)
      && (result.requestId === undefined || result.requestId === requestId));
    return result;
  };
  const personalPermission = async (key, granted) => {
    const result = await command("change_membership_permission", { p_organization_id: organizationId,
      p_membership_id: admin.membershipId, p_permission_key: key, p_granted: granted, p_reason: reason });
    check(result?.organization_id === organizationId && result.membership_id === admin.membershipId
      && result.permission_key === key && result.granted === granted);
    await refreshAdmin();
  };
  const saveDetails = async (department, expectedVersion) => {
    const receipt = await command("staff_organizational_details_save", { p_organization_id: organizationId,
      p_membership_id: admissions.membershipId, p_department_id: department, p_job_title: originalDetails.job_title,
      p_direction_codes: originalDetails.direction_codes, p_expected_version: expectedVersion, p_reason: reason });
    check(receipt?.organizational_version === expectedVersion + 1);
    await refreshAdmin();
    const current = details(await directory(), admissions.membershipId);
    check(current.department_id === department && current.job_title === originalDetails.job_title
      && sameSet(current.direction_codes, originalDetails.direction_codes) && current.organizational_version === expectedVersion + 1);
  };
  try {
    apiUrl = localStaffOrigin(apiUrl); appOrigin = localStaffOrigin(appOrigin);
    localClient(adminClient, apiUrl); uuid(organizationId);
    ["admin", ...SCENARIOS].forEach((scenario) => localIdentity(identities?.[scenario], true));
    check(typeof publishableKey === "string" && publishableKey.length >= 16
      && accepted?.schemaVersion === 1 && accepted.organizationId === organizationId
      && ["localMail", "actualCallback", "passwordSet", "freshPasswordLogin"].every((key) => accepted.proof?.[key] === true));
    admin = await staffSnapshot(adminClient);
    check(admin.organizationId === organizationId && admin.systemRole === "admin");
    const acceptedStaff = SCENARIOS.map((scenario) => {
      const matches = accepted.members?.filter((member) => member.scenario === scenario && member.systemRole === "staff");
      check(matches?.length === 1); return matches[0];
    });
    [sales, admissions] = acceptedStaff;
    check(new Set([admin.membershipId, sales.membershipId, admissions.membershipId]).size === 3);
    initial = await workspace();
    for (const member of acceptedStaff) {
      const current = initial.members.find((entry) => entry.membershipId === member.membershipId);
      check(current?.systemRole === "staff" && sameSet(current.assignments.map(pair), member.assignments.map(pair)));
    }
    const before = await directory();
    originalDetails = details(before, admissions.membershipId);
    check(Number.isSafeInteger(originalDetails.organizational_version) && Array.isArray(originalDetails.direction_codes));
    const originalAdmin = details(before, admin.membershipId);
    originalPersonal = personalState(originalAdmin);
    check(originalPersonal.every((value) => typeof value === "boolean"));
    for (const [key, field] of [["contract.evidence.confirm", "contract_confirmation_granted"],
      ["finance.first.payment.confirm", "first_payment_confirmation_granted"]]) {
      check(typeof originalAdmin[field] === "boolean");
      if (!originalAdmin[field]) changedPermissions.push({ key, field, original: false });
    }
    stage = "DEPARTMENT";
    const departmentName = `Local scope ${randomUUID().slice(0, 8)}`;
    const department = await command("staff_department_command", { p_organization_id: organizationId,
      p_department_id: null, p_operation: "create", p_name: departmentName, p_description: reason,
      p_expected_version: 0, p_reason: reason });
    departmentId = uuid(department?.department_id); check(department.version === 1);
    check((await directory()).departments.some((entry) => entry.id === departmentId && entry.status === "active" && entry.version === 1));
    await saveDetails(departmentId, originalDetails.organizational_version);
    stage = "PERSONAL_PERMISSIONS";
    for (const grant of changedPermissions) await personalPermission(grant.key, true);
    const grantedAdmin = details(await directory(), admin.membershipId);
    check(grantedAdmin.contract_confirmation_granted === true && grantedAdmin.first_payment_confirmation_granted === true);
    stage = "LEAD";
    const day = new Date().toISOString().slice(0, 10);
    const lead = await command("create_manual_sales_lead", { p_organization_id: organizationId,
      p_display_name: "Fictional local scoped handoff", p_phone: null, p_email: `scope-${randomUUID()}@evo.local.test`,
      p_source_key: "other", p_owner_membership_id: sales.membershipId, p_interest_direction: "CN",
      p_next_action: reason, p_next_action_due_date: day });
    check(lead?.status === "saved"); const leadId = uuid(lead.lead_id);
    stage = "QUALIFY";
    const readWorkflow = async () => {
      const rows = await rpc(adminClient, "staff_sales_lead_detail", { p_lead_id: leadId });
      check(rows?.length === 1 && rows[0].lead_id === leadId && rows[0].organization_id === organizationId
        && rows[0].current_owner_membership_id === sales.membershipId && Number.isSafeInteger(rows[0].workflow_version));
      return rows[0];
    };
    const intake = await readWorkflow();
    check(intake.stage_key === "new" && intake.lifecycle_state === "open");
    const qualification = await command("mutate_sales_lead_workflow", { p_lead_id: leadId,
      p_expected_workflow_version: intake.workflow_version, p_stage_key: "qualified", p_owner_membership_id: sales.membershipId,
      p_next_action_text: reason, p_next_action_due_date: day, p_clear_next_action: false, p_reason: reason });
    const qualified = await readWorkflow();
    check(qualification?.lead_id === leadId && qualification.organization_id === organizationId
      && qualification.current_owner_membership_id === sales.membershipId && qualification.stage_key === "qualified"
      && qualified.stage_key === "qualified" && qualified.workflow_version === intake.workflow_version + 1
      && qualification.workflow_version === qualified.workflow_version && qualified.next_action_text === reason
      && qualified.next_action_due_date === day);
    const readGate = async () => {
      const rows = await rpc(adminClient, "staff_lead_admissions_gate", { p_lead_id: leadId });
      check(rows?.length === 1 && rows[0].organization_id === organizationId && rows[0].lead_id === leadId
        && Number.isSafeInteger(rows[0].gate_version)); return rows[0];
    };
    stage = "CONTRACT";
    let gate = await readGate();
    await command("mutate_lead_admissions_gate", { p_lead_id: leadId, p_expected_gate_version: gate.gate_version,
      p_action: "confirm_contract", p_amount: 1, p_currency: "USD", p_due_date: day, p_received_date: null,
      p_evidence_reference: "Fictional local contract: no customer agreement", p_reason: reason });
    const contractGate = await readGate();
    check(contractGate.contract_confirmed === true && contractGate.gate_version === gate.gate_version + 1
      && Number(contractGate.first_payment_amount) === 1 && contractGate.first_payment_currency === "USD");
    stage = "PAYMENT"; gate = contractGate;
    await command("mutate_lead_admissions_gate", { p_lead_id: leadId, p_expected_gate_version: gate.gate_version,
      p_action: "confirm_first_payment", p_amount: null, p_currency: null, p_due_date: null, p_received_date: day,
      p_evidence_reference: "Fictional local payment: no funds transferred", p_reason: reason });
    gate = await readGate();
    check(gate.gate_version === contractGate.gate_version + 1 && gate.gate_state === "satisfied" && gate.normal_handoff_allowed === true
      && gate.first_payment_received_date === day && gate.first_payment_confirmed_by_membership_id === admin.membershipId);
    stage = "HANDOFF";
    const handoffReady = await rpc(adminClient, "staff_lead_admissions_handoff", { p_lead_id: leadId });
    check(handoffReady?.length === 1 && handoffReady[0].organization_id === organizationId
      && handoffReady[0].lead_id === leadId && handoffReady[0].gate_version === gate.gate_version
      && handoffReady[0].can_submit_normal === true && handoffReady[0].case_id === null);
    const handoff = await command("handoff_lead_to_admissions", { p_lead_id: leadId,
      p_expected_gate_version: gate.gate_version, p_admissions_owner_membership_id: admissions.membershipId,
      p_handoff_mode: "normal", p_reason: reason });
    const caseId = uuid(handoff?.case_id);
    const handoffRead = await rpc(adminClient, "staff_lead_admissions_handoff", { p_lead_id: leadId });
    check(handoff.case_state === "active" && handoff.admissions_owner_membership_id === admissions.membershipId
      && handoffRead?.length === 1 && handoffRead[0].case_id === caseId && handoffRead[0].case_state === "active"
      && handoffRead[0].handoff_mode === "normal" && handoffRead[0].admissions_owner_membership_id === admissions.membershipId);
    stage = "DIRECTION";
    const catalogue = await rpc(adminClient, "admissions_playbook_catalog_v1", {});
    const playbook = catalogue?.playbooks?.find((entry) => entry.direction === "CN" && entry.publishedAt);
    uuid(playbook?.id);
    const caseWorkspace = () => rpc(adminClient, "staff_case_admissions_workspace_v1", { p_student_case_id: caseId });
    const unconfigured = (await caseWorkspace())?.case;
    check(unconfigured?.id === caseId && unconfigured.organizationId === organizationId && unconfigured.state === "active"
      && typeof unconfigured.version === "string" && /^\d+$/.test(unconfigured.version) && Number.isSafeInteger(Number(unconfigured.version)));
    const configured = await command("configure_case_admissions_v1", { p_student_case_id: caseId,
      p_expected_version: Number(unconfigured.version), p_direction: "CN", p_playbook_version_id: playbook.id,
      p_next_action: reason, p_next_action_due_on: day });
    const canonical = (await caseWorkspace())?.case;
    check(configured?.caseId === caseId && canonical?.direction === "CN" && canonical.id === caseId
      && canonical.organizationId === organizationId && canonical.state === "active" && canonical.playbookVersionId === playbook.id
      && Number(canonical.version) === Number(unconfigured.version) + 1 && canonical.version === configured.version);
    const ownerRead = await adminClient.schema("platform").from("student_cases")
      .select("id,organization_id,current_curator_membership_id,responsible_sales_membership_id,admissions_direction,state")
      .eq("organization_id", organizationId).eq("id", caseId);
    check(!ownerRead.error && ownerRead.data?.length === 1 && ownerRead.data[0].organization_id === organizationId
      && ownerRead.data[0].current_curator_membership_id === admissions.membershipId && ownerRead.data[0].responsible_sales_membership_id === sales.membershipId
      && ownerRead.data[0].admissions_direction === "CN" && ownerRead.data[0].state === "active");
    stage = "ROLES";
    for (const kind of ["department", "direction"]) {
      const roleId = randomUUID(); temporaryRoles.push(roleId);
      const created = await command("staff_role_command", { p_organization_id: organizationId, p_role_id: roleId,
        p_expected_version: 0, p_operation: "create", p_payload: { label: `Local case read ${kind} ${roleId.slice(0, 8)}`,
          description: reason, permissionKeys: ["case.read.full"] }, p_reason: reason });
      const creation = strictParse(() => parseStaffRoleCommandResult(created, "role"));
      check(creation.roleId === roleId && creation.version === 1);
      const impactRaw = await rpc(adminClient, "staff_role_impact", { p_organization_id: organizationId, p_role_id: roleId, p_expected_version: 1 });
      const impact = strictParse(() => parseStaffRoleImpact(impactRaw));
      check(impact.roleId === roleId && impact.version === 1 && impact.affectedMembershipIds.length === 0);
      const published = await command("staff_role_publish", { p_organization_id: organizationId, p_role_id: roleId,
        p_expected_version: 1, p_expected_impact_fingerprint: impact.impactFingerprint, p_reason: reason });
      const publication = strictParse(() => parseStaffRoleCommandResult(published, "publish"));
      check(publication.roleId === roleId && publication.version === 2 && published.affectedMembershipIds.length === 0);
    }
    // Department/grant setup and the previous member proof already changed live versions.
    stage = "BASELINE";
    const baseline = await workspace();
    const original = baseline.members.find((entry) => entry.membershipId === sales.membershipId);
    check(original?.systemRole === "staff" && sameSet(original.assignments.map(pair), sales.assignments.map(pair))
      && original.assignments.every((entry) => entry.scope.resourceKind === null &&
        (entry.scope.kind === "own" && entry.scope.key === null || entry.scope.kind === "organization" && entry.scope.key === organizationId)));
    // case own is current Admissions owner, never responsible Sales. Baseline may contain the key under own.
    check(sales.membershipId !== admissions.membershipId && original.assignments.every((entry) => entry.scope.kind !== "organization"
      || !baseline.roles.find((role) => role.id === entry.roleId)?.permissionKeys.includes("case.read.full")));
    const additions = temporaryRoles.map((roleId, index) => {
      const role = baseline.roles.find((entry) => entry.id === roleId);
      check(role?.version === 2 && role.status === "active" && role.memberCount === 0 && sameSet(role.permissionKeys, ["case.read.full"]));
      return { roleId, scope: { kind: index === 0 ? "department" : "direction", key: index === 0 ? departmentId : "CN", resourceKind: null } };
    });
    const freshSales = async (version, assignments, fullRead) => {
      const client = createClient(apiUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      try {
        const login = await client.auth.signInWithPassword({ email: identities.sales.email, password: identities.sales.password });
        check(!login.error && login.data?.session && login.data.user);
        const actor = await staffSnapshot(client);
        check(actor.organizationId === organizationId && actor.membershipId === sales.membershipId && actor.systemRole === "staff"
          && actor.platformAccessVersion === version && sameSet(actor.assignments.map(pair), assignments.map(pair)));
        if (fullRead) {
          const rows = await rpc(client, "staff_student_case_read_snapshot", { p_student_case_id: caseId });
          check(rows?.length === 1 && rows[0].student_case_id === caseId && rows[0].organization_id === organizationId
            && rows[0].access_mode === "full" && rows[0].state === "active");
        }
      } finally { await client.auth.signOut({ scope: "local" }); }
    };
    await freshSales(original.accessVersion, original.assignments, false);
    stage = "LOGIN";
    context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", (route) => [appOrigin, apiUrl].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(30_000);
    page.on("pageerror", () => { clientError = true; });
    page.on("console", (message) => { if (message.type() === "error") clientError = true; });
    await page.goto(`${appOrigin}/login`, { waitUntil: "domcontentloaded" });
    await page.locator("#staff-email").fill(identities.admin.email);
    await page.locator("#staff-password").fill(identities.admin.password);
    await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    await page.getByTestId("v3-shell").waitFor();
    check(await page.getByTestId("v3-shell").getAttribute("data-system-role") === "admin"
      && await page.getByTestId("v3-shell").getAttribute("data-presentation-role") === "actual");
    stage = "CARD";
    const memberUrl = `${appOrigin}/v3/settings?section=staff&view=people&member=${original.membershipId}`;
    await page.goto(memberUrl, { waitUntil: "domcontentloaded" });
    const card = page.getByRole("article", { name: `Сотрудник: ${original.displayName}`, exact: true });
    await card.getByText("Доступ", { exact: true }).click();
    const form = () => card.getByRole("form", { name: `Назначения: ${original.displayName}`, exact: true });
    const row = (index) => form().getByRole("group", { name: `Назначение ${index + 1}`, exact: true });
    const fields = async (version, assignments) => {
      check(await form().locator('input[name="expected_version"]').inputValue() === String(version));
      const raw = JSON.parse(await form().locator('input[name="assignments"]').inputValue());
      const parsed = strictParse(() => parseStaffRoleAssignmentInputs(raw));
      check(sameSet(parsed.map(pair), assignments.map(pair)));
      const expected = JSON.parse(await form().locator('input[name="expected_role_bindings"]').inputValue());
      check(sameSet(expected.map((entry) => JSON.stringify(entry)), bindings(baseline.roles, assignments).map((entry) => JSON.stringify(entry))));
      for (const [index, entry] of parsed.entries()) {
        const role = baseline.roles.find((item) => item.id === entry.roleId);
        const roleSelect = row(index).getByRole("combobox", { name: "Роль", exact: true });
        const scopeSelect = row(index).getByRole("combobox", { name: "Область доступа", exact: true });
        check(await roleSelect.inputValue() === entry.roleId && await roleSelect.locator("option:checked").textContent() === role.label
          && await scopeSelect.inputValue() === entry.scope.kind && await scopeSelect.locator("option:checked").textContent()
          === { own: "Свои записи", organization: "Вся организация", department: "Отдел", direction: "Направление" }[entry.scope.kind]);
        if (["department", "direction"].includes(entry.scope.kind)) {
          const target = row(index).getByRole("combobox", { name: entry.scope.kind === "department" ? "Отдел" : "Направление", exact: true });
          check(await target.inputValue() === entry.scope.key
            && await target.locator("option:checked").textContent() === (entry.scope.kind === "department" ? departmentName : "Китай"));
        }
      }
    };
    const otherMembers = (members) => members.filter((entry) => entry.membershipId !== sales.membershipId);
    const readback = async (version, assignments) => {
      const current = await workspace(), target = current.members.find((entry) => entry.membershipId === sales.membershipId);
      const expectedRoles = baseline.roles.map((role) => ({ ...role, memberCount: role.memberCount
        - Number(original.assignments.some((entry) => entry.roleId === role.id)) + Number(assignments.some((entry) => entry.roleId === role.id)) }));
      check(target?.accessVersion === version && target.systemRole === "staff" && target.displayName === original.displayName
        && sameSet(target.assignments.map(pair), assignments.map(pair)) && target.assignments.every((entry) => {
          const role = baseline.roles.find((item) => item.id === entry.roleId);
          return entry.label === role?.label && entry.bundleId === role.bundleId && entry.bundleVersion === role.bundleVersion;
        }) && JSON.stringify(otherMembers(current.members)) === JSON.stringify(otherMembers(baseline.members))
        && JSON.stringify(current.roles) === JSON.stringify(expectedRoles) && JSON.stringify(current.permissions) === JSON.stringify(baseline.permissions)
        && JSON.stringify(current.departments) === JSON.stringify(baseline.departments));
      return target;
    };
    await fields(original.accessVersion, original.assignments);
    let currentAssignments = original.assignments;
    const states = [[additions[0]], [additions[1]], additions, []];
    for (const [index, extra] of states.entries()) {
      stage = ["DEPARTMENT_SAVE", "DIRECTION_SAVE", "COMBINED_SAVE", "RESTORE_SAVE"][index];
      if (index > 0) {
        await form().getByRole("button", { name: "Изменить назначения", exact: true }).click();
        await fields(original.accessVersion + index, currentAssignments);
      }
      for (let cursor = currentAssignments.length - 1; cursor >= 0; cursor -= 1) {
        if (temporaryRoles.includes(currentAssignments[cursor].roleId)) await row(cursor).getByRole("button", { name: "Убрать назначение", exact: true }).click();
      }
      for (const [offset, addition] of extra.entries()) {
        await form().getByRole("button", { name: "Добавить роль", exact: true }).click();
        const added = row(original.assignments.length + offset);
        await added.getByRole("combobox", { name: "Роль", exact: true }).selectOption(addition.roleId);
        await added.getByRole("combobox", { name: "Область доступа", exact: true }).selectOption(addition.scope.kind);
        await added.getByRole("combobox", { name: addition.scope.kind === "department" ? "Отдел" : "Направление", exact: true }).selectOption(addition.scope.key);
      }
      const expected = [...original.assignments, ...extra];
      await fields(original.accessVersion + index, expected);
      await form().getByRole("textbox", { name: "Причина изменения", exact: true }).fill(reason);
      await form().getByRole("button", { name: "Сохранить назначения", exact: true }).click();
      await form().getByText("Изменение доступа сохранено.", { exact: true }).waitFor();
      stage = ["DEPARTMENT_READ", "DIRECTION_READ", "COMBINED_READ", "RESTORE_READ"][index];
      const target = await readback(original.accessVersion + index + 1, expected);
      currentAssignments = target.assignments;
      await freshSales(target.accessVersion, target.assignments, index < 3);
      check(page.url() === memberUrl && !clientError);
    }
    await form().getByRole("button", { name: "Изменить назначения", exact: true }).click();
    await fields(original.accessVersion + 4, original.assignments);
    check(page.url() === memberUrl && !clientError);
    // A separate ordinary archive proof starts only after the four scope edits are complete.
    stage = "ASSIGNED_ARCHIVE_SETUP";
    const archiveRole = baseline.roles.find((entry) => entry.id === additions[0].roleId);
    const assigned = [...original.assignments, additions[0]];
    const assignmentReceipt = await command("staff_role_assignments_save", { p_organization_id: organizationId,
      p_membership_id: sales.membershipId, p_expected_access_version: original.accessVersion + 4,
      p_assignments: inputs(assigned), p_expected_role_bindings: bindings(baseline.roles, assigned), p_reason: reason });
    check(assignmentReceipt?.membershipId === sales.membershipId && assignmentReceipt.accessVersion === original.accessVersion + 5);
    const assignedMember = await readback(original.accessVersion + 5, assigned);
    await freshSales(assignedMember.accessVersion, assignedMember.assignments, true);
    stage = "ASSIGNED_ARCHIVE_PREVIEW";
    await page.goto(`${appOrigin}/v3/settings?section=staff&view=roles&role=${archiveRole.id}`, { waitUntil: "domcontentloaded" });
    const roleDetails = page.getByRole("region", { name: "Выбранная роль", exact: true });
    await roleDetails.getByRole("heading", { name: archiveRole.label, exact: true }).waitFor();
    await roleDetails.getByRole("button", { name: "Архивировать", exact: true }).click();
    const preview = roleDetails.getByRole("form", { name: "Проверить архивирование", exact: true });
    await preview.locator('input[name="revoke_assignments"]').check();
    await preview.getByRole("button", { name: "Проверить архивирование", exact: true }).click();
    const archiveForm = roleDetails.getByRole("form", { name: "Архивировать роль", exact: true });
    await archiveForm.locator('input[name="expected_impact_fingerprint"]').waitFor({ state: "attached" });
    const rawArchiveImpact = await rpc(adminClient, "staff_role_archive_impact", { p_organization_id: organizationId,
      p_role_id: archiveRole.id, p_expected_version: archiveRole.version, p_replacement_role_id: null, p_revoke_assignments: true });
    const archiveImpact = strictParse(() => parseStaffRoleArchiveImpact(rawArchiveImpact));
    check(archiveImpact.roleId === archiveRole.id && archiveImpact.version === archiveRole.version
      && archiveImpact.replacementRoleId === null && archiveImpact.revokeAssignments === true
      && sameSet(archiveImpact.affectedMembershipIds, [sales.membershipId]) && archiveImpact.addedPermissionKeys.length === 0
      && sameSet(archiveImpact.removedPermissionKeys, ["case.read.full"])
      && await archiveForm.locator('input[name="expected_impact_fingerprint"]').inputValue() === archiveImpact.impactFingerprint
      && await archiveForm.locator('input[name="expected_version"]').inputValue() === String(archiveRole.version));
    await roleDetails.getByText("Затронуто сотрудников: 1", { exact: true }).waitFor();
    await roleDetails.getByText(original.displayName, { exact: true }).waitFor();
    const permissionLabel = baseline.permissions.find((entry) => entry.key === "case.read.full").label;
    await roleDetails.getByText(`Перестанут предоставляться этой ролью: ${permissionLabel}.`, { exact: true }).waitFor();
    stage = "ASSIGNED_ARCHIVE_SAVE";
    await archiveForm.getByLabel("Причина", { exact: true }).fill(reason);
    await archiveForm.locator('input[name="confirm_impact"]').check();
    await archiveForm.getByRole("button", { name: "Перенести в архив", exact: true }).click();
    await roleDetails.getByText("Изменение доступа сохранено.", { exact: true }).waitFor();
    stage = "ASSIGNED_ARCHIVE_READBACK";
    const archivedWorkspace = await workspace();
    const restoredMember = archivedWorkspace.members.find((entry) => entry.membershipId === sales.membershipId);
    check(restoredMember?.accessVersion === original.accessVersion + 6 && restoredMember.systemRole === "staff"
      && restoredMember.displayName === original.displayName && sameSet(restoredMember.assignments.map(pair), original.assignments.map(pair))
      && JSON.stringify(otherMembers(archivedWorkspace.members)) === JSON.stringify(otherMembers(baseline.members))
      && JSON.stringify(archivedWorkspace.roles) === JSON.stringify(baseline.roles.map((role) => role.id === archiveRole.id
        ? { ...role, version: role.version + 1, status: "archived" } : role))
      && JSON.stringify(archivedWorkspace.permissions) === JSON.stringify(baseline.permissions)
      && JSON.stringify(archivedWorkspace.departments) === JSON.stringify(baseline.departments));
    await freshSales(restoredMember.accessVersion, restoredMember.assignments, false);
    check(!clientError);
  } catch { failure = new ScopedStaffProvisioningError(`LOCAL_BUSINESS_SCOPES_${stage}_FAILED`); }
  finally {
    if (context) {
      try { await context.close(); } catch { failure ??= new ScopedStaffProvisioningError("LOCAL_BUSINESS_SCOPES_BROWSER_CLOSE_FAILED"); }
    }
    if (clientError) failure ??= new ScopedStaffProvisioningError("LOCAL_BUSINESS_SCOPES_BROWSER_ERROR_FAILED");
    // Teardown uses ordinary commands with current versions, including after a failed UI save.
    if (initial && admin && originalDetails) {
      const restore = async (action) => {
        try { await refreshAdmin(); await action(); }
        catch { failure ??= new ScopedStaffProvisioningError("LOCAL_BUSINESS_SCOPES_RESTORATION_FAILED"); }
      };
      await restore(async () => {
        let current = await workspace();
        const original = initial.members.find((entry) => entry.membershipId === sales.membershipId);
        const target = current.members.find((entry) => entry.membershipId === sales.membershipId);
        if (!sameSet(target.assignments.map(pair), original.assignments.map(pair))) {
          const receipt = await command("staff_role_assignments_save", { p_organization_id: organizationId,
            p_membership_id: sales.membershipId, p_expected_access_version: target.accessVersion,
            p_assignments: inputs(original.assignments), p_expected_role_bindings: bindings(current.roles, original.assignments), p_reason: reason });
          check(receipt?.accessVersion === target.accessVersion + 1);
          current = await workspace();
          check(sameSet(current.members.find((entry) => entry.membershipId === sales.membershipId).assignments.map(pair), original.assignments.map(pair)));
        }
      });
      for (const grant of changedPermissions) {
        await restore(async () => {
          if (details(await directory(), admin.membershipId)[grant.field] !== grant.original) await personalPermission(grant.key, grant.original);
          check(details(await directory(), admin.membershipId)[grant.field] === grant.original);
        });
      }
      await restore(async () => {
        const currentDetails = details(await directory(), admissions.membershipId);
        if (departmentId && currentDetails.department_id === departmentId) await saveDetails(originalDetails.department_id, currentDetails.organizational_version);
      });
      for (const roleId of temporaryRoles) {
        await restore(async () => {
          const role = (await workspace()).roles.find((entry) => entry.id === roleId);
          if (!role) { check(failure); return; }
          check(role.memberCount === 0);
          if (role.status === "archived") return;
          const rawImpact = await rpc(adminClient, "staff_role_archive_impact", { p_organization_id: organizationId,
            p_role_id: roleId, p_expected_version: role.version, p_replacement_role_id: null, p_revoke_assignments: false });
          const impact = strictParse(() => parseStaffRoleArchiveImpact(rawImpact));
          check(impact.roleId === roleId && impact.version === role.version && impact.replacementRoleId === null
            && impact.revokeAssignments === false && impact.affectedMembershipIds.length === 0
            && impact.addedPermissionKeys.length === 0 && sameSet(impact.removedPermissionKeys, role.permissionKeys));
          const receipt = await command("staff_role_command", { p_organization_id: organizationId, p_role_id: roleId,
            p_expected_version: role.version, p_operation: "archive", p_payload: { replacementRoleId: null, revokeAssignments: false,
              expectedImpactFingerprint: impact.impactFingerprint }, p_reason: reason });
          const archived = (await workspace()).roles.find((entry) => entry.id === roleId);
          check(receipt?.version === role.version + 1 && archived?.status === "archived" && archived.memberCount === 0 && archived.version === receipt.version);
        });
      }
      if (departmentId) {
        await restore(async () => {
          const department = (await directory()).departments.find((entry) => entry.id === departmentId);
          check(department?.member_count === 0);
          const receipt = await command("staff_department_command", { p_organization_id: organizationId, p_department_id: departmentId,
            p_expected_version: department.version, p_operation: "archive", p_name: null, p_description: null, p_reason: reason });
          await refreshAdmin();
          const archived = (await directory()).departments.find((entry) => entry.id === departmentId);
          check(receipt?.version === department.version + 1 && archived?.status === "archived" && archived.member_count === 0 && archived.version === receipt.version);
        });
      }
      await restore(async () => {
        const restored = await workspace(), restoredDirectory = await directory();
        const restoredDetails = details(restoredDirectory, admissions.membershipId);
        check(restored.members.length === initial.members.length && initial.members.every((before) => {
          const after = restored.members.find((entry) => entry.membershipId === before.membershipId);
          return after?.systemRole === before.systemRole && after.displayName === before.displayName && after.accessVersion >= before.accessVersion
            && sameSet(after.assignments.map(pair), before.assignments.map(pair));
        }) && JSON.stringify(restored.roles.filter((entry) => !temporaryRoles.includes(entry.id))) === JSON.stringify(initial.roles)
          && JSON.stringify(restored.permissions) === JSON.stringify(initial.permissions)
          && JSON.stringify(restored.departments.filter((entry) => entry.id !== departmentId)) === JSON.stringify(initial.departments)
          && restoredDetails.department_id === originalDetails.department_id && restoredDetails.job_title === originalDetails.job_title
          && sameSet(restoredDetails.direction_codes, originalDetails.direction_codes)
          && JSON.stringify(personalState(details(restoredDirectory, admin.membershipId))) === JSON.stringify(originalPersonal));
      });
    }
  }
  if (failure) throw failure;
  return { schemaVersion: 1, edits: 4, proof: { ordinaryHandoff: true, canonicalDirection: true,
    independentDepartmentRead: true, independentDirectionRead: true, combinedRead: true, sameCard: true,
    versionIncrements: 4, assignedRoleArchive: true, archiveVersionIncrements: 2,
    assignmentsRestored: true, personalGrantsRestored: true, organizationalDetailsRestored: true,
    temporaryRolesArchived: true, temporaryDepartmentArchived: true, otherMembersUnchangedDuringEdits: true, noBrowserErrors: true } };
}
