import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { buildScopedStaffBaselines, localStaffOrigin, staffInvitationLink, dispatchScopedStaffInvitation,
  prepareScopedStaffInvitations, acceptScopedStaffInvitations, verifyScopedStaffRoleEditor } from "../scripts/lib/scoped-staff-provisioner.mjs";

const org = "51000000-0000-4000-8000-000000000001";
const request = "51000000-0000-4000-8000-000000000002";
const member = "51000000-0000-4000-8000-000000000003";
const roleId = "51000000-0000-4000-8000-000000000004";
const bundle = "51000000-0000-4000-8000-000000000005";
const userId = "51000000-0000-4000-8000-000000000006";
const profileId = "51000000-0000-4000-8000-000000000007";
const assignment = { roleId, roleVersion: 2, scope: { kind: "own", key: null, resourceKind: null } };
const apiUrl = "http://127.0.0.1:45421";
const appOrigin = "http://127.0.0.1:38971";
const identity = { email: "sales-proof@evo.local.test", displayName: "Local Sales" };
const orgKeys = ["staff.task.create", "staff.assistant.use", "team.chat.general", "team.chat.sales", "team.chat.admissions",
  "workflow.contract.read", "reply.snippet.all", "reply.snippet.manage", "reply.snippet.sales", "reply.snippet.admissions",
  "company.file.read", "company.file.download", "company.file.upload", "company.file.manage"];
const ownKeys = ["staff.task.read", "staff.task.edit", "staff.task.complete", "lead.read", "case.read.full", "task.manage", "task.create",
  "document.download", "document.upload", "communication.manual.send", "finance.read.summary", "case.workflow.read",
  "amocrm.command.manage", "finance.stop.create", "sales.register.read", "sales.register.manage"];
const permissions = [...orgKeys.map((key) => ({ key, allowedScopes: ["organization"] })),
  ...ownKeys.map((key) => ({ key, allowedScopes: ["own", "organization", "record"] })),
  { key: "contract.evidence.confirm", allowedScopes: ["organization"], sensitive: true },
  { key: "membership.provision", allowedScopes: ["organization"], systemOnly: true }]
  .map((entry) => ({ label: entry.key, group: "test", resourceKinds: ["organization"], sensitive: false, systemOnly: false, ...entry }));
const baseline = { sales: ["lead.read", "task.manage", "workflow.contract.read", "communication.manual.send", "contract.evidence.confirm", "membership.provision"],
  admissions: ["lead.read", "case.read.full", "task.manage", "workflow.contract.read", "document.download", "document.upload", "communication.manual.send", "finance.read.summary"] };
const adminSnapshot = { schemaVersion: 1, authUserId: userId, profileId, membershipId: member, organizationId: org,
  displayName: "Local Admin", systemRole: "admin", accessVersion: 1, assignments: [], permissions: ["membership.provision"] };

test("fixture roles reproduce155 own/organization split without sensitive or cross-case broadening", () => {
  const rows = buildScopedStaffBaselines({ permissions, baseline });
  assert.equal(rows.length, 4);
  const own = rows.find((row) => row.scenario === "sales" && row.kind === "own").permissionKeys;
  assert.ok(own.includes("task.create") && !own.includes("task.manage"));
  assert.ok(own.includes("amocrm.command.manage") && own.includes("case.workflow.read"));
  assert.ok(own.includes("sales.register.read") && own.includes("sales.register.manage"));
  const admissionsOwn = rows.find((row) => row.scenario === "admissions" && row.kind === "own").permissionKeys;
  assert.ok(admissionsOwn.includes("finance.stop.create") && admissionsOwn.includes("document.download"));
  const admissionsOrg = rows.find((row) => row.scenario === "admissions" && row.kind === "organization").permissionKeys;
  assert.ok(admissionsOrg.includes("company.file.download") && !admissionsOrg.includes("document.download"));
  assert.ok(!admissionsOrg.includes("case.read.full"));
  for (const row of rows) assert.ok(!row.permissionKeys.includes("contract.evidence.confirm") && !row.permissionKeys.includes("membership.provision"));
});

