import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

const databasePath =
  process.env.EVO_PLAYWRIGHT_DB_PATH
  ?? path.join(process.cwd(), "output", "playwright", "runtime", "edu-admin-e2e.db");

const SALES_EMAIL = "p1d.sales@example.test";
const OTHER_SALES_EMAIL = "p1d.other.sales@example.test";
const CURATOR_EMAIL = "p1d.curator@example.test";
const OTHER_CURATOR_EMAIL = "p1d.other.curator@example.test";
const CREATED_LEAD_NAME = "P1D Forged Manager Create";
const STALE_CREATE_PHONE = "+996700889991";
const SUMMARY_FIELDS = [
  "case-id",
  "student-name",
  "target-country",
  "target-degree",
  "case-state",
  "curator-name",
  "handoff-at",
] as const;

type ConversationKey =
  | "leadOnly"
  | "pendingDirect"
  | "activeDirect"
  | "activeConsistent"
  | "closedDirect"
  | "conflicting"
  | "indirect"
  | "brokenLead"
  | "brokenClient"
  | "danglingCase"
  | "invalidCase"
  | "unlinked"
  | "ownerless";

type ConversationFixture = {
  id: number;
  name: string;
  phone: string;
  secret: string;
};

type Fixture = {
  users: {
    sales: number;
    otherSales: number;
    curator: number;
    otherCurator: number;
  };
  clients: {
    pending: number;
    active: number;
    closed: number;
    invalid: number;
    ownerless: number;
  };
  leads: {
    leadOnly: number;
    activeConsistent: number;
    conflicting: number;
    indirect: number;
    danglingCase: number;
    ownerless: number;
    managerMutation: number;
  };
  conversations: Record<ConversationKey, ConversationFixture>;
  baseUnread: Array<{ id: number; unread: number }>;
};

let fixture: Fixture;

function desktopOnly(testInfo: TestInfo) {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "stateful P1D authorization coverage runs once",
  );
}

function openDatabase() {
  return new Database(databasePath, { fileMustExist: true });
}

function recreateCaseStateInsertGuard(database: Database.Database) {
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS clients_case_state_insert_guard
    BEFORE INSERT ON clients
    WHEN NEW.case_state NOT IN ('pending', 'active', 'closed')
    BEGIN
      SELECT RAISE(ABORT, 'unsupported student case state');
    END;
  `);
}

function recreateCaseTransitionGuard(database: Database.Database) {
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS clients_case_transition_guard
    BEFORE UPDATE OF case_state ON clients
    WHEN OLD.case_state <> NEW.case_state
      AND NOT (
        (OLD.case_state = 'pending' AND NEW.case_state = 'active')
        OR (OLD.case_state = 'active' AND NEW.case_state = 'closed')
        OR (OLD.case_state = 'closed' AND NEW.case_state = 'active')
      )
    BEGIN
      SELECT RAISE(ABORT, 'unsupported student case transition');
    END;
  `);
}

function deleteFixtureRows(database: Database.Database) {
  database.pragma("foreign_keys = OFF");
  database.transaction(() => {
    database.prepare(`
      DELETE FROM wa_messages
      WHERE conversation_id IN (
        SELECT id FROM wa_conversations WHERE name LIKE 'P1D %'
      )
    `).run();
    database.prepare("DELETE FROM wa_conversations WHERE name LIKE 'P1D %'").run();
    database.prepare("DELETE FROM lead_activities WHERE lead_id IN (SELECT id FROM leads WHERE name LIKE 'P1D %')").run();
    database.prepare("DELETE FROM tasks WHERE lead_id IN (SELECT id FROM leads WHERE name LIKE 'P1D %')").run();
    database.prepare("DELETE FROM calls WHERE lead_id IN (SELECT id FROM leads WHERE name LIKE 'P1D %')").run();
    database.prepare("DELETE FROM leads WHERE name LIKE 'P1D %'").run();
    database.prepare(`
      DELETE FROM student_case_audit
      WHERE client_id IN (
        SELECT c.id
        FROM clients c
        JOIN users u ON u.id = c.user_id
        WHERE lower(u.email) LIKE 'p1d.%@example.test'
      )
    `).run();
    database.prepare(`
      DELETE FROM clients
      WHERE user_id IN (
        SELECT id FROM users WHERE lower(email) LIKE 'p1d.%@example.test'
      )
    `).run();
    database.prepare("DELETE FROM users WHERE lower(email) LIKE 'p1d.%@example.test'").run();
  })();
  database.pragma("foreign_keys = ON");
}

