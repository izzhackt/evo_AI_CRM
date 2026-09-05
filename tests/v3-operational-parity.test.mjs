import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V3 main renders the canonical role-scoped operational dashboard", () => {
  const page = source("src/app/(v3)/v3/main/page.tsx");
  const adapter = source("src/lib/v3/funnel-source.ts");
  const overview = source("src/components/v3/OperationsOverview.tsx");

  assert.match(page, /readV3OperationalDashboard\(actor\)/u);
  assert.match(page, /<OperationsOverview snapshot=\{operations\} \/>/u);
  assert.match(adapter, /readPlatformDashboardSnapshot\(actor\)/u);
  assert.match(adapter, /ActivePlatformActor/u);
  for (const key of ["sales", "clients", "tasks", "finance", "whatsapp"]) {
    assert.match(overview, new RegExp(`${key}:`));
  }
  for (const key of [
    "sales_overdue",
    "sales_unassigned",
    "student_attention",
    "admissions_overdue",
    "finance_stops",
    "whatsapp_open",
  ]) {
    assert.match(overview, new RegExp(`${key}:`));
  }
  assert.match(overview, /href=\{card\.href\}/u);
  assert.match(overview, /href=\{item\.href\}/u);
  assert.doesNotMatch(overview, /href=["']\/dashboard/u);
});

test("V3 profile preserves strict searchable paginated Student Case discovery", () => {
  const page = source("src/app/(v3)/v3/profile/page.tsx");
  const adapter = source("src/lib/v3/profile-source.ts");
  const directory = source(
    "src/components/v3/profile/ProfileCaseDirectory.tsx",
  );

  assert.match(page, /parseV3ProfileCaseDirectoryParams\(params\)/u);
  assert.match(page, /readV3ProfileCaseDirectory\(actor, directoryParams\)/u);
  assert.match(page, /directoryParams\.active[\s\S]*\? null/u);
  assert.match(adapter, /listPlatformStudentCases\(actor, \{/u);
  assert.match(adapter, /cursor: params\.cursor/u);
  assert.match(adapter, /pageSize: 25/u);
  assert.match(adapter, /query: params\.query/u);
  assert.match(adapter, /state: params\.state/u);
  assert.match(adapter, /parsePlatformAdmissionsCursor\(beforeAt, beforeId\)/u);
  assert.match(adapter, /beforeAt && beforeId && cursor === null/u);
  assert.match(adapter, /listPlatformStudentCaseLeadLinks/u);
  assert.match(directory, /name="case_q"/u);
  assert.match(directory, /name="case_status"/u);
  assert.match(directory, /value="closed"/u);
  assert.match(directory, /case_before_at/u);
  assert.match(directory, /case_before_id/u);
  assert.match(
    directory,
    /href=\{`\/v3\/profile\?case=\$\{row\.studentCaseId\}&tab=overview`\}/u,
  );
  assert.doesNotMatch(directory, /href=["']\/clients/u);
});
