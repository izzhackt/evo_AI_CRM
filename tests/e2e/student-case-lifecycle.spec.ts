import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

const databasePath =
  process.env.EVO_PLAYWRIGHT_DB_PATH
  ?? path.join(process.cwd(), "output", "playwright", "runtime", "edu-admin-e2e.db");

function desktopOnly(testInfo: TestInfo) {
  test.skip(testInfo.project.name !== "desktop-chromium", "stateful lifecycle coverage runs once");
}

function openDatabase() {
  return new Database(databasePath, { fileMustExist: true });
}

function clearAuditFixture(database: Database.Database, clientId: number) {
  database.exec(`
    DROP TRIGGER IF EXISTS student_case_audit_update_guard;
    DROP TRIGGER IF EXISTS student_case_audit_delete_guard;
  `);
  try {
    database.prepare("DELETE FROM student_case_audit WHERE client_id = ?").run(clientId);
  } finally {
    database.exec(`
      CREATE TRIGGER student_case_audit_update_guard
      BEFORE UPDATE ON student_case_audit
      BEGIN
        SELECT RAISE(ABORT, 'student case audit is append-only');
      END;

      CREATE TRIGGER student_case_audit_delete_guard
      BEFORE DELETE ON student_case_audit
      BEGIN
        SELECT RAISE(ABORT, 'student case audit is append-only');
      END;
    `);
  }
}

