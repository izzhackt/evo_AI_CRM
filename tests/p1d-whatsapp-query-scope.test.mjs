import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const tempRoot = mkdtempSync(join(tmpdir(), "evo-p1d-whatsapp-query-"));
process.env.EVO_DB_PATH = join(tempRoot, "query-scope.db");
process.env.NODE_ENV = "production";
delete process.env.EVO_ALLOW_DEMO_SEED;

const jiti = createJiti(import.meta.url);
const queries = await jiti.import("../src/lib/queries.ts");
const { db } = await jiti.import("../src/lib/db.ts");
const database = db();

after(() => {
  if (database.open) database.close();
  rmSync(tempRoot, { recursive: true, force: true });
});

const actors = {
  admin: { id: 1, role: "admin" },
  salesA: { id: 10, role: "sales" },
  salesB: { id: 11, role: "sales" },
  curatorA: { id: 20, role: "curator" },
  curatorB: { id: 21, role: "curator" },
  finance: { id: 30, role: "finance" },
  student: { id: 40, role: "client" },
};

const requiredExports = [
  "listConversationsForActor",
  "getConversationForActor",
  "waMessagesForActor",
  "getConversationForLeadForActor",
  "listLeadsForActor",
  "getLeadForActor",
  "salesCockpitStatsForActor",
];

const missingExports = requiredExports.filter(
  (name) => typeof queries[name] !== "function",
);
const queryContractReady = missingExports.length === 0;
const contractTestOptions = {
  skip: queryContractReady
    ? false
    : `future P1D query exports are missing: ${missingExports.join(", ")}`,
};

