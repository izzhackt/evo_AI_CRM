import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSalesDate, parseSalesInteger, parseSalesRegisterWorkspace } from "../src/lib/platform-sales-register-contract.ts";

// Pure boundary/source assertions; no fake successful RPC or business actor.
test("sales scalar boundaries reject date rollover, infinity and unsafe money", () => {
  for (const value of ["2026-02-30", "2026-13-01", "infinity", "2101-01-01", "2026-2-1", null]) assert.equal(parseSalesDate(value), null);
  assert.equal(parseSalesDate("2024-02-29"), "2024-02-29");
  for (const value of [NaN, Infinity, -1, "1.5", "1e2", " 12", Number.MAX_SAFE_INTEGER + 1]) assert.equal(parseSalesInteger(value), null);
  assert.equal(parseSalesInteger("0"), 0);
  assert.equal(parseSalesInteger("1000000000001", 1_000_000_000_000), null);
  assert.throws(() => parseSalesRegisterWorkspace(null, ""), /unavailable/);
  assert.throws(() => parseSalesRegisterWorkspace({ rows: [] }, ""), /unavailable/);
});
test("sales register has one guarded canonical handoff path and no first-payment inference", () => {
  const sql = readFileSync(new URL("../supabase/migrations/134_platform_sales_register.sql", import.meta.url), "utf8");
  assert.match(sql, /UNIQUE\(organization_id,lead_id\)/);
  assert.match(sql, /AFTER INSERT ON platform\.sales_admissions_handoffs/);
  assert.match(sql, /NEW\.handoff_state='completed'/);
  assert.match(sql, /AT TIME ZONE 'Asia\/Bishkek'/);
  assert.match(sql, /sales_context->>'current_owner_membership_id'/);
  assert.doesNotMatch(sql, /first_payment_amount|contract_confirmed_at/);
  assert.match(sql, /IF EXISTS\(SELECT 1 FROM platform_private\.sales_register r WHERE r\.organization_id=handoff\.organization_id AND r\.lead_id=handoff\.lead_id\) THEN RETURN/);
  assert.match(sql, /WHERE handoff_state='completed' ORDER BY organization_id,handed_off_at,id/);
  assert.match(sql, /source_kind='pipeline' AND source_snapshot IS NOT NULL AND jsonb_typeof\(source_snapshot\)='object'/);
  assert.match(sql, /p_allow_unknown_applicant BOOLEAN DEFAULT false/);
  assert.match(sql, /value='' AND p_allow_unknown_applicant IS DISTINCT FROM true/);
  assert.match(sql, /display_applicant:=left\(btrim\(regexp_replace\(original_applicant,'\[\[:cntrl:\]\]',' ','g'\)\),300\)/);
  assert.match(sql, /WHEN client\.normalized_phone ~ '\^\\\+\?\[0-9\]\{7,15\}\$' THEN client\.normalized_phone ELSE NULL END/);
  assert.doesNotMatch(sql, /left\(client\.(?:phone|normalized_phone)/);
  assert.match(sql, /'original_applicant_length',length\(original_applicant\)/);
});
test("private request history retains reasons without expanding shared audit", () => {
  const sql = readFileSync(new URL("../supabase/migrations/134_platform_sales_register.sql", import.meta.url), "utf8");
  assert.match(sql, /reason TEXT NOT NULL CHECK \(length\(btrim\(reason\)\) BETWEEN 1 AND 1000\)/);
  assert.equal((sql.match(/receipt,btrim\(p_reason\)\)/g) ?? []).length, 2);
  assert.match(sql, /receipt,'Sales source import'\)/);
  const auditWrites = [...sql.matchAll(/INSERT INTO platform\.audit_events[^;]+;/g)].map(match => match[0]);
  assert.ok(auditWrites.length > 0);
  for (const auditWrite of auditWrites) assert.doesNotMatch(auditWrite, /p_reason/);
});
test("source and actions use cookie authority with no provider or elevated client", () => {
  const source = readFileSync(new URL("../src/lib/v3/sales-register-source.ts", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../src/lib/platform-sales-register-actions.ts", import.meta.url), "utf8");
  assert.match(source, /createSupabaseServerClient\(\)/);
  // Э8.6 (253): отчёт читает v4, правка — manage v2; v1–v3 и manage v1 остаются на сервере для отката.
  assert.match(source, /rpc\("read_sales_register_v4"/);
  assert.doesNotMatch(source, /rpc\("read_sales_register_v[123]"/);
  assert.match(source, /rpc\("read_sales_manager_labels_v1"/);
  assert.match(actions, /rpc\("manage_sales_register_v2"/);
  assert.match(actions, /rpc\("save_sales_manager_label_v1"/);
  assert.doesNotMatch(actions, /rpc\("manage_sales_register_v1"/);
  assert.match(source, /p_organization_id: actor\.organizationId/);
  assert.doesNotMatch(source, /row\.ownerMembershipId !== actor\.membershipId|actor\.authorityRole/);
  assert.match(actions, /p_expected_version: version/);
  assert.match(actions, /data\.request_id !== requestId/);
  assert.doesNotMatch(source + actions, /createSupabaseAdmin|SERVICE_ROLE|SECRET_KEY|\.from\(/);
  assert.match(actions, /inserted \+ skipped \+ mismatches !== input\.sales\.length/);
  // 254 adds linkSalesRecordLeadAction's own revalidation (report panel + Lead 360).
  assert.equal((actions.match(/revalidatePath\("\/v3\/main"\)/g) ?? []).length, 5);
  assert.match(actions, /rpc\("link_sales_record_lead_v1"/);
});

// Unified workflow S2 (plan §6): «Отчёт продаж → Добавить продажу» narrows
// to выбор лида и куратора; conditions/applicant identity are read back
// server-side from the card, never resubmitted through this form.
test("saveSalesRegisterAction's create path takes lead+curator and lets the server choose the month and drops the retired new-student intake", () => {
  const actions = readFileSync(new URL("../src/lib/platform-sales-register-actions.ts", import.meta.url), "utf8");
  assert.match(actions, /const INTAKE = \["lead_id", "curator_membership_id"\] as const;/);
  assert.doesNotMatch(actions, /"email"|"interest_direction"/);
  assert.doesNotMatch(actions, /create_manual_sales_lead|existing_student/);
  assert.match(
    actions,
    /rpc\("create_sales_report_handoff", \{\s*p_organization_id: actor\.organizationId, p_request_id: requestId, p_lead_id: leadId,\s*p_curator_membership_id: curatorId,/,
  );
  assert.doesNotMatch(actions, /p_report_month: reportMonth/);
  // create no longer submits or expects a reason; only update/archive/restore do.
  assert.match(actions, /const REASON = \["reason"\] as const;/);
  assert.match(
    actions,
    /exactActionStringFields\(form, operation === "create" \? \[\.\.\.BASE, \.\.\.INTAKE\]\s*: operation === "update" \? \[\.\.\.BASE, \.\.\.REASON, \.\.\.EDIT, \.\.\.CONTRACT\] : \[\.\.\.BASE, \.\.\.REASON\]\)/,
  );
  // «Оплачено в валюте договора» (253) — отдельной парой, не в полях записи.
  assert.match(actions, /const CONTRACT = \["paid_contract_minor", "paid_contract_currency"\] as const;/);
  assert.match(actions, /p_paid_contract_minor: contractMinor,\s*p_paid_contract_currency: contractCurrency,/);
});

test("conditions-missing UX: a distinct status routes the create form back to the lead card, never a generic invalid message", () => {
  const actions = readFileSync(new URL("../src/lib/platform-sales-register-actions.ts", import.meta.url), "utf8");
  const forms = readFileSync(new URL("../src/components/v3/SalesRegisterForms.tsx", import.meta.url), "utf8");
  assert.match(
    actions,
    /error\.message\.includes\("sale_conditions_missing"\)\) return outcome\(form, "conditions_missing"\);/,
  );
  assert.match(actions, /"conditions_missing"/);
  assert.match(forms, /conditions_missing: /);
  assert.match(forms, /Заполнить условия в карточке/);
  assert.match(forms, /readSalesReportConditionsPreviewAction/);
  assert.match(forms, /conditions\.serviceCostMinor === null/);
  // The «new student» mode (owner/email/direction inputs) is fully retired.
  assert.doesNotMatch(forms, /studentMode|interestDirection/);
});

// Э8.6 (253, owner decisions 28.09): «Оплачено в валюте договора» as columns, row v2, read v4, manage v2 and
// «Менеджеры в отчёте». The real-Postgres proof is supabase/tests/platform_sales_register_v4.sql at its checkpoint.
test("migration 253 continues the contiguous source ledger and runs its real-Postgres suite at its checkpoint", async () => {
  const { expectedMigrationVersions } = await import("../scripts/fast-release-ledger-gate.mjs");
  const { fileURLToPath } = await import("node:url");
  // 252 is Э8.5's migration (merged first); the ledger stays contiguous only with both.
  const versions = expectedMigrationVersions(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
  assert.ok(versions.includes("252") && versions.includes("253"));
  const script = readFileSync(new URL("../scripts/test-postgres-authorization.sh", import.meta.url), "utf8");
  assert.match(script, /== 253_\* \]\]; then\s+docker exec "\$container_name" \\\s+psql -X -v ON_ERROR_STOP=1 -h 127\.0\.0\.1 -U postgres -d "\$test_database" \\\s+-f \/workspace\/supabase\/tests\/platform_sales_register_v4\.sql/u);
  const suite = readFileSync(new URL("../supabase/tests/platform_sales_register_v4.sql", import.meta.url), "utf8");
  assert.match(suite, /^BEGIN;$/mu);
  assert.match(suite, /^ROLLBACK;\s*$/mu);
  assert.match(suite, /N253_SALES_REPORT_V4_SUITE_OK/u);
  assert.doesNotMatch(suite, /@(?!example\.invalid)[a-z0-9-]+\.[a-z]/iu, "synthetic addresses only");
});

test("migration 253 adds columns outside `fields`, new versions only, and keeps the released reads byte-identical", () => {
  const sql = readFileSync(new URL("../supabase/migrations/253_platform_sales_report_contract_amount.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN paid_contract_minor BIGINT,\s*ADD COLUMN paid_contract_currency TEXT,/u);
  assert.match(sql, /CHECK \(\(paid_contract_minor IS NULL\) = \(paid_contract_currency IS NULL\)\)/u);
  assert.match(sql, /paid_contract_currency IN \('USD','EUR','KGS'\)/u);
  // Nothing new goes into `fields` (row v1 = fields || fixed keys would leak it into v1–v3), and no mass update.
  assert.doesNotMatch(sql, /fields\s*\|\|\s*jsonb_build_object\('paid_contract/u);
  assert.doesNotMatch(sql, /UPDATE platform_private\.sales_register SET[^;]*WHERE (?!id=old\.id)/u);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION/u, "released functions are never replaced");
  assert.doesNotMatch(sql, /'source_snapshot'|source_snapshot\s*\)\s*$/mu, "the snapshot is never returned");
  for (const signature of ["platform.read_sales_register_v1(", "platform.read_sales_register_v2(", "platform.read_sales_register_v3(",
    "platform.manage_sales_register_v1(", "platform.staff_lead_handoff_strip_v1(", "platform_private.sales_register_row(platform_private.sales_register)"]) {
    assert.ok(sql.includes(signature), `${signature} is compared before and after`);
  }
  assert.match(sql, /RAISE EXCEPTION 'a253_sales_report_verification_failed: a released read or command changed'/u);
  // The mapping: FORCE RLS, no client grants, the data-transfer permission at organization scope.
  assert.match(sql, /ALTER TABLE platform_private\.sales_manager_labels FORCE ROW LEVEL SECURITY;/u);
  assert.equal((sql.match(/'sales\.register\.import', 'organization', p_organization_id\)/gu) ?? []).length, 2);
  // manage v2 keeps v1's gates: the 208 Sales Manager guard twice (before and after the lock) and the record permission.
  const manage = sql.slice(sql.indexOf("CREATE FUNCTION platform.manage_sales_register_v2"), sql.indexOf("CREATE FUNCTION platform.read_sales_manager_labels_v1"));
  assert.equal((manage.match(/staff_is_sales_manager\(p_organization_id,actor\.membership_id\)/gu) ?? []).length, 2);
  assert.match(manage, /'sales\.register\.manage', 'sales_register', old\.id\)/u);
  assert.match(manage, /currency_gap:=cost_currency IS NOT NULL AND paid_currency IS NOT NULL AND cost_currency<>paid_currency\s+AND p_paid_contract_minor IS NULL;/u);
});

// Э8.7 (254, owner decision 28.09: «можно связать, но это не рабочее место,
// просто связать»). The real-Postgres proof is
// supabase/tests/platform_sales_record_lead_link.sql at its checkpoint.
test("migration 254 continues the contiguous source ledger and runs its real-Postgres suite at its checkpoint", async () => {
  const { expectedMigrationVersions } = await import("../scripts/fast-release-ledger-gate.mjs");
  const { fileURLToPath } = await import("node:url");
  const versions = expectedMigrationVersions(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
  assert.ok(versions.includes("253") && versions.includes("254"));
  const script = readFileSync(new URL("../scripts/test-postgres-authorization.sh", import.meta.url), "utf8");
  assert.match(script, /== 254_\* \]\]; then\s+docker exec "\$container_name" \\\s+psql -X -v ON_ERROR_STOP=1 -h 127\.0\.0\.1 -U postgres -d "\$test_database" \\\s+-f \/workspace\/supabase\/tests\/platform_sales_record_lead_link\.sql/u);
  const suite = readFileSync(new URL("../supabase/tests/platform_sales_record_lead_link.sql", import.meta.url), "utf8");
  assert.match(suite, /^BEGIN;$/mu);
  assert.match(suite, /^ROLLBACK;\s*$/mu);
  assert.match(suite, /N254_SALES_RECORD_LEAD_LINK_SUITE_OK/u);
  assert.doesNotMatch(suite, /@(?!example\.invalid)[a-z0-9-]+\.[a-z]/iu, "synthetic addresses only");
});

test("migration 254 adds a plain lead link outside `lead_id`, never a pipeline sale, and keeps v4/manage v2/row v2/strip v1 byte-identical", () => {
  const sql = readFileSync(new URL("../supabase/migrations/254_platform_sales_record_lead_link.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN linked_lead_id UUID,/u);
  assert.match(sql, /FOREIGN KEY \(organization_id, linked_lead_id\)\s*\n\s*REFERENCES platform\.leads\(organization_id, id\)/u);
  assert.match(sql, /CHECK \(source_kind <> 'pipeline' OR linked_lead_id IS NULL\)/u);
  assert.match(sql, /CREATE UNIQUE INDEX sales_register_linked_lead_unique_idx\s*\n\s*ON platform_private\.sales_register \(organization_id, linked_lead_id\)\s*\n\s*WHERE linked_lead_id IS NOT NULL;/u);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION/u, "released functions are never replaced");
  for (const signature of ["platform.read_sales_register_v4(", "platform.manage_sales_register_v2(",
    "platform_private.sales_register_row_v2(platform_private.sales_register)", "platform.staff_lead_handoff_strip_v1("]) {
    assert.ok(sql.includes(signature), `${signature} is compared before and after`);
  }
  assert.match(sql, /RAISE EXCEPTION 'a254_sales_record_lead_verification_failed: a released read or command changed'/u);
  // link/unlink share manage_sales_register_v2's write gates: the 208 guard before and after the lock,
  // the record permission, and lead.read on the touched lead.
  const link = sql.slice(sql.indexOf("CREATE FUNCTION platform.link_sales_record_lead_v1"), sql.indexOf("CREATE FUNCTION platform.sales_record_lead_link_v1"));
  assert.equal((link.match(/staff_is_sales_manager\(p_organization_id, actor\.membership_id\)/gu) ?? []).length, 2);
  assert.match(link, /'sales\.register\.manage', 'sales_register', old\.id\)/u);
  assert.match(link, /staff_can_access\(p_organization_id, actor\.membership_id, 'lead\.read', 'lead', lead_check\)/u);
  assert.match(link, /IF old\.source_kind <> 'import' OR old\.archived THEN/u);
  assert.match(link, /sales_register_lead_has_sale/u);
  assert.match(link, /sales_register_lead_already_linked/u);
  // The panel read never guesses: visible only with lead.read on the linked lead.
  const panelRead = sql.slice(sql.indexOf("CREATE FUNCTION platform.sales_record_lead_link_v1"), sql.indexOf("CREATE FUNCTION platform.staff_lead_handoff_strip_v2"));
  assert.match(panelRead, /'visible', false, 'lead_id', NULL, 'name', NULL/u);
  // Strip v2 prefers a pipeline sale (lead_id) over a merely linked row.
  const stripV2 = sql.slice(sql.indexOf("CREATE FUNCTION platform.staff_lead_handoff_strip_v2"));
  assert.match(stripV2, /ORDER BY \(r\.lead_id IS NOT DISTINCT FROM p_lead_id\) DESC/u);
  assert.match(stripV2, /CASE WHEN r\.lead_id = p_lead_id THEN 'sale' ELSE 'linked' END AS link/u);
});
