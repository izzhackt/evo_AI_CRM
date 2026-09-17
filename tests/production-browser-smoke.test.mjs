import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildProductionSmokeReceipt,
  readProductionSmokeConfiguration,
  writeProductionSmokeReceipt,
} from "../scripts/evo-production-browser-smoke.mjs";

const REVISION = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;
const smokeSource = readFileSync(
  new URL("../scripts/evo-production-browser-smoke.mjs", import.meta.url),
  "utf8",
);

function environment(receiptPath = "/tmp/evo-v3-browser-receipt.json") {
  return {
    EVO_RELEASE_EXTERNAL_HEALTH_URL: "https://crm.evoadmissions.com/api/health",
    EVO_PRODUCTION_SMOKE_ADMIN_EMAIL: "release-smoke@evo.invalid",
    EVO_PRODUCTION_SMOKE_ADMIN_PASSWORD: "not-a-real-secret",
    EVO_PRODUCTION_SMOKE_STUDENT_EMAIL: "student-smoke@evo.invalid",
    EVO_PRODUCTION_SMOKE_STUDENT_PASSWORD: "not-a-real-student-secret",
    EVO_PRODUCTION_SMOKE_CASE_ID: "12345678-1234-1234-1234-123456789abc",
    EVO_PRODUCTION_SMOKE_RECEIPT: receiptPath,
    EVO_RELEASE_ID: "v3-r100-a2-aaaaaaaa",
    EVO_RELEASE_REPOSITORY: "izzhackt/evo_AI_CRM",
    EVO_RELEASE_REVISION: REVISION,
    EVO_RELEASE_VERSION: "r100.2-aaaaaaaa",
    EVO_RELEASE_WORKFLOW_RUN_ID: "100",
    EVO_RELEASE_WORKFLOW_RUN_ATTEMPT: "2",
    EVO_RELEASE_ARTIFACT_ID: "900",
    EVO_RELEASE_ARTIFACT_DIGEST: DIGEST,
  };
}

test("browser receipt is a deterministic closed identity without credentials", () => {
  const config = readProductionSmokeConfiguration(environment());
  const receipt = buildProductionSmokeReceipt(config);
  assert.deepEqual(receipt, {
    schema: "evo-v3-browser-receipt/v1",
    releaseId: "v3-r100-a2-aaaaaaaa",
    repository: "izzhackt/evo_AI_CRM",
    revision: REVISION,
    workflowRunId: "100",
    workflowRunAttempt: "2",
    artifactId: "900",
    artifactDigest: DIGEST,
    result: "passed",
  });
  const serialized = JSON.stringify(receipt);
  assert.doesNotMatch(serialized, /email|password|cookie|session|secret|caseId/iu);
  assert.equal(config.studentBaseUrl, "https://app.evoadmissions.com");
});

test("configuration is exact and rejects unsafe or normalized authority values", () => {
  for (const [name, value] of [
    ["EVO_RELEASE_EXTERNAL_HEALTH_URL", "http://crm.evoadmissions.com/api/health"],
    ["EVO_RELEASE_EXTERNAL_HEALTH_URL", "https://crm.evoadmissions.com/api/health?ok=1"],
    ["EVO_RELEASE_EXTERNAL_HEALTH_URL", "https://evo-crm.72.62.119.112.sslip.io/api/health"],
    ["EVO_RELEASE_EXTERNAL_HEALTH_URL", "https://app.evoadmissions.com/api/health"],
    ["EVO_RELEASE_EXTERNAL_HEALTH_URL", "https://crm.evoadmissions.com.attacker.invalid/api/health"],
    ["EVO_RELEASE_REVISION", REVISION.toUpperCase()],
    ["EVO_RELEASE_WORKFLOW_RUN_ATTEMPT", "02"],
    ["EVO_RELEASE_ARTIFACT_DIGEST", "b".repeat(64)],
    ["EVO_PRODUCTION_SMOKE_ADMIN_EMAIL", " release-smoke@evo.invalid"],
    ["EVO_PRODUCTION_SMOKE_STUDENT_EMAIL", "release-smoke@evo.invalid"],
    ["EVO_PRODUCTION_SMOKE_STUDENT_EMAIL", "student@example.invalid?bad value"],
    ["EVO_PRODUCTION_SMOKE_STUDENT_PASSWORD", ""],
    ["EVO_PRODUCTION_SMOKE_CASE_ID", "12345678-1234-1234-1234-123456789abc&tab=money"],
    ["EVO_PRODUCTION_SMOKE_RECEIPT", "relative.json"],
  ]) {
    assert.throws(() =>
      readProductionSmokeConfiguration({ ...environment(), [name]: value }),
    );
  }
  for (const name of ["EVO_PRODUCTION_SMOKE_CASE_ID", "EVO_PRODUCTION_SMOKE_STUDENT_EMAIL", "EVO_PRODUCTION_SMOKE_STUDENT_PASSWORD"]) {
    const input = environment();
    delete input[name];
    assert.throws(() => readProductionSmokeConfiguration(input));
  }
});