function prepareFixtures(): Fixture {
  const database = openDatabase();
  try {
    deleteFixtureRows(database);

    const baseUnread = database.prepare(`
      SELECT id, unread
      FROM wa_conversations
      ORDER BY id
    `).all() as Array<{ id: number; unread: number }>;

    const hashes = database.prepare(`
      SELECT lower(email) AS email, password_hash
      FROM users
      WHERE lower(email) IN (
        'sales@demo.kg',
        'curator@demo.kg',
        'client@demo.kg'
      )
    `).all() as Array<{ email: string; password_hash: string }>;
    const passwordHash = new Map(hashes.map((row) => [row.email, row.password_hash]));
    const salesHash = passwordHash.get("sales@demo.kg");
    const curatorHash = passwordHash.get("curator@demo.kg");
    const clientHash = passwordHash.get("client@demo.kg");
    if (!salesHash || !curatorHash || !clientHash) {
      throw new Error("P1D fixtures require the standard synthetic demo users");
    }

    database.pragma("foreign_keys = OFF");
    const result = database.transaction(() => {
      database.prepare("UPDATE wa_conversations SET unread = 0").run();

      const insertUser = database.prepare(`
        INSERT INTO users (email, phone, password_hash, name, role)
        VALUES (?, ?, ?, ?, ?)
      `);
      const sales = Number(
        insertUser.run(
          SALES_EMAIL,
          "+996700880001",
          salesHash,
          "P1D Responsible Sales",
          "sales",
        ).lastInsertRowid,
      );
      const otherSales = Number(
        insertUser.run(
          OTHER_SALES_EMAIL,
          "+996700880002",
          salesHash,
          "P1D Other Sales",
          "sales",
        ).lastInsertRowid,
      );
      const curator = Number(
        insertUser.run(
          CURATOR_EMAIL,
          "+996700880003",
          curatorHash,
          "P1D Assigned Curator",
          "curator",
        ).lastInsertRowid,
      );
      const otherCurator = Number(
        insertUser.run(
          OTHER_CURATOR_EMAIL,
          "+996700880004",
          curatorHash,
          "P1D Other Curator",
          "curator",
        ).lastInsertRowid,
      );

      const insertStudent = (email: string, phone: string, name: string) =>
        Number(insertUser.run(email, phone, clientHash, name, "client").lastInsertRowid);
      const pendingUser = insertStudent(
        "p1d.pending.student@example.test",
        "+996700881001",
        "P1D Pending Student",
      );
      const activeUser = insertStudent(
        "p1d.active.student@example.test",
        "+996700881002",
        "P1D Active Student",
      );
      const closedUser = insertStudent(
        "p1d.closed.student@example.test",
        "+996700881003",
        "P1D Closed Student",
      );
      const invalidUser = insertStudent(
        "p1d.invalid.student@example.test",
        "+996700881004",
        "P1D Invalid State Student",
      );
      const ownerlessUser = insertStudent(
        "p1d.ownerless.student@example.test",
        "+996700881005",
        "P1D Ownerless Student",
      );

      const insertClient = database.prepare(`
        INSERT INTO clients (
          user_id, stage, manager_id, curator_id, source,
          target_country, target_degree, notes, case_state,
          contract_confirmed_at, contract_confirmation_ref,
          portal_activated_at, handoff_at, closed_at
        ) VALUES (?, 'consultation', ?, ?, 'P1D synthetic', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const pending = Number(
        insertClient.run(
          pendingUser,
          sales,
          null,
          "Польша",
          "Бакалавриат",
          "P1D pending case private notes",
          "pending",
          null,
          null,
          null,
          null,
          null,
        ).lastInsertRowid,
      );
      const active = Number(
        insertClient.run(
          activeUser,
          sales,
          curator,
          "Германия",
          "Бакалавриат",
          "P1D active case private notes",
          "active",
          "2026-07-28T09:00:00.000Z",
          "synthetic:p1d-active-contract",
          "2026-07-28T12:00:00.000Z",
          "2026-07-28T12:00:00.000Z",
          null,
        ).lastInsertRowid,
      );
      const closed = Number(
        insertClient.run(
          closedUser,
          sales,
          curator,
          "Франция",
          "Магистратура",
          "P1D closed case private notes",
          "closed",
          "2026-07-28T09:30:00.000Z",
          "synthetic:p1d-closed-contract",
          "2026-07-28T13:00:00.000Z",
          "2026-07-28T13:00:00.000Z",
          "2026-07-28T15:00:00.000Z",
        ).lastInsertRowid,
      );
      const ownerless = Number(
        insertClient.run(
          ownerlessUser,
          null,
          null,
          "Италия",
          "Бакалавриат",
          "P1D ownerless private notes",
          "pending",
          null,
          null,
          null,
          null,
          null,
        ).lastInsertRowid,
      );

      database.exec("DROP TRIGGER IF EXISTS clients_case_state_insert_guard");
      let invalid: number;
      try {
        invalid = Number(
          insertClient.run(
            invalidUser,
            sales,
            curator,
            "Испания",
            "Магистратура",
            "P1D invalid lifecycle private notes",
            "paused",
            null,
            null,
            null,
            null,
            null,
          ).lastInsertRowid,
        );
      } finally {
        recreateCaseStateInsertGuard(database);
      }

      const insertLead = database.prepare(`
        INSERT INTO leads (
          name, phone, email, source, status, amount, currency,
          manager_id, client_id, target_country, notes, updated_at
        ) VALUES (?, ?, ?, 'P1D synthetic', ?, 12345, 'KGS', ?, ?, ?, ?, ?)
      `);
      const leadOnly = Number(
        insertLead.run(
          "P1D True Lead Only",
          "+996700882001",
          "p1d.lead.only@example.test",
          "qualified",
          sales,
          null,
          "Чехия",
          "P1D true lead-only notes",
          "2026-07-20T08:00:00.000Z",
        ).lastInsertRowid,
      );
      const activeConsistent = Number(
        insertLead.run(
          "P1D Post-Handoff Active Lead",
          "+996700882002",
          "p1d.active.lead@example.test",
          "meeting_scheduled",
          sales,
          active,
          "Германия",
          "P1D post-handoff lead notes",
          "2026-07-20T09:00:00.000Z",
        ).lastInsertRowid,
      );
      const conflicting = Number(
        insertLead.run(
          "P1D Conflicting Case Lead",
          "+996700882003",
          "p1d.conflict.lead@example.test",
          "qualified",
          sales,
          closed,
          "Франция",
          "P1D conflicting lead notes",
          "2026-07-20T10:00:00.000Z",
        ).lastInsertRowid,
      );
      const indirect = Number(
        insertLead.run(
          "P1D Indirect Case Lead",
          "+996700882004",
          "p1d.indirect.lead@example.test",
          "qualified",
          sales,
          active,
          "Германия",
          "P1D indirect lead notes",
          "2026-07-20T11:00:00.000Z",
        ).lastInsertRowid,
      );
      const danglingCase = Number(
        insertLead.run(
          "P1D Dangling Case Lead",
          "+996700882005",
          "p1d.dangling.lead@example.test",
          "qualified",
          sales,
          9_100_003,
          "Канада",
          "P1D dangling client link notes",
          "2026-07-20T12:00:00.000Z",
        ).lastInsertRowid,
      );
      const ownerlessLead = Number(
        insertLead.run(
          "P1D Ownerless Lead",
          "+996700882006",
          "p1d.ownerless.lead@example.test",
          "qualified",
          null,
          null,
          "Австрия",
          "P1D ownerless lead notes",
          "2026-07-20T13:00:00.000Z",
        ).lastInsertRowid,
      );
      const managerMutation = Number(
        insertLead.run(
          "P1D Manager Mutation Lead",
          "+996700882007",
          "p1d.manager.mutation@example.test",
          "qualified",
          sales,
          null,
          "Нидерланды",
          "P1D manager mutation baseline",
          "2026-07-20T14:00:00.000Z",
        ).lastInsertRowid,
      );

      const conversationDefinitions: Array<{
        key: ConversationKey;
        name: string;
        phone: string;
        leadId: number | null;
        clientId: number | null;
        lastMessageAt: string;
        unread: number;
        messageCount?: number;
      }> = [
        {
          key: "leadOnly",
          name: "P1D Lead Only Conversation",
          phone: "+996700883001",
          leadId: leadOnly,
          clientId: null,
          lastMessageAt: "2026-07-21T08:00:00.000Z",
          unread: 0,
        },
        {
          key: "pendingDirect",
          name: "P1D Pending Direct Conversation",
          phone: "+996700883002",
          leadId: null,
          clientId: pending,
          lastMessageAt: "2026-07-21T09:00:00.000Z",
          unread: 9,
        },
        {
          key: "activeDirect",
          name: "P1D Active Direct Conversation",
          phone: "+996700883003",
          leadId: null,
          clientId: active,
          lastMessageAt: "2040-01-01T00:00:00.000Z",
          unread: 444_440,
          messageCount: 13,
        },
        {
          key: "activeConsistent",
          name: "P1D Active Consistent Conversation",
          phone: "+996700883004",
          leadId: activeConsistent,
          clientId: active,
          lastMessageAt: "2035-12-31T23:59:00.000Z",
          unread: 333_330,
          messageCount: 117,
        },
        {
          key: "closedDirect",
          name: "P1D Closed Direct Conversation",
          phone: "+996700883005",
          leadId: null,
          clientId: closed,
          lastMessageAt: "2039-01-01T00:00:00.000Z",
          unread: 10,
        },
        {
          key: "conflicting",
          name: "P1D Conflicting Conversation",
          phone: "+996700883006",
          leadId: conflicting,
          clientId: active,
          lastMessageAt: "2041-01-01T00:00:00.000Z",
          unread: 0,
        },
        {
          key: "indirect",
          name: "P1D Indirect Conversation",
          phone: "+996700883007",
          leadId: indirect,
          clientId: null,
          lastMessageAt: "2042-01-01T00:00:00.000Z",
          unread: 0,
        },
        {
          key: "brokenLead",
          name: "P1D Broken Lead Conversation",
          phone: "+996700883008",
          leadId: 9_100_001,
          clientId: active,
          lastMessageAt: "2043-01-01T00:00:00.000Z",
          unread: 0,
        },
        {
          key: "brokenClient",
          name: "P1D Broken Client Conversation",
          phone: "+996700883009",
          leadId: null,
          clientId: 9_100_002,
          lastMessageAt: "2044-01-01T00:00:00.000Z",
          unread: 0,
        },
        {
          key: "danglingCase",
          name: "P1D Dangling Case Conversation",
          phone: "+996700883010",
          leadId: danglingCase,
          clientId: null,
          lastMessageAt: "2045-01-01T00:00:00.000Z",
          unread: 0,
        },
        {
          key: "invalidCase",
          name: "P1D Invalid Case Conversation",
          phone: "+996700883011",
          leadId: null,
          clientId: invalid,
          lastMessageAt: "2046-01-01T00:00:00.000Z",
          unread: 0,
        },
        {
          key: "unlinked",
          name: "P1D Unlinked Conversation",
          phone: "+996700883012",
          leadId: null,
          clientId: null,
          lastMessageAt: "2047-01-01T00:00:00.000Z",
          unread: 0,
        },
        {
          key: "ownerless",
          name: "P1D Ownerless Conversation",
          phone: "+996700883013",
          leadId: ownerlessLead,
          clientId: null,
          lastMessageAt: "2048-01-01T00:00:00.000Z",
          unread: 0,
        },
      ];

      const insertConversation = database.prepare(`
        INSERT INTO wa_conversations (
          phone, name, lead_id, client_id,
          amo_lead_id, amo_contact_id,
          agent_state, agent_summary, agent_handoff_reason,
          agent_draft_review_text, agent_draft_review_status,
          agent_draft_review_provider, agent_draft_review_model,
          agent_last_synced_at, last_message_at, unread
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?,
          'handoff_required', ?, 'p1d_private_reason',
          'P1D PRIVATE DRAFT', 'review_required',
          'p1d-provider', 'p1d-model',
          '2050-01-01T00:00:00.000Z', ?, ?
        )
      `);
      const insertMessage = database.prepare(`
        INSERT INTO wa_messages (
          conversation_id, direction, text, status, author_id, created_at
        ) VALUES (?, 'in', ?, 'received', NULL, ?)
      `);
      const conversations = {} as Record<ConversationKey, ConversationFixture>;

      for (const [definitionIndex, definition] of conversationDefinitions.entries()) {
        const secret = `P1D PRIVATE TRANSCRIPT ${definition.key}`;
        const inserted = insertConversation.run(
          definition.phone,
          definition.name,
          definition.leadId,
          definition.clientId,
          8_800_000 + definitionIndex,
          8_900_000 + definitionIndex,
          `P1D PRIVATE SUMMARY ${definition.key}`,
          definition.lastMessageAt,
          definition.unread,
        );
        const id = Number(inserted.lastInsertRowid);
        const messageCount = definition.messageCount ?? 1;
        for (let messageIndex = 0; messageIndex < messageCount; messageIndex += 1) {
          insertMessage.run(
            id,
            messageIndex === messageCount - 1
              ? secret
              : `${secret} hidden metric ${String(messageIndex + 1).padStart(3, "0")}`,
            `2026-07-22T00:${String(definitionIndex).padStart(2, "0")}:${String(messageIndex % 60).padStart(2, "0")}.000Z`,
          );
        }
        conversations[definition.key] = {
          id,
          name: definition.name,
          phone: definition.phone,
          secret,
        };
      }

      return {
        users: { sales, otherSales, curator, otherCurator },
        clients: { pending, active, closed, invalid, ownerless },
        leads: {
          leadOnly,
          activeConsistent,
          conflicting,
          indirect,
          danglingCase,
          ownerless: ownerlessLead,
          managerMutation,
        },
        conversations,
        baseUnread,
      } satisfies Fixture;
    })();
    database.pragma("foreign_keys = ON");
    return result;
  } finally {
    database.close();
  }
}

function cleanupFixtures() {
  const database = openDatabase();
  try {
    deleteFixtureRows(database);
    if (fixture?.baseUnread) {
      const restoreUnread = database.prepare(
        "UPDATE wa_conversations SET unread = ? WHERE id = ?",
      );
      database.transaction(() => {
        for (const row of fixture.baseUnread) {
          restoreUnread.run(row.unread, row.id);
        }
      })();
    }
  } finally {
    database.close();
  }
}

async function login(
  context: BrowserContext,
  page: Page,
  email: string,
  password: string,
  target: RegExp,
) {
  await context.clearCookies();
  await page.goto("/login");
  await page.getByLabel("Эл. почта").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await Promise.all([
    page.waitForURL(target),
    page.getByRole("button", { name: "Войти" }).click(),
  ]);
}

async function browserFetch(page: Page, url: string, init?: RequestInit) {
  return page.evaluate(
    async ({ requestUrl, requestInit }) => {
      const response = await fetch(requestUrl, requestInit);
      return {
        status: response.status,
        body: await response.text(),
      };
    },
    { requestUrl: url, requestInit: init },
  );
}

function conversationLink(page: Page, conversationId: number) {
  return page.locator(`a[href="/whatsapp/${conversationId}"]`);
}

function summaryRows(page: Page) {
  return page.getByTestId("whatsapp-handoff-summary");
}

async function expectFullConversation(
  page: Page,
  conversation: ConversationFixture,
) {
  const response = await page.goto(`/whatsapp/${conversation.id}`);
  expect(response?.status(), conversation.name).toBe(200);
  await expect(page.getByTestId("whatsapp-conversation")).toBeVisible();
  await expect(
    page.locator("[data-whatsapp-message]").getByText(conversation.secret, { exact: true }),
  ).toBeVisible();
}

async function expectConversationDenied(
  page: Page,
  conversation: ConversationFixture,
) {
  const response = await page.goto(`/whatsapp/${conversation.id}`);
  // Next.js can return 200 after a streamed route calls notFound(); the
  // rendered 404 boundary and absence of protected content are authoritative.
  expect([200, 404], conversation.name).toContain(response?.status());
  await expect(page.getByText("404", { exact: true })).toBeVisible();
  await expect(page.getByTestId("whatsapp-conversation")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(conversation.secret);
}

function transitionPendingCaseToActive() {
  const database = openDatabase();
  try {
    database.prepare(`
      UPDATE clients
      SET case_state = 'active',
          curator_id = ?,
          contract_confirmed_at = '2026-07-28T16:00:00.000Z',
          contract_confirmation_ref = 'synthetic:p1d-stale-handoff',
          portal_activated_at = '2026-07-28T16:05:00.000Z',
          handoff_at = '2026-07-28T16:05:00.000Z',
          closed_at = NULL
      WHERE id = ?
    `).run(fixture.users.curator, fixture.clients.pending);
  } finally {
    database.close();
  }
}

function restorePendingCase() {
  const database = openDatabase();
  try {
    database.exec("DROP TRIGGER IF EXISTS clients_case_transition_guard");
    try {
      database.prepare(`
        UPDATE clients
        SET case_state = 'pending',
            curator_id = NULL,
            contract_confirmed_at = NULL,
            contract_confirmation_ref = NULL,
            portal_activated_at = NULL,
            handoff_at = NULL,
            closed_at = NULL
        WHERE id = ?
      `).run(fixture.clients.pending);
    } finally {
      recreateCaseTransitionGuard(database);
    }
  } finally {
    database.close();
  }
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context, page }, testInfo) => {
  if (testInfo.project.name !== "desktop-chromium" || fixture) return;
  await login(context, page, "admin@demo.kg", "admin123", /\/dashboard$/);
  fixture = prepareFixtures();
});

test.afterAll(({}, workerInfo) => {
  if (workerInfo.project.name !== "desktop-chromium" || !fixture) return;
  cleanupFixtures();
});

test("Admin sees every queue row and full detail, including fail-closed association shapes", async ({
  context,
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  test.setTimeout(120_000);
  await login(context, page, "admin@demo.kg", "admin123", /\/dashboard$/);
  await page.goto("/whatsapp");

  await expect(page.locator("details#add")).toHaveCount(1);
  await expect(page.locator('a[href="/whatsapp#add"]')).toHaveCount(1);
  await expect(summaryRows(page)).toHaveCount(0);

  for (const conversation of Object.values(fixture.conversations)) {
    await expect(conversationLink(page, conversation.id), conversation.name).toHaveCount(1);
  }
  for (const conversation of Object.values(fixture.conversations)) {
    await expectFullConversation(page, conversation);
  }
});

test("responsible Sales gets only true lead-only and pending transcript access plus one seven-field summary per handed-off case", async ({
  context,
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  test.setTimeout(120_000);

  const proof = openDatabase();
  try {
    expect(
      proof.prepare(`
        SELECT c.client_id AS conversation_client_id, l.client_id AS lead_client_id
        FROM wa_conversations c
        JOIN leads l ON l.id = c.lead_id
        WHERE c.id = ?
      `).get(fixture.conversations.leadOnly.id),
    ).toEqual({ conversation_client_id: null, lead_client_id: null });
  } finally {
    proof.close();
  }

  await login(context, page, SALES_EMAIL, "sales123", /\/sales$/);
  await page.goto("/whatsapp");

  await expect(page.locator("details#add")).toHaveCount(0);
  await expect(page.locator('a[href="/whatsapp#add"]')).toHaveCount(0);
  await expect(conversationLink(page, fixture.conversations.leadOnly.id)).toHaveCount(1);
  await expect(conversationLink(page, fixture.conversations.pendingDirect.id)).toHaveCount(1);

  const handedOffKeys: ConversationKey[] = [
    "activeDirect",
    "activeConsistent",
    "closedDirect",
  ];
  const adminOnlyKeys: ConversationKey[] = [
    "conflicting",
    "indirect",
    "brokenLead",
    "brokenClient",
    "danglingCase",
    "invalidCase",
    "unlinked",
    "ownerless",
  ];
  for (const key of [...handedOffKeys, ...adminOnlyKeys]) {
    await expect(conversationLink(page, fixture.conversations[key].id), key).toHaveCount(0);
  }

  const rows = summaryRows(page);
  await expect(rows).toHaveCount(2);
  const caseIds = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-case-id")),
  );
  expect(caseIds.filter((id) => id === String(fixture.clients.active))).toHaveLength(1);
  expect(caseIds.filter((id) => id === String(fixture.clients.closed))).toHaveLength(1);

  const expectations = [
    {
      id: fixture.clients.active,
      student: "P1D Active Student",
      country: "Германия",
      degree: "Бакалавриат",
      state: "Активно",
      curator: "P1D Assigned Curator",
      handoffAt: "2026-07-28T12:00:00.000Z",
    },
    {
      id: fixture.clients.closed,
      student: "P1D Closed Student",
      country: "Франция",
      degree: "Магистратура",
      state: "Закрыто",
      curator: "P1D Assigned Curator",
      handoffAt: "2026-07-28T13:00:00.000Z",
    },
  ];
  for (const expected of expectations) {
    const row = page.locator(
      `[data-testid="whatsapp-handoff-summary"][data-case-id="${expected.id}"]`,
    );
    await expect(row).toHaveCount(1);
    const fields = await row.locator("[data-summary-field]").evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute("data-summary-field"))
        .filter((field): field is string => Boolean(field))
        .sort(),
    );
    expect(fields).toEqual([...SUMMARY_FIELDS].sort());
    await expect(row.locator('[data-summary-field="case-id"] dd')).toHaveText(`#${expected.id}`);
    await expect(row.locator('[data-summary-field="student-name"] dd')).toHaveText(expected.student);
    await expect(row.locator('[data-summary-field="target-country"] dd')).toHaveText(expected.country);
    await expect(row.locator('[data-summary-field="target-degree"] dd')).toHaveText(expected.degree);
    await expect(row.locator('[data-summary-field="case-state"] dd')).toHaveText(expected.state);
    await expect(row.locator('[data-summary-field="curator-name"] dd')).toHaveText(expected.curator);
    await expect(row.locator('[data-summary-field="handoff-at"] dd')).toHaveText(expected.handoffAt);
    await expect(row.locator("a")).toHaveCount(0);
  }

  for (const key of handedOffKeys) {
    const conversation = fixture.conversations[key];
    await expect(page.locator("body")).not.toContainText(conversation.name);
    await expect(page.locator("body")).not.toContainText(conversation.phone);
    await expect(page.locator("body")).not.toContainText(conversation.secret);
  }
  await expect(page.locator("body")).not.toContainText("P1D PRIVATE DRAFT");
  await expect(page.locator("body")).not.toContainText("p1d_private_reason");
  await expect(page.locator("body")).not.toContainText("P1D PRIVATE SUMMARY");
  await expect(page.locator("body")).not.toContainText("8800002");
  await expect(page.locator("body")).not.toContainText("8900002");
  await expect(page.locator("body")).not.toContainText("444440");
  await expect(page.locator("body")).not.toContainText("333330");

  await expectFullConversation(page, fixture.conversations.leadOnly);
  await expectFullConversation(page, fixture.conversations.pendingDirect);
  for (const key of [...handedOffKeys, ...adminOnlyKeys]) {
    await expectConversationDenied(page, fixture.conversations[key]);
  }
});

test("post-handoff summaries do not expose shared WhatsApp metrics and do not reorder when only hidden activity changes", async ({
  context,
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  test.setTimeout(90_000);
  await login(context, page, SALES_EMAIL, "sales123", /\/sales$/);

  await page.goto("/sales?view=list");
  const leadRow = page.getByRole("row").filter({
    has: page.locator(`a[href="/sales/${fixture.leads.activeConsistent}"]`),
  });
  await expect(leadRow).toHaveCount(1);
  await expect(leadRow.getByText("117", { exact: true })).toHaveCount(0);
  await expect(leadRow).not.toContainText("31.12.35");

  await page.goto(`/sales/${fixture.leads.activeConsistent}`);
  await expect(page.getByText("0 / 117", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("333330");
  await expect(page.locator("body")).not.toContainText("2035-12-31");
  await expect(conversationLink(page, fixture.conversations.activeConsistent.id)).toHaveCount(0);

  await page.goto("/dashboard");
  await expect(page.getByText(/777[\s\u00a0]*789/)).toHaveCount(0);

  for (const route of ["/calls", "/tasks"]) {
    await page.goto(route);
    await expect(
      conversationLink(page, fixture.conversations.activeConsistent.id),
      route,
    ).toHaveCount(0);
    await expect(page.locator("body"), route).not.toContainText(
      fixture.conversations.activeConsistent.secret,
    );
    await expect(page.locator("body"), route).not.toContainText("333330");
  }

  await page.goto("/whatsapp");
  const beforeOrder = await summaryRows(page).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-case-id")),
  );
  expect(beforeOrder).toHaveLength(2);

  const database = openDatabase();
  const hiddenRows = database.prepare(`
    SELECT id, unread, last_message_at
    FROM wa_conversations
    WHERE id IN (?, ?, ?)
    ORDER BY id
  `).all(
    fixture.conversations.activeDirect.id,
    fixture.conversations.activeConsistent.id,
    fixture.conversations.closedDirect.id,
  ) as Array<{ id: number; unread: number; last_message_at: string | null }>;
  try {
    database.transaction(() => {
      database.prepare(`
        UPDATE wa_conversations
        SET unread = 909091, last_message_at = '1999-01-01T00:00:00.000Z'
        WHERE id = ?
      `).run(fixture.conversations.activeDirect.id);
      database.prepare(`
        UPDATE wa_conversations
        SET unread = 808081, last_message_at = '2099-12-31T23:59:59.000Z'
        WHERE id = ?
      `).run(fixture.conversations.closedDirect.id);
      database.prepare(`
        INSERT INTO wa_messages (
          conversation_id, direction, text, status, created_at
        ) VALUES (?, 'in', 'P1D HIDDEN ORDER MUTATION', 'received', '2099-12-31T23:59:59.000Z')
      `).run(fixture.conversations.closedDirect.id);
    })();

    await page.reload();
    await expect(summaryRows(page)).toHaveCount(2);
    const afterOrder = await summaryRows(page).evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-case-id")),
    );
    expect(afterOrder).toEqual(beforeOrder);
    await expect(page.locator("body")).not.toContainText("909091");
    await expect(page.locator("body")).not.toContainText("808081");
    await expect(page.locator("body")).not.toContainText("P1D HIDDEN ORDER MUTATION");
  } finally {
    const restore = database.prepare(`
      UPDATE wa_conversations
      SET unread = ?, last_message_at = ?
      WHERE id = ?
    `);
    database.transaction(() => {
      for (const row of hiddenRows) {
        restore.run(row.unread, row.last_message_at, row.id);
      }
      database.prepare(`
        DELETE FROM wa_messages
        WHERE conversation_id = ?
          AND text = 'P1D HIDDEN ORDER MUTATION'
      `).run(fixture.conversations.closedDirect.id);
    })();
    database.close();
  }
});

test("assigned Curator gets direct active, consistent, and closed conversations while other staff fail closed", async ({
  context,
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  test.setTimeout(120_000);
  await login(context, page, CURATOR_EMAIL, "curator123", /\/clients$/);
  await page.goto("/whatsapp");

  await expect(page.locator("details#add")).toHaveCount(0);
  await expect(page.locator('a[href="/whatsapp#add"]')).toHaveCount(0);
  const curatorKeys: ConversationKey[] = [
    "activeDirect",
    "activeConsistent",
    "closedDirect",
  ];
  for (const key of curatorKeys) {
    await expect(conversationLink(page, fixture.conversations[key].id), key).toHaveCount(1);
  }
  await expect(summaryRows(page)).toHaveCount(0);
  for (const key of curatorKeys) {
    await expectFullConversation(page, fixture.conversations[key]);
  }
  for (const key of ["leadOnly", "pendingDirect", "conflicting", "indirect"] as ConversationKey[]) {
    await expectConversationDenied(page, fixture.conversations[key]);
  }

  await login(context, page, OTHER_CURATOR_EMAIL, "curator123", /\/clients$/);
  await page.goto("/whatsapp");
  for (const conversation of Object.values(fixture.conversations)) {
    await expect(conversationLink(page, conversation.id), conversation.name).toHaveCount(0);
  }
  await expect(summaryRows(page)).toHaveCount(0);
  await expectConversationDenied(page, fixture.conversations.activeDirect);

  await login(context, page, OTHER_SALES_EMAIL, "sales123", /\/sales$/);
  await page.goto("/whatsapp");
  for (const conversation of Object.values(fixture.conversations)) {
    await expect(conversationLink(page, conversation.id), conversation.name).toHaveCount(0);
  }
  await expect(summaryRows(page)).toHaveCount(0);
  await expectConversationDenied(page, fixture.conversations.leadOnly);
});

test("Finance and Student cannot enter the WhatsApp queue, API-shaped detail, or create surface", async ({
  context,
  page,
}, testInfo) => {
  desktopOnly(testInfo);

  await login(context, page, "finance@demo.kg", "finance123", /\/finance$/);
  await page.goto("/whatsapp");
  await expect(page).toHaveURL(/\/access-denied\?from=%2Fwhatsapp$/);
  await page.goto(`/whatsapp/${fixture.conversations.leadOnly.id}`);
  await expect(page).toHaveURL(/\/access-denied\?from=%2Fwhatsapp$/);
  await expect(page.locator("details#add")).toHaveCount(0);
  await expect(page.locator('a[href="/whatsapp#add"]')).toHaveCount(0);

  await login(context, page, "client@demo.kg", "client123", /\/portal$/);
  await page.goto("/whatsapp");
  await expect(page).toHaveURL(/\/portal$/);
  await page.goto(`/whatsapp/${fixture.conversations.leadOnly.id}`);
  await expect(page).toHaveURL(/\/portal$/);
});

test("Sales manager fields are hidden, forged create is forced to the actor, owned update preserves ownership, and takeover replay is denied", async ({
  context,
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  test.setTimeout(90_000);

  await login(context, page, SALES_EMAIL, "sales123", /\/sales$/);
  await page.goto("/sales#add");
  const createForm = page.locator("section#add form");
  await expect(createForm.locator('[name="manager_id"]')).toHaveCount(0);
  await createForm.locator('input[name="name"]').fill(CREATED_LEAD_NAME);
  await createForm.locator('input[name="phone"]').fill("+996700889900");
  await createForm.evaluate((form, forgedManagerId) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "manager_id";
    input.value = forgedManagerId;
    form.append(input);
  }, String(fixture.users.otherSales));

  const [createResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    page.waitForURL(/\/sales$/),
    createForm.getByRole("button", { name: "Добавить" }).click(),
  ]);
  expect(createResponse.status()).toBe(303);

  let verification = openDatabase();
  const created = verification.prepare(`
    SELECT id, manager_id
    FROM leads
    WHERE name = ?
  `).get(CREATED_LEAD_NAME) as { id: number; manager_id: number | null } | undefined;
  verification.close();
  expect(created).toEqual({
    id: expect.any(Number),
    manager_id: fixture.users.sales,
  });

  await page.goto(`/sales/${fixture.leads.managerMutation}`);
  const ownedUpdate = page.locator('form:has(input[name="id"])').filter({
    has: page.locator('textarea[name="notes"]'),
  });
  await expect(ownedUpdate).toHaveCount(1);
  await expect(ownedUpdate.locator('[name="manager_id"]')).toHaveCount(0);
  await ownedUpdate.locator('input[name="name"]').fill("P1D Manager Mutation Updated");
  await ownedUpdate.evaluate((form, forgedManagerId) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "manager_id";
    input.value = forgedManagerId;
    form.append(input);
  }, String(fixture.users.otherSales));
  const [ownedResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    ownedUpdate.getByRole("button", { name: "Сохранить" }).click(),
  ]);
  expect(ownedResponse.status()).toBeLessThan(400);

  verification = openDatabase();
  expect(
    verification.prepare(`
      SELECT name, manager_id
      FROM leads
      WHERE id = ?
    `).get(fixture.leads.managerMutation),
  ).toEqual({
    name: "P1D Manager Mutation Updated",
    manager_id: fixture.users.sales,
  });
  verification.close();

  await page.goto(`/sales/${fixture.leads.managerMutation}`);
  const staleOwnerForm = page.locator('form:has(input[name="id"])').filter({
    has: page.locator('textarea[name="notes"]'),
  });
  await staleOwnerForm.locator('input[name="name"]').fill("P1D Takeover Must Fail");
  await staleOwnerForm.evaluate((form, forgedManagerId) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "manager_id";
    input.value = forgedManagerId;
    form.append(input);
  }, String(fixture.users.otherSales));

  verification = openDatabase();
  const beforeTakeover = verification.prepare(`
    SELECT name, phone, email, source, amount, manager_id,
           target_country, notes, updated_at
    FROM leads
    WHERE id = ?
  `).get(fixture.leads.managerMutation);
  verification.close();

  const attacker = await context.newPage();
  await login(context, attacker, OTHER_SALES_EMAIL, "sales123", /\/sales$/);
  const [takeoverResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    staleOwnerForm.getByRole("button", { name: "Сохранить" }).click(),
  ]);
  expect(takeoverResponse.status()).toBe(404);
  await attacker.close();

  verification = openDatabase();
  expect(
    verification.prepare(`
      SELECT name, phone, email, source, amount, manager_id,
             target_country, notes, updated_at
      FROM leads
      WHERE id = ?
    `).get(fixture.leads.managerMutation),
  ).toEqual(beforeTakeover);
  verification.close();

  await login(context, page, "admin@demo.kg", "admin123", /\/dashboard$/);
  await page.goto(`/sales/${fixture.leads.managerMutation}`);
  const adminUpdate = page.locator('form:has(input[name="id"])').filter({
    has: page.locator('textarea[name="notes"]'),
  });
  const managerSelect = adminUpdate.locator('select[name="manager_id"]');
  await expect(
    managerSelect.locator(`option[value="${fixture.users.otherSales}"]`),
  ).toHaveCount(1);
  await managerSelect.selectOption(String(fixture.users.otherSales));
  const [adminResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    adminUpdate.getByRole("button", { name: "Сохранить" }).click(),
  ]);
  expect(adminResponse.status()).toBeLessThan(400);

  verification = openDatabase();
  expect(
    verification.prepare("SELECT manager_id FROM leads WHERE id = ?").pluck().get(
      fixture.leads.managerMutation,
    ),
  ).toBe(fixture.users.otherSales);
  verification.close();
});

