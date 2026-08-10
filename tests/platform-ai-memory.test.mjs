import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  buildPlatformAiControlRpcArgs,
  buildPlatformAiFactRpcArgs,
  buildPlatformAiLexicalPreviewRpcArgs,
  buildPlatformAiMemoryRpcArgs,
  buildPlatformAiQualificationRpcArgs,
  normalizePlatformAiRetrievalCapabilities,
  normalizePlatformAiRetrievalEvidence,
  normalizePlatformConversationAiMemory,
  parsePlatformAiFactValue,
  PLATFORM_AI_CONTROL_STATES,
  PLATFORM_AI_FACT_KEYS,
  PLATFORM_AI_QUALIFICATION_STATES,
  PlatformAiMemoryContractError,
} from "../src/lib/platform-ai-memory.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export default {};",
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  isPlatformAiMemoryEnabled,
  readPlatformConversationAiMemory,
  PlatformAiMemoryRepositoryError,
} = await import("../src/lib/server/platform-ai-memory-repository.ts");

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const MESSAGE_ID = "33333333-3333-4333-8333-333333333333";
const RETRIEVAL_ID = "44444444-4444-4444-8444-444444444444";

function actor() {
  return {
    authUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    membershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    organizationId: ORGANIZATION_ID,
    displayName: "Operator",
    platformRole: "sales",
    platformAccessVersion: 1,
    role: "sales",
  };
}

function validMemoryRow(overrides = {}) {
  return {
    conversation_id: CONVERSATION_ID,
    memory_version: "2",
    memory_short_summary: "Interested in China undergraduate options.",
    memory_long_summary: "The student asked about an autumn intake and tuition.",
    memory_source_message_id: MESSAGE_ID,
    facts: [
      {
        fact_key: "preferred_country",
        status: "active",
        value: "China",
        version: "1",
        source_message_id: MESSAGE_ID,
        created_at: "2026-08-10T08:00:00Z",
      },
      {
        fact_key: "blockers",
        status: "active",
        value: ["Needs a scholarship"],
        version: "3",
        source_message_id: MESSAGE_ID,
        created_at: "2026-08-10T08:01:00Z",
      },
    ],
    qualification_version: "4",
    qualification_status: "ready_for_staff_review",
    qualification_completeness: 70,
    qualification_missing_fact_keys: ["budget_signal", "intake_target"],
    qualification_notes: "Confirm the available budget.",
    qualification_source_message_id: MESSAGE_ID,
    control_version: "5",
    control_state: "staff_only",
    control_reason: "Staff keeps control in P5F1.",
    latest_retrieval_request_id: RETRIEVAL_ID,
    latest_retrieval_outcome: "completed",
    latest_retrieval_created_at: "2026-08-10T08:02:00Z",
    autonomous_authority: false,
    ...overrides,
  };
}

function validEvidenceRow(overrides = {}) {
  return {
    retrieval_request_id: RETRIEVAL_ID,
    source_message_id: MESSAGE_ID,
    retrieval_mode: "lexical_preview",
    retrieval_outcome: "completed",
    degraded: true,
    provider_proof_state: "blocked",
    autonomous_authority: false,
    knowledge_key: "admissions.documents",
    knowledge_version: "3",
    knowledge_title: "Approved admissions documents",
    evidence_ordinal: 1,
    created_at: "2026-08-10T08:02:00Z",
    ...overrides,
  };
}

test("freezes the exact P5F1 fact, qualification and staff-only control vocabulary", () => {
  assert.deepEqual(PLATFORM_AI_FACT_KEYS, [
    "preferred_country",
    "preferred_program",
    "budget_signal",
    "intake_target",
    "preferred_language",
    "urgency",
    "blockers",
    "promised_follow_up",
    "unanswered_questions",
  ]);
  assert.deepEqual(PLATFORM_AI_QUALIFICATION_STATES, [
    "collecting",
    "ready_for_staff_review",
    "staff_confirmed",
    "not_a_fit",
  ]);
  assert.deepEqual(PLATFORM_AI_CONTROL_STATES, [
    "paused",
    "staff_takeover",
    "staff_only",
  ]);
  assert.equal(PLATFORM_AI_CONTROL_STATES.includes("active"), false);
});

