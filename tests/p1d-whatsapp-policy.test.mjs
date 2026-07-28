import assert from "node:assert/strict";
import test from "node:test";

import {
  canCreateManualWhatsAppConversation,
  canWhatsAppCapability,
  resolveWhatsAppConversationAccess,
} from "../src/lib/whatsapp-policy.ts";

const actors = {
  admin: { id: 1, role: "admin" },
  responsibleSales: { id: 11, role: "sales" },
  unrelatedSales: { id: 12, role: "sales" },
  assignedCurator: { id: 22, role: "curator" },
  unrelatedCurator: { id: 23, role: "curator" },
  finance: { id: 33, role: "finance" },
  student: { id: 102, role: "client" },
};

const pendingCase = {
  id: 101,
  manager_id: 11,
  manager_role: "sales",
  curator_id: null,
  curator_role: null,
  case_state: "pending",
};

const activeCase = {
  id: 101,
  manager_id: 11,
  manager_role: "sales",
  curator_id: 22,
  curator_role: "curator",
  case_state: "active",
};

const closedCase = {
  id: 101,
  manager_id: 11,
  manager_role: "sales",
  curator_id: 22,
  curator_role: "curator",
  case_state: "closed",
};

const leadOnly = {
  id: 201,
  manager_id: 11,
  manager_role: "sales",
  client_id: null,
};

function conversationScope(overrides = {}) {
  return {
    conversationClientId: null,
    conversationLeadId: null,
    resolvedClient: null,
    resolvedLead: null,
    ...overrides,
  };
}

test("Admin has full access regardless of link quality or lifecycle state", () => {
  const scopes = [
    {
      name: "unlinked conversation",
      scope: conversationScope(),
    },
    {
      name: "true lead-only conversation",
      scope: conversationScope({
        conversationLeadId: leadOnly.id,
        resolvedLead: leadOnly,
      }),
    },
    {
      name: "direct pending case",
      scope: conversationScope({
        conversationClientId: pendingCase.id,
        resolvedClient: pendingCase,
      }),
    },
    {
      name: "dangling direct case link",
      scope: conversationScope({ conversationClientId: 999 }),
    },
    {
      name: "dangling lead link",
      scope: conversationScope({ conversationLeadId: 999 }),
    },
    {
      name: "indirect lead-to-case link",
      scope: conversationScope({
        conversationLeadId: 201,
        resolvedLead: { ...leadOnly, client_id: 101 },
      }),
    },
    {
      name: "conflicting direct and lead case links",
      scope: conversationScope({
        conversationClientId: 101,
        conversationLeadId: 201,
        resolvedClient: activeCase,
        resolvedLead: { ...leadOnly, client_id: 202 },
      }),
    },
    {
      name: "ownerless active case",
      scope: conversationScope({
        conversationClientId: 101,
        resolvedClient: { ...activeCase, curator_id: null },
      }),
    },
    {
      name: "invalid case lifecycle",
      scope: conversationScope({
        conversationClientId: 101,
        resolvedClient: { ...activeCase, case_state: "archived" },
      }),
    },
    {
      name: "valid direct case with unresolved non-null lead link",
      scope: conversationScope({
        conversationClientId: 101,
        conversationLeadId: 999,
        resolvedClient: activeCase,
      }),
    },
  ];

  for (const row of scopes) {
    assert.equal(
      resolveWhatsAppConversationAccess(actors.admin, row.scope),
      "admin_full",
      row.name,
    );
  }
});

