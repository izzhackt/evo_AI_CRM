import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function localSupabase() {
  const url = new URL(required("EVO_STUDENT_PORTAL_SUPABASE_URL"));
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Assessment QA must use isolated loopback Supabase");
  return { url: url.origin, key: required("EVO_STUDENT_PORTAL_SUPABASE_PUBLISHABLE_KEY") };
}

async function login(page: Page, kind = "STUDENT") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("#staff-email").fill(required(`EVO_STUDENT_PORTAL_${kind}_EMAIL`));
  await page.locator("#staff-password").fill(required(`EVO_STUDENT_PORTAL_${kind}_PASSWORD`));
  await page.locator('form[aria-labelledby="login-title"] button[type="submit"]').click();
  await expect(page).toHaveURL(kind === "ADMIN" ? /\/v3\/main$/ : /\/portal$/);
}

async function saved(page: Page) {
  await expect(page.getByRole("status")).toHaveText("Все ответы сохранены", { timeout: 30_000 });
}

async function screenshot(page: Page, name: string) {
  const directory = process.env.EVO_STUDENT_PORTAL_SCREENSHOT_DIR;
  if (!directory) throw new Error("Private evidence directory is required");
  const path = join(directory, name);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await chmod(path, 0o600);
}

async function quality(page: Page) {
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("nextjs-portal [data-nextjs-dialog]")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length }))).toEqual([]);
}

async function ownerRpc(kind = "STUDENT") {
  const config = localSupabase();
  const client = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: required(`EVO_STUDENT_PORTAL_${kind}_EMAIL`), password: required(`EVO_STUDENT_PORTAL_${kind}_PASSWORD`) });
  if (error) throw new Error("Isolated QA identity login failed");
  return client;
}

test("English: actual UI save, logout/resume, immutable completion and owner-only access", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Full persistence path runs once; responsive paths are separate.");
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  await login(page);
  await page.goto("/portal/tests");
  await expect(page.getByRole("heading", { name: "Тесты", exact: true })).toBeVisible();
  await quality(page); await screenshot(page, "assessments-desktop-catalog.png");
  await page.goto("/portal/tests/english?new=1");
  await page.getByRole("button", { name: "Начать тест", exact: true }).click();
  await expect(page.getByTestId("assessment-runner")).toBeVisible();
  await expect(page).toHaveURL(/attempt=[0-9a-f-]{36}/);
  const attemptUrl = page.url();
  const attemptId = new URL(attemptUrl).searchParams.get("attempt");
  expect(await page.content()).not.toContain('"correctOptionId"');
  for (let index = 0; index < 3; index++) {
    await page.getByRole("radio").last().check();
    await saved(page);
    await page.getByRole("button", { name: "Далее", exact: true }).click();
  }
  await quality(page); await screenshot(page, "assessments-desktop-english-question.png");
  await page.getByRole("button", { name: "Сохранить и выйти" }).click();
  await expect(page).toHaveURL(/\/portal\/tests$/);
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await login(page);
  await page.goto(attemptUrl);
  await expect(page.getByRole("heading", { name: "Задание 4 из 36", exact: true })).toBeVisible();
  for (let index = 3; index < 36; index++) {
    await page.getByRole("radio").last().check();
    await saved(page);
    await page.getByRole("button", { name: index === 35 ? "Проверить и завершить" : "Далее", exact: true }).click();
  }
  await page.getByRole("button", { name: "Завершить и получить результат" }).click();
  await expect(page.getByRole("heading", { name: "0 из 36", exact: true })).toBeVisible();
  await quality(page); await screenshot(page, "assessments-desktop-english-result.png");
  await page.reload();
  await expect(page.getByRole("heading", { name: "0 из 36", exact: true })).toBeVisible();
  const owner = await ownerRpc();
  const { data: completed, error: readError } = await owner.schema("platform").rpc("student_assessment_attempt_v1", { p_attempt_id: attemptId });
  expect(readError).toBeNull(); expect(completed.status).toBe("completed"); expect(completed.result.english.correctCount).toBe(0);
  expect(completed.result.english.band).toBe("basic"); expect(completed.result.english.feedback).toHaveLength(36);
  const { error: immutable } = await owner.schema("platform").rpc("save_student_assessment_answers_v1", { p_attempt_id: attemptId, p_expected_revision: completed.revision, p_answers: {}, p_request_id: crypto.randomUUID() });
  expect(immutable?.code).toBe("40001");
  for (const kind of ["STUDENT_SECOND", "ADMIN"]) {
    const other = await ownerRpc(kind);
    const denied = await other.schema("platform").rpc("student_assessment_attempt_v1", { p_attempt_id: attemptId });
    expect(denied.error?.code).toBe("42501"); expect(denied.data).toBeNull();
    await other.auth.signOut();
  }
  const direct = await owner.schema("platform").from("student_assessment_attempts").select("answers").eq("id", attemptId);
  expect(direct.error).not.toBeNull(); expect(direct.data).toBeNull();
  await owner.auth.signOut(); expect(errors).toEqual([]);
});

