import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

import {
  documentReviewDecision,
  documentSlotStatus,
  paymentObligationCategory,
  paymentObligationStatus,
  studentOperationalStage,
} from "../src/lib/v3/wording.ts";
import { studentPortalNotificationReadRequestId } from "../src/lib/server/student-portal-notification-command-id.ts";

const ROOT = new URL("../", import.meta.url);

function source(path) {
  return readFileSync(new URL(path, ROOT), "utf8");
}

function filesUnder(path) {
  const absolute = new URL(path, ROOT);
  return readdirSync(absolute)
    .flatMap((name) => {
      const directory = statSync(new URL(name, absolute)).isDirectory();
      return directory ? filesUnder(`${path}${name}/`) : [`${path}${name}`];
    })
    .sort();
}

test("the Student workspace exposes exactly five portal pages", () => {
  const pageFiles = filesUnder("src/app/(portal)/portal/")
    .filter((path) => path.endsWith("/page.tsx") || path.endsWith("portal/page.tsx"));

  assert.deepEqual(pageFiles, [
    "src/app/(portal)/portal/applications/page.tsx",
    "src/app/(portal)/portal/documents/page.tsx",
    "src/app/(portal)/portal/notifications/page.tsx",
    "src/app/(portal)/portal/page.tsx",
    "src/app/(portal)/portal/payments/page.tsx",
  ]);

  const shell = source("src/components/v3/portal/PortalShell.tsx");
  assert.deepEqual(
    [...shell.matchAll(/href: "([^"]+)"/gu)].map((match) => match[1]),
    [
      "/portal",
      "/portal/documents",
      "/portal/applications",
      "/portal/payments",
      "/portal/notifications",
    ],
  );
});

test("the portal uses the Student guard and never mounts the staff shell", () => {
  const layout = source("src/app/(portal)/layout.tsx");
  const shell = source("src/components/v3/portal/PortalShell.tsx");

  assert.match(layout, /requireStudentPortalActor\(\)/u);
  assert.match(layout, /<PortalShell displayName=\{actor\.displayName\}>/u);
  assert.match(shell, /logoutStudentPortalAction/u);
  assert.doesNotMatch(
    `${layout}\n${shell}`,
    /AppShell|requirePlatformStaffActor|role preview|presentationRole/u,
  );
});

test("every page passes the direct strict E2 result to its view", () => {
  const expected = [
    ["src/app/(portal)/portal/page.tsx", "readStudentPortalOverview", "overview", "OverviewView"],
    ["src/app/(portal)/portal/documents/page.tsx", "readStudentPortalDocuments", "documents", "DocumentsView"],
    ["src/app/(portal)/portal/applications/page.tsx", "readStudentPortalApplications", "applications", "ApplicationsView"],
    ["src/app/(portal)/portal/payments/page.tsx", "readStudentPortalPayments", "payments", "PaymentsView"],
    ["src/app/(portal)/portal/notifications/page.tsx", "readStudentPortalNotifications", "notifications", "NotificationsView"],
  ];

  for (const [path, reader, resultName, component] of expected) {
    const page = source(path);
    assert.match(
      page,
      new RegExp(`import \\{ ${reader} \\} from "@/lib/v3/portal-source"`, "u"),
    );
    assert.match(page, new RegExp(`const ${resultName} = await ${reader}\\(\\)`, "u"));
    assert.match(
      page,
      new RegExp(`<${component}[\\s\\S]*${resultName}=\\{${resultName}\\}`, "u"),
    );
    assert.doesNotMatch(page, /createClient|supabase|sqlite|drizzle|fixture|demo/iu);
  }
});

test("overview names each actor from the canonical projection and links exact items", () => {
  const overview = source("src/components/v3/portal/OverviewView.tsx");
  const documents = source("src/components/v3/portal/DocumentsView.tsx");

  assert.match(overview, /overview\.studentAction/u);
  assert.match(overview, /overview\.evoAction/u);
  assert.doesNotMatch(overview, /overview\.nextAction/u);
  assert.match(overview, /Что требуется от вас/u);
  assert.match(overview, /Что делает EVO/u);
  assert.match(
    overview,
    /\/portal\/documents#document-\$\{overview\.studentAction\.documentSlotId\}/u,
  );
  assert.match(overview, /<details/u);
  assert.match(overview, /id=\{`evo-task-\$\{overview\.evoAction\.taskId\}`\}/u);
  assert.match(
    overview,
    /Нет документов, которые сейчас нужно загрузить или заменить/u,
  );
  assert.match(overview, /Нет опубликованной задачи команды EVO/u);
  assert.match(overview, /min-h-11/u);
  assert.match(
    documents,
    /id=\{`document-\$\{document\.documentSlotId\}`\}/u,
  );
});