test("normalizes only the safe aggregate shape and preserves bigint versions as strings", () => {
  const memory = normalizePlatformConversationAiMemory(validMemoryRow());

  assert.equal(memory.conversationId, CONVERSATION_ID);
  assert.equal(memory.memory.version, "2");
  assert.equal(memory.facts[1].key, "blockers");
  assert.deepEqual(memory.facts[1].value, ["Needs a scholarship"]);
  assert.equal(memory.qualification.version, "4");
  assert.equal(memory.control.state, "staff_only");
  assert.equal(memory.latestRetrieval?.requestId, RETRIEVAL_ID);
  assert.equal(memory.autonomousAuthority, false);
  assert.equal("organizationId" in memory, false);
});

test("fails closed on extra/private fields, unsafe states, mismatched facts and autonomy", () => {
  const invalidRows = [
    validMemoryRow({ raw_waha_chat_id: "996555000000@c.us" }),
    validMemoryRow({ autonomous_authority: true }),
    validMemoryRow({ control_state: "resumed" }),
    validMemoryRow({ qualification_status: "qualified" }),
    validMemoryRow({
      facts: [
        {
          ...validMemoryRow().facts[0],
          private_chunk_id: "55555555-5555-4555-8555-555555555555",
        },
      ],
    }),
    validMemoryRow({
      facts: [
        {
          ...validMemoryRow().facts[0],
          fact_key: "preferred_intake",
        },
      ],
    }),
    validMemoryRow({
      facts: [
        {
          ...validMemoryRow().facts[0],
          fact_key: "blockers",
          value: "not-an-array",
        },
      ],
    }),
  ];

  for (const row of invalidRows) {
    assert.throws(
      () => normalizePlatformConversationAiMemory(row),
      PlatformAiMemoryContractError,
    );
  }
});

test("accepts exact scalar/list fact input and rejects empty, duplicate or oversized values", () => {
  assert.equal(parsePlatformAiFactValue("intake_target", "Autumn 2027"), "Autumn 2027");
  assert.deepEqual(
    parsePlatformAiFactValue("unanswered_questions", "Visa timing\nHousing options"),
    ["Visa timing", "Housing options"],
  );
  assert.equal(parsePlatformAiFactValue("blockers", "Duplicate\nDuplicate"), null);
  assert.equal(parsePlatformAiFactValue("preferred_country", " "), null);
  assert.equal(parsePlatformAiFactValue("preferred_program", "x".repeat(501)), null);
});

test("builds exact mutation RPC arguments without public organization or provider data", () => {
  assert.deepEqual(
    buildPlatformAiMemoryRpcArgs({
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      expectedVersion: "2",
      shortSummary: "Short",
      longSummary: "Long context",
      sourceMessageId: MESSAGE_ID,
      reason: "staff_ui_update",
      requestId: RETRIEVAL_ID,
    }),
    {
      p_organization_id: ORGANIZATION_ID,
      p_conversation_id: CONVERSATION_ID,
      p_expected_version: "2",
      p_short_summary: "Short",
      p_long_summary: "Long context",
      p_source_message_id: MESSAGE_ID,
      p_reason: "staff_ui_update",
      p_request_id: RETRIEVAL_ID,
    },
  );

  assert.equal(
    buildPlatformAiFactRpcArgs({
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      key: "intake_target",
      expectedVersion: "0",
      status: "active",
      value: "Autumn 2027",
      sourceMessageId: MESSAGE_ID,
      reason: "staff_ui_update",
      requestId: RETRIEVAL_ID,
    }).p_fact_key,
    "intake_target",
  );
  assert.equal(
    buildPlatformAiQualificationRpcArgs({
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      expectedVersion: "4",
      status: "collecting",
      completeness: 60,
      missingFactKeys: ["blockers"],
      notes: null,
      sourceMessageId: MESSAGE_ID,
      reason: "staff_ui_update",
      requestId: RETRIEVAL_ID,
    }).p_status,
    "collecting",
  );
  assert.equal(
    buildPlatformAiControlRpcArgs({
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      expectedVersion: "5",
      state: "staff_takeover",
      reason: "staff_ui_takeover",
      requestId: RETRIEVAL_ID,
    }).p_state,
    "staff_takeover",
  );
});

