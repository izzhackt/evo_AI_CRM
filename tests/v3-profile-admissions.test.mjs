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
  const workspace = source("src/components/v3/profile/ProfileAdmissionsWorkspace.tsx");

  assert.match(page, /requireV3PageActor\("\/v3\/profile"\)/u);
  assert.match(page, /ProfileSearchParams/u);
  assert.match(page, /loadV3ProfileRoute\(routeMode/u);
  assert.match(page, /readTarget: \(target\) => readProfileTarget\(actor, target\)/u);
  assert.doesNotMatch(page, /readProfilePicks/u);
  assert.match(page, /actorRole=\{actor\.presentationRole\}/u);
  assert.match(types, /query\.set\("id", target\.leadId\)/u);
  assert.match(types, /query\.set\("case", target\.studentCaseId\)/u);
  assert.match(types, /student && actorRole !== "sales"/u);
  assert.match(page, /actor\.presentationRole,[\s\S]*\);/u);
  assert.doesNotMatch(page + types + adapter, /case_id/u);

  assert.match(adapter, /actor\.presentationRole === "admissions"/u);
  assert.match(
    adapter,
    /actor\.presentationRole !== "admin" && actor\.presentationRole !== "admissions"/u,
  );
  assert.match(adapter, /if \(actor\.presentationRole === "admissions"\) return null/u);
  assert.match(adapter, /actor\.presentationRole === "admin" && studentCase/u);
  assert.match(adapter, /links\.find\(\(item\) => item\.studentCaseId === canonicalCaseId\)/u);
  assert.match(adapter, /if \(leadProfile\) return leadProfile/u);
  assert.match(adapter, /leadId: link\?\.leadId \?\? null/u);
  assert.doesNotMatch(adapter, /if \(!link[^\n]*\) return null/u);
  assert.match(workspace, /<Card id="applications" title="Заявки">/u);
  assert.match(workspace, /id="visa"[\s\S]*title="Виза"/u);
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
    "updatePlatformUniversityApplicationDetailsAction",
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
    "is_primary",
    "university_deadline_on",
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
  assert.match(controls, /Основной вариант/u);
  assert.match(controls, /Дедлайн от университета/u);
  assert.match(controls, /application\.universityDeadlineOn/u);
  assert.match(controls, /type="checkbox"[\s\S]*name="is_primary"/u);
  assert.doesNotMatch(controls, /<select[^>]*name="is_primary"/u);
  assert.match(controls, /data-primary=\{application\.isPrimary \? "true" : "false"\}/u);
  assert.match(controls, /details-\$\{application\.universityApplicationId\}-\$\{application\.version\}/u);
  assert.match(controls, /router\.refresh\(\)/u);
  assert.match(controls, /PLATFORM_APPLICATION_STATUSES\.map/u);
  assert.match(controls, /PLATFORM_VISA_STATUSES\.map/u);
  assert.doesNotMatch(controls, /createSupabase|supabase\.from|localStorage|sessionStorage/u);
  assert.equal(
    existsSync(new URL("../src/components/v3/profile/ProfileAdmissionsActions.ts", import.meta.url)),
    false,
  );

  const detailsForm = controls.slice(
    controls.indexOf("function ApplicationDetailsForm"),
    controls.indexOf("function VisaForm"),
  );
  assert.match(detailsForm, /name="application_id"/u);
  assert.doesNotMatch(detailsForm, /name="student_case_id"/u);

  const tabs = source("src/components/v3/profile/tabs.tsx");
  assert.match(tabs, /find\(\(candidate\) => candidate\.isPrimary\)/u);
  assert.doesNotMatch(tabs, /profile\.applications\[0\]/u);
  assert.match(tabs, /Основной вариант ещё не выбран/u);
});

test("V3 profile adapter carries application priority and all-day deadline without inference", () => {
  const adapter = source("src/lib/v3/profile-source.ts");
  const types = source("src/components/v3/profile/types.ts");

  assert.match(types, /isPrimary: boolean/u);
  assert.match(types, /universityDeadlineOn: string \| null/u);
  assert.match(types, /applicationDetails: Readonly<Record<string, string>>/u);
  assert.match(adapter, /isPrimary: application\.isPrimary/u);
  assert.match(adapter, /universityDeadlineOn: application\.universityDeadlineOn/u);
  assert.match(adapter, /applicationDetails: Object\.fromEntries/u);
  assert.doesNotMatch(adapter, /universityDeadlineOn:[^\n]*(?:intake|createdAt|updatedAt)/u);
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