test("migration 131 adds a v2 overview while preserving the rollback v1", () => {
  const migration = source(
    "supabase/migrations/131_platform_student_portal_next_steps.sql",
  );

  assert.doesNotMatch(
    migration,
    /DROP FUNCTION platform\.student_portal_overview_v1\(\);/u,
  );
  assert.match(
    migration,
    /CREATE FUNCTION platform\.student_portal_overview_v2\(\)/u,
  );
  assert.doesNotMatch(
    migration,
    /CREATE(?: OR REPLACE)? FUNCTION platform\.student_portal_overview_v1\(\)/u,
  );
  assert.match(migration, /student_action_kind TEXT/u);
  assert.match(migration, /student_action_document_slot_id UUID/u);
  assert.match(migration, /evo_action_task_id UUID/u);
  assert.match(migration, /evo_action_status platform\.case_task_status/u);
  assert.match(
    migration,
    /slot\.status IN \('required', 'correction_required', 'rejected'\)/u,
  );
  assert.match(
    migration,
    /assignee_membership\."current_role" IN \('admin', 'sales', 'curator'\)/u,
  );
  assert.doesNotMatch(migration, /student_case\.next_action/u);
  assert.match(migration, /SECURITY DEFINER/u);
  assert.match(migration, /SET search_path = ''/u);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION platform\.student_portal_overview_v2\(\)\s+TO authenticated;/u,
  );
});

test("views consume the exact E2 DTOs without an invented wrapper", () => {
  assert.equal(
    existsSync(new URL("src/components/v3/portal/types.ts", ROOT)),
    false,
  );

  const expectedTypes = new Map([
    ["OverviewView.tsx", "StudentPortalOverview"],
    ["DocumentsView.tsx", "StudentPortalDocument"],
    ["ApplicationsView.tsx", "StudentPortalApplications"],
    ["PaymentsView.tsx", "StudentPortalPayment"],
    ["NotificationsView.tsx", "StudentPortalNotification"],
  ]);
  for (const [filename, typeName] of expectedTypes) {
    const view = source(`src/components/v3/portal/${filename}`);
    assert.match(view, new RegExp(`\\b${typeName}\\b`, "u"));
    assert.match(view, /@\/lib\/v3\/portal-source/u);
    assert.doesNotMatch(view, /Portal(?:Overview|Documents|Applications|Payments|Notifications)View/u);
  }

  const applications = source("src/components/v3/portal/ApplicationsView.tsx");
  const payments = source("src/components/v3/portal/PaymentsView.tsx");
  assert.match(applications, /application\.isPrimary/u);
  assert.match(payments, /payment\.category/u);
  assert.match(payments, /payment\.refundedMinor/u);
  assert.doesNotMatch(payments, /paymentObligationId/u);
});

test("the single wording module maps every Student status exposed by E2", () => {
  const operationalStages = new Map([
    ["contract_confirmed", "договор подтверждён"],
    ["admissions_handoff", "передано в приёмную"],
    ["intake", "начало работы"],
    ["profile_and_route", "профиль и маршрут"],
    ["documents", "сбор документов"],
    ["applications", "заявки в университеты"],
    ["decisions", "решения университетов"],
    ["visa_and_predeparture", "виза и подготовка к отъезду"],
    ["arrival_and_adaptation", "прибытие и адаптация"],
    ["completed", "поступление завершено"],
    ["closed", "дело закрыто"],
  ]);
  const documentStatuses = new Map([
    ["required", "требуется"],
    ["submitted", "отправлен"],
    ["approved", "принят"],
    ["correction_required", "нужно исправить"],
    ["rejected", "отклонён"],
  ]);
  const reviewDecisions = new Map([
    ["approved", "принят"],
    ["correction_required", "возвращён на исправление"],
    ["rejected", "отклонён"],
  ]);
  const paymentStatuses = new Map([
    ["pending", "ожидает оплаты"],
    ["partially_paid", "оплачено частично"],
    ["paid", "оплачено"],
    ["overdue", "просрочено"],
  ]);
  const paymentCategories = new Map([
    ["evo_service_fee", "услуги EVO"],
    ["third_party_cost", "сторонние расходы"],
  ]);

  for (const [value, label] of operationalStages) {
    assert.equal(studentOperationalStage(value), label);
  }
  for (const [value, label] of documentStatuses) {
    assert.equal(documentSlotStatus(value), label);
  }
  for (const [value, label] of reviewDecisions) {
    assert.equal(documentReviewDecision(value), label);
  }
  for (const [value, label] of paymentStatuses) {
    assert.equal(paymentObligationStatus(value), label);
  }
  for (const [value, label] of paymentCategories) {
    assert.equal(paymentObligationCategory(value), label);
  }

  for (const mapper of [
    documentSlotStatus,
    documentReviewDecision,
    paymentObligationStatus,
    paymentObligationCategory,
  ]) {
    assert.equal(mapper("unexpected_runtime_value"), null);
    assert.equal(mapper(null), null);
  }

  assert.equal(
    studentOperationalStage("admissions_validation"),
    "индивидуальный этап сопровождения",
  );
  assert.equal(
    studentOperationalStage("  Подготовка документов  "),
    "индивидуальный этап сопровождения",
  );
  assert.equal(studentOperationalStage("   "), null);
  assert.equal(studentOperationalStage(null), null);
});

