import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import Database from "better-sqlite3";

const evidenceDir = path.join(
  process.cwd(),
  "docs",
  "design",
  "evo-platform",
  "implementation-screenshots",
  "communications-admin",
);

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Эл. почта").fill("admin@demo.kg");
  await page.getByLabel("Пароль").fill("admin123");
  await Promise.all([
    page.waitForURL(/\/dashboard$/),
    page.getByRole("button", { name: "Войти" }).click(),
  ]);
}

async function openConversation(page: Page, name: string) {
  await page.goto("/whatsapp");
  await page.getByRole("link", { name: new RegExp(`Открыть диалог: ${name}`) }).click();
}

async function expectInsideViewport(locator: Locator, viewportHeight: number) {
  const box = await locator.boundingBox();
  expect(box, "message should have a rendered box").not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewportHeight);
}

type OperationalContext = {
  agent_summary: string | null;
  agent_handoff_reason: string | null;
  agent_state: string | null;
  agent_last_synced_at: string | null;
  amo_lead_id: number | null;
  amo_contact_id: number | null;
};

function replaceOperationalContext(context: OperationalContext) {
  const databasePath =
    process.env.EVO_PLAYWRIGHT_DB_PATH ??
    path.join(process.cwd(), "output", "playwright", "runtime", "edu-admin-e2e.db");
  const database = new Database(databasePath);
  const previous = database
    .prepare(
      `SELECT agent_summary,
              agent_handoff_reason,
              agent_state,
              agent_last_synced_at,
              amo_lead_id,
              amo_contact_id
       FROM wa_conversations
       WHERE name = ?`,
    )
    .get("Асель Бекова") as OperationalContext;
  database
    .prepare(
      `UPDATE wa_conversations
       SET agent_summary = ?,
           agent_handoff_reason = ?,
           agent_state = ?,
           agent_last_synced_at = ?,
           amo_lead_id = ?,
           amo_contact_id = ?
       WHERE name = ?`,
    )
    .run(
      context.agent_summary,
      context.agent_handoff_reason,
      context.agent_state,
      context.agent_last_synced_at,
      context.amo_lead_id,
      context.amo_contact_id,
      "Асель Бекова",
    );
  database.close();

  return () => {
    const restoreDatabase = new Database(databasePath);
    restoreDatabase
      .prepare(
        `UPDATE wa_conversations
         SET agent_summary = ?,
             agent_handoff_reason = ?,
             agent_state = ?,
             agent_last_synced_at = ?,
             amo_lead_id = ?,
             amo_contact_id = ?
         WHERE name = ?`,
      )
      .run(
        previous.agent_summary,
        previous.agent_handoff_reason,
        previous.agent_state,
        previous.agent_last_synced_at,
        previous.amo_lead_id,
        previous.amo_contact_id,
        "Асель Бекова",
      );
    restoreDatabase.close();
  };
}

test("desktop Inbox guides the operator before a conversation is selected", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop empty-state contract");
  await page.setViewportSize({ width: 1440, height: 1024 });
  await login(page);
  await page.goto("/whatsapp");

  const emptyState = page.getByRole("region", { name: "Выберите диалог" });
  await expect(emptyState.getByRole("heading", { name: "Выберите диалог" })).toBeVisible();
  await expect(
    emptyState.getByText(
      "Откройте переписку слева, чтобы увидеть историю, контекст лида и подготовить ответ. AI создаёт только черновик — отправляете вы.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(evidenceDir, "08-whatsapp-empty-state-desktop-1440.png"),
    fullPage: false,
    animations: "disabled",
  });
});