function resetCaseStateFixture(
  database: Database.Database,
  statement: string,
  clientId: number,
) {
  database.exec("DROP TRIGGER IF EXISTS clients_case_transition_guard");
  try {
    database.prepare(statement).run(clientId);
  } finally {
    database.exec(`
      CREATE TRIGGER clients_case_transition_guard
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

function prepareConfirmedPendingCase(clientId = 2) {
  const database = openDatabase();
  try {
    clearAuditFixture(database, clientId);
    resetCaseStateFixture(database, `
      UPDATE clients
      SET case_state = 'pending',
          curator_id = NULL,
          contract_confirmed_at = '2026-07-28T10:00:00.000Z',
          contract_confirmation_ref = 'synthetic:e2e-confirmed-contract',
          portal_activated_at = NULL,
          handoff_at = NULL,
          closed_at = NULL
      WHERE id = ?
    `, clientId);
  } finally {
    database.close();
  }
}

function resetSecondClient() {
  const database = openDatabase();
  try {
    clearAuditFixture(database, 2);
    resetCaseStateFixture(database, `
      UPDATE clients
      SET case_state = 'pending',
          curator_id = NULL,
          contract_confirmed_at = NULL,
          contract_confirmation_ref = NULL,
          portal_activated_at = NULL,
          handoff_at = NULL,
          closed_at = NULL
      WHERE id = ?
    `, 2);
  } finally {
    database.close();
  }
}

function resetFirstClient() {
  const database = openDatabase();
  try {
    clearAuditFixture(database, 1);
    database.prepare(`
      UPDATE clients
      SET case_state = 'active',
          curator_id = (SELECT id FROM users WHERE lower(email) = 'curator@demo.kg'),
          contract_confirmed_at = '2026-07-01T00:00:00.000Z',
          contract_confirmation_ref = 'synthetic:demo-contract-1',
          portal_activated_at = '2026-07-01T00:00:00.000Z',
          handoff_at = '2026-07-01T00:00:00.000Z',
          closed_at = NULL
      WHERE id = 1
    `).run();
  } finally {
    database.close();
  }
}

function createOtherCuratorFixture() {
  const database = openDatabase();
  try {
    database.prepare(`
      INSERT OR IGNORE INTO users (email, phone, password_hash, name, role)
      SELECT
        'other.curator@example.test',
        '+996000000903',
        password_hash,
        'Other Synthetic Curator',
        'curator'
      FROM users
      WHERE lower(email) = 'curator@demo.kg'
    `).run();
  } finally {
    database.close();
  }
}

function removeOtherCuratorFixture() {
  const database = openDatabase();
  try {
    database
      .prepare("DELETE FROM users WHERE lower(email) = 'other.curator@example.test'")
      .run();
  } finally {
    database.close();
  }
}

test.describe.configure({ mode: "serial" });

test("pending student portal stays unavailable before contract-confirmed assignment", async ({
  page,
  context,
}, testInfo) => {
  desktopOnly(testInfo);
  await login(context, page, "aizhan@demo.kg", "client123", /\/portal$/);
  await expect(
    page.getByRole("heading", { name: "Дело студента пока не готово" }),
  ).toBeVisible();
});

test("Admin assignment requires a reason and activates handoff plus portal atomically", async ({
  page,
  context,
}, testInfo) => {
  desktopOnly(testInfo);
  prepareConfirmedPendingCase();

  try {
    const database = openDatabase();
    const curatorId = Number(
      database
        .prepare("SELECT id FROM users WHERE lower(email) = 'curator@demo.kg'")
        .pluck()
        .get(),
    );
    database.close();

    await login(context, page, "admin@demo.kg", "admin123", /\/dashboard$/);
    await page.goto("/clients/2");
    const assignment = page.getByTestId("curator-assignment-form");
    await assignment.locator("select[name='curator_id']").selectOption(String(curatorId));
    await assignment.locator("textarea[name='reason']").evaluate((element) => {
      element.removeAttribute("required");
    });
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      assignment.getByRole("button", { name: "Назначить куратора" }).click(),
    ]);

    let verification = openDatabase();
    expect(
      verification
        .prepare("SELECT case_state, curator_id, portal_activated_at, handoff_at FROM clients WHERE id = 2")
        .get(),
    ).toEqual({
      case_state: "pending",
      curator_id: null,
      portal_activated_at: null,
      handoff_at: null,
    });
    expect(
      verification
        .prepare("SELECT COUNT(*) FROM student_case_audit WHERE client_id = 2")
        .pluck()
        .get(),
    ).toBe(0);
    verification.close();

    await assignment.locator("select[name='curator_id']").selectOption(String(curatorId));
    await assignment.locator("textarea[name='reason']").fill("Contract verified; assign full-case owner");
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      assignment.getByRole("button", { name: "Назначить куратора" }).click(),
    ]);

    verification = openDatabase();
    const activated = verification.prepare(`
      SELECT case_state, curator_id,
             portal_activated_at IS NOT NULL AS portal_active,
             handoff_at IS NOT NULL AS handed_off
      FROM clients WHERE id = 2
    `).get();
    const audit = verification.prepare(`
      SELECT event_type, reason, before_curator_id, after_curator_id,
             before_case_state, after_case_state,
             before_workflow_owner, after_workflow_owner
      FROM student_case_audit
      WHERE client_id = 2
      ORDER BY id DESC
      LIMIT 1
    `).get();
    verification.close();

    expect(activated).toEqual({
      case_state: "active",
      curator_id: curatorId,
      portal_active: 1,
      handed_off: 1,
    });
    expect(audit).toEqual({
      event_type: "assigned",
      reason: "Contract verified; assign full-case owner",
      before_curator_id: null,
      after_curator_id: curatorId,
      before_case_state: "pending",
      after_case_state: "active",
      before_workflow_owner: "sales",
      after_workflow_owner: "curator",
    });

    await login(context, page, "aizhan@demo.kg", "client123", /\/portal$/);
    await expect(page.getByRole("heading", { name: "Главная" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Дело студента пока не готово" }),
    ).toHaveCount(0);
  } finally {
    resetSecondClient();
  }
});

test("Admin reassignment preserves handoff timestamps and records before/after Curators", async ({
  page,
  context,
}, testInfo) => {
  desktopOnly(testInfo);
  prepareConfirmedPendingCase();
  createOtherCuratorFixture();

  try {
    await login(context, page, "admin@demo.kg", "admin123", /\/dashboard$/);
    await page.goto("/clients/2");
    let assignment = page.getByTestId("curator-assignment-form");
    const firstCuratorId = Number(
      await assignment
        .locator("select[name='curator_id'] option")
        .filter({ hasText: "Динара Токтогулова" })
        .getAttribute("value"),
    );
    await assignment.locator("select[name='curator_id']").selectOption(String(firstCuratorId));
    await assignment.locator("textarea[name='reason']").fill("Initial full-case ownership");
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      assignment.getByRole("button", { name: "Назначить куратора" }).click(),
    ]);

    let verification = openDatabase();
    const initial = verification.prepare(`
      SELECT curator_id, handoff_at, portal_activated_at
      FROM clients
      WHERE id = 2
    `).get() as {
      curator_id: number;
      handoff_at: string;
      portal_activated_at: string;
    };
    const otherCuratorId = Number(
      verification
        .prepare("SELECT id FROM users WHERE lower(email) = 'other.curator@example.test'")
        .pluck()
        .get(),
    );
    verification.close();

    await page.reload();
    assignment = page.getByTestId("curator-assignment-form");
    await expect(
      assignment.getByRole("button", { name: "Переназначить куратора" }),
    ).toBeVisible();
    await assignment.locator("select[name='curator_id']").selectOption(String(otherCuratorId));
    await assignment.locator("textarea[name='reason']").fill("Admin coverage reassignment");
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      assignment.getByRole("button", { name: "Переназначить куратора" }).click(),
    ]);

    verification = openDatabase();
    expect(
      verification.prepare(`
        SELECT case_state, curator_id, handoff_at, portal_activated_at
        FROM clients
        WHERE id = 2
      `).get(),
    ).toEqual({
      case_state: "active",
      curator_id: otherCuratorId,
      handoff_at: initial.handoff_at,
      portal_activated_at: initial.portal_activated_at,
    });
    expect(
      verification.prepare(`
        SELECT
          event_type, reason,
          before_curator_id, after_curator_id,
          before_case_state, after_case_state,
          before_workflow_owner, after_workflow_owner
        FROM student_case_audit
        WHERE client_id = 2
        ORDER BY id DESC
        LIMIT 1
      `).get(),
    ).toEqual({
      event_type: "reassigned",
      reason: "Admin coverage reassignment",
      before_curator_id: firstCuratorId,
      after_curator_id: otherCuratorId,
      before_case_state: "active",
      after_case_state: "active",
      before_workflow_owner: "curator",
      after_workflow_owner: "curator",
    });
    verification.close();
  } finally {
    resetSecondClient();
    removeOtherCuratorFixture();
  }
});

test("Sales, Curator, Finance, and Student cannot replay an Admin assignment form", async ({
  page,
  context,
}, testInfo) => {
  desktopOnly(testInfo);

  const attackers = [
    ["sales@demo.kg", "sales123", /\/sales$/],
    ["curator@demo.kg", "curator123", /\/clients$/],
    ["finance@demo.kg", "finance123", /\/finance$/],
    ["client@demo.kg", "client123", /\/portal$/],
  ] as const;

  try {
    for (const [email, password, target] of attackers) {
      prepareConfirmedPendingCase();
      await login(context, page, "admin@demo.kg", "admin123", /\/dashboard$/);
      await page.goto("/clients/2");
      const assignment = page.getByTestId("curator-assignment-form");
      const curatorId = await assignment.locator("select[name='curator_id'] option").nth(1).getAttribute("value");
      expect(curatorId).not.toBeNull();
      await assignment.locator("select[name='curator_id']").selectOption(curatorId!);
      await assignment.locator("textarea[name='reason']").fill(`forged assignment by ${email}`);

      const attacker = await context.newPage();
      await login(context, attacker, email, password, target);
      await Promise.all([
        page.waitForResponse((response) => response.request().method() === "POST"),
        assignment.getByRole("button", { name: "Назначить куратора" }).click(),
      ]);
      await attacker.close();

      const verification = openDatabase();
      expect(
        verification
          .prepare("SELECT case_state, curator_id FROM clients WHERE id = 2")
          .get(),
      ).toEqual({ case_state: "pending", curator_id: null });
      expect(
        verification
          .prepare("SELECT COUNT(*) FROM student_case_audit WHERE client_id = 2")
          .pluck()
          .get(),
      ).toBe(0);
      verification.close();
    }
  } finally {
    resetSecondClient();
  }
});

test("broad profile updates cannot forge ownership or close a case", async ({
  page,
  context,
}, testInfo) => {
  desktopOnly(testInfo);
  resetFirstClient();

  const beforeDatabase = openDatabase();
  const before = beforeDatabase.prepare(`
    SELECT stage, manager_id, curator_id, case_state
    FROM clients WHERE id = 1
  `).get();
  const financeId = Number(
    beforeDatabase
      .prepare("SELECT id FROM users WHERE lower(email) = 'finance@demo.kg'")
      .pluck()
      .get(),
  );
  beforeDatabase.close();

  await login(context, page, "admin@demo.kg", "admin123", /\/dashboard$/);
  await page.goto("/clients/1");
  const profile = page.getByTestId("client-profile-form");
  await profile.evaluate((form, forgedFinanceId) => {
    const append = (name: string, value: string) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.append(input);
    };
    append("manager_id", String(forgedFinanceId));
    append("curator_id", String(forgedFinanceId));
    const stage = form.querySelector<HTMLSelectElement>("select[name='stage']");
    const archived = document.createElement("option");
    archived.value = "archived";
    archived.textContent = "archived";
    stage?.append(archived);
    if (stage) stage.value = "archived";
  }, financeId);
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    profile.getByRole("button", { name: "Сохранить" }).click(),
  ]);

  const afterDatabase = openDatabase();
  const after = afterDatabase.prepare(`
    SELECT stage, manager_id, curator_id, case_state
    FROM clients WHERE id = 1
  `).get();
  afterDatabase.close();
  expect(after).toEqual(before);
});

test("other Curator, Sales, Finance, and Student cannot replay a close action", async ({
  page,
  context,
}, testInfo) => {
  desktopOnly(testInfo);
  createOtherCuratorFixture();
  const attackers = [
    ["other.curator@example.test", "curator123", /\/clients$/],
    ["sales@demo.kg", "sales123", /\/sales$/],
    ["finance@demo.kg", "finance123", /\/finance$/],
    ["client@demo.kg", "client123", /\/portal$/],
  ] as const;

  try {
    for (const [email, password, target] of attackers) {
      resetFirstClient();
      await login(context, page, "curator@demo.kg", "curator123", /\/clients$/);
      await page.goto("/clients/1");
      const closeForm = page.getByTestId("student-case-close-form");
      await closeForm.locator("textarea[name='reason']").fill(`forged closure by ${email}`);

      const attacker = await context.newPage();
      await login(context, attacker, email, password, target);
      await Promise.all([
        page.waitForResponse((response) => response.request().method() === "POST"),
        closeForm.getByRole("button", { name: "Закрыть дело" }).click(),
      ]);
      await attacker.close();

      const verification = openDatabase();
      expect(
        verification.prepare("SELECT case_state FROM clients WHERE id = 1").pluck().get(),
      ).toBe("active");
      expect(
        verification
          .prepare("SELECT COUNT(*) FROM student_case_audit WHERE client_id = 1")
          .pluck()
          .get(),
      ).toBe(0);
      verification.close();
    }
  } finally {
    resetFirstClient();
    removeOtherCuratorFixture();
  }
});

test("assigned Curator and Admin close and reopen only with a reason and audit", async ({
  page,
  context,
}, testInfo) => {
  desktopOnly(testInfo);
  resetFirstClient();

  try {
    await login(context, page, "curator@demo.kg", "curator123", /\/clients$/);
    await page.goto("/clients/1");
    const closeForm = page.getByTestId("student-case-close-form");
    await closeForm.locator("textarea[name='reason']").evaluate((element) => {
      element.removeAttribute("required");
    });
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      closeForm.getByRole("button", { name: "Закрыть дело" }).click(),
    ]);

    let verification = openDatabase();
    expect(
      verification.prepare("SELECT case_state FROM clients WHERE id = 1").pluck().get(),
    ).toBe("active");
    expect(
      verification.prepare("SELECT COUNT(*) FROM student_case_audit WHERE client_id = 1").pluck().get(),
    ).toBe(0);
    verification.close();

    await closeForm.locator("textarea[name='reason']").fill("Service obligations completed");
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      closeForm.getByRole("button", { name: "Закрыть дело" }).click(),
    ]);

    verification = openDatabase();
    expect(
      verification.prepare("SELECT case_state, closed_at IS NOT NULL AS has_closed_at FROM clients WHERE id = 1").get(),
    ).toEqual({ case_state: "closed", has_closed_at: 1 });
    expect(
      verification.prepare(`
        SELECT event_type, reason, before_case_state, after_case_state
        FROM student_case_audit WHERE client_id = 1 ORDER BY id DESC LIMIT 1
      `).get(),
    ).toEqual({
      event_type: "closed",
      reason: "Service obligations completed",
      before_case_state: "active",
      after_case_state: "closed",
    });
    verification.close();

    const reopenForm = page.getByTestId("student-case-reopen-form");
    await reopenForm.locator("textarea[name='reason']").fill("Additional agreed service work opened");
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      reopenForm.getByRole("button", { name: "Открыть дело снова" }).click(),
    ]);

    verification = openDatabase();
    expect(
      verification.prepare("SELECT case_state, closed_at FROM clients WHERE id = 1").get(),
    ).toEqual({ case_state: "active", closed_at: null });
    expect(
      verification.prepare(`
        SELECT event_type, reason, before_case_state, after_case_state
        FROM student_case_audit WHERE client_id = 1 ORDER BY id DESC LIMIT 1
      `).get(),
    ).toEqual({
      event_type: "reopened",
      reason: "Additional agreed service work opened",
      before_case_state: "closed",
      after_case_state: "active",
    });
    verification.close();

    await login(context, page, "admin@demo.kg", "admin123", /\/dashboard$/);
    await page.goto("/clients/1");
    const adminCloseForm = page.getByTestId("student-case-close-form");
    await adminCloseForm.locator("textarea[name='reason']").fill("Admin-authorized closure");
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      adminCloseForm.getByRole("button", { name: "Закрыть дело" }).click(),
    ]);
    const adminReopenForm = page.getByTestId("student-case-reopen-form");
    await adminReopenForm.locator("textarea[name='reason']").fill("Admin-authorized reopening");
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST"),
      adminReopenForm.getByRole("button", { name: "Открыть дело снова" }).click(),
    ]);

    verification = openDatabase();
    expect(
      verification.prepare("SELECT case_state, closed_at FROM clients WHERE id = 1").get(),
    ).toEqual({ case_state: "active", closed_at: null });
    expect(
      verification.prepare(`
        SELECT audit.event_type, audit.reason, actor.email AS actor_email
        FROM student_case_audit audit
        JOIN users actor ON actor.id = audit.actor_user_id
        WHERE audit.client_id = 1
        ORDER BY audit.id DESC
        LIMIT 1
      `).get(),
    ).toEqual({
      event_type: "reopened",
      reason: "Admin-authorized reopening",
      actor_email: "admin@demo.kg",
    });
    verification.close();
  } finally {
    resetFirstClient();
  }
});

test("database guards reject forged lifecycle state and append-only audit changes", async ({}, testInfo) => {
  desktopOnly(testInfo);
  const database = openDatabase();
  database.exec("BEGIN");
  try {
    const adminId = Number(
      database
        .prepare("SELECT id FROM users WHERE lower(email) = 'admin@demo.kg'")
        .pluck()
        .get(),
    );
    const curatorId = Number(
      database
        .prepare("SELECT id FROM users WHERE lower(email) = 'curator@demo.kg'")
        .pluck()
        .get(),
    );
    const salesId = Number(
      database
        .prepare("SELECT id FROM users WHERE lower(email) = 'sales@demo.kg'")
        .pluck()
        .get(),
    );

    expect(() =>
      database
        .prepare("UPDATE clients SET curator_id = ? WHERE id = 2")
        .run(salesId),
    ).toThrow(/student case curator must have curator role/);
    expect(() =>
      database
        .prepare("UPDATE users SET role = 'sales' WHERE id = ?")
        .run(curatorId),
    ).toThrow(/assigned student case curator role cannot be changed/);
    expect(() =>
      database
        .prepare("UPDATE clients SET case_state = 'closed' WHERE id = 2")
        .run(),
    ).toThrow(/unsupported student case transition/);
    expect(() =>
      database
        .prepare("UPDATE clients SET case_state = 'active' WHERE id = 2")
        .run(),
    ).toThrow(
      /active student case requires confirmed contract, curator, portal activation, and handoff/,
    );
    expect(() =>
      database
        .prepare("UPDATE clients SET portal_activated_at = NULL WHERE id = 1")
        .run(),
    ).toThrow(
      /active student case requires confirmed contract, curator, portal activation, and handoff/,
    );

    const inserted = database.prepare(`
      INSERT INTO student_case_audit (
        client_id, actor_user_id, event_type, reason,
        before_curator_id, after_curator_id,
        before_case_state, after_case_state,
        before_workflow_owner, after_workflow_owner
      ) VALUES (1, ?, 'reassigned', 'append-only test', ?, ?, 'active', 'active', 'curator', 'curator')
    `).run(adminId, curatorId, curatorId);

    expect(() =>
      database
        .prepare("UPDATE student_case_audit SET reason = 'tampered' WHERE id = ?")
        .run(inserted.lastInsertRowid),
    ).toThrow(/student case audit is append-only/);
    expect(() =>
      database
        .prepare("DELETE FROM student_case_audit WHERE id = ?")
        .run(inserted.lastInsertRowid),
    ).toThrow(/student case audit is append-only/);
  } finally {
    database.exec("ROLLBACK");
    database.close();
  }
});