test("valid lead and case links follow responsibility and handoff ownership", () => {
  const trueLeadOnlyScope = conversationScope({
    conversationLeadId: 201,
    resolvedLead: leadOnly,
  });
  const pendingScope = conversationScope({
    conversationClientId: 101,
    resolvedClient: pendingCase,
  });
  const activeScope = conversationScope({
    conversationClientId: 101,
    resolvedClient: activeCase,
  });
  const closedScope = conversationScope({
    conversationClientId: 101,
    resolvedClient: closedCase,
  });

  const cases = [
    {
      name: "responsible Sales owns a true lead-only conversation",
      actor: actors.responsibleSales,
      scope: trueLeadOnlyScope,
      expected: "sales_full_pre_handoff",
    },
    {
      name: "unrelated Sales cannot use another Sales user's lead",
      actor: actors.unrelatedSales,
      scope: trueLeadOnlyScope,
      expected: "none",
    },
    {
      name: "Curator cannot use a lead-only conversation",
      actor: actors.assignedCurator,
      scope: trueLeadOnlyScope,
      expected: "none",
    },
    {
      name: "responsible Sales owns a directly linked pending case",
      actor: actors.responsibleSales,
      scope: pendingScope,
      expected: "sales_full_pre_handoff",
    },
    {
      name: "unrelated Sales cannot use a directly linked pending case",
      actor: actors.unrelatedSales,
      scope: pendingScope,
      expected: "none",
    },
    {
      name: "Curator cannot take over a pending case",
      actor: actors.assignedCurator,
      scope: conversationScope({
        conversationClientId: 101,
        resolvedClient: { ...pendingCase, curator_id: 22 },
      }),
      expected: "none",
    },
    {
      name: "former responsible Sales receives summary-only on an active case",
      actor: actors.responsibleSales,
      scope: activeScope,
      expected: "sales_post_handoff_summary",
    },
    {
      name: "former responsible Sales receives summary-only on a closed case",
      actor: actors.responsibleSales,
      scope: closedScope,
      expected: "sales_post_handoff_summary",
    },
    {
      name: "unrelated Sales cannot see an active case summary",
      actor: actors.unrelatedSales,
      scope: activeScope,
      expected: "none",
    },
    {
      name: "unrelated Sales cannot see a closed case summary",
      actor: actors.unrelatedSales,
      scope: closedScope,
      expected: "none",
    },
    {
      name: "assigned Curator has full access to an active case",
      actor: actors.assignedCurator,
      scope: activeScope,
      expected: "curator_full",
    },
    {
      name: "assigned Curator keeps full access to a closed case",
      actor: actors.assignedCurator,
      scope: closedScope,
      expected: "curator_full",
    },
    {
      name: "unassigned Curator cannot use an active case conversation",
      actor: actors.unrelatedCurator,
      scope: activeScope,
      expected: "none",
    },
    {
      name: "unassigned Curator cannot use a closed case conversation",
      actor: actors.unrelatedCurator,
      scope: closedScope,
      expected: "none",
    },
    {
      name: "Finance has no conversation access",
      actor: actors.finance,
      scope: activeScope,
      expected: "none",
    },
    {
      name: "Student has no conversation access",
      actor: actors.student,
      scope: activeScope,
      expected: "none",
    },
  ];

  for (const row of cases) {
    assert.equal(
      resolveWhatsAppConversationAccess(row.actor, row.scope),
      row.expected,
      row.name,
    );
  }
});

