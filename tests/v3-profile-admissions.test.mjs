import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V3 profile keeps lead and Admissions case route identities separate", () => {
  const page = source("src/app/(v3)/v3/profile/page.tsx");
  const types = source("src/components/v3/profile/types.ts");
  const adapter = source("src/lib/v3/profile-source.ts");

  assert.match(page, /requirePlatformStaffActor/u);
  assert.match(page, /case\?: string/u);
  assert.match(page, /readProfileTarget\(actor, target\)/u);
  assert.match(page, /actorRole=\{actor\.presentationRole\}/u);
  assert.match(types, /query\.set\("id", target\.leadId\)/u);
  assert.match(types, /query\.set\("case", target\.studentCaseId\)/u);
  assert.doesNotMatch(page + types + adapter, /case_id/u);

  assert.match(adapter, /actor\.presentationRole === "admissions"/u);
  assert.match(
    adapter,
    /actor\.presentationRole !== "admin" && actor\.presentationRole !== "admissions"/u,
  );
  assert.match(adapter, /if \(actor\.presentationRole === "admissions"\) return null/u);
  assert.match(adapter, /actor\.presentationRole === "admin" && studentCase/u);
  assert.doesNotMatch(adapter, /actor\.authorityRole === "admin" && studentCase/u);
  assert.match(adapter, /listPlatformStudentCases/u);
  assert.match(adapter, /getPlatformStudentCaseView/u);
  assert.match(adapter, /listPlatformStudentCaseLeadLinks/u);
  assert.match(adapter, /view\.access !== "full"/u);
  assert.match(adapter, /sales: null/u);
});

test("V3 profile actions use canonical versioned server commands and honest outcomes", () => {
  const controls = source("src/components/v3/profile/ProfileAdmissionsWorkspace.tsx");

  for (const action of [
    "createPlatformUniversityApplicationAction",
    "changePlatformUniversityApplicationAction",
    "upsertPlatformCaseVisaAction",
    "createPlatformFinanceStopFactorAction",
    "resolvePlatformFinanceStopFactorAction",
  ]) {
    assert.match(controls, new RegExp(`${action}`));
  }
  for (const field of [
    "student_case_id",
    "request_id",
    "expected_version",
    "application_id",
    "visa_case_id",
    "payment_obligation_id",
    "stop_factor_id",
  ]) {
    assert.match(controls, new RegExp(`name="${field}"`));
  }
  for (const outcome of [
    "saved",
    "invalid",
    "forbidden",
    "stale",
    "request_conflict",
    "unavailable",
  ]) {
    assert.match(controls, new RegExp(`${outcome}:`));
  }

  assert.match(controls, /status === "saved" \|\| status === "stale"/u);
  assert.match(controls, /router\.refresh\(\)/u);
  assert.match(controls, /PLATFORM_APPLICATION_STATUSES\.map/u);
  assert.match(controls, /PLATFORM_VISA_STATUSES\.map/u);
  assert.doesNotMatch(controls, /createSupabase|supabase\.from|localStorage|sessionStorage/u);
  assert.equal(
    existsSync(new URL("../src/components/v3/profile/ProfileAdmissionsActions.ts", import.meta.url)),
    false,
  );
});

test("finance stop controls submit canonical keys and never render them raw", () => {
  const controls = source("src/components/v3/profile/ProfileAdmissionsWorkspace.tsx");
  const wording = source("src/lib/v3/wording.ts");

  assert.match(controls, /<select[\s\S]*name="blocked_action"/u);
  assert.match(controls, /financeBlockedActionOptions\.map/u);
  assert.match(controls, /financeBlockedAction\(stop\.blockedAction\)/u);
  for (const key of [
    "application_submission",
    "document_processing",
    "visa_submission",
    "case_progression",
  ]) {
    assert.match(wording, new RegExp(`${key}:`));
    assert.doesNotMatch(controls, new RegExp(`>${key}<`));
  }
});
