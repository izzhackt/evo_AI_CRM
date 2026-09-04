import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PlatformBw4RepositoryError,
  buildPlatformCreateDecisionBacklogRpcArgs,
  buildPlatformTransitionDecisionBacklogRpcArgs,
  doesPlatformDecisionCreateTargetMatchWorkspace,
  doesPlatformDecisionMutationPreserveSnapshot,
  isPlatformDecisionTransitionAllowed,
  normalizePlatformConversationBw4Workspace,
  normalizePlatformDecisionMutationResponse,
  parsePlatformBw4PositiveBigint,
  parsePlatformCreateDecisionBacklogEntryForm,
  parsePlatformTransitionDecisionBacklogEntryForm,
} from "../src/lib/platform-bw4-workflow.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const STUDENT_CASE_ID = "33333333-3333-4333-8333-333333333333";
const HANDOFF_ID = "44444444-4444-4444-8444-444444444444";
const OP_CONTRACT_ID = "55555555-5555-4555-8555-555555555555";
const OP_VERSION_ID = "66666666-6666-4666-8666-666666666666";
const OZO_CONTRACT_ID = "77777777-7777-4777-8777-777777777777";
const OZO_VERSION_ID = "88888888-8888-4888-8888-888888888888";
const SOURCE_ID = "99999999-9999-4999-8999-999999999999";
const PROMPT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTEXT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQUEST_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DECISION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DECISION_VERSION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const NEXT_DECISION_VERSION_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const COUNTRY_REQUIREMENT_ID = "12121212-1212-4212-8212-121212121212";
const DOCUMENT_REQUIREMENT_ID = "13131313-1313-4313-8313-131313131313";
const AT = "2026-08-02T05:00:00+00:00";
const SOURCE_KEY = `src_${"a".repeat(40)}`;
const SOURCE_URL = `https://github.com/izzhackt/evo_AI_CRM/commit/${"b".repeat(40)}`;
const SHA256 = "c".repeat(64);

function promptArtifact(kind, id, overrides = {}) {
  return {
    prompt_artifact_version_id: id,
    artifact_kind: kind,
    artifact_key: "lead_manager.default",
    title: kind === "prompt_policy" ? "Lead Manager policy" : "EVO context",
    version: "1",
    status: "approved",
    content_sha256: SHA256,
    provenance_ref: "repository:reviewed-artifact",
    approved_at: AT,
    ...overrides,
  };
}

function reviewedSource(overrides = {}) {
  return {
    source_registry_id: SOURCE_ID,
    source_key: SOURCE_KEY,
    source_kind: "repository_contract",
    source_url: SOURCE_URL,
    source_revision: "revision:2026-08-02",
    review_status: "reviewed",
    reviewed_at: AT,
    ...overrides,
  };
}

function decisionVersion(overrides = {}) {
  return {
    decision_backlog_version_id: DECISION_VERSION_ID,
    effective_version: "1",
    question: "Which intake should the manager confirm?",
    answer: null,
    owner_role: "sales",
    status: "unresolved",
    affected_requirement_kind: "general",
    affected_requirement_id: null,
    affected_requirement_field: null,
    source_registry_id: null,
    evidence_ref: null,
    created_at: AT,
    ...overrides,
  };
}