test("stale reply, mark-read, and manual-create Server Actions re-authorize and leave SQLite unchanged", async ({
  context,
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  test.setTimeout(90_000);
  restorePendingCase();

  const pendingConversation = fixture.conversations.pendingDirect;
  const settings = openDatabase();
  try {
    expect(
      settings.prepare(`
        SELECT COUNT(*)
        FROM settings
        WHERE key IN ('wa_token', 'wa_phone_id', 'waha_api_key')
          AND length(trim(value)) > 0
      `).pluck().get(),
      "the RED test must not have a configured WhatsApp provider",
    ).toBe(0);
  } finally {
    settings.close();
  }

  await login(context, page, SALES_EMAIL, "sales123", /\/sales$/);
  await page.goto(`/whatsapp/${pendingConversation.id}`);
  const replyForm = page.locator('form:has(input[name="conversation_id"])');
  await replyForm.locator('input[name="text"]').fill("P1D stale reply must not persist");

  const readPage = await context.newPage();
  await readPage.goto(`/whatsapp/${pendingConversation.id}`);
  const readForm = readPage.getByTestId("mark-conversation-read-form");
  await expect(readForm).toBeVisible();

  transitionPendingCaseToActive();
  let verification = openDatabase();
  const beforeReplay = {
    conversation: verification.prepare(`
      SELECT unread, last_message_at
      FROM wa_conversations
      WHERE id = ?
    `).get(pendingConversation.id),
    messages: verification.prepare(`
      SELECT COUNT(*) AS count,
             SUM(CASE WHEN text = 'P1D stale reply must not persist' THEN 1 ELSE 0 END) AS forged
      FROM wa_messages
      WHERE conversation_id = ?
    `).get(pendingConversation.id),
  };
  verification.close();

  try {
    const [replyResponse] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      replyForm.getByRole("button", { name: "Отправить" }).click(),
    ]);
    expect(replyResponse.status()).toBe(404);

    const [readResponse] = await Promise.all([
      readPage.waitForResponse((response) => response.request().method() === "POST"),
      readForm.locator('button[type="submit"]').click(),
    ]);
    expect(readResponse.status()).toBe(404);

    verification = openDatabase();
    expect(
      verification.prepare(`
        SELECT unread, last_message_at
        FROM wa_conversations
        WHERE id = ?
      `).get(pendingConversation.id),
    ).toEqual(beforeReplay.conversation);
    expect(
      verification.prepare(`
        SELECT COUNT(*) AS count,
               SUM(CASE WHEN text = 'P1D stale reply must not persist' THEN 1 ELSE 0 END) AS forged
        FROM wa_messages
        WHERE conversation_id = ?
      `).get(pendingConversation.id),
    ).toEqual(beforeReplay.messages);
    verification.close();
  } finally {
    await readPage.close();
    restorePendingCase();
  }

  await login(context, page, "admin@demo.kg", "admin123", /\/dashboard$/);
  await page.goto("/whatsapp");
  const createDetails = page.locator("details#add");
  await createDetails.locator("summary").click();
  const createForm = createDetails.locator("form");
  await createForm.locator('input[name="phone"]').fill(STALE_CREATE_PHONE);
  await createForm.locator('input[name="name"]').fill("P1D stale create must not persist");

  const salesAttacker = await context.newPage();
  await login(context, salesAttacker, SALES_EMAIL, "sales123", /\/sales$/);
  const [createResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    createForm.getByRole("button", { name: "Добавить" }).click(),
  ]);
  expect(createResponse.status()).toBe(404);
  await salesAttacker.close();

  verification = openDatabase();
  expect(
    verification.prepare(`
      SELECT COUNT(*)
      FROM wa_conversations
      WHERE phone = ? OR name = 'P1D stale create must not persist'
    `).pluck().get(STALE_CREATE_PHONE),
  ).toBe(0);
  verification.close();
});

