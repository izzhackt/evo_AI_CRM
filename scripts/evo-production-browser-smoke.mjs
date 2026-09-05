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

function exactEnvironment(environment, name, pattern, code) {
  const value = environment[name];
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(code);
  return value;
}

export function readProductionSmokeConfiguration(environment = process.env) {
  const healthUrl = exactEnvironment(
    environment,
    "EVO_RELEASE_EXTERNAL_HEALTH_URL",
    /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?\/api\/health$/u,
    "health_url_invalid",
  );
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

export async function runProductionBrowserSmoke({
  environment = process.env,
  chromiumRuntime = chromium,
  writeReceipt = writeProductionSmokeReceipt,
} = {}) {
  const configuration = readProductionSmokeConfiguration(environment);
  const browser = await chromiumRuntime.launch({ headless: true });

  try {
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
    });
    try {
      const page = await context.newPage();
      const loginResponse = await page.goto(`${configuration.baseUrl}/login`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      if (!loginResponse?.ok()) throw new Error("login_route_unavailable");
      const finalLoginUrl = new URL(page.url());
      if (
        finalLoginUrl.origin !== configuration.baseUrl ||
        finalLoginUrl.username ||
        finalLoginUrl.password ||
        finalLoginUrl.pathname !== "/login" ||
        finalLoginUrl.search ||
        finalLoginUrl.hash
      ) {
        throw new Error("login_origin_invalid");
      }

      await page.locator("#staff-email").fill(configuration.email);
      await page.locator("#staff-password").fill(configuration.password);
      await Promise.all([
        page.waitForURL(`${configuration.baseUrl}/v3/main`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        }),
        page.locator('form[aria-labelledby="login-title"] button[type="submit"]').click(),
      ]);

      if (new URL(page.url()).pathname !== "/v3/main") {
        throw new Error("authenticated_route_invalid");
      }
      const shell = page.getByTestId("v3-shell");
      const activeRole = page.getByTestId("active-role");
      const operationalDashboard = page.getByTestId("v3-operational-dashboard");
      await shell.waitFor({ state: "visible", timeout: 30_000 });
      await operationalDashboard.waitFor({ state: "visible", timeout: 30_000 });
      if (
        (await activeRole.getAttribute("data-role")) !== "admin" ||
        (await activeRole.getAttribute("data-authority-role")) !== "admin"
      ) {
        throw new Error("admin_authority_invalid");
      }

      const versionResult = await page.evaluate(async () => {
        const response = await fetch("/api/version", {
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
        });
        return { status: response.status, body: await response.json() };
      });
      if (
        versionResult.status !== 200 ||
        versionResult.body?.status !== "available" ||
        versionResult.body?.revision !== configuration.revision ||
        versionResult.body?.version !== configuration.version
      ) {
        throw new Error("release_metadata_invalid");
      }

      await writeReceipt(
        configuration.receiptPath,
        buildProductionSmokeReceipt(configuration),
      );
    } finally {
      await context.close();
    }
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
