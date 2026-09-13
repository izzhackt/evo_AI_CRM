import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { buildScopedStaffBaselines, localStaffOrigin, staffInvitationLink,
  prepareScopedStaffInvitations, acceptScopedStaffInvitations, verifyScopedStaffRoleEditor,
  verifyScopedStaffBusinessScopes } from "../scripts/lib/scoped-staff-provisioner.mjs";

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

test("foundation failure output forwards only the exact role-editor machine observations", () => {
  const harness = readFileSync(new URL("../scripts/test-postgres-v2-foundation.sh", import.meta.url), "utf8");
  const pattern = harness.match(/role_editor_diagnostic="\$\(grep -m 1 -E '([^']+)' "\$staff_provision_log" \|\| true\)"/)?.[1];
  assert.ok(pattern, "The harness must retain the bounded role-editor observation before cleanup");
  assert.match(harness, /\[\[ -z "\$role_editor_diagnostic" \]\] \|\| echo "\$role_editor_diagnostic" >&2/);
  const line = 'LOCAL_ROLE_EDITOR_UI_STATE:{"stage":"CREATE_ID","roleEditors":0,"createButtons":1,"archiveForms":0,"restoreForms":0,"emptyDetails":1,"createClickHandlerBefore":false,"createClickHandlerAtFailure":true,"mainFrameNavigationsSinceCreateAttempt":0,"clientError":false}';
  const select = (input) => spawnSync("grep", ["-m", "1", "-E", pattern], { input, encoding: "utf8" }).stdout.trim();
  assert.equal(select(`private log before\n${line}\nprivate log after\n`), line);
  const unavailable = line.replace('"createClickHandlerBefore":false', '"createClickHandlerBefore":null')
    .replace('"createClickHandlerAtFailure":true', '"createClickHandlerAtFailure":null')
    .replace('"mainFrameNavigationsSinceCreateAttempt":0', '"mainFrameNavigationsSinceCreateAttempt":null');
  assert.equal(select(unavailable), unavailable);
  for (const input of [line + " private", line.replace('"CREATE_ID"', '"person@example.com"'),
    line.replace('"roleEditors":0', '"roleEditors":"private"'),
    line.replace('"createClickHandlerBefore":false', '"createClickHandlerBefore":"private"'),
    line.replace('"createClickHandlerAtFailure":true', '"createClickHandlerAtFailure":1'),
    line.replace('"mainFrameNavigationsSinceCreateAttempt":0', '"mainFrameNavigationsSinceCreateAttempt":-1'),
    line.replace('"clientError":false', '"clientError":"private"'), "LOCAL_ROLE_EDITOR_UI_STATE:private"]) {
    assert.equal(select(input), "");
  }
});

