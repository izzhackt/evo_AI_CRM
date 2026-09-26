import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { buildV3Navigation } from "../src/lib/v3/navigation.ts";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("«Сегодня» is the one start page of every role and replaces the operational overview", () => {
  const main = source("src/app/(v3)/v3/main/page.tsx");
  const calendar = source("src/app/(v3)/v3/calendar/page.tsx");
  const today = source("src/lib/v3/today-source.ts");

  // Э3 (26.09.2026): /v3/main is «Сегодня» for every role — Admissions is no
  // longer redirected to its board — and the release smoke finds the page
  // root by the same test id. The queue reads only existing sources.
  assert.match(main, /testId="v3-operational-dashboard"/u);
  assert.match(main, /readTodayQueue\(actor, \{ now \}\)/u);
  assert.match(main, /<TodayScreen\b/u);
  assert.doesNotMatch(main, /redirect\("\/v3\/admissions-pipeline"\)/u);
  assert.doesNotMatch(main, /OperationsOverview|readV3OperationalDashboard|readCurrentSalesFunnel|TrendChart|MetricCard/u);
  // Charts, period and funnel live in the report's «Динамика по дням».
  assert.match(main, /query\.view === "sales"/u);
  assert.match(main, /<SalesDynamics\b/u);
  assert.doesNotMatch(calendar, /OperationsOverview|TodayScreen/u);
  assert.doesNotMatch(calendar, /href="\/v3\/main"/u);
  assert.doesNotMatch(calendar, /Сводка на Главной/u);
  for (const reader of ["staff.listStaffTasks", "workspace.listPlatformAdmissionsTaskQueue", "queue.readStudentCaseQueue",
    "pipeline.readPipelineLeads", "chat.readStaffCaseChatThreads"]) {
    assert.match(today, new RegExp(reader.replace(".", "\\.")), reader);
  }
  assert.doesNotMatch(today, /\.rpc\(|createSupabaseServerClient/u, "no new read: only the existing readers");
  for (const retired of ["src/components/v3/OperationsOverview.tsx", "src/lib/v3/operations-source.ts", "src/components/v3/SalesReportNavigation.tsx"]) {
    assert.equal(existsSync(new URL(`../${retired}`, import.meta.url)), false, retired);
  }
});

test("V3 profile preserves strict searchable paginated Student Case discovery", () => {
  const page = source("src/app/(v3)/v3/profile/page.tsx");
  const adapter = source("src/lib/v3/profile-source.ts");
  // Since 2026-09-25 Admin and curators get the migration-241 work queue;
  // Sales (and the Sales role preview), which 241 refuses, keep the 078 page.
  const fallback = source("src/components/v3/students/StudentsDirectoryFallback.tsx");
  const queueView = source("src/components/v3/students/students-queue-view.ts");
  const queueSource = source("src/lib/v3/students-queue-source.ts");

  assert.match(page, /parseV3ProfileCaseDirectoryParams\(params\)/u);
  assert.match(page, /loadV3ProfileRoute\(routeMode/u);
  assert.match(page, /kind: "target", target: explicitTarget/u);
  assert.match(page, /kind: "directory", params: directoryParams/u);
  assert.match(page, /К списку студентов/u);
  assert.doesNotMatch(page, /readProfilePicks/u);
  assert.match(page, /invalidIdentityShape/u);
  assert.match(page, /\(hasLeadParam \|\| hasCaseParam\) && directoryParams\.active/u);
  assert.doesNotMatch(page, /effectiveDirectoryParams/u);
  // The queue is for staff with the full case read; everyone else keeps the 078 read.
  assert.match(page, /const queueMode = staffPresentationCan\(actor, "admissions\.read"\) && staffHasPermission\(actor, "case\.read\.full"\);/u);
  assert.match(page, /readDirectory: \(nextParams\) => queueMode \? Promise\.resolve\(null\) : readV3ProfileCaseDirectory\(actor, nextParams\)/u);
  assert.match(page, /if \(queueParse\?\.kind === "redirect"\) redirect\(queueParse\.href\);/u);
  assert.match(queueSource, /readStudentCaseQueue\(actor, studentsQueueRequest\(params\)\)/u);
  assert.match(queueSource, /readStudentCaseQueueCounts\(actor, studentsCountsView\(params\), filters\)/u);
  assert.match(queueView, /STUDENTS_QUEUE_PAGE_SIZE = 50/u);
  assert.match(adapter, /listPlatformStudentCases\(actor, \{/u);
  assert.match(adapter, /cursor: params\.cursor/u);
  assert.match(adapter, /pageSize: 25/u);
  assert.match(adapter, /parsePlatformAdmissionsUuid\(params\.query\)/u);
  assert.match(adapter, /query: exactStudentCaseId \? undefined : params\.query/u);
  assert.match(adapter, /studentCaseId: exactStudentCaseId \?\? undefined/u);
  assert.match(adapter, /state: params\.state/u);
  assert.match(adapter, /parsePlatformAdmissionsCursor\(beforeAt, beforeId\)/u);
  assert.match(adapter, /beforeAt && beforeId && cursor === null/u);
  assert.match(
    adapter,
    /query && parsePlatformAdmissionsUuid\(query\) && \(beforeAt \|\| beforeId\)/u,
  );
  assert.match(
    adapter,
    /if \(params\.invalid\)[\s\S]*return Object\.freeze\(\{ hasNext: false, nextCursor: null, rows: \[\] \}\);[\s\S]*listPlatformStudentCases/u,
  );
  assert.match(adapter, /listPlatformStudentCaseLeadLinks/u);
  assert.match(
    adapter,
    /if \(item\.access === "sales_summary"\)/u,
  );
  assert.match(adapter, /if \(presentationRole === "sales"\)/u);
  for (const field of [
    "operationalStage",
    "overdueObligationCount",
    "overdueTaskCount",
    "rejectedDocumentCount",
    "responsibleSalesDisplayName",
  ]) {
    assert.match(adapter, new RegExp(`${field}: null`));
  }
  assert.match(fallback, /name: "case_q"/u);
  assert.match(fallback, /case_status: params\.state \?\? null/u);
  assert.match(fallback, /closed: "Закрыто"/u);
  const directoryLinks = source("src/components/v3/profile/admissions-view.ts");
  assert.match(directoryLinks, /case_before_at/u);
  assert.match(directoryLinks, /case_before_id/u);
  assert.match(fallback, /admissionsDirectoryHref\(params, directory\.nextCursor, docsMode\)/u);
  // A handed-off summary opens the lead card; a full case opens its overview.
  assert.match(fallback, /if \(row\.access === "full"\) return withDocsSection\(`\/v3\/profile\?case=\$\{row\.studentCaseId\}&tab=\$\{docsMode \? "documents" : "overview"\}`, docsMode\);/u);
  assert.match(fallback, /return row\.leadId \? `\/v3\/profile\?id=\$\{row\.leadId\}` : null;/u);
  assert.match(fallback, /data-access=\{row\.access\}/u);
  assert.match(fallback, /<caption className="sr-only">Дела студентов: \{rows\.length\} на этой странице<\/caption>/u);
  for (const file of [fallback, source("src/components/v3/students/StudentsQueueTable.tsx")]) {
    assert.doesNotMatch(file, />\s*\{row\.studentCaseId\}\s*</u);
    assert.doesNotMatch(file, /href=["']\/clients/u);
  }
});

test("the student directory stays discoverable from navigation and both inbox queues", () => {
  const shell = source("src/components/v3/AppShell.tsx");
  const inbox = source("src/app/(v3)/v3/inbox/page.tsx");

  assert.match(shell, /buildV3Navigation\(actor,/u);
  for (const role of ["admin", "sales", "admissions"]) {
    const actor = { systemRole: role === "admin" ? "admin" : "staff", presentationRole: null,
      permissionKeys: role === "sales" ? ["lead.read", "case.read.summary"] : ["case.read.full"], assignments: [] };
    const navigation = buildV3Navigation(actor, "/v3/profile", new URLSearchParams());
    const group = navigation.groups.find((item) => item.id === "admissions");
    assert.equal(group?.label, "Поступление");
    assert.equal(group?.active, true);
    assert.ok(group.links.some((link) => link.href === "/v3/profile" && link.label === "Студенты"));
  }
  assert.match(inbox, /v3InboxProfileHref\(/u);
});
