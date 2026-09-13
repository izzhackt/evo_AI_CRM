import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { parseStaffAccessSnapshot } from "../../src/lib/supabase/platform-authority.ts";
import { parseStaffRoleWorkspace, parseStaffRoleCommandResult, parseStaffRoleImpact } from "../../src/lib/v3/staff-roles-contract.ts";
import { parseStaffAuthClaim, parseStaffAuthResult, parseStaffAuthPreparation,
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

/** Issue exactly one immutable prepared request. An uncertain dispatch is never retried. */
export async function dispatchScopedStaffInvitation({ adminClient, authAdminClient, apiUrl, organizationId, appOrigin, identity, assignments, requestId }) {
  apiUrl = localStaffOrigin(apiUrl); appOrigin = localStaffOrigin(appOrigin);
  localClient(adminClient, apiUrl); localClient(authAdminClient, apiUrl);
  uuid(organizationId); uuid(requestId); localIdentity(identity);
  assignments = strictParse(() => parseStaffInviteAssignmentInputs(assignments, false, organizationId));
  await requireAdmin(adminClient, organizationId);
  const raw = await rpc(adminClient, "staff_workspace_claim_auth", {
    p_organization_id: organizationId, p_request_id: requestId, p_operation: "invite",
    p_email: identity.email, p_display_name: identity.displayName, p_membership_id: null,
    p_assignments: assignments, p_no_access: false, p_reason: REASON, p_expected_access_version: null,
  }, requestId);
  const claim = strictParse(() => parseStaffAuthClaim(raw, requestId, identity.email));
  if (claim.dispatch) {
    // The real Supabase invitation sends a local email; no generated-link shortcut.
    // https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail
    try {
      const result = await authAdminClient.auth.admin.inviteUserByEmail(identity.email, {
        redirectTo: `${appOrigin}/auth/staff`, data: { evo_staff_invitation_request_id: requestId },
      });
      if (result.error || !result.data?.user || !UUID.test(result.data.user.id)
        || result.data.user.email !== identity.email || !result.data.user.invited_at
        || result.data.user.email_confirmed_at || result.data.user.confirmed_at) {
        throw new ScopedStaffProvisioningError("LOCAL_STAFF_INVITE_NOT_CONFIRMED", requestId);
      }
    } catch { throw new ScopedStaffProvisioningError("LOCAL_STAFF_INVITE_OUTCOME_UNKNOWN", requestId); }
  }
  const reconciled = await rpc(adminClient, "staff_workspace_reconcile_auth", {
    p_organization_id: organizationId, p_request_id: requestId,
  }, requestId);
  const result = strictParse(() => parseStaffAuthResult(reconciled, "invite"));
  requireValue(result.status === "completed", "LOCAL_STAFF_INVITE_RECONCILIATION_REQUIRED");
  const selected = await rpc(adminClient, "staff_workspace_auth_preparation", { p_organization_id: organizationId, p_request_id: requestId });
  const preparation = strictParse(() => parseStaffAuthPreparation(selected, { organizationId, requestId }));
  requireValue(preparation.status === "completed" && preparation.operation === "invite" && !preparation.noAccess
    && preparation.targetMembershipId && preparation.displayName === identity.displayName
    && sameSet(preparation.assignments.map(pair), assignments.map(pair))
    && preparation.assignments.every((row) => assignments.some((expected) => pair(expected) === pair(row) && expected.roleVersion === row.roleVersion)), "LOCAL_STAFF_PREPARATION_MISMATCH");
  return { requestId, membershipId: preparation.targetMembershipId, preparationVersion: preparation.preparationVersion,
    assignments, permissionKeys: [...new Set(preparation.assignments.flatMap((row) => row.permissionKeys))].sort() };
}

/** Phase one; call only after an isolated app and its local email sink are ready. */
export async function prepareScopedStaffInvitations({ adminClient, authAdminClient, apiUrl, organizationId, appOrigin, identities }) {
  try {
    apiUrl = localStaffOrigin(apiUrl); appOrigin = localStaffOrigin(appOrigin);
    localClient(adminClient, apiUrl); localClient(authAdminClient, apiUrl); uuid(organizationId);
    SCENARIOS.forEach((scenario) => localIdentity(identities[scenario]));
    requireValue(identities.sales.email !== identities.admissions.email, "LOCAL_STAFF_IDENTITIES_NOT_DISTINCT");
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
    const invitations = [];
    for (const scenario of SCENARIOS) {
      const selectedRoles = roles.filter((row) => row.scenario === scenario);
      const invitation = await dispatchScopedStaffInvitation({ adminClient, authAdminClient, apiUrl, organizationId, appOrigin,
        identity: identities[scenario], requestId: randomUUID(),
        assignments: selectedRoles.map(({ roleId, roleVersion, scope }) => ({ roleId, roleVersion, scope })),
      });
      requireValue(sameSet(invitation.permissionKeys, new Set(selectedRoles.flatMap((row) => row.permissionKeys))), "LOCAL_STAFF_EFFECTIVE_PERMISSIONS_MISMATCH");
      invitations.push({ scenario, ...invitation });
    }
    return { schemaVersion: 1, organizationId, invitations };
  } catch (error) {
    if (error instanceof ScopedStaffProvisioningError) throw error;
    throw new ScopedStaffProvisioningError("LOCAL_STAFF_PREPARATION_FAILED");
  }
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
    const archive = page.getByRole("form", { name: "Архивировать роль", exact: true });
    await archive.getByLabel("Причина", { exact: true }).fill(reason);
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
      impactReviewed: true, published: true, copied: true, archived: true, restored: true, existingAccessUnchanged: true }, screenshots };
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
        })}\n`);
      } catch { /* Page setup or closure can make even fixed counters unavailable. */ }
    }
    // No raw Playwright diagnostics: they can contain passwords, request bodies or URLs.
    throw new ScopedStaffProvisioningError(`LOCAL_ROLE_EDITOR_${stage}_FAILED`);
  } finally { if (context) await context.close().catch(() => {}); }
}
