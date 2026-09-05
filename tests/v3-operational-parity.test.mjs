import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("both V3 role homes render the canonical role-scoped operational dashboard", () => {
  const main = source("src/app/(v3)/v3/main/page.tsx");
  const calendar = source("src/app/(v3)/v3/calendar/page.tsx");
  const adapter = source("src/lib/v3/operations-source.ts");
  const overview = source("src/components/v3/OperationsOverview.tsx");

  for (const page of [main, calendar]) {
    assert.match(page, /readV3OperationalDashboard\(actor\)/u);
    assert.match(page, /<OperationsOverview snapshot=\{operations\} \/>/u);
  }
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
    /return `\/v3\/profile\?case=\$\{row\.studentCaseId\}&tab=overview`/u,
  );
  assert.match(directory, /return row\.leadId \? `\/v3\/profile\?id=\$\{row\.leadId\}` : null/u);
  assert.doesNotMatch(directory, />\s*\{row\.studentCaseId\}\s*</u);
  assert.doesNotMatch(directory, /href=["']\/clients/u);
});

test("Student 360 stays discoverable from navigation and both inbox queues", () => {
  const shell = source("src/components/v3/AppShell.tsx");
  const inbox = source("src/app/(v3)/v3/inbox/page.tsx");

  assert.match(shell, /\{ href: "\/v3\/profile", label: "Student 360" \}/u);
  assert.match(
    inbox,
    /presentationRole === "admissions"[\s\S]*canonicalContext\.studentCaseId[\s\S]*`\/v3\/profile\?case=\$\{selected\.canonicalContext\.studentCaseId\}`/u,
  );
});