test("lexical preview accepts an exact inbound source reference and no arbitrary query", () => {
  const args = buildPlatformAiLexicalPreviewRpcArgs({
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    sourceMessageId: MESSAGE_ID,
    limit: 5,
    reason: "staff_ui_preview",
    requestId: RETRIEVAL_ID,
  });

  assert.equal(args.p_source_message_ref, MESSAGE_ID);
  assert.equal("p_query" in args, false);
  assert.equal("p_text" in args, false);
});

test("retrieval capabilities and evidence remain explicitly degraded and provider-disabled", () => {
  assert.deepEqual(
    normalizePlatformAiRetrievalCapabilities({
      embedding_model: "gemini-embedding-2",
      embedding_dimensions: 1536,
      provider_ingestion_enabled: false,
      semantic_retrieval_enabled: false,
      lexical_preview_enabled: true,
      lexical_preview_degraded: true,
      autonomous_authority: false,
      provider_proof_state: "blocked",
    }),
    {
      embeddingModel: "gemini-embedding-2",
      embeddingDimensions: 1536,
      providerIngestionEnabled: false,
      semanticRetrievalEnabled: false,
      lexicalPreviewEnabled: true,
      lexicalPreviewDegraded: true,
      autonomousAuthority: false,
      providerProofState: "blocked",
    },
  );

  const evidence = normalizePlatformAiRetrievalEvidence([validEvidenceRow()]);
  assert.equal(evidence.requestId, RETRIEVAL_ID);
  assert.equal(evidence.items[0].knowledgeKey, "admissions.documents");
  assert.equal(evidence.autonomousAuthority, false);

  assert.throws(
    () =>
      normalizePlatformAiRetrievalEvidence([
        validEvidenceRow({ chunk_text: "private evidence" }),
      ]),
    PlatformAiMemoryContractError,
  );
});

test("repository stays disabled unless the exact server feature flag is 1", async () => {
  assert.equal(isPlatformAiMemoryEnabled({}), false);
  assert.equal(isPlatformAiMemoryEnabled({ EVO_PLATFORM_AI_MEMORY_ENABLED: "true" }), false);
  assert.equal(isPlatformAiMemoryEnabled({ EVO_PLATFORM_AI_MEMORY_ENABLED: "1" }), true);

  let calls = 0;
  const client = {
    schema() {
      return {
        async rpc() {
          calls += 1;
          return { data: [validMemoryRow()], error: null };
        },
      };
    },
  };
  await assert.rejects(
    readPlatformConversationAiMemory(actor(), CONVERSATION_ID, {
      client,
      env: {},
    }),
    PlatformAiMemoryRepositoryError,
  );
  assert.equal(calls, 0);
});

test("repository scopes the safe memory read to the authenticated actor organization", async () => {
  const calls = [];
  const client = {
    schema(name) {
      assert.equal(name, "platform");
      return {
        async rpc(rpcName, args, options) {
          calls.push({ rpcName, args, options });
          return { data: [validMemoryRow()], error: null };
        },
      };
    },
  };

  const memory = await readPlatformConversationAiMemory(actor(), CONVERSATION_ID, {
    client,
    env: { EVO_PLATFORM_AI_MEMORY_ENABLED: "1" },
  });
  assert.equal(memory.conversationId, CONVERSATION_ID);
  assert.deepEqual(calls, [
    {
      rpcName: "staff_conversation_ai_memory",
      args: {
        p_organization_id: ORGANIZATION_ID,
        p_conversation_id: CONVERSATION_ID,
      },
      options: { get: true },
    },
  ]);
});