test("baseline catalogue drift fails rather than silently changing scope", () => {
  assert.throws(() => buildScopedStaffBaselines({ permissions: permissions.filter((entry) => entry.key !== "team.chat.sales"), baseline }), /BASELINE_SCOPE_DRIFT/);
  assert.throws(() => buildScopedStaffBaselines({ permissions: [...permissions, permissions[0]], baseline }), /CATALOGUE_INVALID/);
  assert.throws(() => buildScopedStaffBaselines({ permissions, baseline: { ...baseline, sales: [] } }), /BASELINE_INVALID/);
});

test("helper accepts exact loopback origins only", () => {
  assert.equal(localStaffOrigin(`${appOrigin}/`), appOrigin);
  for (const value of ["https://crm.example.com", `${appOrigin}/auth/staff`, `${appOrigin}?key=secret`, `${appOrigin}#token`,
    "http://user:secret@127.0.0.1:8080", "file:///tmp/app", "not-url"]) assert.throws(() => localStaffOrigin(value));
});

test("captured invitation must be one exact app-local Staff TokenHash link", () => {
  const token = "a".repeat(56);
  const link = `${appOrigin}/auth/staff?token_hash=${token}&type=invite`;
  assert.equal(staffInvitationLink(`<a href="${link.replaceAll("&", "&amp;")}">Continue</a>`, appOrigin), link);
  for (const target of [link.replace(appOrigin, "https://external.example"), link.replace("/auth/staff", "/auth/callback"),
    `${link}&token_hash=${token}`, link.replace("type=invite", "type=recovery"), `${link}#access_token=secret`]) {
    assert.throws(() => staffInvitationLink(`<a href="${target}">Continue</a>`, appOrigin));
  }
  assert.throws(() => staffInvitationLink(`<a href="${link}">One</a><a href="${link}">Two</a>`, appOrigin));
});

function clients(options = {}) {
  const calls = [];
  let invited = 0;
  const adminClient = { supabaseUrl: apiUrl, auth: { getUser: async () => ({ data: { user: { id: userId, email: "admin@evo.local.test" } }, error: null }) },
    schema: () => ({ rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "staff_access_snapshot") return { data: adminSnapshot };
      if (name === "staff_workspace_claim_auth") return options.claimError ? { error: { code: "40001", message: "private details" } }
        : { data: { id: request, dispatch: !options.replay, status: options.replay ? "completed" : "dispatching", ...(!options.replay ? { email: identity.email } : {}) } };
      if (name === "staff_workspace_reconcile_auth") return { data: { status: options.pending ? "reconciliation_required" : "completed", operation: "invite" } };
      if (name === "staff_workspace_auth_preparation") return { data: { schemaVersion: 1, requestId: request, operation: "invite", status: "completed",
        displayName: identity.displayName, preparationVersion: 1, conflictCode: null, noAccess: false, targetMembershipId: member,
        assignments: [{ ...assignment, roleVersion: options.changedVersion ? 3 : 2, bundleId: bundle, bundleVersion: 1, label: "Local Sales", permissionKeys: ["lead.read"] }] } };
      throw new Error("unexpected RPC");
    } }) };
  const authAdminClient = { supabaseUrl: apiUrl, auth: { admin: { inviteUserByEmail: async (email, params) => {
    invited += 1; calls.push({ name: "inviteUserByEmail", email, params });
    if (options.throwAuth) throw new Error("private token and email");
    return { data: { user: { id: userId, email, invited_at: "2026-09-13T00:00:00Z", email_confirmed_at: null } } };
  } } } };
  return { calls, adminClient, authAdminClient, count: () => invited };
}
function input(fixture) { return { ...fixture, apiUrl, appOrigin, organizationId: org, identity, assignments: [assignment], requestId: request }; }

test("invitation requires prepared157 claim and reconciled exact membership, with no private return fields", async () => {
  const fixture = clients();
  const result = await dispatchScopedStaffInvitation(input(fixture));
  assert.equal(result.membershipId, member);
  assert.deepEqual(result.permissionKeys, ["lead.read"]);
  assert.equal(fixture.count(), 1);
  const claim = fixture.calls.find((call) => call.name === "staff_workspace_claim_auth");
  assert.deepEqual(claim.args.p_assignments, [assignment]);
  assert.equal(Object.hasOwn(claim.args, "p_role"), false);
  assert.equal(fixture.calls.find((call) => call.name === "inviteUserByEmail").params.data.evo_staff_invitation_request_id, request);
  assert.doesNotMatch(JSON.stringify(result), /email|authUser|password|token|@/);
});