test("Student stage wording matches the exact schema and published OZO lifecycle", () => {
  const studentCases = source(
    "supabase/migrations/042_platform_student_admissions.sql",
  );
  const workflowContracts = source(
    "supabase/migrations/051_platform_business_workflow_contracts.sql",
  );
  const handoff = source(
    "supabase/migrations/088_platform_sales_admissions_handoff.sql",
  );

  assert.match(
    studentCases,
    /operational_stage TEXT NOT NULL DEFAULT 'contract_confirmed'\s+CHECK \(btrim\(operational_stage\) <> ''\)/u,
  );
  assert.match(
    handoff,
    /operational_stage = 'admissions_handoff'/u,
  );

  const ozoContract = workflowContracts.match(
    /target\.workflow_kind = 'ozo'[\s\S]*?target\.stage_keys = ARRAY\[([\s\S]*?)\]::TEXT\[\]/u,
  );
  assert.ok(ozoContract);
  assert.deepEqual(
    [...ozoContract[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]),
    [
      "intake",
      "profile_and_route",
      "documents",
      "applications",
      "decisions",
      "visa_and_predeparture",
      "arrival_and_adaptation",
      "completed",
      "closed",
    ],
  );
});

test("portal components stay presentation-only and never render raw status keys", () => {
  const componentFiles = filesUnder("src/components/v3/portal/")
    .filter((path) => path.endsWith(".tsx"));
  const components = componentFiles.map(source).join("\n");

  assert.doesNotMatch(
    components,
    /meeting_scheduled|correction_required|under_review|not_started|document_slots|auth\.users|record_scopes/u,
  );
  assert.doesNotMatch(
    components,
    /createClient|supabase|sqlite|drizzle|Realtime|useEffect|Fixture|Legacy|Connected/u,
  );
  assert.match(components, /<PortalStatus[\s\S]*label=/u);
  assert.match(components, /Что нужно исправить/u);
  assert.match(components, /История статусов/u);
});

