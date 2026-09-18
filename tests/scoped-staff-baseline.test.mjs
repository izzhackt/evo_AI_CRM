import assert from "node:assert/strict";
import test from "node:test";
import { staffCanAccessRoute, staffHomeRoute } from "../src/lib/platform-access.ts";
import { readPlatformDashboardSnapshot } from "../src/lib/server/platform-dashboard-model.ts";
import { STAFF_BASELINE_CARDS, STAFF_BASELINE_HOME } from "./e2e/staff-baseline.ts";

// Relevant published baseline permissions preserved by155, not a complete grant list.
// These unit inputs exercise actual navigation/model code, not database scope proof.
const baselinePermissions = {
  sales: ["lead.read", "case.read.full", "profile.read.full", "finance.read.summary",
    "communication.read.full", "task.create"],
  admissions: ["lead.read", "case.read.full", "profile.read.full", "finance.read.summary",
    "communication.read.full", "task.manage"],
};

for (const scenario of ["sales", "admissions"]) {
  test(`${scenario} browser baseline agrees with its permission-based home and dashboard`, async () => {
    const actor = { systemRole: "staff", presentationRole: null, permissionKeys: baselinePermissions[scenario] };
    assert.equal(staffHomeRoute(actor), STAFF_BASELINE_HOME[scenario]);
    assert.equal(staffCanAccessRoute(actor, "/v3/calendar"), true);
    assert.equal(staffCanAccessRoute(actor, "/v3/pipeline"), true);
    assert.equal(staffCanAccessRoute(actor, "/v3/settings"), false);
    const calls = [];
    const reader = (key) => async (receivedActor) => {
      assert.equal(receivedActor, actor);
      calls.push(key);
      return { rows: [], hasNext: false };
    };
    const snapshot = await readPlatformDashboardSnapshot(actor, {
      now: Date.UTC(2026, 8, 13),
      readers: {
        listSalesLeads: reader("sales"),
        listStudentCases: reader("clients"),
        listAdmissionsTasks: reader("tasks"),
        listFinanceCases: reader("finance"),
        listConversations: reader("whatsapp"),
      },
    });
    assert.deepEqual(snapshot.cards.map((card) => card.key), STAFF_BASELINE_CARDS[scenario]);
    assert.deepEqual(calls.sort(), [...STAFF_BASELINE_CARDS[scenario]].sort());
  });
}

test("fixed-role Admin preview remains distinct from the dynamic staff fixture", () => {
  const admin = { systemRole: "admin", presentationRole: "sales", permissionKeys: [] };
  assert.equal(staffCanAccessRoute(admin, "/v3/calendar"), false);
  assert.equal(staffHomeRoute(admin), "/v3/main");
  const admissionsPreview = { ...admin, presentationRole: "admissions" };
  assert.equal(staffCanAccessRoute(admissionsPreview, "/v3/main"), true);
  assert.equal(staffCanAccessRoute(admissionsPreview, "/v3/pipeline"), false);
  assert.equal(staffHomeRoute(admissionsPreview), "/v3/main");
});