test("immutable replay reconciles but never sends another invitation", async () => {
  const fixture = clients({ replay: true });
  assert.equal((await dispatchScopedStaffInvitation(input(fixture))).membershipId, member);
  assert.equal(fixture.count(), 0);
});

test("fresh fixtures create and publish four versioned roles before any prepared invitation", async () => {
  const calls = [];
  const roles = new Map();
  const claims = new Map();
  const sourceIds = { sales: roleId, curator: bundle };
  const adminClient = { supabaseUrl: apiUrl,
    auth: { getUser: async () => ({ data: { user: { id: userId, email: "admin@evo.local.test" } } }) },
    schema: () => ({
      from(table) {
        const result = table === "role_bundle_versions"
          ? { data: [{ id: roleId, role: "sales", version: 1 }, { id: bundle, role: "curator", version: 1 }] }
          : { data: Object.entries(baseline).flatMap(([scenario, keys]) => keys.map((key) => ({
            bundle_id: sourceIds[scenario === "sales" ? "sales" : "curator"], permission_key: key,
          }))) };
        const query = { select: () => query, eq: () => query, in: () => query, order: () => query,
          then: (resolve) => Promise.resolve(result).then(resolve) };
        return query;
      },
      async rpc(name, args) {
        calls.push(name);
        if (name === "staff_access_snapshot") return { data: adminSnapshot };
        if (name === "staff_role_workspace") return { data: { schemaVersion: 1, permissions, roles: [], members: [], departments: [] } };
        if (name === "staff_role_command") {
          assert.equal(args.p_expected_version, 0);
          roles.set(args.p_role_id, args.p_payload);
          return { data: { status: "applied", roleId: args.p_role_id, version: 1 } };
        }
        if (name === "staff_role_impact") {
          assert.equal(args.p_expected_version, 1);
          assert.ok(roles.has(args.p_role_id));
          return { data: { roleId: args.p_role_id, version: 1, affectedMembershipIds: [],
            addedPermissionKeys: roles.get(args.p_role_id).permissionKeys, removedPermissionKeys: [],
            impactFingerprint: "a".repeat(64) } };
        }
        if (name === "staff_role_publish") {
          assert.equal(args.p_expected_version, 1);
          assert.ok(roles.has(args.p_role_id));
          assert.equal(calls.at(-2), "staff_role_impact");
          assert.equal(args.p_expected_impact_fingerprint, "a".repeat(64));
          return { data: { status: "applied", roleId: args.p_role_id, version: 2, bundleId: bundle, bundleVersion: 1, affectedMembershipIds: [] } };
        }
        if (name === "staff_workspace_claim_auth") {
          assert.equal(roles.size, 4);
          assert.equal(calls.filter((name) => name === "staff_role_publish").length, 4);
          claims.set(args.p_request_id, args);
          return { data: { id: args.p_request_id, dispatch: true, status: "dispatching", email: args.p_email } };
        }
        if (name === "staff_workspace_reconcile_auth") return { data: { status: "completed", operation: "invite" } };
        if (name === "staff_workspace_auth_preparation") {
          const claim = claims.get(args.p_request_id);
          return { data: { schemaVersion: 1, requestId: args.p_request_id, operation: "invite", status: "completed",
            displayName: claim.p_display_name, preparationVersion: 1, conflictCode: null, noAccess: false,
            targetMembershipId: claim.p_email === identity.email ? member : profileId,
            assignments: claim.p_assignments.map((entry) => ({ ...entry, bundleId: bundle, bundleVersion: 1,
              label: roles.get(entry.roleId).label, permissionKeys: roles.get(entry.roleId).permissionKeys })) } };
        }
        throw new Error("unexpected RPC");
      },
    }) };
  const authAdminClient = { supabaseUrl: apiUrl, auth: { admin: { inviteUserByEmail: async (email) => {
    calls.push("inviteUserByEmail");
    return { data: { user: { id: userId, email, invited_at: "2026-09-13T00:00:00Z", email_confirmed_at: null } } };
  } } } };
  const result = await prepareScopedStaffInvitations({ adminClient, authAdminClient, apiUrl, appOrigin, organizationId: org,
    identities: { sales: identity, admissions: { email: "admissions-proof@evo.local.test", displayName: "Local Admissions" } } });
  assert.equal(result.invitations.length, 2);
  assert.equal(calls.filter((name) => name === "inviteUserByEmail").length, 2);
  for (const invitation of result.invitations) {
    assert.equal(invitation.assignments.length, 2);
    assert.deepEqual(invitation.assignments.map((row) => row.scope), [{ kind: "own", key: null, resourceKind: null },
      { kind: "organization", key: org, resourceKind: null }]);
  }
  assert.doesNotMatch(JSON.stringify(result), /email|authUser|password|token|@/);
});

