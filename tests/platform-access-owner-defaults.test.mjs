// Owner decisions B, C and D of 26.09.2026 (migration 248 and the matching
// application gates). Static checks of the migration text and its
// real-Postgres suite wiring, the interface gates of B and C, and the menu of
// D with every real role bundle. They supplement, never replace, the boundary
// suite supabase/tests/platform_access_owner_defaults.sql (checkpoint 248 in
// scripts/test-postgres-authorization.sh), which runs the changed functions
// against members modelled like production.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { staffCan } from "../src/lib/platform-access.ts";
import { buildV3Navigation } from "../src/lib/v3/navigation.ts";

const {
  listStudentPortalActiveCurators,
  StudentPortalCuratorOptionsError,
} = await import("../src/lib/server/student-portal-curator-options.ts");

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = source("supabase/migrations/248_platform_access_owner_defaults.sql");
const suite = source("supabase/tests/platform_access_owner_defaults.sql");
const script = source("scripts/test-postgres-authorization.sh");

/** The body of one function in 248, from its CREATE line up to its closing $$ / $function$. */
function functionBody(kind, name) {
  const start = migration.indexOf(`${kind} ${name}(`);
  assert.notEqual(start, -1, name);
  const open = migration.slice(start).match(/AS (\$[a-z]*\$)/u);
  assert.ok(open, name);
  const bodyStart = start + open.index;
  const bodyEnd = migration.indexOf(open[1], bodyStart + open[0].length);
  return migration.slice(bodyStart, bodyEnd);
}