function workspaceRow(overrides = {}) {
  const prompt = promptArtifact("prompt_policy", PROMPT_ID);
  const context = promptArtifact("business_context", CONTEXT_ID);
  return {
    organization_id: ORGANIZATION_ID,
    conversation_id: CONVERSATION_ID,
    student_case_id: STUDENT_CASE_ID,
    actor_role: "admin",
    can_manage_decisions: true,
    allowed_owner_roles: ["admin", "sales", "admissions"],
    handoff: {
      handoff_id: HANDOFF_ID,
      student_case_id: STUDENT_CASE_ID,
      op_workflow_contract_id: OP_CONTRACT_ID,
      op_workflow_contract_version_id: OP_VERSION_ID,
      ozo_workflow_contract_id: OZO_CONTRACT_ID,
      ozo_workflow_contract_version_id: OZO_VERSION_ID,
      approved_commercial_fields: {
        consultation_fee: 500,
        currency: "USD",
        discount_approved: false,
      },
      unresolved_questions: ["Confirm payment schedule"],
      promises: ["Send the approved checklist"],
      next_step: "Assign Admissions",
      due_at: AT,
      responsible_role: "admissions",
      created_at: AT,
    },
    available_requirements: [
      {
        requirement_kind: "country_requirement",
        requirement_id: COUNTRY_REQUIREMENT_ID,
        label: "Malaysia · Bachelor · v1",
      },
      {
        requirement_kind: "document_requirement",
        requirement_id: DOCUMENT_REQUIREMENT_ID,
        label: "Passport",
      },
    ],
    reviewed_sources: [reviewedSource()],
    active_prompt_artifacts: {
      prompt_policy: prompt,
      business_context: context,
    },
    pinned_prompt_artifacts: {
      ai_draft_request_id: REQUEST_ID,
      selected_at: AT,
      prompt_policy: prompt,
      business_context: context,
    },
    decisions: [
      {
        decision_backlog_id: DECISION_ID,
        current_effective_version: "1",
        versions: [decisionVersion()],
      },
    ],
    ...overrides,
  };
}

function clone(value) {
  return structuredClone(value);
}