test("normal outgoing messages use dark ink and unverified amoCRM context is stated once", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop conversation contract");
  await page.setViewportSize({ width: 1440, height: 1024 });
  await login(page);
  await openConversation(page, "Асель Бекова");

  const outgoingBubble = page
    .getByText(
      "Добрый день! Отличный выбор. Приглашаем на бесплатную консультацию — расскажем про стипендии и подготовку к SAT. Когда вам удобно?",
      { exact: true },
    )
    .locator("..");
  await expect(outgoingBubble).toHaveCSS("background-color", "rgb(19, 21, 25)");
  await expect(outgoingBubble).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.getByRole("button", { name: "Сменить тему" }).click();
  await expect(outgoingBubble).toHaveCSS("background-color", "rgb(37, 41, 47)");
  await page.screenshot({
    path: path.join(evidenceDir, "11-whatsapp-dark-desktop-1440.png"),
    fullPage: false,
    animations: "disabled",
  });

  const syncSummary = page.getByText("amoCRM · синхронизация не проверена", { exact: true });
  await expect(syncSummary).toHaveCount(1);
  await expect(page.getByText("ID лида amoCRM", { exact: true })).toHaveCount(0);
  await expect(page.getByText("ID контакта amoCRM", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Последняя синхронизация", { exact: true })).toHaveCount(0);
});

test("partial operational context does not repeat the unverified sync state", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop partial-context contract");
  await page.setViewportSize({ width: 1440, height: 1024 });
  await login(page);
  const restore = replaceOperationalContext({
    agent_summary: "Оператору передан неполный контекст для проверки.",
    agent_handoff_reason: "operator_takeover",
    agent_state: null,
    agent_last_synced_at: null,
    amo_lead_id: null,
    amo_contact_id: null,
  });
  try {
    await openConversation(page, "Асель Бекова");

    await expect(page.getByTestId("agent-operational-state")).toBeVisible();
    await expect(
      page.getByText("Оператору передан неполный контекст для проверки.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/синхронизация не проверена/i)).toHaveCount(1);
    await expect(page.getByText("Синхронизация не проверена", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Последняя синхронизация", { exact: true })).toHaveCount(0);
  } finally {
    restore();
  }
});

test("verified amoCRM identity does not depend on optional agent state", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop sync-context contract");
  await page.setViewportSize({ width: 1440, height: 1024 });
  await login(page);
  const restore = replaceOperationalContext({
    agent_summary: null,
    agent_handoff_reason: null,
    agent_state: null,
    agent_last_synced_at: "2026-07-25T10:30:00.000Z",
    amo_lead_id: 14201,
    amo_contact_id: 24502,
  });
  try {
    await openConversation(page, "Асель Бекова");

    await expect(page.getByText(/синхронизация не проверена/i)).toHaveCount(0);
    await expect(page.getByText("ID лида amoCRM", { exact: true })).toBeVisible();
    await expect(page.getByText("14201", { exact: true })).toBeVisible();
    await expect(page.getByText("ID контакта amoCRM", { exact: true })).toBeVisible();
    await expect(page.getByText("24502", { exact: true })).toBeVisible();
    await expect(page.getByText("Последняя синхронизация", { exact: true })).toHaveCount(1);
    await expect(page.getByTestId("agent-operational-state")).toHaveCount(0);
  } finally {
    restore();
  }
});

test("mobile conversation keeps source detail available without displacing messages", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile density contract");
  const viewportHeight = 844;
  await page.setViewportSize({ width: 390, height: viewportHeight });
  await login(page);
  await page.goto("/whatsapp");
  await expect(page.getByRole("heading", { name: "Выберите диалог" })).toBeHidden();
  await page
    .getByRole("link", { name: /Открыть диалог: Асель Бекова/ })
    .click();

  const sourceDisclosure = page.getByRole("group", {
    name: "Локальные данные CRM · подробнее",
  });
  await expect(sourceDisclosure).toBeVisible();
  await expect(sourceDisclosure).not.toHaveAttribute("open", "");

  const messages = page.locator("[data-whatsapp-message]");
  await expect(messages).toHaveCount(2);
  await expectInsideViewport(messages.nth(0), viewportHeight);
  await expectInsideViewport(messages.nth(1), viewportHeight);

  const reply = page.getByLabel("Ответ в WhatsApp", { exact: true });
  await expect(reply).toBeVisible();
  await expect(reply).toHaveAttribute("placeholder", "Напишите ответ…");
  await page.screenshot({
    path: path.join(evidenceDir, "09-whatsapp-conversation-mobile-390.png"),
    fullPage: false,
    animations: "disabled",
  });
});