test("unknown Auth dispatch stops with request identity and no resend or fabricated success", async () => {
  const fixture = clients({ throwAuth: true });
  await assert.rejects(dispatchScopedStaffInvitation(input(fixture)), (error) => {
    assert.equal(error.code, "LOCAL_STAFF_INVITE_OUTCOME_UNKNOWN");
    assert.equal(error.requestId, request);
    assert.doesNotMatch(error.message, /private token|@/);
    return true;
  });
  assert.equal(fixture.count(), 1);
  assert.equal(fixture.calls.some((call) => call.name === "staff_workspace_reconcile_auth"), false);
});

test("claim rejection, pending reconcile and drifted preparation cannot produce success", async () => {
  const rejected = clients({ claimError: true });
  await assert.rejects(dispatchScopedStaffInvitation(input(rejected)), /COMMAND_NOT_CONFIRMED/);
  assert.equal(rejected.count(), 0);
  await assert.rejects(dispatchScopedStaffInvitation(input(clients({ pending: true }))), /RECONCILIATION_REQUIRED/);
  await assert.rejects(dispatchScopedStaffInvitation(input(clients({ changedVersion: true }))), /PREPARATION_MISMATCH/);
});

test("neither phase accepts external clients or real recipients", async () => {
  const fixture = clients();
  fixture.authAdminClient.supabaseUrl = "https://real.supabase.co";
  await assert.rejects(dispatchScopedStaffInvitation(input(fixture)), /NOT_LOOPBACK/);
  await assert.rejects(dispatchScopedStaffInvitation({ ...input(clients()), identity: { ...identity, email: "person@gmail.com" } }), /SYNTHETIC_EMAIL_REQUIRED/);
  await assert.rejects(prepareScopedStaffInvitations({ ...input(clients()), identities: { sales: identity, admissions: identity } }), /IDENTITIES_NOT_DISTINCT/);
  await assert.rejects(acceptScopedStaffInvitations({ apiUrl, appOrigin, mailpitOrigin: "https://external.example" }), /NOT_LOOPBACK/);
});