function boundedUuid(prefix, value) {
  return `${prefix}-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function validCreateForm(overrides = {}) {
  const values = {
    conversation_id: CONVERSATION_ID,
    student_case_id: STUDENT_CASE_ID,
    question: "Which intake should the manager confirm?",
    owner_role: "sales",
    affected_requirement_kind: "general",
    affected_requirement_id: "",
    affected_requirement_field: "",
    source_registry_id: "",
    evidence_ref: "",
    reason: "Track an explicit operational decision",
    request_id: REQUEST_ID,
    ...overrides,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

function validTransitionForm(overrides = {}) {
  return validCreateForm({
    decision_backlog_id: DECISION_ID,
    expected_effective_version: "1",
    new_status: "answered",
    answer: "Use the September 2027 intake.",
    source_registry_id: SOURCE_ID,
    evidence_ref: "reviewed-source:section-4",
    ...overrides,
  });
}

test("normalizes the complete metadata-only BW4 workspace and derives controls", () => {
  const workspace = normalizePlatformConversationBw4Workspace(workspaceRow(), {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    actorRole: "admin",
  });

  assert.equal(workspace.studentCaseId, STUDENT_CASE_ID);
  assert.equal(workspace.canCreateDecision, true);
  assert.deepEqual(workspace.allowedOwnerRoles, ["admin", "sales", "admissions"]);
  assert.equal(workspace.handoff?.approvedCommercialFieldEntries.length, 3);
  assert.deepEqual(workspace.handoff?.approvedCommercialFieldEntries[0], {
    key: "consultation_fee",
    value: 500,
  });
  assert.equal(workspace.reviewedSources[0].sourceRegistryId, SOURCE_ID);
  assert.deepEqual(workspace.availableRequirements, [
    {
      requirementKind: "country_requirement",
      requirementId: COUNTRY_REQUIREMENT_ID,
      label: "Malaysia · Bachelor · v1",
    },
    {
      requirementKind: "document_requirement",
      requirementId: DOCUMENT_REQUIREMENT_ID,
      label: "Passport",
    },
  ]);
  assert.equal(
    workspace.activePromptArtifacts.promptPolicy?.promptArtifactVersionId,
    PROMPT_ID,
  );
  assert.equal(workspace.pinnedPromptArtifacts?.aiDraftRequestId, REQUEST_ID);
  assert.equal(workspace.decisions[0].canAnswer, true);
  assert.equal(workspace.decisions[0].canReopen, false);
  assert.equal(workspace.decisions[0].canRetire, true);
});

test("keeps the BW4 workspace usable at the enforced 100 by 100 decision boundary", () => {
  const decisions = Array.from({ length: 100 }, (_, decisionIndex) => {
    const versionCount = decisionIndex === 0 ? 100 : 1;
    return {
      decision_backlog_id: boundedUuid("d1000000", decisionIndex + 1),
      current_effective_version: String(versionCount),
      versions: Array.from({ length: versionCount }, (_, versionIndex) =>
        decisionVersion({
          decision_backlog_version_id: boundedUuid(
            "e1000000",
            decisionIndex * 1000 + versionIndex + 1,
          ),
          effective_version: String(versionIndex + 1),
        }),
      ),
    };
  });

  const workspace = normalizePlatformConversationBw4Workspace(
    workspaceRow({ decisions }),
  );

  assert.equal(workspace.decisions.length, 100);
  assert.equal(workspace.decisions[0].versions.length, 100);
  assert.equal(workspace.decisions[0].currentEffectiveVersion, "100");
  assert.equal(workspace.decisions[0].canAnswer, true);
  assert.equal(workspace.canCreateDecision, true);
  assert.equal(workspace.handoff?.handoffId, HANDOFF_ID);
  assert.equal(workspace.reviewedSources[0].sourceRegistryId, SOURCE_ID);
  assert.equal(
    workspace.activePromptArtifacts.promptPolicy?.promptArtifactVersionId,
    PROMPT_ID,
  );
});

test("keeps a pre-contract conversation usable while limiting it to general decisions", () => {
  const row = workspaceRow({
    student_case_id: null,
    actor_role: "sales",
    allowed_owner_roles: ["sales"],
    handoff: null,
    available_requirements: [],
  });
  const workspace = normalizePlatformConversationBw4Workspace(row, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    actorRole: "sales",
  });

  assert.equal(workspace.studentCaseId, null);
  assert.equal(workspace.canCreateDecision, true);
  assert.equal(workspace.handoff, null);

  const bad = clone(row);
  bad.decisions[0].versions[0].affected_requirement_kind = "handoff";
  bad.decisions[0].versions[0].affected_requirement_id = HANDOFF_ID;
  assert.throws(
    () => normalizePlatformConversationBw4Workspace(bad),
    PlatformBw4RepositoryError,
  );
});

test("rejects malformed identity, enum, bigint, history, and source cross-links wholesale", () => {
  const mutations = [
    (row) => {
      row.organization_id = "not-a-uuid";
    },
    (row) => {
      row.actor_role = "finance";
    },
    (row) => {
      row.allowed_owner_roles = ["admin", "admin"];
    },
    (row) => {
      row.available_requirements.push(row.available_requirements[0]);
    },
    (row) => {
      row.available_requirements[0].label = "unsafe\u0000label";
    },
    (row) => {
      row.decisions[0].current_effective_version = "0";
    },
    (row) => {
      row.decisions[0].current_effective_version = "2";
    },
    (row) => {
      row.decisions[0].versions[0].question = "unsafe\u0000question";
    },
    (row) => {
      row.decisions[0].versions[0].status = "silently_defaulted";
    },
    (row) => {
      row.reviewed_sources[0].source_url = "https://example.com/private";
    },
    (row) => {
      row.reviewed_sources[0].reviewed_at = "not-a-timestamp";
    },
    (row) => {
      row.decisions[0].versions[0] = decisionVersion({
        status: "answered",
        answer: "September 2027",
        source_registry_id: "12121212-1212-4212-8212-121212121212",
        evidence_ref: "reviewed-source:section-4",
      });
    },
    (row) => {
      row.decisions[0].versions = [
        decisionVersion(),
        decisionVersion({
          decision_backlog_version_id: NEXT_DECISION_VERSION_ID,
          effective_version: "3",
          status: "retired",
        }),
      ];
      row.decisions[0].current_effective_version = "3";
    },
    (row) => {
      row.decisions[0].versions[0].affected_requirement_kind =
        "student_profile";
      row.decisions[0].versions[0].affected_requirement_id = HANDOFF_ID;
      row.decisions[0].versions[0].affected_requirement_field = "budget_band";
    },
    (row) => {
      row.decisions[0].versions[0].affected_requirement_kind = "handoff";
      row.decisions[0].versions[0].affected_requirement_id = OP_CONTRACT_ID;
    },
  ];

  for (const mutate of mutations) {
    const row = clone(workspaceRow());
    mutate(row);
    assert.throws(
      () => normalizePlatformConversationBw4Workspace(row),
      PlatformBw4RepositoryError,
    );
  }
});

test("rejects raw prompt content and other uncontracted prompt fields", () => {
  for (const field of [
    "content",
    "content_text",
    "prompt",
    "prompt_text",
    "system_prompt",
  ]) {
    const row = clone(workspaceRow());
    row.active_prompt_artifacts.prompt_policy[field] = "must never be exposed";
    assert.throws(
      () => normalizePlatformConversationBw4Workspace(row),
      PlatformBw4RepositoryError,
    );
  }
});

test("keeps retired reviewed-source metadata readable for immutable history", () => {
  const row = workspaceRow({
    reviewed_sources: [reviewedSource({ review_status: "retired" })],
    decisions: [
      {
        decision_backlog_id: DECISION_ID,
        current_effective_version: "1",
        versions: [
          decisionVersion({
            status: "answered",
            answer: "Use the reviewed September route.",
            source_registry_id: SOURCE_ID,
            evidence_ref: "reviewed-source:section-4",
          }),
        ],
      },
    ],
  });
  const workspace = normalizePlatformConversationBw4Workspace(row);
  assert.equal(workspace.reviewedSources[0].reviewStatus, "retired");
  assert.equal(
    workspace.reviewedSources[0].canUseForDecisionEvidence,
    false,
  );
  assert.equal(workspace.decisions[0].currentVersion.sourceRegistryId, SOURCE_ID);
});

test("bounds PostgreSQL bigint values without unsafe JavaScript coercion", () => {
  assert.equal(parsePlatformBw4PositiveBigint(1), "1");
  assert.equal(
    parsePlatformBw4PositiveBigint("9223372036854775807"),
    "9223372036854775807",
  );
  assert.equal(parsePlatformBw4PositiveBigint(0), null);
  assert.equal(parsePlatformBw4PositiveBigint("01"), null);
  assert.equal(parsePlatformBw4PositiveBigint("9223372036854775808"), null);
  assert.equal(parsePlatformBw4PositiveBigint(Number.MAX_SAFE_INTEGER + 1), null);
});

test("parses create form data and builds the exact idempotent RPC request shape", () => {
  const input = parsePlatformCreateDecisionBacklogEntryForm(validCreateForm());
  assert.ok(input);
  assert.deepEqual(input, {
    conversationId: CONVERSATION_ID,
    studentCaseId: STUDENT_CASE_ID,
    question: "Which intake should the manager confirm?",
    ownerRole: "sales",
    affectedRequirementKind: "general",
    affectedRequirementId: null,
    affectedRequirementField: null,
    sourceRegistryId: null,
    evidenceRef: null,
    reason: "Track an explicit operational decision",
    requestId: REQUEST_ID,
  });
  assert.deepEqual(buildPlatformCreateDecisionBacklogRpcArgs(ORGANIZATION_ID, input), {
    p_organization_id: ORGANIZATION_ID,
    p_conversation_id: CONVERSATION_ID,
    p_student_case_id: STUDENT_CASE_ID,
    p_question: "Which intake should the manager confirm?",
    p_owner_role: "sales",
    p_affected_requirement_kind: "general",
    p_affected_requirement_id: null,
    p_affected_requirement_field: null,
    p_source_registry_id: null,
    p_evidence_ref: null,
    p_reason: "Track an explicit operational decision",
    p_request_id: REQUEST_ID,
  });

  const preContract = parsePlatformCreateDecisionBacklogEntryForm(
    validCreateForm({ student_case_id: "" }),
  );
  assert.equal(preContract?.studentCaseId, null);
});

test("matches create targets against the refreshed workspace allowlist", () => {
  const workspace = normalizePlatformConversationBw4Workspace(workspaceRow());
  const countryInput = parsePlatformCreateDecisionBacklogEntryForm(
    validCreateForm({
      affected_requirement_kind: "country_requirement",
      affected_requirement_id: COUNTRY_REQUIREMENT_ID,
    }),
  );
  assert.ok(countryInput);
  assert.equal(
    doesPlatformDecisionCreateTargetMatchWorkspace(workspace, countryInput),
    true,
  );

  const forgedTarget = parsePlatformCreateDecisionBacklogEntryForm(
    validCreateForm({
      affected_requirement_kind: "document_requirement",
      affected_requirement_id: "14141414-1414-4414-8414-141414141414",
    }),
  );
  assert.ok(forgedTarget);
  assert.equal(
    doesPlatformDecisionCreateTargetMatchWorkspace(workspace, forgedTarget),
    false,
  );

  const wrongCase = parsePlatformCreateDecisionBacklogEntryForm(
    validCreateForm({ student_case_id: HANDOFF_ID }),
  );
  assert.ok(wrongCase);
  assert.equal(
    doesPlatformDecisionCreateTargetMatchWorkspace(workspace, wrongCase),
    false,
  );
});

test("rejects overlong, controlled, duplicated, and cross-linked create form values", () => {
  assert.equal(
    parsePlatformCreateDecisionBacklogEntryForm(
      validCreateForm({ question: "q".repeat(2001) }),
    ),
    null,
  );
  assert.equal(
    parsePlatformCreateDecisionBacklogEntryForm(
      validCreateForm({ reason: "bad\u0007reason" }),
    ),
    null,
  );
  assert.equal(
    parsePlatformCreateDecisionBacklogEntryForm(
      validCreateForm({ owner_role: "finance" }),
    ),
    null,
  );
  assert.equal(
    parsePlatformCreateDecisionBacklogEntryForm(
      validCreateForm({
        affected_requirement_kind: "general",
        affected_requirement_id: HANDOFF_ID,
      }),
    ),
    null,
  );
  assert.equal(
    parsePlatformCreateDecisionBacklogEntryForm(
      validCreateForm({
        affected_requirement_kind: "student_profile",
        affected_requirement_id: HANDOFF_ID,
        affected_requirement_field: "budget_band",
      }),
    ),
    null,
  );
  assert.equal(
    parsePlatformCreateDecisionBacklogEntryForm(
      validCreateForm({
        affected_requirement_kind: "student_profile",
        affected_requirement_id: STUDENT_CASE_ID,
        affected_requirement_field: "invented_field",
      }),
    ),
    null,
  );
  assert.equal(
    parsePlatformCreateDecisionBacklogEntryForm(
      validCreateForm({ source_registry_id: SOURCE_ID, evidence_ref: "" }),
    ),
    null,
  );

  const duplicate = validCreateForm();
  duplicate.append("question", "second question");
  assert.equal(parsePlatformCreateDecisionBacklogEntryForm(duplicate), null);
});

test("parses answer, reopen, and retire transitions with explicit state-safe shapes", () => {
  const answer = parsePlatformTransitionDecisionBacklogEntryForm(
    validTransitionForm(),
  );
  assert.ok(answer);
  assert.equal(answer.newStatus, "answered");
  assert.equal(answer.answer, "Use the September 2027 intake.");
  assert.deepEqual(
    buildPlatformTransitionDecisionBacklogRpcArgs(ORGANIZATION_ID, answer),
    {
      p_organization_id: ORGANIZATION_ID,
      p_conversation_id: CONVERSATION_ID,
      p_decision_backlog_id: DECISION_ID,
      p_expected_effective_version: "1",
      p_new_status: "answered",
      p_question: "Which intake should the manager confirm?",
      p_answer: "Use the September 2027 intake.",
      p_owner_role: "sales",
      p_affected_requirement_kind: "general",
      p_affected_requirement_id: null,
      p_affected_requirement_field: null,
      p_source_registry_id: SOURCE_ID,
      p_evidence_ref: "reviewed-source:section-4",
      p_reason: "Track an explicit operational decision",
      p_request_id: REQUEST_ID,
    },
  );

  const reopen = parsePlatformTransitionDecisionBacklogEntryForm(
    validTransitionForm({
      new_status: "unresolved",
      answer: "",
      source_registry_id: "",
      evidence_ref: "",
    }),
  );
  assert.equal(reopen?.newStatus, "unresolved");
  assert.equal(reopen?.answer, null);

  const retire = parsePlatformTransitionDecisionBacklogEntryForm(
    validTransitionForm({
      new_status: "retired",
      answer: "",
      source_registry_id: "",
      evidence_ref: "",
    }),
  );
  assert.equal(retire?.newStatus, "retired");
  assert.equal(
    doesPlatformDecisionMutationPreserveSnapshot(
      normalizePlatformConversationBw4Workspace(workspaceRow()).decisions[0]
        .currentVersion,
      retire,
    ),
    true,
  );
  assert.equal(isPlatformDecisionTransitionAllowed("unresolved", "answered"), true);
  assert.equal(isPlatformDecisionTransitionAllowed("answered", "unresolved"), true);
  assert.equal(isPlatformDecisionTransitionAllowed("answered", "retired"), true);
  assert.equal(isPlatformDecisionTransitionAllowed("retired", "unresolved"), false);
  assert.equal(isPlatformDecisionTransitionAllowed("answered", "answered"), false);
});

test("rejects invalid transition enums, versions, answers, and evidence pairs", () => {
  for (const overrides of [
    { new_status: "draft" },
    { expected_effective_version: "0" },
    { new_status: "answered", answer: "" },
    { new_status: "answered", source_registry_id: "", evidence_ref: "" },
    { new_status: "unresolved", answer: "still answered" },
    { answer: "a".repeat(8001) },
  ]) {
    assert.equal(
      parsePlatformTransitionDecisionBacklogEntryForm(
        validTransitionForm(overrides),
      ),
      null,
    );
  }
});

test("validates mutation response identity, optimistic version, and status", () => {
  const response = {
    organization_id: ORGANIZATION_ID,
    conversation_id: CONVERSATION_ID,
    student_case_id: STUDENT_CASE_ID,
    decision_backlog_id: DECISION_ID,
    decision_backlog_version_id: NEXT_DECISION_VERSION_ID,
    effective_version: "2",
    status: "answered",
    previous_effective_version: "1",
    previous_status: "unresolved",
  };
  const normalized = normalizePlatformDecisionMutationResponse(response, {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    studentCaseId: STUDENT_CASE_ID,
    decisionBacklogId: DECISION_ID,
    expectedEffectiveVersion: "1",
    previousStatus: "unresolved",
    status: "answered",
  });
  assert.equal(normalized.effectiveVersion, "2");

  const preContractResponse = {
    ...response,
    student_case_id: null,
  };
  assert.equal(
    normalizePlatformDecisionMutationResponse(preContractResponse, {
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      decisionBacklogId: DECISION_ID,
      expectedEffectiveVersion: "1",
      previousStatus: "unresolved",
      status: "answered",
    }).studentCaseId,
    null,
  );

  for (const mutation of [
    (row) => {
      row.organization_id = HANDOFF_ID;
    },
    (row) => {
      row.effective_version = "3";
    },
    (row) => {
      row.previous_status = "answered";
    },
    (row) => {
      row.status = "retired";
    },
  ]) {
    const bad = clone(response);
    mutation(bad);
    assert.throws(
      () =>
        normalizePlatformDecisionMutationResponse(bad, {
          organizationId: ORGANIZATION_ID,
          conversationId: CONVERSATION_ID,
          studentCaseId: STUDENT_CASE_ID,
          decisionBacklogId: DECISION_ID,
          expectedEffectiveVersion: "1",
          previousStatus: "unresolved",
          status: "answered",
        }),
      PlatformBw4RepositoryError,
    );
  }
});

test("BW4 repository and actions use only Platform auth/Supabase seams", () => {
  const workflowSource = readFileSync(
    new URL("../src/lib/platform-bw4-workflow.ts", import.meta.url),
    "utf8",
  );
  const actionSource = readFileSync(
    new URL("../src/lib/platform-bw4-actions.ts", import.meta.url),
    "utf8",
  );

  assert.match(workflowSource, /staff_conversation_bw4_workspace/);
  assert.match(workflowSource, /\.schema\("platform"\)/);
  assert.doesNotMatch(workflowSource, /\{ get: true \}/);
  assert.match(actionSource, /requirePlatformMessagingActor/);
  assert.match(actionSource, /create_decision_backlog_entry/);
  assert.match(actionSource, /transition_decision_backlog_entry/);
  assert.match(actionSource, /revalidatePath\("\/v3\/inbox"\)/);
  assert.match(actionSource, /query\.set\("conversation", conversationId\)/);
  assert.match(actionSource, /redirect\(`\$\{target\}#\$\{fragment\.toString\(\)\}`\)/);
  assert.doesNotMatch(actionSource, /revalidatePath\([^\n]*\/whatsapp/);
  for (const source of [workflowSource, actionSource]) {
    assert.doesNotMatch(source, /from\s+["']\.\/db["']/);
    assert.doesNotMatch(source, /from\s+["']\.\/auth["']/);
    assert.doesNotMatch(source, /@\/lib\/db/);
    assert.doesNotMatch(source, /getCurrentUser|requireAuth/);
  }
});
