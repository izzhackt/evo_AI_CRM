import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { readPlatformDashboardSnapshot } from "../src/lib/server/platform-dashboard-model.ts";

const repoRoot = new URL("../", import.meta.url);

function source(path) {
  return readFileSync(new URL(path, repoRoot), "utf8");
}

function sourceFiles(directory) {
  return readdirSync(new URL(directory, repoRoot), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
    },
  );
}

test("P6B leaves one Supabase-backed staff runtime and no legacy database fallback", () => {
  for (const path of [
    "src/lib/db.ts",
    "src/lib/actions.ts",
    "src/lib/queries.ts",
    "src/lib/server/canonical-crm-repository.ts",
    "src/lib/server/database.ts",
    "src/lib/server/database-config.ts",
    "src/lib/server/database-status.ts",
    "src/app/api/database/status/route.ts",
    "src/app/api/webhooks/telephony/route.ts",
    "src/app/(staff)/calls/page.tsx",
    "src/app/(staff)/chat/page.tsx",
    "src/app/(staff)/notifications/page.tsx",
    "src/app/(staff)/reports/page.tsx",
  ]) {
    assert.equal(existsSync(new URL(path, repoRoot)), false, path);
  }

  const forbiddenRuntimeReference =
    /(?:better-sqlite3|(?:@\/|\.\.\/|\.\/)lib\/(?:db|actions|queries)(?:["']|\/)|server\/(?:canonical-crm-repository|database(?:-config|-status)?)(?:["']|\/)|(?:@\/|\.\.\/|\.\/)db\/schema)/;
  for (const path of sourceFiles("src")) {
    assert.doesNotMatch(source(path), forbiddenRuntimeReference, path);
  }
});

test("P6B browser proof covers every retired staff and API route", () => {
  const browserProof = source("tests/e2e/supabase-staff-auth.spec.ts");

  for (const path of [
    "/calls",
    "/chat",
    "/notifications",
    "/reports",
    "/api/database/status",
    "/api/webhooks/telephony",
  ]) {
    assert.match(browserProof, new RegExp(path.replaceAll("/", "\\/")), path);
  }
  assert.match(browserProof, /expect\(response\?\.status\(\), path\)\.toBe\(404\)/);
  assert.match(browserProof, /expect\(response\.status\(\), path\)\.toBe\(404\)/);
});

test("P6B dashboard composes the canonical product queues instead of parallel screens", () => {
  const dashboardPage = source("src/app/(staff)/dashboard/page.tsx");
  const dashboardRuntime = source("src/lib/server/platform-dashboard.ts");
  const dashboardModel = source("src/lib/server/platform-dashboard-model.ts");

  assert.match(dashboardPage, /readPlatformDashboardSnapshot\(actor\)/);
  assert.match(dashboardRuntime, /listPlatformSalesLeads/);
  assert.match(dashboardRuntime, /listPlatformStudentCases/);
  assert.match(dashboardRuntime, /listPlatformAdmissionsTaskQueue/);
  assert.match(dashboardRuntime, /listPlatformFinanceControlQueue/);
  assert.match(dashboardRuntime, /listPlatformConversations/);
  assert.match(dashboardRuntime, /platform-dashboard-model\.ts/);
  for (const href of ["/sales", "/clients", "/tasks", "/finance", "/v3/inbox"]) {
    assert.match(dashboardModel, new RegExp(`href: ["']${href}["']`), href);
  }
});

test("P6B foundation harness clears only stale empty lock directories and never masks a live run", () => {
  const harness = source("scripts/test-postgres-v2-foundation.sh");

  assert.match(harness, /supabase_lock_pid_file="\$supabase_lock_dir\/pid"/);
  assert.match(harness, /foundation_harness_pid_active\(\)/);
  assert.match(
    harness,
    /existing_harness_pid="\$\(tr -dc '0-9' < "\$supabase_lock_pid_file"\)"/,
  );
  assert.match(
    harness,
    /rm -f -- "\$supabase_lock_pid_file"/,
  );
  assert.match(
    harness,
    /rmdir "\$supabase_lock_dir" >\/dev\/null 2>&1 \|\| true/,
  );
  assert.match(
    harness,
    /Cannot recover the stale EVO local Supabase foundation lock at \$\{supabase_lock_dir\}/,
  );
  assert.match(harness, /printf '%s\\n' "\$\$" >"\$supabase_lock_pid_file"/);
  assert.match(
    harness,
    /Another EVO local Supabase foundation harness is already running: \$\{supabase_lock_dir\}/,
  );
});

function actor(presentationRole) {
  return {
    authUserId: "10000000-0000-4000-8000-000000000001",
    profileId: "10000000-0000-4000-8000-000000000002",
    membershipId: "10000000-0000-4000-8000-000000000003",
    organizationId: "10000000-0000-4000-8000-000000000004",
    displayName: "P6B Admin",
    email: "p6b-admin@example.test",
    platformRole: "admin",
    authorityRole: "admin",
    presentationRole,
    platformAccessVersion: 1,
    platformBundleId: "10000000-0000-4000-8000-000000000005",
    platformBundleVersion: 1,
  };
}

test("P6B Admin Sales preview reads only Sales and messaging outcomes", async () => {
  const calls = [];
  const forbidden = async (name) => {
    assert.fail(`${name} must not run for the Sales preview`);
  };
  const snapshot = await readPlatformDashboardSnapshot(actor("sales"), {
    now: Date.parse("2026-09-03T12:00:00.000Z"),
    readers: {
      listSalesLeads: async () => {
        calls.push("sales");
        return {
          rows: [
            {
              nextActionDueDate: "2026-09-02T12:00:00.000Z",
              currentOwnerMembershipId: null,
            },
            {
              nextActionDueDate: "2026-09-04T12:00:00.000Z",
              currentOwnerMembershipId: "10000000-0000-4000-8000-000000000006",
            },
          ],
          nextCursor: null,
        };
      },
      listStudentCases: () => forbidden("admissions cases"),
      listAdmissionsTasks: () => forbidden("admissions tasks"),
      listFinanceCases: () => forbidden("finance"),
      listConversations: async () => {
        calls.push("whatsapp");
        return {
          rows: [{ queue: "sales" }, { queue: "admissions" }],
          nextCursor: null,
        };
      },
    },
  });

  assert.deepEqual(calls.sort(), ["sales", "whatsapp"]);
  assert.deepEqual(snapshot.cards, [
    {
      key: "sales",
      href: "/sales",
      totalOnPage: 2,
      overdueCount: 1,
      unassignedCount: 1,
    },
    {
      key: "whatsapp",
      href: "/v3/inbox",
      totalOnPage: 2,
      salesCount: 1,
      admissionsCount: 1,
    },
  ]);
  assert.deepEqual(
    snapshot.attentionItems.map(({ key, value }) => ({ key, value })),
    [
      { key: "sales_overdue", value: 1 },
      { key: "sales_unassigned", value: 1 },
      { key: "whatsapp_open", value: 2 },
    ].sort((left, right) => right.value - left.value || left.key.localeCompare(right.key)),
  );
});

test("P6B Admin Admissions preview aggregates overdue work and finance stops", async () => {
  const calls = [];
  const snapshot = await readPlatformDashboardSnapshot(actor("admissions"), {
    now: Date.parse("2026-09-03T12:00:00.000Z"),
    readers: {
      listSalesLeads: async () => assert.fail("Sales must not run for Admissions preview"),
      listStudentCases: async () => {
        calls.push("clients");
        return {
          rows: [
            {
              access: "full",
              studentCase: {
                overdueTaskCount: 1,
                overdueObligationCount: 0,
                rejectedDocumentCount: 0,
              },
            },
            {
              access: "sales_summary",
              studentCase: {
                overdueTaskCount: 9,
                overdueObligationCount: 9,
                rejectedDocumentCount: 9,
              },
            },
          ],
          nextCursor: null,
        };
      },
      listAdmissionsTasks: async () => {
        calls.push("tasks");
        return {
          rows: [
            { status: "open", dueOn: null, dueAt: "2026-09-02T12:00:00.000Z" },
            { status: "open", dueOn: "2026-09-02", dueAt: null },
            { status: "open", dueOn: "2026-09-03", dueAt: null },
            { status: "done", dueOn: null, dueAt: "2026-09-01T12:00:00.000Z" },
            { status: "cancelled", dueOn: "2026-09-01", dueAt: null },
          ],
          nextCursor: null,
        };
      },
      listFinanceCases: async () => {
        calls.push("finance");
        return [{ activeStopFactorCount: 2 }, { activeStopFactorCount: 0 }];
      },
      listConversations: async () => {
        calls.push("whatsapp");
        return { rows: [], nextCursor: null };
      },
    },
  });

  assert.deepEqual(calls.sort(), ["clients", "finance", "tasks", "whatsapp"]);
  assert.deepEqual(
    snapshot.cards.map((card) => [card.key, card]),
    [
      ["clients", { key: "clients", href: "/clients", totalOnPage: 2, attentionCount: 1 }],
      ["tasks", { key: "tasks", href: "/tasks", totalOnPage: 5, overdueCount: 2 }],
      ["finance", { key: "finance", href: "/finance", totalOnPage: 2, blockedCount: 1 }],
      [
        "whatsapp",
        {
          key: "whatsapp",
          href: "/v3/inbox",
          totalOnPage: 0,
          salesCount: 0,
          admissionsCount: 0,
        },
      ],
    ],
  );
  assert.deepEqual(
    snapshot.attentionItems.map(({ key, value }) => ({ key, value })),
    [
      { key: "admissions_overdue", value: 2 },
      { key: "finance_stops", value: 1 },
      { key: "student_attention", value: 1 },
    ],
  );
});