test("AI draft rejects unrelated and post-handoff actors before message reads or any provider dependency", async ({
  context,
  page,
}, testInfo) => {
  desktopOnly(testInfo);
  expect(
    process.env.ANTHROPIC_API_KEY,
    "provider-free P1D authorization coverage must run without an Anthropic environment key",
  ).toBeFalsy();

  const database = openDatabase();
  const previousKey = database.prepare(
    "SELECT value FROM settings WHERE key = 'anthropic_api_key'",
  ).get() as { value: string } | undefined;
  database.prepare("DELETE FROM settings WHERE key = 'anthropic_api_key'").run();
  database.close();

  const requestDraft = (conversationId: number) =>
    browserFetch(page, "/api/ai/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId }),
    });

  try {
    await login(context, page, OTHER_SALES_EMAIL, "sales123", /\/sales$/);
    let response = await requestDraft(fixture.conversations.leadOnly.id);
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: "not_found" });

    await login(context, page, SALES_EMAIL, "sales123", /\/sales$/);
    response = await requestDraft(fixture.conversations.activeConsistent.id);
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: "not_found" });

    await login(context, page, OTHER_CURATOR_EMAIL, "curator123", /\/clients$/);
    response = await requestDraft(fixture.conversations.activeDirect.id);
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: "not_found" });
  } finally {
    const restore = openDatabase();
    try {
      if (previousKey) {
        restore.prepare(`
          INSERT INTO settings (key, value)
          VALUES ('anthropic_api_key', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(previousKey.value);
      } else {
        restore.prepare("DELETE FROM settings WHERE key = 'anthropic_api_key'").run();
      }
    } finally {
      restore.close();
    }
  }
});