test("foundation failure reports only fixed completed invitation and onboarding stages and still fails", () => {
  const harness = readFileSync(new URL("../scripts/test-postgres-v2-foundation.sh", import.meta.url), "utf8");
  const start = harness.indexOf('  # Completed stages are partial progress; the failed proof still exits nonzero.');
  const end = harness.indexOf('  role_editor_diagnostic=', start);
  assert.ok(start > 0 && end > start);
  const report = harness.slice(start, end);
  const failFunction = harness.match(/^fail\(\) \{\n[\s\S]*?^\}/m)?.[0];
  const terminalFailure = harness.slice(end).match(/^  fail "Local Supabase staff identity and RLS provisioning failed"(?=\nfi)/m)?.[0];
  assert.ok(failFunction && terminalFailure);
  const run = (input) => {
    const directory = mkdtempSync(join(tmpdir(), "evo-stage-report-test-"));
    const log = join(directory, "private.log");
    try {
      writeFileSync(log, input, { mode: 0o600 });
      return spawnSync("bash", ["-c", `set -Eeuo pipefail\n${failFunction}\nstaff_provision_log="$1"\n${report}\n${terminalFailure}`,
        "stage-report", log], { encoding: "utf8" });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  };
  for (const [input, expected] of [
    ["LOCAL_SCOPED_STAFF_INVITATION_UI_VERIFIED\nLOCAL_SUPABASE_STAFF_ONBOARDING_VERIFIED\n",
      "LOCAL_SUPABASE_STAFF_COMPLETED_STAGE:invitation_ui\nLOCAL_SUPABASE_STAFF_COMPLETED_STAGE:onboarding\n"],
    ["LOCAL_SCOPED_STAFF_INVITATION_UI_VERIFIED\n", "LOCAL_SUPABASE_STAFF_COMPLETED_STAGE:invitation_ui\n"],
    ["LOCAL_SUPABASE_STAFF_ONBOARDING_VERIFIED\n", "LOCAL_SUPABASE_STAFF_COMPLETED_STAGE:onboarding\n"],
    ["LOCAL_SCOPED_STAFF_INVITATION_UI_VERIFIED private\nprivate LOCAL_SUPABASE_STAFF_ONBOARDING_VERIFIED\nLOCAL_SUPABASE_STAFF_PROVISIONED\n", ""],
  ]) {
    const result = run(input);
    assert.equal(result.status, 1); assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${expected}Local Supabase staff identity and RLS provisioning failed\n`);
  }
});

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

test("local role preparation publishes four scoped baselines without dispatching invitations", async () => {
  const { prepareScopedStaffRoles } = await import("../scripts/lib/scoped-staff-provisioner.mjs");
  const calls = [];
  const roles = new Map();
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
        throw new Error("unexpected RPC");
      },
    }) };
  const result = await prepareScopedStaffRoles({ adminClient, apiUrl, organizationId: org });
  assert.equal(result.roles.length, 4);
  assert.equal(calls.filter((name) => name === "staff_role_publish").length, 4);
  assert.ok(calls.every((name) => ["staff_access_snapshot", "staff_role_workspace", "staff_role_command", "staff_role_impact", "staff_role_publish"].includes(name)));
  for (const scenario of ["sales", "admissions"]) {
    const selected = result.roles.filter((row) => row.scenario === scenario);
    assert.equal(selected.length, 2);
    assert.ok(selected.every((row) => row.roleVersion === 2));
    assert.deepEqual(selected.map((row) => row.scope), [{ kind: "own", key: null, resourceKind: null },
      { kind: "organization", key: org, resourceKind: null }]);
  }
  assert.doesNotMatch(JSON.stringify(result), /email|authUser|password|token|@/);
});

// Browser and authenticated read boundaries only; actual invitation acceptance
// still requires the separate local Auth/Mailpit/browser run.
function invitationUiBoundary() {
  const identities = { sales: identity, admissions: { email: "admissions-proof@evo.local.test", displayName: "Local Admissions" } };
  const roles = ["sales", "admissions"].flatMap((scenario, scenarioIndex) => ["own", "organization"].map((kind, scopeIndex) => ({
    scenario, kind, roleId: `51000000-0000-4000-8000-00000000002${scenarioIndex * 2 + scopeIndex + 1}`, roleVersion: 2,
    permissionKeys: [scenario === "sales" ? "lead.read" : "case.read.full"],
    scope: { kind, key: kind === "organization" ? org : null, resourceKind: null },
  })));
  const rolePreparation = { schemaVersion: 1, organizationId: org, roles };
  const history = [{ request_id: request, operation: "invite", display_name: "Earlier local request", status: "completed",
    created_at: "2026-09-13T00:00:00Z", provider_observed_at: null, rejection_code: null, rejection_http_status: null, rejected_at: null }];
  const submitted = [], reads = [], navigations = [], preparations = new Map();
  let values = {}, rows = [], consents = [], closed = 0;
  const locator = (name = "", index) => ({
    getByRole: (_role, options = {}) => locator(options.name ?? "", /^Роль [12]$/.test(options.name ?? "") ? Number(options.name.slice(-1)) - 1 : index),
    locator: (selector) => locator(selector, index),
    filter({ has, hasText }) {
      if (name === "form") assert.equal(has.name, "Пригласить сотрудника");
      else assert.equal(String(hasText), "/^Пригласить сотрудника$/");
      return locator(name, index);
    },
    name,
    async fill(value) { values[name] = value; consents = []; },
    async selectOption(value) {
      consents = [];
      if (name === "Название роли") rows[index] = { roleId: value, roleVersion: 2, scope: { kind: "own", key: null, resourceKind: null } };
      else rows[index].scope = { kind: value, key: value === "organization" ? org : null, resourceKind: null };
    },
    async inputValue() { return name.includes('name="no_access"') ? "no" : JSON.stringify(rows); },
    async check() { consents.push(name); },
    async waitFor() {}, async getAttribute(attribute) { return attribute === "data-system-role" ? "admin" : "actual"; },
    async click() {
      if (name === "Добавить роль") { rows.push({}); consents = []; }
      if (name === "Пригласить следующего сотрудника") { values = {}; rows = []; consents = []; }
      if (name !== "Отправить приглашение") return;
      assert.deepEqual(consents, ['input[name="recipient_confirmed"]', 'input[name="rights_confirmed"]']);
      assert.ok(values["Основание подключения"].length >= 3);
      const scenario = submitted.length === 0 ? "sales" : "admissions";
      assert.equal(values["Имя"], identities[scenario].displayName); assert.equal(values["Рабочий email"], identities[scenario].email);
      assert.deepEqual(rows, roles.filter((row) => row.scenario === scenario).map(({ roleId, roleVersion, scope }) => ({ roleId, roleVersion, scope })));
      submitted.push(scenario);
      const requestId = `51000000-0000-4000-8000-00000000003${submitted.length}`;
      history.push({ ...history[0], request_id: requestId, display_name: identities[scenario].displayName });
      preparations.set(requestId, { schemaVersion: 1, requestId, operation: "invite", status: "completed", displayName: identities[scenario].displayName,
        preparationVersion: 1, conflictCode: null, noAccess: false, targetMembershipId: scenario === "sales" ? member : profileId,
        assignments: rows.map((row) => ({ ...row, bundleId: bundle, bundleVersion: 1, label: "Local published role",
          permissionKeys: roles.find((role) => role.roleId === row.roleId).permissionKeys })) });
    },
  });
  const page = { ...locator(), setDefaultTimeout() {}, on() {}, getByTestId: () => locator("shell"),
    async goto(url) { navigations.push(url); }, async screenshot() { assert.fail("No invitation artifacts"); } };
  const browser = { async newContext(options) {
    assert.equal(options.serviceWorkers, "block"); assert.equal(options.acceptDownloads, false);
    return { async route() {}, async newPage() { return page; }, async close() { closed += 1; } };
  } };
  const adminClient = { supabaseUrl: apiUrl, auth: { getUser: async () => ({ data: { user: { id: userId, email: "admin@evo.local.test" } } }) },
    schema: () => ({ async rpc(name, args) {
      reads.push(name);
      if (name === "staff_access_snapshot") return { data: adminSnapshot };
      if (name === "staff_workspace_auth_history") return { data: structuredClone(history) };
      assert.equal(name, "staff_workspace_auth_preparation");
      return { data: structuredClone(preparations.get(args.p_request_id)) };
    } }) };
  return { input: { browser, adminClient, apiUrl, appOrigin, organizationId: org, identities, rolePreparation,
    identity: { email: "admin@evo.local.test", password: randomUUID() } }, submitted, reads, navigations, closed: () => closed };
}

test("Admin invitation UI submits the two planned recipients once and returns canonical prepared assignments", async () => {
  const fixture = invitationUiBoundary();
  const result = await prepareScopedStaffInvitations(fixture.input);
  assert.deepEqual(fixture.submitted, ["sales", "admissions"]);
  assert.equal(result.invitations.length, 2);
  assert.deepEqual(result.invitations.map(({ requestId }) => requestId), ["51000000-0000-4000-8000-000000000031", "51000000-0000-4000-8000-000000000032"]);
  assert.deepEqual(result.invitations.map(({ membershipId }) => membershipId), [member, profileId]);
  assert.deepEqual(result.invitations.map(({ permissionKeys }) => permissionKeys), [["lead.read"], ["case.read.full"]]);
  assert.equal(fixture.reads.filter((name) => name === "staff_workspace_auth_history").length, 4);
  assert.deepEqual(fixture.navigations, [`${appOrigin}/login`, `${appOrigin}/v3/settings?section=staff&view=people`]);
  assert.equal(fixture.closed(), 1);
  assert.doesNotMatch(JSON.stringify(result), /email|authUser|password|token|@/);
});

test("invitation UI marker is required before unchanged mail acceptance and editor proofs", () => {
  const wrapper = readFileSync(new URL("../scripts/provision-local-supabase-staff.mjs", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../scripts/test-postgres-v2-foundation.sh", import.meta.url), "utf8");
  const helper = readFileSync(new URL("../scripts/lib/scoped-staff-provisioner.mjs", import.meta.url), "utf8");
  assert.ok(/const browser = await chromium\.launch[\s\S]*await prepareScopedStaffRoles[\s\S]*await prepareScopedStaffInvitations[\s\S]*LOCAL_SCOPED_STAFF_INVITATION_UI_VERIFIED[\s\S]*accepted = await acceptScopedStaffInvitations[\s\S]*await verifyScopedStaffRoleEditor[\s\S]*await verifyScopedStaffMemberEditor/.test(wrapper), "Require UI dispatch before the existing acceptance sequence");
  assert.ok(/grep -Fx "LOCAL_SCOPED_STAFF_INVITATION_UI_VERIFIED" "\$staff_provision_log" >\/dev\/null \\\n\s*\|\| fail/.test(shell), "Require the distinct invitation UI marker at the shell boundary");
  assert.doesNotMatch(helper, /dispatchScopedStaffInvitation|inviteUserByEmail|staff_workspace_claim_auth|staff_workspace_reconcile_auth/);
});

test("acceptance keeps its local mail boundary", async () => {
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
function roleEditorBoundary({ failureAction, alterExistingAccess = false, clickHandlers = [true, true],
  mainFrameNavigations = 0, childFrameNavigations = 0, clientFailure = false, observationFailure } = {}) {
  const actions = [], reads = [];
  const listeners = new Map(), mainFrame = {}, childFrame = {};
  let nativeClickObservations = 0;
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
    async inputValue() {
      if (name.includes("expected_impact_fingerprint")) return "a".repeat(64);
      act(name.includes("expected_version") ? "input:expected_version" : "input:role_id");
      return name.includes("expected_version") ? String(draft.version) : draft.id;
    },
    async evaluateAll(evaluate) {
      act("observe:native-click");
      if (observationFailure === "native-click") throw privateError;
      // Navigation before the Create click attempt must not count toward that interval.
      if (nativeClickObservations === 0) listeners.get("framenavigated")?.(mainFrame);
      const present = clickHandlers[nativeClickObservations++];
      return evaluate(present === null ? [] : [{ onclick: present ? () => {} : null }]);
    },
    async check() {
      act(`check:${name}`);
      const permission = permissions.find(({ label }) => label === name);
      if (permission && !draft.draftPermissionKeys.includes(permission.key)) draft.draftPermissionKeys.push(permission.key);
    },
    async click() {
      act(`click:${name}`);
      if (name === "Создать роль") {
        draft = emptyRole(ids[0]); operation = "create";
        for (let index = 0; index < mainFrameNavigations; index += 1) listeners.get("framenavigated")?.(mainFrame);
        for (let index = 0; index < childFrameNavigations; index += 1) listeners.get("framenavigated")?.(childFrame);
        if (clientFailure) listeners.get("pageerror")?.(privateError);
      }
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
    async count() { if (observationFailure === "fixed-counts") throw privateError; return 0; },
  });
  const page = { ...locator(), setDefaultTimeout() {},
    on(event, listener) {
      if (event === "framenavigated" && observationFailure === "navigation-listener") throw privateError;
      listeners.set(event, listener);
    },
    mainFrame() { if (observationFailure === "main-frame") throw privateError; return mainFrame; },
    url: () => pageUrl,
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
      if (name === "staff_role_archive_impact") return { data: { roleId: selected.id, version: selected.version,
        affectedMembershipIds: [], addedPermissionKeys: [], removedPermissionKeys: [...selected.permissionKeys].sort(),
        impactFingerprint: "a".repeat(64), replacementRoleId: null, revokeAssignments: false } };
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
  assert.ok(fixture.reads.every((name) => ["staff_access_snapshot", "staff_role_workspace", "staff_role_impact", "staff_role_archive_impact"].includes(name)));
  const archivePreview = fixture.actions.indexOf("click:Проверить архивирование");
  const archiveConfirmation = fixture.actions.indexOf('check:input[name="confirm_impact"]');
  assert.ok(archivePreview >= 0 && archiveConfirmation > archivePreview
    && fixture.actions.indexOf("command:archive") > archiveConfirmation);
  assert.equal(result.proof.archiveImpactReviewed, true);
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

test("role editor failure emits only native handler observations and main-frame counts since the Create attempt", async (t) => {
  const output = [];
  t.mock.method(process.stderr, "write", (value) => { output.push(String(value)); return true; });
  const fixture = roleEditorBoundary({ failureAction: "input:role_id", clickHandlers: [false, true],
    mainFrameNavigations: 2, childFrameNavigations: 3, clientFailure: true });
  await assert.rejects(verifyScopedStaffRoleEditor(fixture.input), { code: "LOCAL_ROLE_EDITOR_CREATE_ID_FAILED" });
  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0].slice("LOCAL_ROLE_EDITOR_UI_STATE:".length)), {
    stage: "CREATE_ID", roleEditors: 0, createButtons: 0, archiveForms: 0, restoreForms: 0, emptyDetails: 0,
    createClickHandlerBefore: false, createClickHandlerAtFailure: true, mainFrameNavigationsSinceCreateAttempt: 2, clientError: true,
  });
  const click = fixture.actions.indexOf("click:Создать роль");
  assert.equal(fixture.actions[click - 1], "observe:native-click");
  assert.equal(fixture.actions.filter((action) => action === "click:Создать роль").length, 1);
  for (const secret of [fixture.input.identity.email, fixture.input.identity.password, appOrigin, "token=private"])
    assert.ok(!output.join("").includes(secret));
  assert.equal(fixture.closed(), 1);
});

for (const observationFailure of ["native-click", "navigation-listener", "main-frame", "fixed-counts"]) {
  test(`role editor preserves the actual failure when ${observationFailure} observation is unavailable`, async (t) => {
    const output = [];
    t.mock.method(process.stderr, "write", (value) => { output.push(String(value)); return true; });
    const fixture = roleEditorBoundary({ failureAction: "input:role_id", mainFrameNavigations: 1, observationFailure });
    await assert.rejects(verifyScopedStaffRoleEditor(fixture.input), { code: "LOCAL_ROLE_EDITOR_CREATE_ID_FAILED" });
    if (observationFailure === "fixed-counts") assert.deepEqual(output, []);
    else {
      assert.equal(output.length, 1);
      const diagnostic = JSON.parse(output[0].slice("LOCAL_ROLE_EDITOR_UI_STATE:".length));
      if (observationFailure === "native-click") {
        assert.equal(diagnostic.createClickHandlerBefore, null); assert.equal(diagnostic.createClickHandlerAtFailure, null);
      } else assert.equal(diagnostic.mainFrameNavigationsSinceCreateAttempt, null);
    }
    assert.equal(fixture.actions.filter((action) => action === "click:Создать роль").length, 1);
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
  const editor = helper.slice(helper.indexOf("export async function verifyScopedStaffRoleEditor"), helper.indexOf("export async function verifyScopedStaffMemberEditor"));
  assert.doesNotMatch(editor, /inviteUserByEmail|signInWithPassword|staff_role_command|staff_role_publish|staff_role_assignments_save|storageState|addCookies/);
});

// Public browser/RPC boundary only, not browser or database acceptance.
function memberEditorBoundary() {
  const staffId = "51000000-0000-4000-8000-000000000021";
  const otherId = "51000000-0000-4000-8000-000000000022";
  const assignments = [
    { id: "51000000-0000-4000-8000-000000000031", roleId, label: "Local own", bundleId: bundle, bundleVersion: 1,
      scope: { kind: "own", key: null, resourceKind: null } },
    { id: "51000000-0000-4000-8000-000000000032", roleId: request, label: "Local organization", bundleId: bundle, bundleVersion: 1,
      scope: { kind: "organization", key: org, resourceKind: null } },
  ];
  const members = [
    { membershipId: member, displayName: "Local Admin", systemRole: "admin", accessVersion: 1, assignments: [] },
    { membershipId: staffId, displayName: "Local Sales", systemRole: "staff", accessVersion: 7, assignments },
    { membershipId: otherId, displayName: "Local Admissions", systemRole: "staff", accessVersion: 5, assignments: structuredClone(assignments) },
  ];
  const roles = assignments.map((row) => ({ id: row.roleId, label: row.label, description: "Local role", status: "active", version: 2,
    bundleId: bundle, bundleVersion: 1, permissionKeys: ["team.chat.general"], draftPermissionKeys: ["team.chat.general"], memberCount: 2 }));
  const baseline = structuredClone(members), baselineRoles = structuredClone(roles);
  const inputRows = (rows) => rows.map(({ roleId, scope }) => ({ roleId, scope }));
  let draft = structuredClone(inputRows(assignments)), formVersion = 7, saved = false, observedVersion = 7, closed = 0, pageUrl;
  const commands = [], reopenedVersions = [], navigation = [], reads = [];
  const locator = (name = "", index, parent = "") => ({
    getByRole: (_role, options = {}) => locator(options.name ?? "", /^Назначение [12]$/.test(options.name ?? "") ? Number(options.name.slice(-1)) - 1 : index),
    getByText: (text) => locator(text, index), locator: (selector) => locator(selector, index, name),
    async fill() {}, async waitFor() {},
    async getAttribute(attribute) { return attribute === "data-system-role" ? "admin" : "actual"; },
    async inputValue() {
      if (name.includes('name="expected_version"')) return String(formVersion);
      if (name.includes('name="assignments"')) return JSON.stringify(draft);
      return name === "Роль" ? draft[index].roleId : draft[index].scope.kind;
    },
    async textContent() {
      assert.equal(name, "option:checked");
      return parent === "Роль" ? roles.find((role) => role.id === draft[index].roleId).label
        : draft[index].scope.kind === "own" ? "Свои записи" : "Вся организация";
    },
    async selectOption(value) {
      assert.equal(saved, false);
      if (name === "Роль") draft[index].roleId = value;
      else draft[index].scope = { kind: value, key: value === "organization" ? org : null, resourceKind: null };
    },
    async click() {
      if (name === "Убрать назначение") draft.splice(index, 1);
      if (name === "Добавить роль") draft.push({ roleId: "", scope: { kind: "own", key: null, resourceKind: null } });
      if (name === "Сохранить назначения") {
        assert.equal(saved, false); assert.equal(formVersion, members[1].accessVersion);
        commands.push({ version: formVersion, assignments: structuredClone(draft) });
        members[1].accessVersion += 1;
        members[1].assignments = draft.map((row) => ({ ...assignments.find((original) => original.roleId === row.roleId), ...row }));
        roles[1].memberCount = draft.length === 1 ? 1 : 2; saved = true;
      }
      if (name === "Изменить назначения") {
        assert.equal(saved, true); assert.equal(observedVersion, members[1].accessVersion);
        formVersion = observedVersion; draft = structuredClone(inputRows(members[1].assignments)); saved = false;
        reopenedVersions.push(formVersion);
      }
    },
  });
  const page = { ...locator(), setDefaultTimeout() {}, on() {}, getByTestId: () => locator("shell"), url: () => pageUrl,
    async goto(url) { navigation.push(url); pageUrl = url; },
    async screenshot() { assert.fail("Member proof has no default artifacts"); } };
  const browser = { async newContext(options) {
    assert.equal(options.serviceWorkers, "block"); assert.equal(options.acceptDownloads, false);
    return { async route() {}, async newPage() { return page; }, async close() { closed += 1; } };
  } };
  const adminClient = { supabaseUrl: apiUrl, auth: { getUser: async () => ({ data: { user: { id: userId, email: "admin@evo.local.test" } } }) },
    schema: () => ({ async rpc(name) {
      reads.push(name);
      if (name === "staff_access_snapshot") return { data: adminSnapshot };
      assert.equal(name, "staff_role_workspace"); observedVersion = members[1].accessVersion;
      return { data: structuredClone({ schemaVersion: 1, members, roles, departments: [], permissions: [
        { key: "team.chat.general", label: "Чат", group: "Команда", allowedScopes: ["own", "organization"], resourceKinds: ["organization"], sensitive: false, systemOnly: false },
      ] }) };
    } }) };
  return { input: { browser, adminClient, apiUrl, appOrigin, organizationId: org,
    identity: { email: "admin@evo.local.test", password: randomUUID() },
    accepted: { schemaVersion: 1, organizationId: org, members: structuredClone(members.slice(1)),
      proof: { localMail: true, actualCallback: true, passwordSet: true, freshPasswordLogin: true } } },
  commands, reopenedVersions, navigation, reads, members, baseline, roles, baselineRoles, closed: () => closed };
}

test("member editor proves two same-card UI saves and restores existing assignments with fresh versions", async () => {
  const { verifyScopedStaffMemberEditor } = await import("../scripts/lib/scoped-staff-provisioner.mjs");
  const fixture = memberEditorBoundary();
  const result = await verifyScopedStaffMemberEditor(fixture.input);
  assert.deepEqual(fixture.commands.map(({ version, assignments }) => [version, assignments.length]), [[7, 1], [8, 2]]);
  assert.deepEqual(fixture.reopenedVersions, [8, 9]);
  assert.equal(fixture.navigation.length, 2);
  assert.equal(fixture.navigation[1], `${appOrigin}/v3/settings?section=staff&view=people&member=${fixture.members[1].membershipId}`);
  assert.deepEqual(fixture.members, fixture.baseline.map((row, index) => index === 1 ? { ...row, accessVersion: 9 } : row));
  assert.deepEqual(fixture.roles, fixture.baselineRoles);
  assert.ok(fixture.reads.every((name) => ["staff_access_snapshot", "staff_role_workspace"].includes(name)));
  assert.equal(result.proof.consecutiveAssignmentEdits, true); assert.equal(result.proof.roleScopeDisplay, true);
  assert.equal(result.proof.finalAssignmentsRestored, true); assert.equal(result.edits, 2); assert.equal(fixture.closed(), 1);
  assert.doesNotMatch(JSON.stringify(result), /email|password|token|membershipId|roleId|@/);
});

test("member editor has a separate required shell marker after the complete catalogue proof", () => {
  const wrapper = readFileSync(new URL("../scripts/provision-local-supabase-staff.mjs", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../scripts/test-postgres-v2-foundation.sh", import.meta.url), "utf8");
  assert.match(wrapper, /await verifyScopedStaffRoleEditor[\s\S]*LOCAL_SCOPED_STAFF_ROLE_EDITOR_VERIFIED[\s\S]*await verifyScopedStaffMemberEditor[\s\S]*LOCAL_SCOPED_STAFF_MEMBER_EDITOR_VERIFIED/);
  assert.match(shell, /grep -Fx "LOCAL_SCOPED_STAFF_MEMBER_EDITOR_VERIFIED" "\$staff_provision_log" >\/dev\/null \\\n\s*\|\| fail/);
});

const businessHelper = () => readFileSync(new URL("../scripts/lib/scoped-staff-provisioner.mjs", import.meta.url), "utf8")
  .split("export async function verifyScopedStaffBusinessScopes")[1];

test("ordinary business proof orders canonical setup before the four same-card scope edits", () => {
  const source = businessHelper();
  const order = ['stage = "DEPARTMENT"', 'stage = "PERSONAL_PERMISSIONS"', 'stage = "LEAD"', 'stage = "QUALIFY"', 'stage = "CONTRACT"',
    'stage = "PAYMENT"', 'stage = "HANDOFF"', 'stage = "DIRECTION"', 'stage = "ROLES"', 'stage = "BASELINE"', 'stage = "CARD"'];
  assert.ok(order.every((needle, index) => source.indexOf(needle) >= 0 && (index === 0 || source.indexOf(needle) > source.indexOf(order[index - 1]))));
  assert.match(source, /const states = \[\[additions\[0\]\], \[additions\[1\]\], additions, \[\]\]/);
  const edits = source.slice(source.indexOf('stage = "CARD"'), source.indexOf('stage = "ASSIGNED_ARCHIVE_SETUP"'));
  assert.equal((edits.match(/page\.goto\(/g) ?? []).length, 1);
  assert.doesNotMatch(edits, /\.reload\(|staff_role_assignments_save|staff_role_command|staff_role_publish/);
  assert.match(edits, /Изменить назначения/);
  assert.match(edits, /await fields\(original.accessVersion \+ 4, original.assignments\)/);
  const wrapper = readFileSync(new URL("../scripts/provision-local-supabase-staff.mjs", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../scripts/test-postgres-v2-foundation.sh", import.meta.url), "utf8");
  assert.match(wrapper, /await verifyScopedStaffMemberEditor[\s\S]*LOCAL_SCOPED_STAFF_MEMBER_EDITOR_VERIFIED[\s\S]*await verifyScopedStaffBusinessScopes[\s\S]*LOCAL_SCOPED_STAFF_BUSINESS_SCOPES_VERIFIED/);
  assert.match(shell, /grep -Fx "LOCAL_SCOPED_STAFF_BUSINESS_SCOPES_VERIFIED" "\$staff_provision_log" >\/dev\/null \\\n\s*\|\| fail/);
});

test("ordinary business proof requires independent target matches, full reads and current authority", () => {
  const source = businessHelper();
  assert.match(source, /p_handoff_mode: "normal"/);
  assert.match(source, /p_amount: 1, p_currency: "USD"/);
  assert.match(source, /gate.gate_state === "satisfied" && gate.normal_handoff_allowed === true/);
  assert.match(source, /const caseId = uuid\(handoff\?\.case_id\)/);
  assert.match(source, /p_expected_version: Number\(unconfigured.version\), p_direction: "CN"/);
  assert.match(source, /current_curator_membership_id === admissions.membershipId/);
  assert.match(source, /canonical\?\.direction === "CN"/);
  assert.match(source, /entry.scope.kind !== "organization"\s*\|\| !baseline.roles.find[\s\S]*?permissionKeys.includes\("case.read.full"\)/);
  assert.match(source, /permissionKeys: \["case.read.full"\]/);
  assert.doesNotMatch(source, /acceptedMember.accessVersion|sales.accessVersion|!actor.permissionKeys.includes\("case.read.full"\)/);
  assert.match(source, /actor.platformAccessVersion === version && sameSet\(actor.assignments.map\(pair\), assignments.map\(pair\)\)/);
  assert.match(source, /staff_student_case_read_snapshot[\s\S]*rows\?\.length === 1[\s\S]*rows\[0\].access_mode === "full"/);
  assert.match(source, /await freshSales\(target.accessVersion, target.assignments, index < 3\)/);
  assert.match(source, /JSON.stringify\(otherMembers\(current.members\)\) === JSON.stringify\(otherMembers\(baseline.members\)\)/);
  assert.match(source, /input\[name="expected_role_bindings"\]/);
});

test("ordinary handoff qualifies manual intake using fresh workflow state before financial confirmation", () => {
  const source = businessHelper();
  const qualification = source.slice(source.indexOf('stage = "QUALIFY"'), source.indexOf('stage = "CONTRACT"'));
  assert.match(qualification, /staff_sales_lead_detail/);
  assert.match(qualification, /mutate_sales_lead_workflow/);
  assert.match(qualification, /p_expected_workflow_version: intake.workflow_version/);
  assert.match(qualification, /p_stage_key: "qualified", p_owner_membership_id: sales.membershipId/);
  assert.match(qualification, /qualified.workflow_version === intake.workflow_version \+ 1/);
  assert.match(qualification, /qualified.stage_key === "qualified"/);
  assert.match(source, /handoffReady\[0\].can_submit_normal === true/);
});

test("business read diagnostics distinguish fixed private substages without exporting runtime data", () => {
  const source = businessHelper();
  for (const suffix of ["LOGIN", "AUTHORITY", "CASE_RPC", "CASE_RESULT", "SIGNOUT", "WORKSPACE", "TARGET", "OTHER_MEMBERS", "CATALOGUE"]) {
    assert.ok(source.includes('stage = `${readStage}_' + suffix + '`;'));
  }
  assert.match(source, /stage = readStage;\s*return target;/);
  assert.match(source, /\} catch \{ failure = new ScopedStaffProvisioningError\(`LOCAL_BUSINESS_SCOPES_\$\{stage\}_FAILED`\); \}/);
  assert.doesNotMatch(source, /console\.|JSON.stringify\(.*error|throw new Error/);
});

test("business proof cleanup is ordinary, versioned, verified and never upgrades a failed UI result", () => {
  const source = businessHelper();
  const cleanup = source.slice(source.indexOf("// Teardown uses ordinary commands"));
  assert.match(cleanup, /p_expected_access_version: target.accessVersion/);
  assert.match(cleanup, /p_expected_role_bindings: bindings\(current.roles, original.assignments\)/);
  assert.match(cleanup, /personalPermission\(grant.key, grant.original\)/);
  assert.match(cleanup, /saveDetails\(originalDetails.department_id, currentDetails.organizational_version\)/);
  assert.match(cleanup, /check\(role.memberCount === 0\)/);
  assert.match(cleanup, /if \(role.status === "archived"\) return/);
  assert.match(cleanup, /staff_role_archive_impact[\s\S]*expectedImpactFingerprint: impact.impactFingerprint/);
  assert.match(cleanup, /archived\?\.status === "archived" && archived.member_count === 0/);
  assert.match(cleanup, /await refreshAdmin\(\)/);
  assert.match(cleanup, /after.accessVersion >= before.accessVersion/);
  assert.match(cleanup, /if \(failure\) throw failure;\s*return \{ schemaVersion: 1, edits: 4/);
  assert.doesNotMatch(source, /auth\.admin|service_role|\.insert\(|\.update\(|\.delete\(|\.upsert\(|inviteUserByEmail|generateLink|storageState|addCookies|screenshot|writeFile|console\./);
  assert.match(source, /localClient\(adminClient, apiUrl\)/);
  assert.match(source, /\[appOrigin, apiUrl\].includes/);
});

test("assigned archive is a separate positive UI step after all four scope edits", () => {
  const source = businessHelper();
  const archive = source.slice(source.indexOf('stage = "ASSIGNED_ARCHIVE_SETUP"'), source.indexOf("} catch { failure ="));
  assert.match(source.slice(0, source.indexOf('stage = "ASSIGNED_ARCHIVE_SETUP"')), /await fields\(original.accessVersion \+ 4, original.assignments\)/);
  assert.match(archive, /p_expected_access_version: original.accessVersion \+ 4/);
  assert.match(archive, /readback\(original.accessVersion \+ 5, assigned\)/);
  assert.match(archive, /sameSet\(archiveImpact.affectedMembershipIds, \[sales.membershipId\]\)/);
  assert.match(archive, /sameSet\(archiveImpact.removedPermissionKeys, \["case.read.full"\]\)/);
  assert.match(archive, /input\[name="expected_impact_fingerprint"\][\s\S]*archiveImpact.impactFingerprint/);
  assert.match(archive, /input\[name="confirm_impact"\][\s\S]*Перенести в архив/);
  assert.match(archive, /restoredMember\?\.accessVersion === original.accessVersion \+ 6/);
  assert.match(archive, /sameSet\(restoredMember.assignments.map\(pair\), original.assignments.map\(pair\)\)/);
  assert.doesNotMatch(archive, /p_operation: "archive"|\.reload\(|newContext/);
});

test("business proof rejects incomplete inputs with a fixed private stage before any write", async () => {
  await assert.rejects(verifyScopedStaffBusinessScopes({ apiUrl, appOrigin, organizationId: org,
    adminClient: { supabaseUrl: apiUrl }, identities: {} }), (error) => {
    assert.equal(error.code, "LOCAL_BUSINESS_SCOPES_SETUP_FAILED");
    assert.deepEqual(Object.keys(error), ["code"]);
    assert.equal(error.message, error.code); return true;
  });
});
