import assert from "node:assert/strict";
import test from "node:test";

import {
  ObjectAccessDeniedError,
  buildFullClientPredicate,
  buildVisibleClientPredicate,
  buildVisaClientPredicate,
  canClientCapability,
  canMutateClientlessTask,
  canReceiveClientlessTask,
  canReceiveClientTask,
  resolveClientAccess,
} from "../src/lib/access.ts";

const pendingCase = {
  id: 101,
  manager_id: 11,
  curator_id: null,
  case_state: "pending",
};

const activeCase = {
  id: 102,
  manager_id: 11,
  curator_id: 22,
  case_state: "active",
};

const closedCase = {
  id: 103,
  manager_id: 11,
  curator_id: 22,
  case_state: "closed",
};

test("client access modes follow ownership and handoff state", () => {
  const cases = [
    {
      name: "Admin has full access to a pending case",
      actor: { id: 1, role: "admin" },
      client: pendingCase,
      expected: "admin_full",
    },
    {
      name: "responsible Sales has full access before handoff",
      actor: { id: 11, role: "sales" },
      client: pendingCase,
      expected: "sales_full_pre_handoff",
    },
    {
      name: "responsible Sales sees only the summary after handoff",
      actor: { id: 11, role: "sales" },
      client: activeCase,
      expected: "sales_post_handoff_summary",
    },
    {
      name: "responsible Sales sees only the summary for a closed case",
      actor: { id: 11, role: "sales" },
      client: closedCase,
      expected: "sales_post_handoff_summary",
    },
    {
      name: "another Sales user cannot see the case",
      actor: { id: 12, role: "sales" },
      client: pendingCase,
      expected: "none",
    },
    {
      name: "assigned Curator has full access after handoff",
      actor: { id: 22, role: "curator" },
      client: activeCase,
      expected: "curator_full",
    },
    {
      name: "assigned Curator keeps full access to a closed case",
      actor: { id: 22, role: "curator" },
      client: closedCase,
      expected: "curator_full",
    },
    {
      name: "Curator cannot take over a pending Sales case",
      actor: { id: 22, role: "curator" },
      client: { ...pendingCase, curator_id: 22 },
      expected: "none",
    },
    {
      name: "another Curator cannot see the case",
      actor: { id: 23, role: "curator" },
      client: activeCase,
      expected: "none",
    },
    {
      name: "Finance receives only the finance projection",
      actor: { id: 33, role: "finance" },
      client: activeCase,
      expected: "finance_projection",
    },
    {
      name: "client accounts do not receive staff object access",
      actor: { id: 102, role: "client" },
      client: activeCase,
      expected: "none",
    },
    {
      name: "unknown roles fail closed",
      actor: { id: 99, role: "unknown" },
      client: activeCase,
      expected: "none",
    },
  ];

  for (const row of cases) {
    assert.equal(
      resolveClientAccess(row.actor, row.client),
      row.expected,
      row.name,
    );
  }
});

test("capabilities are granted only by the resolved access mode", () => {
  const capabilities = [
    "read_full",
    "read_summary",
    "read_finance",
    "write_profile",
    "write_applications",
    "write_documents",
    "write_visa",
    "write_tasks",
    "write_updates",
    "write_finance",
    "transition_case",
    "read_case_audit",
  ];

  const expectedByMode = {
    none: [],
    student_portal: [],
    admin_full: capabilities,
    sales_full_pre_handoff: [
      "read_full",
      "read_summary",
      "write_profile",
      "write_applications",
      "write_documents",
      "write_tasks",
      "write_updates",
    ],
    sales_post_handoff_summary: ["read_summary"],
    curator_full: [
      "read_full",
      "read_summary",
      "write_profile",
      "write_applications",
      "write_documents",
      "write_visa",
      "write_tasks",
      "write_updates",
      "transition_case",
      "read_case_audit",
    ],
    finance_projection: ["read_finance", "write_finance"],
  };

  for (const [mode, expected] of Object.entries(expectedByMode)) {
    for (const capability of capabilities) {
      assert.equal(
        canClientCapability(mode, capability),
        expected.includes(capability),
        `${mode} / ${capability}`,
      );
    }
  }

  assert.equal(canClientCapability("admin_full", "external_approval"), false);
  assert.equal(canClientCapability("invented_mode", "read_full"), false);
});

test("clientless task mutations stay Admin-wide or assignee-scoped", () => {
  assert.equal(
    canMutateClientlessTask({ id: 1, role: "admin" }, null),
    true,
  );
  assert.equal(
    canMutateClientlessTask({ id: 11, role: "sales" }, 11),
    true,
  );
  assert.equal(
    canMutateClientlessTask({ id: 11, role: "sales" }, 12),
    false,
  );
  assert.equal(
    canMutateClientlessTask({ id: 33, role: "finance" }, 33),
    true,
  );
  assert.equal(
    canMutateClientlessTask({ id: 22, role: "curator" }, 22),
    false,
  );
  assert.equal(
    canMutateClientlessTask({ id: 99, role: "unknown" }, 99),
    false,
  );
});