test("Career: all 92 real answers produce eight descriptive scales and profession cards", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Full 92-question completion runs once.");
  test.setTimeout(240_000);
  await login(page);
  await page.goto("/portal/tests/career?new=1");
  await page.getByRole("button", { name: "Начать тест", exact: true }).click();
  await expect(page.getByTestId("assessment-runner")).toBeVisible();
  const attemptUrl = page.url();
  for (let block = 0; block < 23; block++) {
    const groups = page.locator("fieldset");
    await expect(groups).toHaveCount(4);
    for (let item = 0; item < 4; item++) await groups.nth(item).getByRole("radio").nth(2).check();
    await saved(page);
    if (block === 0) { await quality(page); await screenshot(page, "assessments-desktop-career-questions.png"); }
    await page.getByRole("button", { name: block === 22 ? "Проверить и завершить" : "Далее", exact: true }).click();
  }
  await page.getByRole("button", { name: "Завершить и получить результат" }).click();
  await expect(page.getByRole("heading", { name: "Ваша карта интересов", exact: true })).toBeVisible();
  await expect(page.getByRole("meter")).toHaveCount(8);
  await quality(page); await screenshot(page, "assessments-desktop-career-result.png");
  await page.locator("details").filter({ hasText: "Попробуйте:" }).first().locator("summary").click();
  await expect(page.getByText("Возможное развитие:", { exact: true }).first()).toBeVisible();
  await screenshot(page, "assessments-desktop-profession.png");
  await page.goto(attemptUrl);
  await expect(page.getByRole("heading", { name: "Ваша карта интересов", exact: true })).toBeVisible();
  const owner = await ownerRpc();
  const result = await owner.schema("platform").rpc("student_assessment_attempt_v1", { p_attempt_id: new URL(attemptUrl).searchParams.get("attempt") });
  expect(result.error).toBeNull(); expect(result.data.result.orvis.scales).toHaveLength(8);
  expect(result.data.result.orvis.scales.every((s: { mean: number }) => s.mean === 3)).toBe(true);
  expect(result.data.result.orvis.topScales).toHaveLength(8); await owner.auth.signOut();
});

test("393px and keyboard: test options, pause and saved result stay usable", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile-393-chromium", "Dedicated narrow viewport path.");
  await login(page); await page.goto("/portal/tests");
  await quality(page); await screenshot(page, "assessments-mobile-catalog.png");
  await page.goto("/portal/tests/career?new=1"); await page.getByRole("button", { name: "Начать тест", exact: true }).click();
  const first = page.getByRole("radio").first(); await first.focus(); await page.keyboard.press("Space");
  await expect(first).toBeChecked(); await saved(page); await quality(page);
  await screenshot(page, "assessments-mobile-career.png");
  await page.getByRole("button", { name: "Сохранить и выйти" }).click(); await expect(page).toHaveURL(/\/portal\/tests$/);
  await page.getByRole("link", { name: /Английский · версия/ }).first().click();
  await expect(page.getByTestId("assessment-results")).toBeVisible(); await quality(page);
  await screenshot(page, "assessments-mobile-result.png");
});

test("real competing tabs: stale save is visible and explicit reload recovers", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Conflict contract runs once.");
  await login(page); await page.goto("/portal/tests/english?new=1"); await page.getByRole("button", { name: "Начать тест", exact: true }).click();
  await expect(page).toHaveURL(/attempt=[0-9a-f-]{36}/);
  const second = await context.newPage(); await second.goto(page.url());
  await expect(second.getByTestId("assessment-runner")).toBeVisible();
  await page.getByRole("radio").first().check(); await saved(page);
  await second.getByRole("radio").last().check();
  await expect(second.getByRole("alert")).toContainText("Ответы изменились в другой вкладке");
  await expect(second.getByRole("radio").last()).toBeChecked();
  second.once("dialog", dialog => dialog.accept());
  await second.getByRole("button", { name: "Загрузить сохранённую попытку" }).click();
  await expect(second.getByRole("radio").first()).toBeChecked(); await saved(second);
  await second.close();
});

test("real connection loss preserves input and retries the same save after recovery", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Network recovery runs once with the real backend.");
  await login(page); await page.goto("/portal/tests/english");
  await expect(page.getByTestId("assessment-runner")).toBeVisible();
  await context.setOffline(true);
  try {
    await page.getByRole("radio").last().check();
    await expect(page.getByRole("alert")).toContainText("Не удалось подтвердить сохранение");
    await expect(page.getByRole("radio").last()).toBeChecked();
    await screenshot(page, "assessments-desktop-offline.png");
  } finally { await context.setOffline(false); }
  await page.getByRole("button", { name: "Повторить сохранение" }).click();
  await saved(page); await page.reload();
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(page.getByRole("radio").last()).toBeChecked();
});