test("248 is one forward-only transaction over the audited functions", () => {
  assert.match(migration, /^BEGIN;$/mu);
  assert.match(migration, /^COMMIT;\s*$/mu);
  assert.doesNotMatch(migration, /\bDROP\s+(FUNCTION|TABLE|POLICY|TRIGGER)\b/iu);
  assert.doesNotMatch(migration, /\b(CREATE|ALTER)\s+TABLE\b/iu);
  assert.deepEqual([...migration.matchAll(/^CREATE FUNCTION ([a-z_]+\.[a-z0-9_]+)\(/gmu)].map((match) => match[1]), [
    "platform_private.needs_curator_case_last_curator",
    "platform_private.staff_can_take_needs_curator_case",
    "platform_private.require_case_curator_assigner_locked",
  ]);
  assert.deepEqual([...migration.matchAll(/^CREATE OR REPLACE FUNCTION ([a-z_]+\.[a-z0-9_]+)\(/gmu)].map((match) => match[1]), [
    "private.platform_can_read_student_case",
    "private.assign_case_curator_v1",
    "platform.staff_student_portal_curator_options",
    "platform_private.require_student_portal_cabinet_actor_e1",
    "platform_private.assert_student_portal_cabinet_membership_e1",
    "platform.staff_student_case_cabinet_origin_v1",
  ]);
  assert.ok(migration.includes("'platform.prepare_student_portal_provisioning(uuid,uuid,text,text,text,uuid,text,uuid)'"));
  // Every function it defines keeps the definer and the empty search_path.
  const definitions = migration.split(/^CREATE (?:OR REPLACE )?FUNCTION /mu).slice(1);
  assert.equal(definitions.length, 9);
  for (const definition of definitions) {
    assert.match(definition.slice(0, 600), /SECURITY DEFINER\s+SET search_path\s*=\s*''/u, definition.slice(0, 60));
  }
  assert.match(migration, /a248_access_owner_defaults_verification_failed/u);
});

test("B: the needs-curator rule is the last curator's scope, both permissions, never the curator's own", () => {
  const last = functionBody("CREATE FUNCTION", "platform_private.needs_curator_case_last_curator");
  assert.match(last, /e\.event_type = 'declined'/u);
  assert.match(last, /ORDER BY e\.created_at DESC, e\.id DESC LIMIT 1/u);
  assert.match(last, /c\.state = 'pending' AND c\.current_curator_membership_id IS NULL/u);
  assert.match(last, /platform_private\.case_sale_or_handoff_evidence\(c\.organization_id, c\.id\)/u);
  const take = functionBody("CREATE FUNCTION", "platform_private.staff_can_take_needs_curator_case");
  assert.match(take, /last_curator\.membership_id <> p_membership_id/u);
  for (const key of ["case.read.full", "case.curator.assign"]) {
    assert.match(take, new RegExp(`staff_context_can_access\\(p_organization_id, p_membership_id,\\s+'${key.replaceAll(".", "\\.")}', 'student_case', p_student_case_id,\\s+last_curator\\.membership_id, p_student_case_id, NULL\\)`, "u"), key);
  }
  assert.match(migration, /REVOKE ALL ON FUNCTION\s+platform_private\.needs_curator_case_last_curator\(UUID, UUID\),\s+platform_private\.staff_can_take_needs_curator_case\(UUID, UUID, UUID\)\s+FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;/u);
});

test("B: the case read keeps its check first and adds the rule for staff only", () => {
  const read = functionBody("CREATE OR REPLACE FUNCTION", "private.platform_can_read_student_case");
  assert.match(read, /CASE\s+WHEN platform_private\.staff_can_access_for_actor\(\s*p_organization_id, 'case\.read\.full', 'student_case', p_student_case_id\) THEN TRUE/u);
  assert.match(read, /a\.platform_role IS DISTINCT FROM 'student'\s+AND platform_private\.staff_can_take_needs_curator_case\(a\.organization_id, a\.membership_id, p_student_case_id\)/u);
});

test("B: assignment and curator options check case.curator.assign, not the Admin", () => {
  const assign = functionBody("CREATE OR REPLACE FUNCTION", "private.assign_case_curator_v1");
  assert.doesNotMatch(assign, /require_admin_actor/u);
  const preflight = assign.indexOf("require_domain_actor_read(p_organization_id, 'case.curator.assign')");
  const domainLock = assign.indexOf("lock_student_case_note_assignment_domain(p_organization_id)");
  const locked = assign.indexOf("require_case_curator_assigner_locked(p_organization_id, p_student_case_id)");
  const replay = assign.indexOf("replay_audit(");
  const shape = assign.indexOf("'Case does not need a curator assignment'");
  assert.ok(preflight > 0 && preflight < domainLock && domainLock < locked && locked < replay && replay < shape,
    "preflight, locks, live authority, replay, shape check — in this order");
  assert.match(assign, /assign_student_case_curator_authorized_e1\(\s*p_organization_id, p_student_case_id, p_curator_membership_id, p_reason, p_request_id,\s*actor\.actor_profile_id, actor\.actor_membership_id, actor\.actor_auth_user_id\s*\)/u);
  const locker = functionBody("CREATE FUNCTION", "platform_private.require_case_curator_assigner_locked");
  assert.match(locker, /require_domain_actor\(p_organization_id, 'case\.curator\.assign'\)/u);
  assert.match(locker, /staff_can_access\(p_organization_id, actor\.actor_membership_id,\s+'case\.curator\.assign', 'student_case', p_student_case_id\)/u);
  assert.match(locker, /staff_can_take_needs_curator_case\(p_organization_id,\s+actor\.actor_membership_id, p_student_case_id\)/u);
  assert.match(locker, /RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501'/u);
  const options = functionBody("CREATE OR REPLACE FUNCTION", "platform.staff_student_portal_curator_options");
  assert.doesNotMatch(options, /require_admin_actor/u);
  assert.match(options, /require_domain_actor_read\(p_organization_id, 'case\.curator\.assign'\)/u);
  assert.match(options, /u6_eligible_admissions_owners\(p_organization_id\)/u);
});

test("C: the cabinet invite is decided by the lead permission, not the coarse role", () => {
  const live = functionBody("CREATE OR REPLACE FUNCTION", "platform_private.require_student_portal_cabinet_actor_e1");
  assert.doesNotMatch(live, /platform_role IN \(/u);
  assert.match(live, /a\.platform_role IS DISTINCT FROM 'student'\s+AND platform_private\.staff_can_access\(\s*p_organization_id, a\.membership_id,\s*'lead\.sales\.workflow\.manage', 'lead', p_lead_id\s*\)/u);
  const stored = functionBody("CREATE OR REPLACE FUNCTION", "platform_private.assert_student_portal_cabinet_membership_e1");
  assert.doesNotMatch(stored, /coarse_role/u);
  assert.match(stored, /staff_membership_identity\(p_organization_id, p_membership_id\)/u);
  assert.match(stored, /'lead\.sales\.workflow\.manage', 'lead', p_lead_id/u);
  // The prepare body is patched by one self-verifying anchor, never retyped.
  assert.match(migration, /\$q\$WHERE identity\.coarse_role IN \('admin','sales'\) AND identity\.profile_id=actor\.actor_profile_id\$q\$/u);
  assert.match(migration, /RAISE EXCEPTION 'student_portal_cabinet_identity_anchor_drift'/u);
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION platform\.prepare_student_portal_provisioning/u);
  const origin = functionBody("CREATE OR REPLACE FUNCTION", "platform.staff_student_case_cabinet_origin_v1");
  assert.match(origin, /NOT private\.platform_can_read_student_case\(p_organization_id, p_student_case_id\)\s+AND NOT \(cabinet_lead_id IS NOT NULL AND platform_private\.staff_can_access_for_actor\(\s*p_organization_id, 'lead\.sales\.workflow\.manage', 'lead', cabinet_lead_id\)\)/u);
  assert.match(origin, /RETURN cabinet_lead_id IS NOT NULL;/u);
});

test("the real-Postgres suite runs at checkpoint 248 with production-shaped members", () => {
  assert.match(script, /if \[\[ "\$\(basename "\$migration"\)" == 248_\* \]\]; then\s+docker exec "\$container_name" \\\s+psql -X -v ON_ERROR_STOP=1 -h 127\.0\.0\.1 -U postgres -d "\$test_database" \\\s+-f \/workspace\/supabase\/tests\/platform_access_owner_defaults\.sql\s+fi/u);
  assert.match(suite, /^BEGIN;$/mu);
  assert.match(suite, /^ROLLBACK;\s*$/mu);
  assert.match(suite, /N248_ACCESS_OWNER_DEFAULTS_SUITE_PASS/u);
  assert.match(suite, /= ARRAY\[35, 36, 23, 12, 16\], 'role bundles have the production key counts 35\/36\/23\/12\/16'/u);
  assert.match(suite, /"current_role" IS NULL AND current_bundle_id IS NULL/u);
  for (const refusal of [
    "'Admissions cannot assign'",
    "'the curator who declined cannot assign'",
    "'the Sales Manager cannot assign'",
    "'the Student cannot assign'",
    "'anon cannot assign'",
    "'the curator who declined does not get the case back'",
    "'a case declined outside the department stays out of the manager''s reach'",
    "'the Admissions Manager does not read a pre-sale cabinet'",
    "'the other department''s Sales Manager cannot prepare the invite'",
    "'the other department''s Sales Manager cannot reissue'",
    "'the Student cannot prepare the invite'",
    "'anon cannot prepare the invite'",
    "'the post-handoff invite of an active case stays Admin-only'",
  ]) {
    assert.ok(suite.includes(refusal), refusal);
  }
  // The 182 decline command is shown refused by the 042 guard (a separate,
  // pre-existing defect); the fixture writes the state it is meant to leave.
  assert.match(suite, /'55000:First student-case handoff timestamp is immutable'/u);
});

// ---------------------------------------------------------------------------
// Interface gates of B and C
// ---------------------------------------------------------------------------
function staffActor(permissionKeys) {
  return {
    authUserId: "24800000-0000-4000-8000-000000000101",
    profileId: "24800000-0000-4000-8000-000000000201",
    membershipId: "24800000-0000-4000-8000-000000000301",
    organizationId: "24800000-0000-4000-8000-000000000001",
    displayName: "N248 Actor",
    email: "n248-actor@example.invalid",
    systemRole: "staff",
    presentationRole: null,
    assignments: [],
    permissionKeys,
    platformAccessVersion: 1,
  };
}

test("B: a holder of case.curator.assign reads the curator names; others fail before the database", async () => {
  const calls = [];
  const client = { schema() { return { rpc(name, args) { calls.push([name, args]); return Promise.resolve({
    data: { organization_id: "24800000-0000-4000-8000-000000000001", owners: [] }, error: null }); } }; } };
  assert.deepEqual(await listStudentPortalActiveCurators(staffActor(["case.curator.assign"]), { client }), []);
  assert.deepEqual(calls, [["staff_student_portal_curator_options", { p_organization_id: "24800000-0000-4000-8000-000000000001" }]]);
  await assert.rejects(() => listStudentPortalActiveCurators(staffActor(["case.read.full"]), { client }),
    StudentPortalCuratorOptionsError);
  assert.equal(calls.length, 1);
});

test("B: assign, the case header and both curator filters follow case.curator.assign outside a preview", () => {
  const action = source("src/lib/platform-case-curator-assignment-actions.ts");
  assert.match(action, /if \(isStaffPreview\(actor\) \|\| !staffHasPermission\(actor, "case\.curator\.assign"\)\) \{\s+return outcome\("forbidden", previous\.requestId\);/u);
  assert.doesNotMatch(action, /systemRole !== "admin"/u);
  const pipeline = source("src/app/(v3)/v3/admissions-pipeline/page.tsx");
  assert.match(pipeline, /!isStaffPreview\(actor\) && staffHasPermission\(actor, "case\.curator\.assign"\)\s+\? listStudentPortalActiveCurators\(actor\)/u);
  const parts = source("src/components/v3/profile/CaseWorkParts.tsx");
  assert.match(parts, /coverage=\{!preview && staffHasPermission\(actor, "case\.curator\.assign"\)\}/u);
  const work = source("src/lib/v3/case-work-source.ts");
  assert.match(work, /: !isStaffPreview\(actor\) && staffHasPermission\(actor, "case\.curator\.assign"\)\s+\? \(await readCaseAttentionFlags/u);
});

test("C: the lead card offers the cabinet invite to Sales with the lead permission", () => {
  const profileSource = source("src/lib/v3/profile-source.ts");
  assert.match(profileSource, /const cabinetInvite = leadCabinetCase\?\.state === "pending" && !isStaffPreview\(actor\) && staffCan\(actor, "sales\.write"\)\s+\? await readStudentCaseCabinetOrigin\(actor, leadCabinetCase\.studentCaseId\)\s+: false;/u);
  assert.match(profileSource, /leadCabinetCase: leadCabinetCase \? \{ \.\.\.leadCabinetCase, cabinetInvite \} : null,/u);
  const profile = source("src/components/v3/profile/Profile.tsx");
  assert.match(profile, /: !isStaffPreview\(actor\) && !draft\.admissions && draft\.leadCabinetCase\?\.cabinetInvite \? \([\s\S]*?<StudentPortalAccessControls[\s\S]*?studentCaseId=\{draft\.leadCabinetCase\.studentCaseId\}[\s\S]*?caseState="pending"\s+isCabinetCase[\s\S]*?\/>/u);
  // «Открыть дело» only for those who open cases: without admissions.read the
  // link led to an empty page.
  assert.match(profile, /caseLink=\{staffPresentationCan\(actor, "admissions\.read"\)\}/u);
  const tabs = source("src/components/v3/profile/tabs.tsx");
  assert.match(tabs, /\{caseLink \? <>\{" "\}<Link [^>]*href=\{`\/v3\/profile\?case=\$\{encodeURIComponent\(leadCabinetCase\.studentCaseId\)\}&tab=anketa`\}>/u);
  assert.match(tabs, /<PrepareLeadCabinetAction leadId=\{leadId\} requestId=\{prepareRequestId\} caseLink=\{caseLink\} \/>/u);
  const prepare = source("src/components/v3/profile/PrepareLeadCabinetAction.tsx");
  assert.doesNotMatch(prepare, /Приглашение отправляет администратор/u);
  // Right after «Подготовить кабинет» the same rule: no «Открыть дело» for
  // Sales without admissions.read, not even until the refresh.
  assert.match(prepare, /Кабинет подготовлен\.\s*\{caseLink \? <>\{" "\}<Link [^>]*href=\{`\/v3\/profile\?case=\$\{encodeURIComponent\(state\.studentCaseId\)\}&tab=anketa`\}>/u);
});

// ---------------------------------------------------------------------------
// D: the menu with every real role bundle (keys of the 244 fixture, the
// production bundles of the 26.09 audit)
// ---------------------------------------------------------------------------
const fixture = source("supabase/tests/platform_access_by_permissions.sql");
const bundles = Object.fromEntries([...fixture.matchAll(/\(pg_temp\.n244_id\(\d+\), '([^']+)', '(\[[^']*\])', \d+\)/gu)]
  .map((match) => [match[1], JSON.parse(match[2])]));
const SALES_ONLY_MANAGER_KEYS = ["contract.evidence.confirm", "finance.event.confirm", "finance.first.payment.confirm", "lead.sales.owner.assign"];
bundles.Sales = bundles["Sales Manager"].filter((key) => !SALES_ONLY_MANAGER_KEYS.includes(key));

function navigationFor(keys, href = "/v3/main", systemRole = "staff") {
  const url = new URL(href, "https://navigation.test");
  return buildV3Navigation({ ...staffActor(keys), systemRole }, url.pathname, url.searchParams);
}
const ids = (model) => ({
  groups: model.groups.map((group) => [group.id, group.links.map((link) => link.id)]),
  common: model.common.map((link) => link.id),
});

test("D: the role bundles are the production ones", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(bundles).map(([label, keys]) => [label, keys.length])), {
    Admissions: 35, "Admissions Manager": 36, "Sales Manager": 23, "Sales common": 12, "Admissions common": 16, Sales: 19,
  });
});

for (const label of ["Admissions", "Admissions Manager"]) {
  test(`D: ${label} sees no sales work, only «Отчёт продаж» of #1067; «Заявки» under «Поступление», WhatsApp in the common sections`, () => {
    const keys = [...bundles[label], ...bundles["Admissions common"]];
    const model = navigationFor(keys);
    // D hides WhatsApp and «Воронка продаж» in «Продажи»; «Отчёт продаж» keeps
    // its own rule of «Сегодня» (#1067): a lead reader without report
    // records opens «Динамика по дням» there, the charts of the former Главная.
    // «Заявки» moves to «Поступление», last: the Admissions Manager reviews
    // «Анкеты платформы» there (177: profile.read.full, profile.manage and
    // case.curator.assign in the review department) and both roles handle
    // the cabinet consultations (197: lead.read). No other surface lists
    // them.
    assert.deepEqual(ids(model).groups, [
      ["sales", ["sales-report"]],
      ["admissions", ["admissions-pipeline", "messages", "admissions-worklist", "evo-docs", "universities", "requests"]],
    ]);
    assert.ok(ids(model).common.includes("inbox"), "WhatsApp is reachable through communication.read.full");
    const everyLink = [...model.groups.flatMap((group) => group.links), ...model.common];
    assert.equal(everyLink.some((link) => link.id === "pipeline"), false, "pipeline");
    assert.equal(everyLink.filter((link) => link.id === "requests").length, 1, "«Заявки» stands once");
    const requests = navigationFor(keys, "/v3/requests");
    assert.equal(requests.activeId, "requests");
    assert.deepEqual(requests.groups.filter((group) => group.active).map((group) => group.id), ["admissions"]);
    assert.equal(navigationFor(keys, "/v3/main?view=sales").activeId, "sales-report");
    // A lead card opened from a case highlights «Студенты», not a hidden board.
    assert.equal(navigationFor(keys, "/v3/profile?id=24800000-0000-4000-8000-000000000702").activeId, "admissions-worklist");
    // The capability behind the case page's lead data is unchanged: lead.read
    // still opens the linked lead of the curator's own case.
    assert.equal(staffCan(staffActor(keys), "sales.read"), true);
  });
}

for (const label of ["Sales Manager", "Sales"]) {
  test(`D: ${label} keeps the whole «Продажи» group with WhatsApp inside it`, () => {
    const model = navigationFor([...bundles[label], ...bundles["Sales common"]]);
    assert.deepEqual(ids(model).groups[0], ["sales", ["requests", "inbox", "pipeline", "sales-report"]]);
    assert.equal(ids(model).groups.slice(1).some(([, links]) => links.includes("requests")), false, "«Заявки» stands once");
    assert.equal(ids(model).common.includes("inbox"), false);
  });
}

test("D: the Admin keeps both groups with «Заявки» in «Продажи» only; common roles without lead work see neither", () => {
  const admin = navigationFor([], "/v3/main", "admin");
  assert.deepEqual(ids(admin).groups, [
    ["sales", ["requests", "inbox", "pipeline", "sales-report"]],
    ["admissions", ["admissions-pipeline", "messages", "admissions-worklist", "evo-docs", "universities"]],
  ]);
  assert.equal(ids(admin).common.includes("inbox"), false);
  for (const label of ["Sales common", "Admissions common"]) {
    const model = ids(navigationFor(bundles[label]));
    assert.equal(model.groups.some(([id]) => id === "sales"), false, label);
    assert.equal(model.groups.some(([, links]) => links.includes("requests")), false, label);
  }
});
