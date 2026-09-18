// Source-contract guards only. These read the actual migration file; they
// are not database execution (no Supabase credentials in this environment —
// the migration is not applied per the S4 task instructions). Behavior is
// checked by pattern-matching the SQL, the same style
// tests/platform-case-acceptance-migration.test.mjs (S3),
// tests/platform-lead-sale-conditions-migration.test.mjs (S2) and
// tests/platform-unified-intake-access-migration.test.mjs (S1) use.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedMigrationVersions } from "../scripts/fast-release-ledger-gate.mjs";
import { fileURLToPath } from "node:url";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = source("supabase/migrations/183_platform_admissions_summary_pruning.sql");

test("migration 183 continues the contiguous source ledger", () => {
  const versions = expectedMigrationVersions(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
  assert.ok(versions.includes("182") && versions.includes("183"));
});

test("migration is transactional and fails closed on source drift, like 173-182", () => {
  assert.match(sql, /^BEGIN;$/mu);
  assert.match(sql, /^COMMIT;\s*$/mu);
  assert.match(sql, /RAISE EXCEPTION/u);
  assert.doesNotMatch(sql, /\bDROP\s+(?:SCHEMA|DATABASE)\b|\bTRUNCATE\s+TABLE\b/iu);
  // A plain body-only CREATE OR REPLACE on an unchanged signature needs no
  // DROP FUNCTION / re-grant dance (same in-place-amend pattern 145/182 used
  // for platform_private.admissions_attention_flags's own rewrites) — no
  // executable statement here does either (only this file's own header
  // prose explains why not, which is allowed to say the words).
  const statements = sql.split("\n").filter((line) => !line.trimStart().startsWith("--"));
  assert.doesNotMatch(statements.join("\n"), /DROP FUNCTION|\bGRANT\b|\bREVOKE\b/u);
});

test("admissions_direction_summary_v1 keeps its exact 4-argument signature and authority gate", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION platform\.admissions_direction_summary_v1\(p_direction TEXT DEFAULT NULL,p_curator_membership_id UUID DEFAULT NULL,p_period_from DATE DEFAULT NULL,p_period_to DATE DEFAULT NULL\)/u);
  assert.match(sql, /a\.platform_role NOT IN \('admin','curator'\)/u);
  assert.match(sql, /private\.platform_has_permission\(a\.organization_id,'case\.read\.full'\)/u);
});

test("stock keeps only active/overdue/awaiting_ack/needs_curator — the retired route/submission/decision/visa/arrival counters are gone", () => {
  const fn = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION platform.admissions_direction_summary_v1("),
  );
  assert.match(fn, /'active',count\(\*\) FILTER\(WHERE state='active'\)/u);
  assert.match(fn, /'overdue',count\(\*\) FILTER\(WHERE 'overdue'=ANY\(flags\)\)/u);
  assert.match(fn, /'awaiting_ack',count\(\*\) FILTER\(WHERE 'awaiting_ack'=ANY\(flags\)\)/u);
  assert.match(fn, /'needs_curator',count\(\*\) FILTER\(WHERE 'needs_curator'=ANY\(flags\)\)/u);
  for (const retired of ["awaiting_partner", "submitted", "decisions", "visas", "arrivals", "cancelled", "arrived"]) {
    assert.doesNotMatch(fn, new RegExp(`'${retired}'`, "u"));
  }
  // No periodArrivals CTE, no periodFrom/periodTo echoed in the JSON result —
  // the params stay accepted (signature stability) but are no longer used
  // to compute or report anything.
  assert.doesNotMatch(fn, /\bperiodArrivals\b/u);
  assert.doesNotMatch(fn, /\bperiodFrom\b|\bperiodTo\b/u);
  assert.doesNotMatch(fn, /JOIN LATERAL/u);
  assert.match(fn, /jsonb_build_object\('stock',COALESCE\(\(SELECT jsonb_agg\(row ORDER BY direction_key\) FROM stock\),'\[\]'::JSONB\)\)/u);
});

test("stock reuses the SAME per-case admissions_attention_flags — no duplicated or diverging flag computation", () => {
  const fn = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION platform.admissions_direction_summary_v1("),
  );
  assert.match(fn, /platform_private\.admissions_attention_flags\(c\.id\) AS flags/u);
  assert.equal((fn.match(/platform_private\.admissions_attention_flags\(/gu) ?? []).length, 1);
});
