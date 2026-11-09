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
} from "../scripts/release/evo-production-browser-smoke.mjs";

const REVISION = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;
const smokeSource = readFileSync(
  new URL("../scripts/release/evo-production-browser-smoke.mjs", import.meta.url),
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
  assert.match(smokeSource, /getByTestId\("v3-universities-programs"\)/u);
  assert.match(smokeSource, /tab=contract/u);
  assert.match(smokeSource, /getAttribute\("data-student-case-id"\) !== configuration\.caseId/u);
  assert.match(smokeSource, /signIn\(page, configuration\.studentBaseUrl, configuration\.studentEmail, configuration\.studentPassword, "\/portal", \{ consentGate: true \}\)/u);
  // 356 (09.11.2026): the Student sign-in may meet the consent screen; it is passed deterministically (both boxes,
  // «Продолжить», back to the requested page) and only for the Student, never for the staff sign-in.
  assert.match(smokeSource, /async function passConsentGate\(page, baseUrl, destination\)/u);
  assert.match(smokeSource, /getByTestId\("consent-gate"\)/u);
  assert.match(smokeSource, /getByTestId\("consent-gate-submit"\)\.click\(\)/u);
  assert.match(smokeSource, /if \(consentGate\) await passConsentGate\(page, baseUrl, destination\);/u);
  assert.equal((smokeSource.match(/consentGate: true/gu) ?? []).length, 1, "only the Student sign-in opts in");
  assert.match(smokeSource, /getByTestId\("student-portal-shell"\)/u);
  assert.match(smokeSource, /\/portal\/documents/u);
  assert.match(smokeSource, /Разделы кабинета/u);
  // #1412: рейл и нижняя панель телефона оба ссылаются на /portal; смоук кликает только видимую ссылку.
  assert.match(smokeSource, /locator\('a\[href="\/portal"\]:visible'\)\.click\(\)/u);
  assert.equal((smokeSource.match(/await verifyVersion\(page, configuration\)/gu) ?? []).length, 1);
  assert.deepEqual([...smokeSource.matchAll(/checkpoint\("([a-z_]+)"\)/gu)].map((match) => match[1]), [
    // OTH-1: «Воронка поступления» checkpoint added right after case_contract,
    // mirroring that checkpoint's own visit()+getByTestId()+runtimeError shape.
    // Э0 (25.09): «Студенты» and EVO Docs queue checkpoints right after the admissions board.
    "admin_login", "case_route", "case_contract", "admissions_pipeline", "students_queue", "evo_docs", "team_chat", "student_login", "student_overview", "student_documents", "student_navigation",
  ]);
  assert.ok(smokeSource.indexOf('"production_student_smoke_passed"') < smokeSource.indexOf("await writeProductionSmokeReceipt(configuration.receiptPath"));
  assert.ok(smokeSource.indexOf('if (page.url() !== `${baseUrl}/login`)') < smokeSource.indexOf('page.locator("#staff-email").fill(email)'));
});

test("team chat checks the real read-only page before issuing the receipt", () => {
  const chatCheck = smokeSource.split('checkpoint("team_chat");')[1]?.split("    } finally {")[0];
  assert.ok(chatCheck);
  assert.ok(chatCheck.includes('await visit(page, `${configuration.baseUrl}/team-chat`);'));
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
  // Sign-in submit, the navigation link and (356) the consent screen's «Продолжить» for the isolated smoke Student.
  assert.equal((smokeSource.match(/\.click\(\)/gu) ?? []).length, 3);
  assert.match(smokeSource, /form\[aria-labelledby="login-title"\] button\[type="submit"\]/u);
  assert.doesNotMatch(smokeSource, /\.screenshot\(|tracing\.|storageState|\.cookies\(/u);
  assert.doesNotMatch(smokeSource, /waha|whatsapp|gemini|amocrm/iu);
});

test("CLI errors are sanitized and never echo missing credential names", () => {
  const script = new URL("../scripts/release/evo-production-browser-smoke.mjs", import.meta.url);
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

test("«Студенты» and EVO Docs smoke checks the real queue without depending on data", () => {
  const verify = smokeSource.slice(smokeSource.indexOf("async function verifyStudentsQueue("), smokeSource.indexOf("export async function runProductionBrowserSmoke("));
  // The container renders in every queue state, so a refusal, a list error and missing counts fail at once.
  assert.match(verify, /getByTestId\("v3-student-case-directory"\)\.waitFor\(\{ state: "visible", timeout: 30_000 \}\)/u);
  for (const [id, suffix] of [["queue-forbidden", "forbidden"], ["queue-error", "unavailable"], ["queue-counts-unavailable", "counts_unavailable"]]) {
    assert.ok(verify.includes(`if (await page.getByTestId("${id}").count()) throw new Error(\`\${prefix}_${suffix}\`);`), id);
  }
  assert.match(verify, /getByRole\("navigation", \{ name: "Виды списка студентов", exact: true \}\)/u);
  assert.match(verify, /views\.getByRole\("link", \{ name: tab \}\)\.first\(\)\.waitFor\(\{ state: "visible", timeout: 30_000 \}\)/u);
  for (const [name, route, prefix, tab] of [
    ["students_queue", "/profile`", "students_queue", "Все в работе"],
    ["evo_docs", "/profile?section=docs`", "evo_docs_queue", "Документы дела"],
  ]) {
    const check = smokeSource.split(`checkpoint("${name}");`)[1]?.split("checkpoint(")[0] ?? "";
    assert.ok(check.includes(`\${configuration.baseUrl}${route}`), `${name} visits ${route}`);
    assert.ok(check.includes(`await verifyStudentsQueue(page, "${prefix}", /^${tab}/u);`), `${name} checks its own tab`);
    assert.match(check, /if \(runtimeError\) throw new Error\("staff_runtime_error"\)/u);
  }
  // The selectors are the real components' — renaming one there breaks this test, not the release.
  const component = (path) => readFileSync(new URL(`../src/components/staff/${path}`, import.meta.url), "utf8");
  // С #1327 очередь и EVO Docs рисует «Новый вид»: контейнер и состояния — у `StudentsNextPage`, вкладки и ошибки — у его видов.
  const page = component("students-next/StudentsNextPage.tsx");
  assert.match(page, /<Alert testId="queue-forbidden"/u);
  assert.match(page, /<div className="grid min-w-0 gap-4" data-testid="v3-student-case-directory">\{body\}<\/div>/u, "the container wraps every state: queue, EVO Docs, refusal, error");
  for (const file of ["students-next/StudentsQueueNext.tsx", "students-next/DocsNext.tsx"]) {
    assert.match(component(file), /data-testid="queue-counts-unavailable"/u, file);
    assert.match(component(file), /data-testid="queue-error"/u, file);
    assert.match(component(file), /label="Виды списка студентов"/u, file);
  }
  const labels = component("students/students-queue-view.ts");
  assert.match(labels, /active: "Все в работе"/u);
  assert.match(labels, /review: "Документы дела"/u);
});