test("browser proof uses local mail, explicit callback, fresh password login and live snapshot, never old provisioning", () => {
  const source = readFileSync(new URL("../scripts/lib/scoped-staff-provisioner.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /provision_pilot_staff_member|change_pilot_staff_status|generateLink|createUser\(|email_confirm:\s*true|request\.jwt\.claims/);
  assert.match(source, /staff_role_command/); assert.match(source, /staff_role_publish/);
  assert.match(source, /api\/v1\/messages/); assert.match(source, /api\/v1\/message/);
  assert.match(source, /LOCAL_STAFF_GET_CONSUMED_INVITE/);
  assert.match(source, /getByRole\("button", \{ name: "Продолжить", exact: true \}\)\.click/);
  assert.match(source, /getUserById/); assert.match(source, /signInWithPassword/); assert.match(source, /staff_access_snapshot/);
  const onboarding = source.slice(0, source.indexOf("function roleEditorEvidenceDirectory"));
  assert.doesNotMatch(onboarding, /\.screenshot\(|\.tracing\.|console\.(log|error)/);
});

for (const [stage, expectedCode] of [
  ["invite-open", "LOCAL_STAFF_BROWSER_INVITE_OPEN_FAILED"],
  ["password-ready", "LOCAL_STAFF_BROWSER_PASSWORD_READY_FAILED"],
]) {
  test(`browser ${stage} failure reports only its safe stage and closes the stub context`, async (t) => {
    // All external boundaries are stubs: this is not a real Auth/browser acceptance proof.
    const mailpitOrigin = "http://127.0.0.1:45971";
    const token = "b".repeat(56);
    const link = `${appOrigin}/auth/staff?token_hash=${token}&type=invite`;
    const password = randomUUID();
    const privateFailure = () => new Error(`Browser failed at ${link}; password=${password}; recipient=${identity.email}`);
    const adminClient = {
      supabaseUrl: apiUrl,
      auth: { getUser: async () => ({ data: { user: { id: userId, email: "admin@evo.local.test" } } }) },
      schema: () => ({ rpc: async (name) => {
        if (name === "staff_access_snapshot") return { data: adminSnapshot };
        if (name === "staff_directory") return { data: [{ membership_id: member, membership_status: "active", auth_user_id: userId }] };
        throw new Error("Unexpected stub RPC");
      } }),
    };
    const authAdminClient = { supabaseUrl: apiUrl, auth: { admin: { getUserById: async () => ({ data: { user: {
      id: userId, email: identity.email, invited_at: "2026-09-13T00:00:00Z", email_confirmed_at: null,
      user_metadata: { evo_staff_invitation_request_id: request },
    } } }) } } };
    t.mock.method(globalThis, "fetch", async (url) => {
      if (url === `${mailpitOrigin}/api/v1/messages`) {
        return new Response(JSON.stringify({ messages: [{ ID: "stub-invite", To: [{ Address: identity.email }] }] }));
      }
      assert.equal(url, `${mailpitOrigin}/api/v1/message/stub-invite`);
      return new Response(JSON.stringify({ HTML: `<a href="${link}">Accept invitation</a>` }));
    });
    let continued = false;
    let closed = 0;
    const page = {
      setDefaultTimeout() {},
      async goto(url) {
        assert.equal(url, link);
        if (stage === "invite-open") throw privateFailure();
      },
      getByRole: () => ({ click: async () => { continued = true; } }),
      getByLabel: () => ({ waitFor: async () => { throw privateFailure(); } }),
    };
    const browser = { newContext: async () => ({
      route: async () => {}, newPage: async () => page, close: async () => { closed += 1; },
    }) };
    const prepared = { schemaVersion: 1, organizationId: org, invitations: [
      { scenario: "sales", requestId: request, membershipId: member, preparationVersion: 1,
        assignments: [assignment], permissionKeys: ["lead.read"] },
      { scenario: "admissions", requestId: "51000000-0000-4000-8000-000000000008",
        membershipId: "51000000-0000-4000-8000-000000000009", preparationVersion: 1,
        assignments: [assignment], permissionKeys: ["case.read.full"] },
    ] };
    await assert.rejects(acceptScopedStaffInvitations({ browser, adminClient, authAdminClient, apiUrl,
      publishableKey: "synthetic-public-key-only", mailpitOrigin, appOrigin, prepared,
      identities: { sales: { ...identity, password }, admissions: { email: "admissions-proof@evo.local.test", password } },
    }), (error) => {
      assert.equal(error.code, expectedCode);
      assert.equal(error.message, expectedCode);
      assert.equal(error.cause, undefined);
      const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
      for (const privateValue of [link, token, password, identity.email]) assert.equal(serialized.includes(privateValue), false);
      return true;
    });
    assert.equal(continued, stage === "password-ready");
    assert.equal(closed, 1);
  });
}

// A fake UI/repository boundary only: this tests helper sequencing and safe
// diagnostics. It is explicitly not browser, Auth, SQL or role-editor acceptance.
function roleEditorBoundary({ failureAction, alterExistingAccess = false } = {}) {
  const actions = [], reads = [];
  const editorIdentity = { email: "admin@evo.local.test", password: randomUUID() };
  const privateError = new Error(`${editorIdentity.email} ${editorIdentity.password} ${appOrigin}/login?token=private`);
  const permissions = [
    { key: "team.chat.general", label: "Чат", group: "Команда", allowedScopes: ["organization"], resourceKinds: ["organization"], sensitive: false, systemOnly: false },
    { key: "staff.assistant.use", label: "Помощник", group: "Команда", allowedScopes: ["organization"], resourceKinds: ["organization"], sensitive: false, systemOnly: false },
  ];
  const ids = ["51000000-0000-4000-8000-000000000021", "51000000-0000-4000-8000-000000000022"];
  const members = [{ membershipId: member, displayName: "Local Admin", systemRole: "admin", accessVersion: 1, assignments: [] }];
  const rows = [];
  let selected, draft, operation, pageUrl = `${appOrigin}/login`, closed = 0;
  const act = (name) => { actions.push(name); if (name === failureAction) throw privateError; };
  const emptyRole = (id) => ({ id, label: "", description: "", version: 0, status: "active", bundleId: null,
    bundleVersion: null, permissionKeys: [], draftPermissionKeys: [], memberCount: 0 });
  const locator = (name = "") => ({
    getByRole: (_role, options = {}) => locator(options.name ?? ""), getByLabel: (label) => locator(label),
    getByText: (text) => locator(text), locator: (selector) => locator(selector),
    filter: ({ hasText }) => locator(`select:${hasText}`),
    async fill(value) {
      act(`fill:${name}`);
      if (name === "Название роли") draft.label = value;
      if (name === "Для какой работы") draft.description = value;
    },
    async inputValue() { return name.includes("expected_version") ? String(draft.version) : draft.id; },
    async check() {
      act(`check:${name}`);
      const permission = permissions.find(({ label }) => label === name);
      if (permission && !draft.draftPermissionKeys.includes(permission.key)) draft.draftPermissionKeys.push(permission.key);
    },
    async click() {
      act(`click:${name}`);
      if (name === "Создать роль") { draft = emptyRole(ids[0]); operation = "create"; }
      else if (name === "Изменить") { draft = structuredClone(selected); operation = "save"; }
      else if (name === "Скопировать") { draft = { ...emptyRole(ids[1]), draftPermissionKeys: [...selected.draftPermissionKeys] }; operation = "copy"; }
      else if (name === "Сохранить черновик") {
        draft.version += 1;
        const index = rows.findIndex(({ id }) => id === draft.id);
        if (index < 0) rows.push(structuredClone(draft)); else rows[index] = structuredClone(draft);
        actions.push(`command:${operation}`);
        if (alterExistingAccess) members[0].accessVersion += 1;
      } else if (name === "Открыть роль") selected = rows.find(({ id }) => id === draft.id);
      else if (name.startsWith("select:")) {
        selected = rows.find(({ label }) => label === name.slice(7));
        assert.ok(selected);
      } else if (name === "Применить изменения") {
        selected.version += 1; selected.bundleId = bundle; selected.bundleVersion = 1;
        selected.permissionKeys = [...selected.draftPermissionKeys]; actions.push("command:publish");
      } else if (name === "Перенести в архив" || name === "Восстановить роль") {
        selected.version += 1; selected.status = name === "Перенести в архив" ? "archived" : "active";
        actions.push(name === "Перенести в архив" ? "command:archive" : "command:restore");
      }
      if (selected) pageUrl = `${appOrigin}/v3/settings?section=staff&view=roles&role=${selected.id}`;
    },
    async waitFor() { act(`wait:${name}`); },
    async getAttribute(attribute) { return attribute === "data-system-role" ? "admin" : "actual"; },
    async count() { return 0; },
  });
  const page = { ...locator(), setDefaultTimeout() {}, on() {}, url: () => pageUrl,
    getByTestId: () => locator("shell"), async goto(url) { act("goto"); pageUrl = url; },
    async screenshot() { assert.fail("No default screenshots, especially during login"); },
  };
  const browser = { async newContext(options) {
    assert.equal(options.serviceWorkers, "block"); assert.equal(options.acceptDownloads, false);
    return { async route() {}, async newPage() { return page; }, async close() { closed += 1; } };
  } };
  const adminClient = { supabaseUrl: apiUrl, auth: { getUser: async () => ({ data: { user: { id: userId, email: editorIdentity.email } } }) },
    schema: () => ({ async rpc(name) {
      reads.push(name);
      if (name === "staff_access_snapshot") return { data: adminSnapshot };
      if (name === "staff_role_workspace") return { data: structuredClone({ schemaVersion: 1, permissions, roles: rows, members, departments: [] }) };
      if (name === "staff_role_impact") return { data: { roleId: selected.id, version: selected.version,
        affectedMembershipIds: [], addedPermissionKeys: [...selected.draftPermissionKeys].sort(), removedPermissionKeys: [],
        impactFingerprint: "a".repeat(64) } };
      assert.fail(`Unexpected helper RPC: ${name}`);
    } }) };
  return { input: { browser, adminClient, apiUrl, appOrigin, organizationId: org, identity: editorIdentity },
    actions, reads, rows, closed: () => closed };
}

test("role editor coordinator uses UI commands, read-only canonical checks and no default artifacts", async () => {
  const fixture = roleEditorBoundary();
  const result = await verifyScopedStaffRoleEditor(fixture.input);
  assert.deepEqual(fixture.actions.filter((name) => name.startsWith("command:")),
    ["command:create", "command:save", "command:publish", "command:copy", "command:archive", "command:restore"]);
  assert.ok(fixture.reads.every((name) => ["staff_access_snapshot", "staff_role_workspace", "staff_role_impact"].includes(name)));
  assert.equal(fixture.reads.filter((name) => name === "staff_role_workspace").length, 8);
  assert.equal(fixture.rows.length, 2);
  assert.ok(fixture.rows.every((row) => row.memberCount === 0 && row.status === "active"));
  assert.deepEqual(result.screenshots, []);
  assert.equal(result.proof.existingAccessUnchanged, true);
  assert.equal(fixture.closed(), 1);
  assert.doesNotMatch(JSON.stringify(result), /email|password|token|membershipId|roleId|@/);
});

for (const [failureAction, code] of [["goto", "LOCAL_ROLE_EDITOR_LOGIN_FAILED"],
  ["click:Создать роль", "LOCAL_ROLE_EDITOR_CREATE_FAILED"],
  ["click:Применить изменения", "LOCAL_ROLE_EDITOR_PUBLISH_FAILED"]]) {
  test(`role editor redacts ${code} without retrying the UI command`, async () => {
    const fixture = roleEditorBoundary({ failureAction });
    await assert.rejects(verifyScopedStaffRoleEditor(fixture.input), (error) => {
      assert.equal(error.code, code); assert.equal(error.message, code); assert.equal(error.cause, undefined);
      const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
      for (const value of [fixture.input.identity.email, fixture.input.identity.password, appOrigin, "token=private"]) assert.ok(!serialized.includes(value));
      return true;
    });
    assert.equal(fixture.actions.filter((name) => name === failureAction).length, 1);
    assert.equal(fixture.closed(), 1);
  });
}

test("role editor refuses a changed existing access version before another command", async () => {
  const fixture = roleEditorBoundary({ alterExistingAccess: true });
  await assert.rejects(verifyScopedStaffRoleEditor(fixture.input), /LOCAL_ROLE_EDITOR_CREATE_READBACK_FAILED/);
  assert.deepEqual(fixture.actions.filter((name) => name.startsWith("command:")), ["command:create"]);
  assert.equal(fixture.closed(), 1);
});

test("role editor keeps local clients and explicit private evidence boundary before opening a browser", async () => {
  for (const changes of [{ apiUrl: "https://external.example" }, { evidenceDirectory: "relative-evidence" },
    { evidenceDirectory: new URL("../", import.meta.url).pathname }, { identity: { email: "person@example.com", password: randomUUID() } }]) {
    const fixture = roleEditorBoundary();
    await assert.rejects(verifyScopedStaffRoleEditor({ ...fixture.input, ...changes }), /LOCAL_ROLE_EDITOR_SETUP_FAILED/);
    assert.deepEqual(fixture.actions, []); assert.equal(fixture.closed(), 0);
  }
});

test("role editor marker stays distinct and follows successful onboarding before any optional screenshots", () => {
  const helper = readFileSync(new URL("../scripts/lib/scoped-staff-provisioner.mjs", import.meta.url), "utf8");
  const wrapper = readFileSync(new URL("../scripts/provision-local-supabase-staff.mjs", import.meta.url), "utf8");
  assert.match(wrapper, /accepted = await acceptScopedStaffInvitations[\s\S]*await verifyScopedStaffRoleEditor[\s\S]*LOCAL_SCOPED_STAFF_ROLE_EDITOR_VERIFIED/);
  assert.match(wrapper, /LOCAL_SUPABASE_STAFF_ONBOARDING_VERIFIED/);
  assert.match(helper, /if \(evidence\) \{[\s\S]*await cleanSettings\(\)[\s\S]*page\.screenshot/);
  assert.match(helper, /flag: "wx", mode: 0o600/);
  const editor = helper.slice(helper.indexOf("export async function verifyScopedStaffRoleEditor"));
  assert.doesNotMatch(editor, /inviteUserByEmail|signInWithPassword|staff_role_command|staff_role_publish|staff_role_assignments_save|storageState|addCookies/);
});