test("receipt writer creates one private file and refuses replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evo-browser-receipt-"));
  const path = join(directory, "receipt.json");
  const receipt = buildProductionSmokeReceipt(
    readProductionSmokeConfiguration(environment(path)),
  );
  try {
    await writeProductionSmokeReceipt(path, receipt);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(await readFile(path, "utf8"), `${JSON.stringify(receipt)}\n`);
    await assert.rejects(writeProductionSmokeReceipt(path, receipt));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("source contract: receipt follows real case and isolated Student journeys", () => {
  // These assertions inspect wiring only. Acceptance requires the real CLI on the deployed candidate.
  assert.match(smokeSource, /const browser = await chromium\.launch\(/u);
  assert.doesNotMatch(smokeSource, /chromiumRuntime|writeReceipt\s*=/u);
  assert.equal((smokeSource.match(/await browser\.newContext\(/gu) ?? []).length, 2);
  assert.match(smokeSource, /response\?\.status\(\) !== 200 \|\| page\.url\(\) !== url/u);
  assert.match(smokeSource, /tab=route/u);
  assert.match(smokeSource, /getByTestId\("admissions-route"\)/u);
  assert.match(smokeSource, /tab=contract/u);
  assert.match(smokeSource, /getAttribute\("data-student-case-id"\) !== configuration\.caseId/u);
  assert.match(smokeSource, /signIn\(page, configuration\.studentBaseUrl, configuration\.studentEmail, configuration\.studentPassword, "\/portal"\)/u);
  assert.match(smokeSource, /getByTestId\("student-portal-shell"\)/u);
  assert.match(smokeSource, /\/portal\/documents/u);
  assert.match(smokeSource, /Разделы кабинета/u);
  assert.equal((smokeSource.match(/await verifyVersion\(page, configuration\)/gu) ?? []).length, 1);
  assert.deepEqual([...smokeSource.matchAll(/checkpoint\("([a-z_]+)"\)/gu)].map((match) => match[1]), [
    "admin_login", "case_route", "case_contract", "team_chat", "student_login", "student_overview", "student_documents", "student_navigation",
  ]);
  assert.ok(smokeSource.indexOf('"production_student_smoke_passed"') < smokeSource.indexOf("await writeProductionSmokeReceipt(configuration.receiptPath"));
  assert.ok(smokeSource.indexOf('if (page.url() !== `${baseUrl}/login`)') < smokeSource.indexOf('page.locator("#staff-email").fill(email)'));
});

test("team chat checks the real read-only page before issuing the receipt", () => {
  const chatCheck = smokeSource.split('checkpoint("team_chat");')[1]?.split("    } finally {")[0];
  assert.ok(chatCheck);
  assert.ok(chatCheck.includes('await visit(page, `${configuration.baseUrl}/v3/team-chat`);'));
  for (const label of ["Каналы команды", "История сообщений", "Сообщение в канал"]) {
    assert.ok(chatCheck.includes(label));
  }
  assert.equal((chatCheck.match(/\.waitFor\(\{ state: "visible"/gu) ?? []).length, 3);
  assert.ok(chatCheck.includes('getByText("Сообщения появляются автоматически", { exact: true }).count()'));
  assert.ok(chatCheck.includes('getByText("Внутренняя переписка сотрудников EVO", { exact: true }).count()'));
  assert.ok(chatCheck.includes('getByRole("button", { name: /^(Приглушить|Включить уведомления)$/u }).count()'));
  assert.ok(chatCheck.includes('(await channels.innerText()).includes("· тихо")'));
  assert.match(chatCheck, /throw new Error\("team_chat_cleanup_incomplete"\)/u);
  assert.match(chatCheck, /if \(runtimeError\) throw new Error\("staff_runtime_error"\)/u);
  assert.doesNotMatch(chatCheck, /\.click\(|\.fill\(|\.press\(|\.request\./u);
  assert.ok(smokeSource.indexOf('"production_team_chat_smoke_passed"') < smokeSource.indexOf("await writeProductionSmokeReceipt(configuration.receiptPath"));
});

test("smoke has no business interaction or sensitive browser evidence path", () => {
  assert.equal((smokeSource.match(/\.click\(\)/gu) ?? []).length, 2);
  assert.match(smokeSource, /form\[aria-labelledby="login-title"\] button\[type="submit"\]/u);
  assert.doesNotMatch(smokeSource, /\.screenshot\(|tracing\.|storageState|\.cookies\(/u);
  assert.doesNotMatch(smokeSource, /waha|whatsapp|gemini|amocrm/iu);
});

test("CLI errors are sanitized and never echo missing credential names", () => {
  const script = new URL("../scripts/evo-production-browser-smoke.mjs", import.meta.url);
  const result = spawnSync(process.execPath, [fileURLToPath(script)], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    '{"ok":false,"code":"production_browser_smoke_failed"}\n',
  );
});