test("raw links govern resolution and direct case ownership takes precedence", () => {
  const cases = [
    {
      name: "a resolved lead cannot manufacture a missing raw lead link",
      actor: actors.responsibleSales,
      scope: conversationScope({ resolvedLead: leadOnly }),
      expected: "none",
    },
    {
      name: "a resolved case cannot manufacture a missing raw case link",
      actor: actors.responsibleSales,
      scope: conversationScope({ resolvedClient: pendingCase }),
      expected: "none",
    },
    {
      name: "an unreferenced resolved lead does not override a direct case",
      actor: actors.responsibleSales,
      scope: conversationScope({
        conversationClientId: 101,
        resolvedClient: pendingCase,
        resolvedLead: { ...leadOnly, manager_id: 12, client_id: 202 },
      }),
      expected: "sales_full_pre_handoff",
    },
    {
      name: "an unreferenced resolved case does not override true lead-only proof",
      actor: actors.responsibleSales,
      scope: conversationScope({
        conversationLeadId: 201,
        resolvedClient: activeCase,
        resolvedLead: leadOnly,
      }),
      expected: "sales_full_pre_handoff",
    },
    {
      name: "a direct pending case beats a stale lead owner when lead case is null",
      actor: actors.responsibleSales,
      scope: conversationScope({
        conversationClientId: 101,
        conversationLeadId: 201,
        resolvedClient: pendingCase,
        resolvedLead: { ...leadOnly, manager_id: 12 },
      }),
      expected: "sales_full_pre_handoff",
    },
    {
      name: "a stale lead owner cannot use a directly linked pending case",
      actor: actors.unrelatedSales,
      scope: conversationScope({
        conversationClientId: 101,
        conversationLeadId: 201,
        resolvedClient: pendingCase,
        resolvedLead: { ...leadOnly, manager_id: 12 },
      }),
      expected: "none",
    },
    {
      name: "consistent direct and lead case links use the active case handoff",
      actor: actors.responsibleSales,
      scope: conversationScope({
        conversationClientId: 101,
        conversationLeadId: 201,
        resolvedClient: activeCase,
        resolvedLead: { ...leadOnly, manager_id: 12, client_id: 101 },
      }),
      expected: "sales_post_handoff_summary",
    },
    {
      name: "assigned Curator owns consistent direct and lead case links",
      actor: actors.assignedCurator,
      scope: conversationScope({
        conversationClientId: 101,
        conversationLeadId: 201,
        resolvedClient: activeCase,
        resolvedLead: { ...leadOnly, manager_id: 12, client_id: 101 },
      }),
      expected: "curator_full",
    },
    {
      name: "stale lead owner cannot restore access after handoff",
      actor: actors.unrelatedSales,
      scope: conversationScope({
        conversationClientId: 101,
        conversationLeadId: 201,
        resolvedClient: activeCase,
        resolvedLead: { ...leadOnly, manager_id: 12, client_id: 101 },
      }),
      expected: "none",
    },
  ];

  for (const row of cases) {
    assert.equal(
      resolveWhatsAppConversationAccess(row.actor, row.scope),
      row.expected,
      row.name,
    );
  }
});