test("UI contract exposes stable P5F1 controls without resume/autonomy or a raw query field", async () => {
  const [cardSource, actionsSource, repositorySource] = await Promise.all([
    readFile(
      new URL(
        "../src/components/platform/communications/PlatformAiMemoryCard.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../src/lib/platform-ai-memory-actions.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../src/lib/server/platform-ai-memory-repository.ts", import.meta.url),
      "utf8",
    ),
  ]);

  for (const testId of [
    "platform-ai-memory-card",
    "platform-ai-memory-control-state",
    "platform-ai-memory-fact-form",
    "platform-ai-memory-summary-source",
    "platform-ai-memory-fact-source",
    "platform-ai-memory-qualification-source",
    "platform-ai-memory-fact-key",
    "platform-ai-memory-fact-value",
    "platform-ai-memory-fact-save",
    "platform-ai-memory-qualification-form",
    "platform-ai-memory-qualification-state",
    "platform-ai-memory-qualification-save",
    "platform-ai-memory-control-pause",
    "platform-ai-memory-control-staff-takeover",
    "platform-ai-memory-control-staff-only",
    "platform-ai-memory-lexical-preview",
    "platform-ai-memory-retrieval-evidence",
  ]) {
    assert.match(cardSource, new RegExp(testId));
  }
  assert.doesNotMatch(cardSource, /\bResume\b|resumeAutonomy|rawQuery|p_query/);
  assert.match(cardSource, /data-control-state/);
  assert.match(cardSource, /data-retrieval-mode/);
  assert.match(cardSource, /data-retrieval-outcome/);
  assert.match(cardSource, /data-provider-proof-state/);
  assert.match(actionsSource, /requirePlatformMessagingActor/);
  assert.equal(
    actionsSource.match(/field\(formData, "sourceMessageId"\)/g)?.length,
    3,
  );
  assert.match(
    actionsSource,
    /message\.id === canonicalSelectedId && message\.direction === "inbound"/,
  );
  assert.doesNotMatch(actionsSource, /sourceMessageId:\s*field\(/);
  assert.match(repositorySource, /EVO_PLATFORM_AI_MEMORY_ENABLED/);
  assert.match(repositorySource, /===\s*["']1["']/);
});

test("approved knowledge chunk validation uses parse-safe PostgreSQL offsets", async () => {
  const migrationSource = await readFile(
    new URL(
      "../supabase/migrations/065_platform_ai_memory_retrieval.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const authorizationSource = await readFile(
    new URL(
      "../supabase/tests/platform_ai_memory_retrieval_rls.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    migrationSource,
    /pg_catalog\.substr\(\s*knowledge_row\.content_text,\s*start_offset \+ 1,\s*end_offset - start_offset\s*\)/,
  );
  assert.doesNotMatch(
    migrationSource,
    /pg_catalog\.substring\([\s\S]*?FROM start_offset \+ 1/,
  );
  assert.doesNotMatch(
    migrationSource,
    /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+platform\.role_bundle_versions/i,
  );
  assert.doesNotMatch(
    migrationSource,
    /INSERT\s+INTO\s+platform\.permission_definitions/i,
  );
  assert.match(
    authorizationSource,
    /array_agg\(bundle\.role ORDER BY bundle\.role::TEXT\)/,
  );
  assert.equal(
    authorizationSource.match(/(?:11|90|12|100)::SMALLINT/g)?.length,
    4,
  );
  assert.match(
    authorizationSource,
    /COALESCE\(pg_catalog\.max\(knowledge\.version\), 0::BIGINT\)/,
  );
  assert.doesNotMatch(authorizationSource, /pg_catalog\.coalesce/i);
});
