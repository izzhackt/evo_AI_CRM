#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const SAFE_RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const PRODUCTION_HEALTH_URL = "https://crm.evoadmissions.com/api/health";
const STUDENT_ORIGIN = "https://app.evoadmissions.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function exactEnvironment(environment, name, pattern, code) {
  const value = environment[name];
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(code);
  return value;
}

export function readProductionSmokeConfiguration(environment = process.env) {
  const healthUrl = exactEnvironment(
    environment,
    "EVO_RELEASE_EXTERNAL_HEALTH_URL",
    /^https:\/\/crm\.evoadmissions\.com\/api\/health$/u,
    "health_url_invalid",
  );
  if (healthUrl !== PRODUCTION_HEALTH_URL) throw new Error("health_url_invalid");
  const parsedHealthUrl = new URL(healthUrl);
  if (
    parsedHealthUrl.username ||
    parsedHealthUrl.password ||
    parsedHealthUrl.search ||
    parsedHealthUrl.hash ||
    parsedHealthUrl.pathname !== "/api/health"
  ) {
    throw new Error("health_url_invalid");
  }

  const email = environment.EVO_PRODUCTION_SMOKE_ADMIN_EMAIL;
  const password = environment.EVO_PRODUCTION_SMOKE_ADMIN_PASSWORD;
  if (
    typeof email !== "string" ||
    email.length < 3 ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+$/u.test(email)
  ) {
    throw new Error("admin_email_invalid");
  }
  if (typeof password !== "string" || password.length < 1 || password.length > 4096) {
    throw new Error("admin_password_invalid");
  }
  const studentEmail = exactEnvironment(environment, "EVO_PRODUCTION_SMOKE_STUDENT_EMAIL", /^[^\s@]+@[^\s@]+$/u, "student_email_invalid");
  if (studentEmail.length > 320 || studentEmail.toLowerCase() === email.toLowerCase()) {
    throw new Error("student_email_invalid");
  }
  const studentPassword = environment.EVO_PRODUCTION_SMOKE_STUDENT_PASSWORD;
  if (typeof studentPassword !== "string" || studentPassword.length < 1 || studentPassword.length > 4096) {
    throw new Error("student_password_invalid");
  }

  const receiptPath = environment.EVO_PRODUCTION_SMOKE_RECEIPT;
  if (
    typeof receiptPath !== "string" ||
    !isAbsolute(receiptPath) ||
    receiptPath.includes("\0") ||
    resolve(receiptPath) !== receiptPath
  ) {
    throw new Error("receipt_path_invalid");
  }

  return Object.freeze({
    baseUrl: parsedHealthUrl.origin,
    email,
    password,
    studentEmail,
    studentPassword,
    studentBaseUrl: STUDENT_ORIGIN,
    caseId: exactEnvironment(environment, "EVO_PRODUCTION_SMOKE_CASE_ID", UUID, "case_id_invalid"),
    receiptPath,
    releaseId: exactEnvironment(
      environment,
      "EVO_RELEASE_ID",
      SAFE_RELEASE_ID,
      "release_id_invalid",
    ),
    repository: exactEnvironment(
      environment,
      "EVO_RELEASE_REPOSITORY",
      REPOSITORY,
      "repository_invalid",
    ),
    revision: exactEnvironment(
      environment,
      "EVO_RELEASE_REVISION",
      SHA40,
      "revision_invalid",
    ),
    version: exactEnvironment(
      environment,
      "EVO_RELEASE_VERSION",
      SAFE_VERSION,
      "version_invalid",
    ),
    workflowRunId: exactEnvironment(
      environment,
      "EVO_RELEASE_WORKFLOW_RUN_ID",
      POSITIVE_DECIMAL,
      "workflow_run_id_invalid",
    ),
    workflowRunAttempt: exactEnvironment(
      environment,
      "EVO_RELEASE_WORKFLOW_RUN_ATTEMPT",
      POSITIVE_DECIMAL,
      "workflow_run_attempt_invalid",
    ),
    artifactId: exactEnvironment(
      environment,
      "EVO_RELEASE_ARTIFACT_ID",
      POSITIVE_DECIMAL,
      "artifact_id_invalid",
    ),
    artifactDigest: exactEnvironment(
      environment,
      "EVO_RELEASE_ARTIFACT_DIGEST",
      SHA256,
      "artifact_digest_invalid",
    ),
  });
}