test("mark-read accepts one opaque handle and creates authority and replay data server-side", () => {
  const action = source("src/lib/student-portal-actions.ts");
  const notifications = source("src/components/v3/portal/NotificationsView.tsx");
  const submit = source(
    "src/components/v3/portal/PortalNotificationReadButton.tsx",
  );
  const browser = source("tests/e2e/student-portal.spec.ts");

  assert.match(action, /^"use server";/u);
  assert.match(action, /const actor = await requireStudentPortalActor\(\)/u);
  assert.match(action, /exactActionStringFields\(form, MARK_NOTIFICATION_READ_FIELDS\)/u);
  assert.match(action, /const MARK_NOTIFICATION_READ_FIELDS = \["notification_id"\] as const/u);
  assert.match(
    action,
    /requestId: studentPortalNotificationReadRequestId\(actor, notificationId\)/u,
  );
  assert.doesNotMatch(action, /randomUUID/u);
  assert.doesNotMatch(action, /form\.get\("request_id"\)|auth_user_id|organization_id|student_case_id/iu);
  assert.match(notifications, /form action=\{markReadAction\}/u);
  assert.match(notifications, /name="notification_id"/u);
  assert.match(notifications, /<PortalNotificationReadButton \/>/u);
  assert.doesNotMatch(notifications, /onClick|fetch\(|useState/u);
  assert.match(submit, /^"use client";/u);
  assert.match(submit, /useFormStatus/u);
  assert.match(submit, /disabled=\{pending\}/u);
  assert.match(submit, /aria-disabled=\{pending\}/u);
  assert.match(
    submit,
    /pending \? "Отмечаем…" : "Отметить прочитанным"/u,
  );
  assert.match(
    browser,
    /const markReadSubmission = notification\.locator\('form button\[type="submit"\]'\);[\s\S]*await markReadSubmission\.click\(\);[\s\S]*await expect\(markReadSubmission\)\.toHaveCount\(0\)/u,
  );
});

test("notification command IDs replay per verified Student actor and notification", () => {
  const actor = {
    authUserId: "10000000-0000-4000-8000-000000000001",
    membershipId: "20000000-0000-4000-8000-000000000002",
    organizationId: "30000000-0000-4000-8000-000000000003",
    studentCaseId: "40000000-0000-4000-8000-000000000004",
  };
  const notificationId = "50000000-0000-4000-8000-000000000005";
  const requestId = studentPortalNotificationReadRequestId(actor, notificationId);

  assert.match(
    requestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  assert.equal(
    studentPortalNotificationReadRequestId(actor, notificationId),
    requestId,
  );
  assert.notEqual(
    studentPortalNotificationReadRequestId(
      { ...actor, authUserId: "60000000-0000-4000-8000-000000000006" },
      notificationId,
    ),
    requestId,
  );
  assert.notEqual(
    studentPortalNotificationReadRequestId(
      actor,
      "70000000-0000-4000-8000-000000000007",
    ),
    requestId,
  );

  for (const [field, value] of [
    ["authUserId", "not-a-uuid"],
    ["membershipId", "00000000-0000-0000-0000-000000000000"],
    ["organizationId", "30000000-0000-4000-0000-000000000003"],
    ["studentCaseId", ""],
  ]) {
    assert.throws(() =>
      studentPortalNotificationReadRequestId(
        { ...actor, [field]: value },
        notificationId,
      ),
    );
  }
  assert.throws(() =>
    studentPortalNotificationReadRequestId(actor, "not-a-uuid"),
  );
});

test("portal includes honest empty, loading and failure states", () => {
  const components = filesUnder("src/components/v3/portal/")
    .filter((path) => path.endsWith(".tsx"))
    .map(source)
    .join("\n");
  const loading = source("src/app/(portal)/portal/loading.tsx");
  const error = source("src/app/(portal)/portal/error.tsx");

  assert.match(components, /PortalEmptyState/u);
  assert.match(loading, /aria-busy="true"/u);
  assert.match(error, /role="alert"/u);
  assert.match(error, /кабинет не будет подменять недоступные сведения/u);
});

// This is deliberately structural. The cumulative E5 integration gate must
// still exercise 393px, forced-dark and axe against real Supabase-backed pages.
test("markup keeps responsive hooks and semantic navigation for the later browser gate", () => {
  const shell = source("src/components/v3/portal/PortalShell.tsx");
  const components = filesUnder("src/components/v3/portal/")
    .filter((path) => path.endsWith(".tsx"))
    .map(source)
    .join("\n");

  assert.match(shell, /overflow-x-auto/u);
  assert.match(shell, /flex w-full max-w-\[1180px\]/u);
  assert.match(shell, /scrollIntoView\(\{/u);
  assert.match(shell, /inline: "nearest"/u);
  assert.match(shell, /aria-label="Навигация по разделам кабинета"/u);
  assert.match(shell, /tabIndex=\{0\}/u);
  assert.match(shell, /min-h-10/u);
  assert.match(shell, /aria-current=\{active \? "page" : undefined\}/u);
  assert.match(shell, /aria-label="Разделы кабинета"/u);
  assert.match(components, /sm:grid-cols-2|sm:grid-cols-3/u);
});

test("portal feedback and status markers reuse the shared restrained visual language", () => {
  const applications = source("src/components/v3/portal/ApplicationsView.tsx");
  const documents = source("src/components/v3/portal/DocumentsView.tsx");
  const notifications = source("src/components/v3/portal/NotificationsView.tsx");
  const error = source("src/app/(portal)/portal/error.tsx");

  assert.match(
    applications,
    /<PortalStatus label=\{item\.label\} tone="neutral" \/>/u,
  );
  assert.match(
    notifications,
    /<PortalStatus label="Новое" tone="info" \/>/u,
  );
  assert.doesNotMatch(
    `${documents}\n${notifications}\n${error}`,
    /border-danger|bg-danger-weak|rounded-\[5px\] bg-info-weak/u,
  );
  assert.match(documents, /role="note"/u);
  assert.match(documents, /aria-label="Что нужно исправить"/u);
});

test("the Student portal structural contract is registered exactly once", () => {
  const packageJson = JSON.parse(source("package.json"));
  const registrations = Object.values(packageJson.scripts)
    .filter((command) => command.includes("tests/v3-student-portal-ui.test.mjs"));

  assert.equal(registrations.length, 1);
  assert.match(packageJson.scripts["test:frontend"], /tests\/v3-student-portal-ui\.test\.mjs/u);
});