test("ambiguous, broken, dangling, ownerless, and invalid scopes fail closed", () => {
  const invalidScopes = [
    {
      name: "unlinked conversation",
      scope: conversationScope(),
    },
    {
      name: "dangling direct case link",
      scope: conversationScope({ conversationClientId: 101 }),
    },
    {
      name: "raw direct case ID does not match the resolved case",
      scope: conversationScope({
        conversationClientId: 101,
        resolvedClient: { ...pendingCase, id: 102 },
      }),
    },
    {
      name: "dangling lead link",
      scope: conversationScope({ conversationLeadId: 201 }),
    },
    {
      name: "raw lead ID does not match the resolved lead",
      scope: conversationScope({
        conversationLeadId: 201,
        resolvedLead: { ...leadOnly, id: 202 },
      }),
    },
    {
      name: "valid direct case with a non-null unresolved lead link",
      scope: conversationScope({
        conversationClientId: 101,
        conversationLeadId: 201,
        resolvedClient: pendingCase,
      }),
    },
    {
      name: "valid direct case with a mismatched resolved lead",
      scope: conversationScope({
        conversationClientId: 101,
        conversationLeadId: 201,
        resolvedClient: pendingCase,
        resolvedLead: { ...leadOnly, id: 202 },
      }),
    },
    {
      name: "indirect resolved lead-to-case link",
      scope: conversationScope({
        conversationLeadId: 201,
        resolvedLead: { ...leadOnly, client_id: 101 },
      }),
    },
    {
      name: "indirect dangling lead-to-case link",
      scope: conversationScope({
        conversationLeadId: 201,
        resolvedLead: { ...leadOnly, client_id: 999 },
      }),
    },
    {
      name: "conflicting direct and lead case links",
      scope: conversationScope({
        conversationClientId: 101,
        conversationLeadId: 201,
        resolvedClient: pendingCase,
        resolvedLead: { ...leadOnly, client_id: 102 },
      }),
    },
    {
      name: "ownerless lead-only conversation",
      scope: conversationScope({
        conversationLeadId: 201,
        resolvedLead: { ...leadOnly, manager_id: null },
      }),
    },
    {
      name: "lead-only owner resolves to the wrong business role",
      scope: conversationScope({
        conversationLeadId: 201,
        resolvedLead: { ...leadOnly, manager_role: "admin" },
      }),
    },
    {
      name: "ownerless pending case",
      scope: conversationScope({
        conversationClientId: 101,
        resolvedClient: { ...pendingCase, manager_id: null },
      }),
    },
    {
      name: "ownerless active case",
      scope: conversationScope({
        conversationClientId: 101,
        resolvedClient: { ...activeCase, curator_id: null },
      }),
    },
    {
      name: "ownerless closed case",
      scope: conversationScope({
        conversationClientId: 101,
        resolvedClient: { ...closedCase, curator_id: null },
      }),
    },
    {
      name: "active case Curator owner resolves to the wrong business role",
      scope: conversationScope({
        conversationClientId: 101,
        resolvedClient: { ...activeCase, curator_role: "finance" },
      }),
    },
    {
      name: "invalid case lifecycle",
      scope: conversationScope({
        conversationClientId: 101,
        resolvedClient: { ...activeCase, case_state: "archived" },
      }),
    },
  ];

  const nonAdminActors = [
    actors.responsibleSales,
    actors.unrelatedSales,
    actors.assignedCurator,
    actors.unrelatedCurator,
    actors.finance,
    actors.student,
  ];

  for (const invalid of invalidScopes) {
    for (const actor of nonAdminActors) {
      assert.equal(
        resolveWhatsAppConversationAccess(actor, invalid.scope),
        "none",
        `${invalid.name} / ${actor.role}:${actor.id}`,
      );
    }
  }

  const wrongSalesOwnerRole = conversationScope({
    conversationClientId: 101,
    resolvedClient: { ...activeCase, manager_role: "admin" },
  });
  assert.equal(
    resolveWhatsAppConversationAccess(
      actors.responsibleSales,
      wrongSalesOwnerRole,
    ),
    "none",
    "a wrong-role former Sales owner cannot receive the handoff summary",
  );
  assert.equal(
    resolveWhatsAppConversationAccess(actors.assignedCurator, wrongSalesOwnerRole),
    "curator_full",
    "a valid assigned Curator remains the applicable active-case owner",
  );
});

test("conversation capabilities are granted only by the resolved access mode", () => {
  const capabilities = [
    "read_full",
    "send",
    "mark_read",
    "draft",
    "read_summary",
  ];

  const expectedByMode = {
    none: [],
    admin_full: capabilities,
    sales_full_pre_handoff: capabilities,
    sales_post_handoff_summary: ["read_summary"],
    curator_full: capabilities,
  };

  for (const [mode, expected] of Object.entries(expectedByMode)) {
    for (const capability of capabilities) {
      assert.equal(
        canWhatsAppCapability(mode, capability),
        expected.includes(capability),
        `${mode} / ${capability}`,
      );
    }
  }

  assert.equal(canWhatsAppCapability("admin_full", "broadcast"), false);
  assert.equal(canWhatsAppCapability("invented_mode", "read_full"), false);
});

test("manual conversation creation is Admin-only", () => {
  assert.equal(canCreateManualWhatsAppConversation(actors.admin), true);

  for (const actor of [
    actors.responsibleSales,
    actors.assignedCurator,
    actors.finance,
    actors.student,
    { id: 99, role: "unknown" },
  ]) {
    assert.equal(
      canCreateManualWhatsAppConversation(actor),
      false,
      `${actor.role}:${actor.id}`,
    );
  }
});