export function buildProductionSmokeReceipt(configuration) {
  return Object.freeze({
    schema: "evo-v3-browser-receipt/v1",
    releaseId: configuration.releaseId,
    repository: configuration.repository,
    revision: configuration.revision,
    workflowRunId: configuration.workflowRunId,
    workflowRunAttempt: configuration.workflowRunAttempt,
    artifactId: configuration.artifactId,
    artifactDigest: configuration.artifactDigest,
    result: "passed",
  });
}

export async function writeProductionSmokeReceipt(path, receipt) {
  let handle;
  try {
    handle = await open(
      path,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW |
        fsConstants.O_CLOEXEC,
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(receipt)}\n`, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

async function signIn(page, baseUrl, email, password, destination) {
  const loginResponse = await page.goto(`${baseUrl}/login`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  if (loginResponse?.status() !== 200) throw new Error("login_route_unavailable");
  if (page.url() !== `${baseUrl}/login`) throw new Error("login_origin_invalid");
  await page.locator("#staff-email").fill(email);
  await page.locator("#staff-password").fill(password);
  await Promise.all([
    page.waitForURL(`${baseUrl}${destination}`, { waitUntil: "domcontentloaded", timeout: 30_000 }),
    page.locator('form[aria-labelledby="login-title"] button[type="submit"]').click(),
  ]);
  if (page.url() !== `${baseUrl}${destination}`) throw new Error("authenticated_route_invalid");
}

async function visit(page, url) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (response?.status() !== 200 || page.url() !== url) throw new Error("feature_route_unavailable");
}

async function verifyVersion(page, configuration) {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/version", {
      cache: "no-store", credentials: "same-origin", redirect: "error",
    });
    return { status: response.status, body: await response.json() };
  });
  if (result.status !== 200 || result.body?.status !== "available"
    || result.body?.revision !== configuration.revision || result.body?.version !== configuration.version) {
    throw new Error("release_metadata_invalid");
  }
}

function checkpoint(phase) {
  process.stdout.write(`${JSON.stringify({ code: "production_browser_smoke_checkpoint", phase })}\n`);
}

export async function runProductionBrowserSmoke({ environment = process.env } = {}) {
  const configuration = readProductionSmokeConfiguration(environment);
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
    });
    try {
      const page = await context.newPage();
      let runtimeError = false;
      page.on("pageerror", () => { runtimeError = true; });
      checkpoint("admin_login");
      await signIn(page, configuration.baseUrl, configuration.email, configuration.password, "/v3/main");
      const shell = page.getByTestId("v3-shell");
      const activeRole = page.getByTestId("active-role");
      const operationalDashboard = page.getByTestId("v3-operational-dashboard");
      await shell.waitFor({ state: "visible", timeout: 30_000 });
      await operationalDashboard.waitFor({ state: "visible", timeout: 30_000 });
      if (
        (await activeRole.getAttribute("data-role")) !== "admin" ||
        (await activeRole.getAttribute("data-system-role")) !== "admin"
      ) {
        throw new Error("admin_authority_invalid");
      }

      await verifyVersion(page, configuration);
      checkpoint("case_route");
      await visit(page, `${configuration.baseUrl}/v3/profile?case=${configuration.caseId}&tab=route`);
      // «Вузы и программы» replaced the route tracker at the same URL (S4).
      await page.getByTestId("v3-universities-programs").waitFor({ state: "visible", timeout: 30_000 });
      checkpoint("case_contract");
      await visit(page, `${configuration.baseUrl}/v3/profile?case=${configuration.caseId}&tab=contract`);
      const contract = page.getByTestId("v3-profile-contract-workspace");
      await contract.waitFor({ state: "visible", timeout: 30_000 });
      if (await contract.getAttribute("data-student-case-id") !== configuration.caseId) {
        throw new Error("case_identity_invalid");
      }
      if (runtimeError) throw new Error("staff_runtime_error");
      process.stdout.write('{"ok":true,"code":"production_case_smoke_passed"}\n');
      checkpoint("admissions_pipeline");
      await visit(page, `${configuration.baseUrl}/v3/admissions-pipeline`);
      await page.getByTestId("v3-admissions-pipeline-board").waitFor({ state: "visible", timeout: 30_000 });
      if (runtimeError) throw new Error("staff_runtime_error");
      process.stdout.write('{"ok":true,"code":"production_admissions_pipeline_smoke_passed"}\n');
      // «Студенты» and EVO Docs are the 241 work queue (Э0 of the 25.09 redesign
      // plan). The checks do not depend on data: the queue container and its view
      // tabs render (the loading skeleton has neither), and no read error or
      // refusal replaced the list.
      checkpoint("students_queue");
      await visit(page, `${configuration.baseUrl}/v3/profile`);
      await page.getByTestId("v3-student-case-directory").waitFor({ state: "visible", timeout: 30_000 });
      await page.getByRole("navigation", { name: "Виды списка студентов", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
      if (await page.getByTestId("queue-error").count()) throw new Error("students_queue_unavailable");
      if (runtimeError) throw new Error("staff_runtime_error");
      process.stdout.write('{"ok":true,"code":"production_students_queue_smoke_passed"}\n');
      checkpoint("evo_docs");
      await visit(page, `${configuration.baseUrl}/v3/profile?section=docs`);
      await page.getByTestId("v3-student-case-directory").waitFor({ state: "visible", timeout: 30_000 });
      await page.getByRole("navigation", { name: "Виды списка студентов", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
      if (await page.getByTestId("queue-error").count()) throw new Error("evo_docs_queue_unavailable");
      if (runtimeError) throw new Error("staff_runtime_error");
      process.stdout.write('{"ok":true,"code":"production_evo_docs_smoke_passed"}\n');
      checkpoint("team_chat");
      await visit(page, `${configuration.baseUrl}/v3/team-chat`);
      const channels = page.getByRole("navigation", { name: "Каналы команды", exact: true });
      await channels.waitFor({ state: "visible", timeout: 30_000 });
      await page.locator('[aria-label="История сообщений"]').waitFor({ state: "visible", timeout: 30_000 });
      await page.getByRole("textbox", { name: "Сообщение в канал", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
      if (
        await page.getByText("Сообщения появляются автоматически", { exact: true }).count() ||
        await page.getByText("Внутренняя переписка сотрудников EVO", { exact: true }).count() ||
        await page.getByRole("button", { name: /^(Приглушить|Включить уведомления)$/u }).count() ||
        (await channels.innerText()).includes("· тихо")
      ) {
        throw new Error("team_chat_cleanup_incomplete");
      }
      if (runtimeError) throw new Error("staff_runtime_error");
      process.stdout.write('{"ok":true,"code":"production_team_chat_smoke_passed"}\n');
    } finally {
      await context.close();
    }
    const studentContext = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block" });
    try {
      const page = await studentContext.newPage();
      let runtimeError = false;
      page.on("pageerror", () => { runtimeError = true; });
      checkpoint("student_login");
      await signIn(page, configuration.studentBaseUrl, configuration.studentEmail, configuration.studentPassword, "/portal");
      checkpoint("student_overview");
      await page.getByTestId("student-portal-shell").waitFor({ state: "visible", timeout: 30_000 });
      await page.getByRole("heading", { name: "Моё поступление", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
      checkpoint("student_documents");
      await visit(page, `${configuration.studentBaseUrl}/portal/documents`);
      await page.getByRole("heading", { name: "Документы", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
      await page.getByRole("heading", { name: /^(Список документов пока пуст|Чеклист)$/u }).waitFor({ state: "visible", timeout: 30_000 });
      checkpoint("student_navigation");
      await Promise.all([
        page.waitForURL(`${configuration.studentBaseUrl}/portal`, { waitUntil: "domcontentloaded", timeout: 30_000 }),
        page.getByRole("navigation", { name: "Разделы кабинета", exact: true }).locator('a[href="/portal"]').click(),
      ]);
      await page.getByRole("heading", { name: "Моё поступление", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
      if (page.url() !== `${configuration.studentBaseUrl}/portal` || runtimeError) {
        throw new Error("student_navigation_failed");
      }
      process.stdout.write('{"ok":true,"code":"production_student_smoke_passed"}\n');
    } finally {
      await studentContext.close();
    }
    await writeProductionSmokeReceipt(configuration.receiptPath, buildProductionSmokeReceipt(configuration));
  } finally {
    await browser.close();
  }
}

async function main() {
  await runProductionBrowserSmoke();
  process.stdout.write('{"ok":true,"code":"production_browser_smoke_passed"}\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write('{"ok":false,"code":"production_browser_smoke_failed"}\n');
    process.exitCode = 2;
  });
}