const conversationFixtures = [
  { id: 301, lead_id: 201, client_id: null, unread: 2 },
  { id: 302, lead_id: null, client_id: 1001, unread: 3 },
  { id: 303, lead_id: 202, client_id: 1001, unread: 4 },
  { id: 304, lead_id: null, client_id: 1002, unread: 5 },
  { id: 305, lead_id: null, client_id: 1002, unread: 6 },
  { id: 306, lead_id: 203, client_id: 1002, unread: 7 },
  { id: 307, lead_id: null, client_id: 1003, unread: 8 },
  { id: 308, lead_id: 206, client_id: null, unread: 9 },
  { id: 309, lead_id: null, client_id: null, unread: 10 },
  { id: 310, lead_id: 204, client_id: null, unread: 11 },
  { id: 311, lead_id: 205, client_id: 1001, unread: 12 },
  { id: 312, lead_id: null, client_id: 9992, unread: 13 },
  { id: 313, lead_id: 9993, client_id: null, unread: 14 },
  { id: 314, lead_id: 9994, client_id: 1001, unread: 15 },
  { id: 315, lead_id: null, client_id: 1005, unread: 16 },
  { id: 316, lead_id: 208, client_id: null, unread: 17 },
  { id: 317, lead_id: null, client_id: 1006, unread: 18 },
  { id: 318, lead_id: null, client_id: 1007, unread: 19 },
].map((fixture, index) => ({
  ...fixture,
  last_message_at: `2026-01-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
}));

const pairedResponseMinutes = new Map([
  [301, 10],
  [303, 20],
  [304, 30],
  [306, 40],
  [307, 50],
  [308, 60],
  [310, 70],
]);

function installFixture(d) {
  const insertUsersAndCases = d.transaction(() => {
    const insertUser = d.prepare(`
      INSERT INTO users (id, email, password_hash, name, role)
      VALUES (@id, @email, 'fixture-password-hash', @name, @role)
    `);
    for (const user of [
      { id: 1, email: "admin@example.test", name: "Admin", role: "admin" },
      { id: 10, email: "sales-a@example.test", name: "Sales A", role: "sales" },
      { id: 11, email: "sales-b@example.test", name: "Sales B", role: "sales" },
      { id: 20, email: "curator-a@example.test", name: "Curator A", role: "curator" },
      { id: 21, email: "curator-b@example.test", name: "Curator B", role: "curator" },
      { id: 30, email: "finance@example.test", name: "Finance", role: "finance" },
      { id: 40, email: "student-actor@example.test", name: "Student Actor", role: "client" },
      { id: 101, email: "pending@example.test", name: "Pending Student", role: "client" },
      { id: 102, email: "active@example.test", name: "Active Student", role: "client" },
      { id: 103, email: "closed@example.test", name: "Closed Student", role: "client" },
      { id: 104, email: "other-pending@example.test", name: "Other Pending Student", role: "client" },
      { id: 105, email: "ownerless@example.test", name: "Ownerless Student", role: "client" },
      { id: 106, email: "invalid-state@example.test", name: "Invalid State Student", role: "client" },
      { id: 107, email: "wrong-owner-role@example.test", name: "Wrong Owner Role Student", role: "client" },
    ]) {
      insertUser.run(user);
    }

    d.prepare(`
      INSERT INTO wa_accounts (
        id, provider, name, session_name, phone, status, owner_user_id, is_default
      ) VALUES (
        1, 'waha', 'Fixture provider', 'fixture-session', '+996700000000',
        'connected', 1, 1
      )
    `).run();

    const insertClient = d.prepare(`
      INSERT INTO clients (
        id, user_id, stage, manager_id, curator_id, source,
        target_country, target_degree, notes, case_state,
        contract_confirmed_at, contract_confirmation_ref,
        portal_activated_at, handoff_at, closed_at
      ) VALUES (
        @id, @user_id, @stage, @manager_id, @curator_id, 'fixture',
        @target_country, @target_degree, 'fixture case', @case_state,
        @contract_confirmed_at, @contract_confirmation_ref,
        @portal_activated_at, @handoff_at, @closed_at
      )
    `);
    for (const client of [
      {
        id: 1001,
        user_id: 101,
        stage: "consultation",
        manager_id: 10,
        curator_id: null,
        target_country: "United Kingdom",
        target_degree: "Foundation",
        case_state: "pending",
        contract_confirmed_at: null,
        contract_confirmation_ref: null,
        portal_activated_at: null,
        handoff_at: null,
        closed_at: null,
      },
      {
        id: 1002,
        user_id: 102,
        stage: "applying",
        manager_id: 10,
        curator_id: 20,
        target_country: "Germany",
        target_degree: "Bachelor",
        case_state: "active",
        contract_confirmed_at: "2026-01-02T08:00:00.000Z",
        contract_confirmation_ref: "fixture-contract-active",
        portal_activated_at: "2026-01-02T09:00:00.000Z",
        handoff_at: "2026-01-02T10:00:00.000Z",
        closed_at: null,
      },
      {
        id: 1003,
        user_id: 103,
        stage: "enrolled",
        manager_id: 10,
        curator_id: 20,
        target_country: "United States",
        target_degree: "Master",
        case_state: "closed",
        contract_confirmed_at: "2026-01-03T08:00:00.000Z",
        contract_confirmation_ref: "fixture-contract-closed",
        portal_activated_at: "2026-01-03T09:00:00.000Z",
        handoff_at: "2026-01-03T10:00:00.000Z",
        closed_at: "2026-02-03T10:00:00.000Z",
      },
      {
        id: 1004,
        user_id: 104,
        stage: "consultation",
        manager_id: 11,
        curator_id: null,
        target_country: "Canada",
        target_degree: "Bachelor",
        case_state: "pending",
        contract_confirmed_at: null,
        contract_confirmation_ref: null,
        portal_activated_at: null,
        handoff_at: null,
        closed_at: null,
      },
      {
        id: 1005,
        user_id: 105,
        stage: "consultation",
        manager_id: null,
        curator_id: null,
        target_country: "Türkiye",
        target_degree: "Bachelor",
        case_state: "pending",
        contract_confirmed_at: null,
        contract_confirmation_ref: null,
        portal_activated_at: null,
        handoff_at: null,
        closed_at: null,
      },
    ]) {
      insertClient.run(client);
    }

    const insertLead = d.prepare(`
      INSERT INTO leads (
        id, name, phone, source, status, currency, manager_id, client_id,
        target_country, notes, created_at, updated_at
      ) VALUES (
        @id, @name, @phone, 'fixture', 'processing_mp', 'KGS',
        @manager_id, @client_id, @target_country, 'fixture lead',
        '2025-12-01T00:00:00.000Z', '2025-12-01T00:00:00.000Z'
      )
    `);
    for (const lead of [
      { id: 201, name: "Lead only A", phone: "+996555000201", manager_id: 10, client_id: null, target_country: "Germany" },
      { id: 202, name: "Pending linked A", phone: "+996555000202", manager_id: 10, client_id: 1001, target_country: "United Kingdom" },
      { id: 203, name: "Active linked A", phone: "+996555000203", manager_id: 10, client_id: 1002, target_country: "Germany" },
      { id: 204, name: "Indirect active A", phone: "+996555000204", manager_id: 10, client_id: 1002, target_country: "Germany" },
      { id: 205, name: "Conflicting active A", phone: "+996555000205", manager_id: 10, client_id: 1002, target_country: "Germany" },
      { id: 206, name: "Lead only B", phone: "+996555000206", manager_id: 11, client_id: null, target_country: "Canada" },
      { id: 208, name: "Ownerless lead", phone: "+996555000208", manager_id: null, client_id: null, target_country: "Türkiye" },
    ]) {
      insertLead.run(lead);
    }
  });
  insertUsersAndCases();

  d.exec(`
    DROP TRIGGER clients_case_state_insert_guard;
    DROP TRIGGER clients_curator_insert_guard;
  `);
  d.prepare(`
    INSERT INTO clients (
      id, user_id, stage, manager_id, curator_id, source,
      target_country, target_degree, notes, case_state
    ) VALUES (
      1006, 106, 'consultation', 10, NULL, 'fixture',
      'France', 'Bachelor', 'fixture invalid lifecycle', 'paused'
    )
  `).run();
  d.prepare(`
    INSERT INTO clients (
      id, user_id, stage, manager_id, curator_id, source,
      target_country, target_degree, notes, case_state,
      contract_confirmed_at, contract_confirmation_ref,
      portal_activated_at, handoff_at
    ) VALUES (
      1007, 107, 'applying', 10, 30, 'fixture',
      'Belgium', 'Bachelor', 'fixture wrong owner role', 'active',
      '2026-01-07T08:00:00.000Z', 'fixture-contract-wrong-owner-role',
      '2026-01-07T09:00:00.000Z', '2026-01-07T10:00:00.000Z'
    )
  `).run();

  d.pragma("foreign_keys = OFF");
  const insertConversations = d.transaction(() => {
    const insertConversation = d.prepare(`
      INSERT INTO wa_conversations (
        id, wa_account_id, phone, name, lead_id, client_id,
        amo_lead_id, amo_contact_id, agent_state, agent_summary,
        agent_handoff_reason, agent_draft_review_text,
        agent_draft_review_status, agent_draft_review_provider,
        agent_draft_review_model, agent_last_synced_at,
        last_message_at, unread
      ) VALUES (
        @id, 1, @phone, @name, @lead_id, @client_id,
        @amo_lead_id, @amo_contact_id, 'fixture-agent-state',
        @agent_summary, 'fixture-secret-handoff',
        'fixture-secret-draft', 'pending', 'fixture-provider',
        'fixture-model', '2026-02-28T00:00:00.000Z',
        @last_message_at, @unread
      )
    `);
    for (const fixture of conversationFixtures) {
      insertConversation.run({
        ...fixture,
        phone: `+996700000${fixture.id}`,
        name: `Conversation ${fixture.id}`,
        amo_lead_id: 900000 + fixture.id,
        amo_contact_id: 800000 + fixture.id,
        agent_summary: `fixture-secret-summary-${fixture.id}`,
      });
    }
  });
  insertConversations();
  d.pragma("foreign_keys = ON");

  const insertMessages = d.transaction(() => {
    const insertMessage = d.prepare(`
      INSERT INTO wa_messages (
        id, conversation_id, direction, text, status, author_id, wa_id, created_at
      ) VALUES (
        @id, @conversation_id, @direction, @text, 'sent',
        @author_id, @wa_id, @created_at
      )
    `);
    for (const [index, fixture] of conversationFixtures.entries()) {
      const incomingAt = new Date(
        Date.UTC(2026, 1, index + 1, 10, 0, 0),
      ).toISOString();
      insertMessage.run({
        id: 1000 + fixture.id,
        conversation_id: fixture.id,
        direction: "in",
        text: `private incoming ${fixture.id}`,
        author_id: null,
        wa_id: `fixture-in-${fixture.id}`,
        created_at: incomingAt,
      });

      const responseMinutes = pairedResponseMinutes.get(fixture.id);
      if (responseMinutes !== undefined) {
        insertMessage.run({
          id: 2000 + fixture.id,
          conversation_id: fixture.id,
          direction: "out",
          text: `private outgoing ${fixture.id}`,
          author_id: fixture.id === 308 ? 11 : 10,
          wa_id: `fixture-out-${fixture.id}`,
          created_at: new Date(
            new Date(incomingAt).getTime() + responseMinutes * 60_000,
          ).toISOString(),
        });
      }
    }
  });
  insertMessages();
}

installFixture(database);

function sortedIds(rows) {
  return rows.map((row) => row.id).sort((a, b) => a - b);
}

function summaryForCase(summaries, id) {
  return summaries.find((summary) => summary.id === id);
}

function leadForId(leads, id) {
  const lead = leads.find((row) => row.id === id);
  assert.ok(lead, `expected actor-aware lead ${id}`);
  return lead;
}

function leadWhatsAppMetrics(row) {
  return {
    last_wa_at: row.last_wa_at,
    last_touch_at: row.last_touch_at,
    last_channel: row.last_channel,
    wa_message_count: row.wa_message_count,
    unread_messages: row.unread_messages,
  };
}

function channelWhatsAppMetrics(stats) {
  return {
    incomingMessages: stats.channelActivity.incomingMessages,
    outgoingMessages: stats.channelActivity.outgoingMessages,
    unreadConversations: stats.channelActivity.unreadConversations,
    avgResponseMinutes: stats.channelActivity.avgResponseMinutes,
  };
}

function assertSuppressed(value, label) {
  assert.ok(
    value === null || value === undefined,
    `${label} must be null or omitted when the actor has no full conversation scope`,
  );
}

test("queries expose the planned actor-aware P1D WhatsApp seam", () => {
  assert.deepEqual(
    missingExports,
    [],
    `src/lib/queries.ts is missing: ${missingExports.join(", ")}`,
  );
});

test(
  "conversation lists partition full rows and safe post-handoff summaries by actor",
  contractTestOptions,
  async () => {
    const admin = await queries.listConversationsForActor(actors.admin);
    assert.deepEqual(Object.keys(admin).sort(), ["full", "summaries"]);
    assert.deepEqual(
      sortedIds(admin.full),
      conversationFixtures.map((row) => row.id),
    );
    assert.deepEqual(admin.summaries, []);

    const salesA = await queries.listConversationsForActor(actors.salesA);
    assert.deepEqual(sortedIds(salesA.full), [301, 302, 303]);
    assert.deepEqual(
      sortedIds(salesA.summaries),
      [1002, 1003],
      "active and closed cases are summary-only and duplicate conversations collapse by case",
    );

    const curatorA = await queries.listConversationsForActor(actors.curatorA);
    assert.deepEqual(sortedIds(curatorA.full), [304, 305, 306, 307]);
    assert.deepEqual(curatorA.summaries, []);

    const salesB = await queries.listConversationsForActor(actors.salesB);
    assert.deepEqual(sortedIds(salesB.full), [308]);
    assert.deepEqual(salesB.summaries, []);

    for (const actor of [
      actors.curatorB,
      actors.finance,
      actors.student,
    ]) {
      assert.deepEqual(
        await queries.listConversationsForActor(actor),
        { full: [], summaries: [] },
      );
    }
  },
);

test(
  "summary list authorization never starts from an unscoped conversation probe",
  contractTestOptions,
  async () => {
    const preparedSql = [];
    const originalPrepare = database.prepare;
    database.prepare = function auditedPrepare(source) {
      preparedSql.push(String(source));
      return originalPrepare.call(this, source);
    };
    try {
      await queries.listConversationsForActor(actors.salesA);
    } finally {
      delete database.prepare;
    }

    const probeStatements = preparedSql.filter(
      (source) =>
        source.includes("conversation.id AS conversation_id")
        && source.includes("FROM wa_conversations conversation"),
    );
    assert.ok(probeStatements.length > 0, "expected an actor-scoped full-access probe");
    for (const source of probeStatements) {
      assert.match(
        source,
        /\bWHERE\b/,
        "list authorization must not materialize every conversation before actor scoping",
      );
    }
  },
);

test(
  "full detail, transcript and lead lookup require full conversation access",
  contractTestOptions,
  async () => {
    const salesLeadOnly = await queries.getConversationForActor(actors.salesA, 301);
    assert.equal(salesLeadOnly.id, 301);
    assert.equal(salesLeadOnly.phone, "+996700000301");
    assert.equal(salesLeadOnly.agent_summary, "fixture-secret-summary-301");

    const salesPending = await queries.getConversationForActor(actors.salesA, 303);
    assert.equal(salesPending.id, 303);
    assert.equal(
      (await queries.getConversationForLeadForActor(actors.salesA, 202)).id,
      303,
    );
    assert.deepEqual(
      sortedIds(await queries.waMessagesForActor(actors.salesA, 303)),
      [1303, 2303],
    );

    for (const conversationId of [304, 305, 306, 307]) {
      assert.equal(
        await queries.getConversationForActor(actors.salesA, conversationId),
        undefined,
      );
      assert.deepEqual(
        await queries.waMessagesForActor(actors.salesA, conversationId),
        [],
      );
    }
    assert.equal(
      await queries.getConversationForLeadForActor(actors.salesA, 203),
      undefined,
    );

    assert.equal(
      (await queries.getConversationForActor(actors.curatorA, 306)).id,
      306,
    );
    assert.equal(
      (await queries.getConversationForLeadForActor(actors.curatorA, 203)).id,
      306,
    );
    assert.deepEqual(
      sortedIds(await queries.waMessagesForActor(actors.curatorA, 306)),
      [1306, 2306],
    );
    assert.equal(
      (await queries.getConversationForActor(actors.curatorA, 307)).id,
      307,
    );
    assert.deepEqual(
      sortedIds(await queries.waMessagesForActor(actors.curatorA, 307)),
      [1307, 2307],
    );

    for (const conversationId of [301, 302, 303, 308]) {
      assert.equal(
        await queries.getConversationForActor(actors.curatorA, conversationId),
        undefined,
      );
    }

    for (const actor of [
      actors.salesB,
      actors.curatorB,
      actors.finance,
      actors.student,
    ]) {
      assert.equal(
        await queries.getConversationForActor(actor, 302),
        undefined,
      );
      assert.equal(
        await queries.getConversationForActor(actor, 307),
        undefined,
      );
      assert.deepEqual(await queries.waMessagesForActor(actor, 302), []);
      assert.deepEqual(await queries.waMessagesForActor(actor, 307), []);
    }
  },
);

test(
  "unlinked, indirect, conflicting, dangling, broken, invalid and ownerless rows are Admin-only",
  contractTestOptions,
  async () => {
    const malformedIds = [309, 310, 311, 312, 313, 314, 315, 316, 317, 318];
    const nonAdminActors = [
      actors.salesA,
      actors.salesB,
      actors.curatorA,
      actors.curatorB,
      actors.finance,
      actors.student,
    ];

    for (const conversationId of malformedIds) {
      assert.equal(
        (await queries.getConversationForActor(actors.admin, conversationId)).id,
        conversationId,
      );
      assert.deepEqual(
        sortedIds(await queries.waMessagesForActor(actors.admin, conversationId)),
        [1000 + conversationId, ...(pairedResponseMinutes.has(conversationId)
          ? [2000 + conversationId]
          : [])],
      );

      for (const actor of nonAdminActors) {
        assert.equal(
          await queries.getConversationForActor(actor, conversationId),
          undefined,
        );
        assert.deepEqual(
          await queries.waMessagesForActor(actor, conversationId),
          [],
        );
      }
    }

    assert.equal(
      await queries.getConversationForLeadForActor(actors.salesA, 204),
      undefined,
      "an indirect lead-to-case path must not prove conversation ownership",
    );
    assert.equal(
      await queries.getConversationForLeadForActor(actors.salesA, 205),
      undefined,
      "conflicting direct and lead case links must fail closed",
    );
  },
);

test(
  "Sales summaries have exactly seven safe case keys and ignore hidden activity or multiplicity",
  contractTestOptions,
  async () => {
    const before = (await queries.listConversationsForActor(actors.salesA)).summaries;
    assert.equal(before.length, 2);

    const expectedKeys = [
      "case_state",
      "curator_name",
      "handoff_at",
      "id",
      "name",
      "target_country",
      "target_degree",
    ];
    for (const summary of before) {
      assert.deepEqual(Object.keys(summary).sort(), expectedKeys);
    }

    assert.deepEqual(summaryForCase(before, 1002), {
      id: 1002,
      name: "Active Student",
      target_country: "Germany",
      target_degree: "Bachelor",
      case_state: "active",
      curator_name: "Curator A",
      handoff_at: "2026-01-02T10:00:00.000Z",
    });
    assert.deepEqual(summaryForCase(before, 1003), {
      id: 1003,
      name: "Closed Student",
      target_country: "United States",
      target_degree: "Master",
      case_state: "closed",
      curator_name: "Curator A",
      handoff_at: "2026-01-03T10:00:00.000Z",
    });

    database.exec("SAVEPOINT p1d_summary_activity");
    try {
      database.prepare(`
        UPDATE wa_conversations
        SET last_message_at = '2035-01-01T00:00:00.000Z',
          unread = 999,
          agent_summary = 'changed hidden summary'
        WHERE client_id = 1002
      `).run();
      database.prepare(`
        UPDATE wa_conversations
        SET last_message_at = '2001-01-01T00:00:00.000Z'
        WHERE client_id = 1003
      `).run();
      database.prepare(`
        INSERT INTO wa_conversations (
          id, wa_account_id, phone, name, client_id, last_message_at, unread,
          agent_summary
        ) VALUES (
          399, 1, '+996700000399', 'Extra hidden conversation', 1002,
          '2040-01-01T00:00:00.000Z', 500, 'extra hidden summary'
        )
      `).run();
      database.prepare(`
        INSERT INTO wa_messages (
          id, conversation_id, direction, text, status, wa_id, created_at
        ) VALUES (
          1399, 399, 'in', 'extra hidden message', 'sent',
          'fixture-extra-hidden', '2040-01-01T00:00:00.000Z'
        )
      `).run();

      const afterHiddenChanges = (
        await queries.listConversationsForActor(actors.salesA)
      ).summaries;
      assert.deepEqual(
        afterHiddenChanges,
        before,
        "summary rows and ordering must depend only on the seven allowlisted case fields",
      );
    } finally {
      database.exec(
        "ROLLBACK TO p1d_summary_activity; RELEASE p1d_summary_activity",
      );
    }
  },
);

test(
  "actor-aware lead queries null denied or summary-only WhatsApp metrics",
  contractTestOptions,
  async () => {
    const salesLeads = await queries.listLeadsForActor(actors.salesA);
    assert.deepEqual(
      leadWhatsAppMetrics(leadForId(salesLeads, 201)),
      {
        last_wa_at: "2026-01-01T12:00:00.000Z",
        last_touch_at: "2026-01-01T12:00:00.000Z",
        last_channel: "WhatsApp",
        wa_message_count: 2,
        unread_messages: 2,
      },
    );
    assert.deepEqual(
      leadWhatsAppMetrics(leadForId(salesLeads, 202)),
      {
        last_wa_at: "2026-01-03T12:00:00.000Z",
        last_touch_at: "2026-01-03T12:00:00.000Z",
        last_channel: "WhatsApp",
        wa_message_count: 2,
        unread_messages: 4,
      },
    );
    assert.deepEqual(
      leadWhatsAppMetrics(leadForId(salesLeads, 203)),
      {
        last_wa_at: null,
        last_touch_at: "2025-12-01T00:00:00.000Z",
        last_channel: null,
        wa_message_count: null,
        unread_messages: null,
      },
      "former Sales must not receive active-case conversation recency or counts",
    );
    assert.deepEqual(
      leadWhatsAppMetrics(leadForId(salesLeads, 204)),
      {
        last_wa_at: null,
        last_touch_at: "2025-12-01T00:00:00.000Z",
        last_channel: null,
        wa_message_count: null,
        unread_messages: null,
      },
      "an indirect lead-to-case conversation remains denied",
    );
    assert.deepEqual(
      leadWhatsAppMetrics(leadForId(salesLeads, 205)),
      {
        last_wa_at: null,
        last_touch_at: "2025-12-01T00:00:00.000Z",
        last_channel: null,
        wa_message_count: null,
        unread_messages: null,
      },
      "conflicting links remain denied",
    );

    assert.deepEqual(
      leadWhatsAppMetrics(await queries.getLeadForActor(actors.salesA, 203)),
      leadWhatsAppMetrics(leadForId(salesLeads, 203)),
      "list and detail callers must apply the same metric suppression",
    );

    assert.deepEqual(
      leadWhatsAppMetrics(await queries.getLeadForActor(actors.admin, 203)),
      {
        last_wa_at: "2026-01-06T12:00:00.000Z",
        last_touch_at: "2026-01-06T12:00:00.000Z",
        last_channel: "WhatsApp",
        wa_message_count: 2,
        unread_messages: 7,
      },
    );
  },
);

test(
  "sales cockpit WhatsApp aggregates include only conversations with full actor scope",
  contractTestOptions,
  async () => {
    const admin = await queries.salesCockpitStatsForActor(actors.admin);
    assert.deepEqual(channelWhatsAppMetrics(admin), {
      incomingMessages: 18,
      outgoingMessages: 7,
      unreadConversations: 189,
      avgResponseMinutes: 40,
    });
    assert.equal(
      admin.managerRows.find((row) => row.id === 10).messages,
      6,
    );
    assert.equal(
      admin.managerRows.find((row) => row.id === 11).messages,
      1,
    );

    const salesA = await queries.salesCockpitStatsForActor(actors.salesA);
    assert.deepEqual(channelWhatsAppMetrics(salesA), {
      incomingMessages: 3,
      outgoingMessages: 2,
      unreadConversations: 9,
      avgResponseMinutes: 15,
    });
    assert.equal(
      salesA.managerRows.reduce(
        (total, row) => total + (row.messages ?? 0),
        0,
      ),
      2,
      "manager message aggregates must exclude handed-off and malformed conversations",
    );

    const curatorA = await queries.salesCockpitStatsForActor(actors.curatorA);
    assert.deepEqual(channelWhatsAppMetrics(curatorA), {
      incomingMessages: 4,
      outgoingMessages: 3,
      unreadConversations: 26,
      avgResponseMinutes: 40,
    });

    const salesB = await queries.salesCockpitStatsForActor(actors.salesB);
    assert.deepEqual(channelWhatsAppMetrics(salesB), {
      incomingMessages: 1,
      outgoingMessages: 1,
      unreadConversations: 9,
      avgResponseMinutes: 60,
    });

    for (const actor of [actors.finance, actors.student]) {
      const denied = await queries.salesCockpitStatsForActor(actor);
      for (const [key, value] of Object.entries(
        channelWhatsAppMetrics(denied),
      )) {
        assertSuppressed(value, `channelActivity.${key}`);
      }
      for (const row of denied.managerRows) {
        assertSuppressed(row.messages, `managerRows[${row.id}].messages`);
      }
    }
  },
);