test("clientless task recipients must be able to complete the task", () => {
  assert.equal(canReceiveClientlessTask({ id: 1, role: "admin" }), true);
  assert.equal(canReceiveClientlessTask({ id: 11, role: "sales" }), true);
  assert.equal(canReceiveClientlessTask({ id: 22, role: "curator" }), false);
  assert.equal(canReceiveClientlessTask({ id: 33, role: "finance" }), true);
  assert.equal(canReceiveClientlessTask({ id: 99, role: "unknown" }), false);
});

test("client task assignees must hold task access to that exact case", () => {
  assert.equal(
    canReceiveClientTask({ id: 1, role: "admin" }, pendingCase),
    true,
  );
  assert.equal(
    canReceiveClientTask({ id: 11, role: "sales" }, pendingCase),
    true,
  );
  assert.equal(
    canReceiveClientTask({ id: 12, role: "sales" }, pendingCase),
    false,
  );
  assert.equal(
    canReceiveClientTask({ id: 22, role: "curator" }, pendingCase),
    false,
  );
  assert.equal(
    canReceiveClientTask({ id: 33, role: "finance" }, pendingCase),
    false,
  );

  assert.equal(
    canReceiveClientTask({ id: 1, role: "admin" }, activeCase),
    true,
  );
  assert.equal(
    canReceiveClientTask({ id: 11, role: "sales" }, activeCase),
    false,
  );
  assert.equal(
    canReceiveClientTask({ id: 22, role: "curator" }, activeCase),
    true,
  );
  assert.equal(
    canReceiveClientTask({ id: 23, role: "curator" }, activeCase),
    false,
  );
  assert.equal(
    canReceiveClientTask({ id: 33, role: "finance" }, activeCase),
    false,
  );
});

test("visible, full, and visa SQL predicates are parameterized and role-scoped", () => {
  const cases = [
    {
      name: "Admin visible",
      build: buildVisibleClientPredicate,
      actor: { id: 1, role: "admin" },
      expected: { sql: "1 = 1", params: [] },
    },
    {
      name: "responsible Sales visible",
      build: buildVisibleClientPredicate,
      actor: { id: 11, role: "sales" },
      expected: { sql: "c.manager_id = ?", params: [11] },
    },
    {
      name: "assigned Curator visible",
      build: buildVisibleClientPredicate,
      actor: { id: 22, role: "curator" },
      expected: {
        sql: "c.curator_id = ? AND c.case_state IN ('active', 'closed')",
        params: [22],
      },
    },
    {
      name: "Finance visible projection",
      build: buildVisibleClientPredicate,
      actor: { id: 33, role: "finance" },
      expected: { sql: "1 = 1", params: [] },
    },
    {
      name: "client hidden from staff object query",
      build: buildVisibleClientPredicate,
      actor: { id: 102, role: "client" },
      expected: { sql: "0 = 1", params: [] },
    },
    {
      name: "responsible Sales full before handoff",
      build: buildFullClientPredicate,
      actor: { id: 11, role: "sales" },
      expected: {
        sql: "client.manager_id = ? AND client.case_state = 'pending'",
        params: [11],
      },
      alias: "client",
    },
    {
      name: "Finance has no full client scope",
      build: buildFullClientPredicate,
      actor: { id: 33, role: "finance" },
      expected: { sql: "0 = 1", params: [] },
    },
    {
      name: "assigned Curator has visa scope",
      build: buildVisaClientPredicate,
      actor: { id: 22, role: "curator" },
      expected: {
        sql: "student.curator_id = ? AND student.case_state IN ('active', 'closed')",
        params: [22],
      },
      alias: "student",
    },
    {
      name: "Sales has no visa scope",
      build: buildVisaClientPredicate,
      actor: { id: 11, role: "sales" },
      expected: { sql: "0 = 1", params: [] },
    },
  ];

  for (const row of cases) {
    assert.deepEqual(
      row.build(row.actor, row.alias),
      row.expected,
      row.name,
    );
  }
});

test("SQL aliases reject unsafe identifiers instead of interpolating them", () => {
  for (const alias of ["c; DROP TABLE clients", "c.manager_id", "client-name", ""]) {
    assert.throws(
      () => buildVisibleClientPredicate({ id: 1, role: "admin" }, alias),
      TypeError,
      alias,
    );
  }
});

test("object denial errors do not disclose object existence or identifiers", () => {
  const error = new ObjectAccessDeniedError();

  assert.equal(error.name, "ObjectAccessDeniedError");
  assert.equal(error.message, "Object not found or access denied");
  assert.equal(error.code, "OBJECT_ACCESS_DENIED");
  assert.equal(error.message.includes("101"), false);
});
