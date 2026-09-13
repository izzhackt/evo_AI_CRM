import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as caseSections from "../src/lib/v3/case-access-contract.ts";
import { getPlatformCaseFinanceControl, PlatformFinanceControlRepositoryError } from "../src/lib/platform-finance-control.ts";
import { tabsFor } from "../src/components/v3/profile/types.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/156_platform_scoped_staff_consumers.sql");
const currentFunctions = [
  {
    signature: "platform.staff_case_finance_control(uuid,integer)",
    source: "supabase/migrations/107_platform_admissions_optimistic_versions.sql",
    hash: "1bcf050aef1215779fa90f0ba09aa770",
    organization: "student_case.organization_id",
    caseId: "student_case.id",
  },
  {
    signature: "platform.staff_finance_control_queue(integer,uuid[])",
    source: "supabase/migrations/090_platform_u8_finance_stop_factor_surface.sql",
    hash: "bb9e645f9a1250599766066892ada88b",
    organization: "obligation.organization_id",
    caseId: "obligation.student_case_id",
  },
];

function currentDefinition(spec) {
  const source = read(spec.source);
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION ${spec.signature.split("(")[0]}(`);
  assert.notEqual(start, -1);
  const bodyStart = source.indexOf("AS $$", start) + 5;
  const bodyEnd = source.indexOf("$$;", bodyStart);
  assert.ok(bodyStart > start && bodyEnd > bodyStart);
  return { header: source.slice(start, bodyStart), body: source.slice(bodyStart, bodyEnd) };
}

function financePatches() {
  const block = migration.match(/DO \$scoped_finance_reads\$([\s\S]+?)\$scoped_finance_reads\$;/);
  assert.ok(block, "156 must include the narrowly guarded finance read cutover");
  const patches = [...block[1].matchAll(
    /PERFORM pg_temp\.evo_s2_replace\('([^']+)',\s*\$\$([\s\S]*?)\$\$,\s*\$\$([\s\S]*?)\$\$\);/g,
  )].map(([, signature, before, after]) => ({ signature, before, after }));
  assert.equal(patches.length, 2, "Only the two current finance readers are replaced");
  return { block: block[1], patches };
}

test("S2 finance read cutover pins both actual current bodies before replacing exact anchors", () => {
  const { block, patches } = financePatches();
  assert.match(block, /IF md5\(body\) <> spec\.expected_md5 THEN/);
  assert.match(block, /RAISE EXCEPTION 'Unexpected scoped finance read definition: %'/);
  for (const spec of currentFunctions) {
    const { body } = currentDefinition(spec);
    assert.equal(createHash("md5").update(body).digest("hex"), spec.hash);
    assert.ok(block.includes(`('${spec.signature}', '${spec.hash}')`));
    const patch = patches.find((one) => one.signature === spec.signature);
    assert.ok(patch);
    assert.equal(body.split(patch.before).length - 1, 1, `${spec.signature} exact current authority anchor`);
  }
});

for (const spec of currentFunctions) {
  test(`S2 ${spec.signature} pairs full/summary with the same case and preserves the projection`, () => {
    const { patches } = financePatches();
    const patch = patches.find((one) => one.signature === spec.signature);
    assert.ok(patch);
    const normalize = (text) => text.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
    assert.equal(normalize(patch.after), normalize(`AND (
      platform_private.staff_can_access_for_actor(
        ${spec.organization}, 'finance.read.full', 'student_case', ${spec.caseId}
      )
      OR (
        private.platform_can_read_student_case(${spec.organization}, ${spec.caseId})
        AND platform_private.staff_can_access_for_actor(
          ${spec.organization}, 'finance.read.summary', 'student_case', ${spec.caseId}
        )
      )
    )`));
    const original = currentDefinition(spec);
    const revised = original.body.replace(patch.before, patch.after);
    // Only the authority predicate changes. Wire fields, monetary arithmetic,
    // pagination, ordering and existing sanitized audit projections stay exact.
    assert.equal(revised.replace(patch.after, patch.before), original.body);
    assert.match(original.header, /STABLE\s+SECURITY DEFINER\s+SET search_path = ''/);
    assert.doesNotMatch(patch.after, /current_role|platform_role|platform_has_permission|organization',/);
    assert.match(migration, /'case\.read\.full', 'student_case', p_student_case_id\)/);
  });
}

test("S2 monthly summary availability is a live staff-bound organization permission, not finance data", () => {
  const definition = migration.match(/CREATE FUNCTION platform\.staff_monthly_payment_summary_access\(p_organization_id UUID\)([\s\S]+?)\$\$;/);
  assert.ok(definition, "The monthly summary has its own exact live capability RPC");
  const body = definition[1];
  assert.match(body, /RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''/);
  assert.match(body, /FROM platform\.current_actor_authority\(\) AS a/);
  assert.match(body, /JOIN platform_private\.staff_membership_identity\(a\.organization_id, a\.membership_id\) AS i ON TRUE/);
  assert.match(body, /WHERE a\.organization_id = p_organization_id/);
  assert.match(body, /IF NOT FOUND THEN[\s\S]+?ERRCODE = '42501'/);
  assert.match(body, /'schemaVersion', 1, 'organizationId', actor\.organization_id,/);
  assert.match(body, /'canReadSummary', platform_private\.staff_can_access\(\s*actor\.organization_id, actor\.membership_id, 'finance\.read\.full',\s*'organization', actor\.organization_id\)/);
  assert.doesNotMatch(body, /platform\.(payment_events|payment_obligations)|staff_has_permission|auth\.jwt|platform_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION platform\.staff_monthly_payment_summary_access\(UUID\)\s+FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION platform\.staff_monthly_payment_summary_access\(UUID\) TO authenticated;/);
  // The actual organization summary still independently checks at execution.
  assert.match(read("supabase/migrations/144_platform_finance_entry_and_report.sql"), /require_finance_actor\(p_organization_id,'finance.read.full'\)/);
  assert.match(migration, /'finance.read.full', 'organization', a.organization_id/);
});

test("S2 case section snapshot admits full or summary finance on the same already-readable case", () => {
  const definition = migration.match(/CREATE FUNCTION platform\.staff_case_access_snapshot\(p_organization_id UUID, p_student_case_id UUID\)([\s\S]+?)\$\$;/);
  assert.ok(definition);
  assert.match(definition[1], /IF NOT FOUND OR NOT platform_private\.staff_can_access\(p_organization_id, a\.membership_id,\s*'case\.read\.full', 'student_case', p_student_case_id\) THEN\s*RAISE EXCEPTION 'Student case is unavailable' USING ERRCODE = '42501'/);
  const finance = definition[1].match(/'finance', ([\s\S]+?),\s*'studentProfile'/)?.[1];
  assert.equal(finance?.replace(/\s+/g, " ").trim(), "(platform_private.staff_can_access(p_organization_id, a.membership_id, 'finance.read.full', 'student_case', p_student_case_id) OR platform_private.staff_can_access(p_organization_id, a.membership_id, 'finance.read.summary', 'student_case', p_student_case_id))");
});

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const STUDENT_CASE_ID = "20000000-0000-4000-8000-000000000001";
function sectionAccess(finance) {
  // The live RPC supplies this exact-case capability. The UI never derives it
  // by combining union permission keys with an unrelated assignment scope.
  return caseSections.parseCaseSectionAccess({
    organizationId: ORGANIZATION_ID, studentCaseId: STUDENT_CASE_ID,
    documents: false, finance, studentProfile: false, contract: false,
    handoff: true, applications: true, visa: true,
  }, ORGANIZATION_ID, STUDENT_CASE_ID);
}
const inaccessibleReader = async () => assert.fail("An unavailable section must not be read");
function financePayload(obligations = [{
  payment_obligation_id: "30000000-0000-4000-8000-000000000001",
  label: "Первый взнос", category: "evo_service_fee", amount_minor: 10000,
  currency: "USD", due_at: "2026-09-20T10:00:00Z", total_paid_minor: 4000,
  total_refunded_minor: 0, outstanding_minor: 6000, derived_status: "partially_paid",
  overdue: false, next_action: "Получить оставшуюся сумму", payment_confirmation_count: 1,
  last_payment_at: "2026-09-12T10:00:00Z", active_stop_factors: [],
}]) {
  return { organization_id: ORGANIZATION_ID, student_case_id: STUDENT_CASE_ID, obligations, history: [] };
}

for (const permissionKeys of [["case.read.full", "finance.read.summary"], ["case.read.full", "finance.read.full"]]) {
  test(`S2 profile coordinator retains permitted ${permissionKeys[1]} data and exposes its actual money tab`, async () => {
    assert.equal(typeof caseSections.readCaseProfileSections, "function");
    const calls = [];
    const actor = {
      systemRole: "staff", presentationRole: null, organizationId: ORGANIZATION_ID,
      permissionKeys, assignments: [], platformAccessVersion: 1,
    };
    const client = { schema(name) {
      assert.equal(name, "platform");
      return { async rpc(name, args, options) {
        calls.push({ name, args, options });
        return { data: financePayload(), error: null };
      } };
    } };
    const result = await caseSections.readCaseProfileSections(sectionAccess(true), {
      finance: () => getPlatformCaseFinanceControl(actor, STUDENT_CASE_ID, 25, { client }),
      documents: inaccessibleReader, studentProfile: inaccessibleReader, contract: inaccessibleReader,
    });
    assert.equal(result.finance.organizationId, ORGANIZATION_ID);
    assert.equal(result.finance.studentCaseId, STUDENT_CASE_ID);
    assert.equal(result.finance.obligations.length, 1);
    assert.equal(result.finance.obligations[0].label, "Первый взнос");
    assert.equal(result.finance.obligations[0].outstandingMinor, 6000);
    assert.deepEqual(calls, [{ name: "staff_case_finance_control",
      args: { p_student_case_id: STUDENT_CASE_ID, p_history_limit: 25 }, options: { get: true } }]);
    assert.ok(tabsFor(true, result.access, true).some((tab) => tab.key === "money"));
    assert.equal(result.documents, null);
    assert.equal(result.studentProfile, null);
    assert.equal(result.contract, null);
  });
}

test("S2 profile coordinator keeps unavailable finance distinct from permitted empty finance", async () => {
  assert.equal(typeof caseSections.readCaseProfileSections, "function");
  const result = await caseSections.readCaseProfileSections(sectionAccess(false), {
    finance: inaccessibleReader, documents: inaccessibleReader,
    studentProfile: inaccessibleReader, contract: inaccessibleReader,
  });
  assert.equal(result.finance, null);
  assert.equal(result.access.finance, false);
  assert.equal(tabsFor(true, result.access, true).some((tab) => tab.key === "money"), false);
  const emptyFinance = { organizationId: ORGANIZATION_ID, studentCaseId: STUDENT_CASE_ID, obligations: [], history: [] };
  const permitted = await caseSections.readCaseProfileSections(sectionAccess(true), {
    finance: async () => emptyFinance, documents: inaccessibleReader,
    studentProfile: inaccessibleReader, contract: inaccessibleReader,
  });
  assert.equal(permitted.finance, emptyFinance);
  assert.equal(permitted.access.finance, true);
  assert.ok(tabsFor(true, permitted.access, true).some((tab) => tab.key === "money"));
});

test("S2 profile coordinator propagates an authorized finance reader failure instead of returning an empty section", async () => {
  assert.equal(typeof caseSections.readCaseProfileSections, "function");
  const actor = { systemRole: "staff", presentationRole: null, organizationId: ORGANIZATION_ID,
    permissionKeys: ["case.read.full", "finance.read.summary"], assignments: [], platformAccessVersion: 1 };
  const client = { schema() { return { async rpc() { return { data: null, error: { code: "read_failed" } }; } }; } };
  await assert.rejects(caseSections.readCaseProfileSections(sectionAccess(true), {
    finance: () => getPlatformCaseFinanceControl(actor, STUDENT_CASE_ID, 25, { client }),
    documents: inaccessibleReader, studentProfile: inaccessibleReader, contract: inaccessibleReader,
  }), PlatformFinanceControlRepositoryError);
});

test("S2 profile adapter uses the tested section coordinator and passes its access/data to the UI", () => {
  const profile = read("src/lib/v3/profile-source.ts");
  assert.match(profile, /readCaseProfileSections\(access,\s*\{/);
  assert.match(profile, /finance:\s*\(\) => getPlatformCaseFinanceControl\(actor, studentCaseId\)/);
  assert.match(profile, /access: data\.access/);
  assert.match(profile, /finance: data\.finance/);
});
