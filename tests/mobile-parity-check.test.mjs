// «Mobile parity» (AGENTS.md, «Кабинет и приложение идут вместе», 25.11.2026): the guard script, the gate wiring in the
// fast PR checks, the PR template and the rule text. Nothing here reaches the real GitHub: the API is a fake `fetch` or a
// loopback HTTP server, git runs in throwaway repositories.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MIN_REASON_LENGTH,
  checkReason,
  createGitHubClient,
  evaluateParity,
  isCabinetUiPath,
  isMobileAppChange,
  isTestFile,
  main,
  normalizePath,
  parseArgs,
  parseDeclarations,
  parseFileList,
  renderFailure,
  stripHtmlComments,
} from "../scripts/ci/mobile-parity-check.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = join(root, "scripts/ci/mobile-parity-check.mjs");
const read = (path) => readFileSync(join(root, path), "utf8");

const REASON = "у приложения нет такого экрана";
const CABINET_FILE = "src/components/portal/home/HomeHero.tsx";
const MOBILE_FILE = "mobile/src/features/home/HomeScreen.tsx";

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "evo-mobile-parity-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const collector = () => {
  const chunks = [];
  return { write: (text) => { chunks.push(text); return true; }, text: () => chunks.join("") };
};
const never = (name) => () => { throw new Error(`${name} must not be called`); };
const reply = (status, body = {}) => ({ status, json: async () => body });

// ---------------------------------------------------------------------------------------------------------------------
// Which files count
// ---------------------------------------------------------------------------------------------------------------------

test("cabinet UI is src/app/(portal) and src/components/portal in any file type, minus test files", () => {
  for (const path of [
    "src/app/(portal)/portal/page.tsx",
    "src/app/(portal)/portal.css",
    "src/app/(portal)/layout.tsx",
    "src/app/(portal)/portal/documents/page.tsx",
    "src/components/portal/Shell.tsx",
    "src/components/portal/home/HomeHero.tsx",
    "src/components/portal/home/home.css",
    "src/components/portal/admission/presentation.ts",
    // A folder called «tests» here is product UI (the English and career tests), not a test folder.
    "src/components/portal/tests/AssessmentPage.tsx",
  ]) assert.equal(isCabinetUiPath(path), true, path);

  for (const path of [
    // Shared logic: the app imports it as @web/*, so a change there already reaches both.
    "src/lib/portal/home-dates.ts",
    "tests/portal-evi.test.mjs",
    "tests/e2e/portal-accessibility.spec.ts",
    "docs/portal/country-timeline-contract.md",
    "docs/design/v3/product.md",
    // Staff product, other apps and look-alike prefixes.
    "src/components/staff/Foo.tsx",
    "src/app/(staff)/main/page.tsx",
    "src/app/api/portal/mobile/evi/route.ts",
    "src/components/portal-extra/Foo.tsx",
    "src/components/portals/Foo.tsx",
    "src/app/(portal)x/page.tsx",
    "mobile/src/features/home/HomeScreen.tsx",
    ".github/pull_request_template.md",
    "AGENTS.md",
  ]) assert.equal(isCabinetUiPath(path), false, path);
});

test("test files inside the cabinet folders do not count: *.test.*, *.spec.* and __tests__", () => {
  for (const path of [
    "src/components/portal/home/HomeHero.test.tsx",
    "src/components/portal/home/HomeHero.test.ts",
    "src/components/portal/home/home.test.mjs",
    "src/components/portal/home/HomeHero.spec.tsx",
    "src/components/portal/home/__tests__/HomeHero.tsx",
    "src/components/portal/home/__tests__/fixtures/data.json",
    "src/app/(portal)/portal/page.test.tsx",
    "src/app/(portal)/__tests__/helpers.ts",
  ]) {
    assert.equal(isTestFile(path), true, path);
    assert.equal(isCabinetUiPath(path), false, path);
  }
  for (const path of ["src/components/portal/home/latest.tsx", "src/components/portal/tests/AssessmentRunner.tsx", "src/components/portal/home/testimonial.css"]) {
    assert.equal(isTestFile(path), false, path);
  }
});

test("an app change is any file under mobile/ except markdown", () => {
  for (const path of ["mobile/src/app/(app)/index.tsx", MOBILE_FILE, "mobile/package.json", "mobile/app.config.ts", "mobile/src/home/__tests__/Home.test.tsx"]) {
    assert.equal(isMobileAppChange(path), true, path);
  }
  for (const path of ["mobile/AGENTS.md", "mobile/docs/guide.MD", "mobile/notes.mdx", "mobile/readme.markdown", "docs/mobile/PLAN.md", "mobile-extra/x.ts", "src/lib/portal/x.ts", "mobile"]) {
    assert.equal(isMobileAppChange(path), false, path);
  }
});

test("paths are normalised and file lists accept newlines, NUL and duplicates", () => {
  assert.equal(normalizePath("./src/components/portal/Shell.tsx"), "src/components/portal/Shell.tsx");
  assert.equal(normalizePath("src\\components\\portal\\Shell.tsx"), "src/components/portal/Shell.tsx");
  assert.deepEqual(parseFileList("a.ts\r\n\r\n./b.ts\na.ts\n"), ["a.ts", "b.ts"]);
  assert.deepEqual(parseFileList("src/app/(portal)/a b.tsx\0mobile/c.ts\0"), ["src/app/(portal)/a b.tsx", "mobile/c.ts"]);
  assert.deepEqual(parseFileList(""), []);
});

// ---------------------------------------------------------------------------------------------------------------------
// The lines of the description
// ---------------------------------------------------------------------------------------------------------------------

test("«не нужно» line: every dash, any case, markdown marks, CRLF", () => {
  for (const dash of ["-", "‐", "‑", "‒", "–", "—", "―", "−", "--"]) {
    const [note] = parseDeclarations(`Приложение: не нужно ${dash} ${REASON}`).notNeeded;
    assert.equal(note?.ok, true, `dash U+${dash.codePointAt(0).toString(16)}`);
    assert.equal(note.reason, REASON);
  }
  for (const line of [
    `ПРИЛОЖЕНИЕ: НЕ НУЖНО — ${REASON}`,
    `приложение: Не Нужно — ${REASON}`,
    `Приложение :  не   нужно  —  ${REASON}`,
    `Приложение：не нужно — ${REASON}`,
    `Приложение: не нужно —${REASON}`,
    `- Приложение: не нужно — ${REASON}`,
    `* Приложение: не нужно — ${REASON}`,
    `> Приложение: не нужно — ${REASON}`,
    `   Приложение: не нужно — ${REASON}`,
    `**Приложение:** не нужно — ${REASON}`,
    `**Приложение: не нужно** — ${REASON}`,
    `__Приложение:__ не нужно — ${REASON}`,
    `## Приложение: не нужно — ${REASON}`,
    `1. Приложение: не нужно — ${REASON}`,
    `2) приложение: не нужно — ${REASON}`,
    `- 3. Приложение: не нужно — ${REASON}`,
    `1. **Приложение:** не нужно — ${REASON}`,
    `2) __Приложение__: не нужно — ${REASON}`,
    `- 4. \`Приложение: не нужно — ${REASON}\``,
    `\`Приложение: не нужно — ${REASON}\``,
    `**\`Приложение:\`** не нужно — ${REASON}`,
  ]) assert.equal(parseDeclarations(line).notNeeded[0]?.ok, true, line);

  const body = `Что изменилось: шапка.\r\n\r\nПриложение: не нужно — ${REASON}\r\nЕщё текст.\r\n`;
  assert.equal(parseDeclarations(body).notNeeded[0]?.ok, true);
  // It is a line that STARTS with the words: the same words in the middle of a sentence do not declare anything.
  assert.deepEqual(parseDeclarations(`Итог. Приложение: не нужно — ${REASON}`), { notNeeded: [], separate: [], unrecognized: [] });
});

test("the reason is real words of at least 12 characters, counted as characters, not an unfilled placeholder", () => {
  assert.equal(MIN_REASON_LENGTH, 12);
  assert.equal(checkReason("а".repeat(11)).ok, false);
  assert.equal(checkReason("а".repeat(12)).ok, true);
  assert.equal(checkReason("  а".repeat(12)).ok, true);
  assert.match(checkReason("не надо").problem, /короче 12 знаков \(сейчас 7\)/u);
  // Characters, not UTF-16 units: six astral letters are 12 units but 6 characters.
  assert.equal(checkReason("\u{1D400}".repeat(6)).ok, false);
  assert.equal(checkReason("\u{1D400}".repeat(12)).ok, true);
  for (const placeholder of ["<причина>", "<причина, не короче 12 знаков>", "<…>", "<you must say why this is not needed here>"]) {
    assert.match(checkReason(placeholder).problem, /шаблон/u, placeholder);
  }
  for (const junk of ["............", "-------------", "1234567890123", "😀😀😀😀😀😀😀😀😀😀😀😀"]) {
    assert.equal(checkReason(junk).ok, false, junk);
  }
  assert.equal(checkReason("").ok, false);
  assert.equal(checkReason(undefined).ok, false);
  // Closing bold marks are not part of the reason.
  assert.equal(parseDeclarations(`**Приложение: не нужно — ${"а".repeat(11)}**`).notNeeded[0].ok, false);
  assert.equal(parseDeclarations(`**Приложение: не нужно — ${"а".repeat(12)}**`).notNeeded[0].ok, true);
  // The line copied from AGENTS.md with its backticks: the closing one is not part of the reason either.
  assert.equal(parseDeclarations(`\`Приложение: не нужно — ${"а".repeat(11)}\``).notNeeded[0].ok, false);
  assert.equal(parseDeclarations(`\`Приложение: не нужно — ${"а".repeat(12)}\``).notNeeded[0].ok, true);
  assert.match(parseDeclarations("`Приложение: не нужно — <причина>`").notNeeded[0].problem, /шаблон/u);
  // The template's bare heading is not a line to fill in; only «Приложение:» with a colon is.
  assert.deepEqual(parseDeclarations("## Приложение\n\nприложение — это мобильный клиент"), { notNeeded: [], separate: [], unrecognized: [] });
});

test("HTML comments are not the description: the template's example lines never count", () => {
  assert.equal(stripHtmlComments("a<!-- x -->b"), "ab");
  assert.equal(stripHtmlComments("a<!--\nmulti\nline\n-->b<!-- y -->c"), "abc");
  assert.equal(stripHtmlComments("a<!-- never closed\nПриложение: не нужно — слова слова слова"), "a");
  assert.equal(stripHtmlComments(null), "");

  const hidden = `<!--\nПриложение: не нужно — ${REASON}\nПриложение: отдельным PR #1540\n-->\n`;
  assert.deepEqual(parseDeclarations(hidden), { notNeeded: [], separate: [], unrecognized: [] });
  assert.equal(parseDeclarations(`${hidden}Приложение: не нужно — ${REASON}`).notNeeded.length, 1);
  assert.deepEqual(parseDeclarations("Приложение: <!-- заполните -->").unrecognized, ["Приложение:"]);
});

test("«отдельным PR #N»: the number is found in the usual spellings, the first number wins", () => {
  for (const line of [
    "Приложение: отдельным PR #1540",
    "приложение: ОТДЕЛЬНЫМ pr #1540",
    "Приложение: отдельным PR#1540",
    "Приложение: отдельным ПР #1540",
    "Приложение: отдельным pull request #1540",
    "Приложение: отдельным #1540",
    "Приложение: отдельным PR # 1540",
    "- **Приложение:** отдельным PR #1540 (ветка mobile/professions)",
    "Приложение: отдельным PR #1540, потом #1541",
  ]) assert.deepEqual(parseDeclarations(line).separate.map((entry) => entry.number), [1540], line);
  for (const line of ["Приложение: отдельным PR", "Приложение: отдельным PR #abc", "Приложение: отдельным PR 1540", "Приложение: обновлено в этом PR (папка mobile/)"]) {
    assert.equal(parseDeclarations(line).separate.length, 0, line);
    assert.equal(parseDeclarations(line).unrecognized.length, 1, line);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------------------------------------------------

test("no cabinet UI change: nothing else is looked at", async () => {
  for (const files of [
    [],
    ["src/lib/portal/home-dates.ts", "tests/portal-evi.test.mjs", "docs/design/v3/product.md", "src/components/staff/Foo.tsx", MOBILE_FILE],
    [`${CABINET_FILE.replace(".tsx", ".test.tsx")}`, "src/components/portal/home/__tests__/a.ts"],
  ]) {
    const result = await evaluateParity({ files, readBody: never("readBody"), lookupPullRequest: never("lookupPullRequest") });
    assert.deepEqual([result.outcome, result.reason], ["pass", "no-cabinet-change"], files.join(","));
  }
});

test("a change of the app passes together with the cabinet, markdown does not count", async () => {
  const noBody = { readBody: never("readBody"), lookupPullRequest: never("lookupPullRequest") };
  const result = await evaluateParity({ files: [CABINET_FILE, MOBILE_FILE], ...noBody });
  assert.deepEqual([result.outcome, result.reason, result.mobile], ["pass", "mobile-changed", [MOBILE_FILE]]);

  const markdownOnly = await evaluateParity({ files: [CABINET_FILE, "mobile/AGENTS.md", "docs/mobile/PLAN.md"], readBody: async () => "", lookupPullRequest: never("lookup") });
  assert.equal(markdownOnly.outcome, "fail");
});

test("the «не нужно» line passes; a bad one fails with the reason why", async () => {
  const run = (body) => evaluateParity({ files: [CABINET_FILE], readBody: async () => body, lookupPullRequest: never("lookupPullRequest") });
  const pass = await run(`Текст\n\nПриложение: не нужно — ${REASON}\n`);
  assert.deepEqual([pass.outcome, pass.reason], ["pass", "not-needed"]);

  for (const [body, expected] of [
    ["Приложение: не нужно — не надо", /короче 12 знаков/u],
    ["Приложение: не нужно — <причина>", /шаблон/u],
    ["Приложение: не нужно", /не подходит ни под одну из форм/u],
    ["Приложение:", /не заполнена/u],
    ["Приложение: обновлено в этом PR (папка mobile/)", /не подходит ни под одну из форм/u],
    ["Просто описание без строки про приложение", null],
    ["", null],
    [null, null],
  ]) {
    const result = await run(body);
    assert.equal(result.outcome, "fail", String(body));
    if (expected) assert.match(result.problems.join("\n"), expected, String(body));
    else assert.deepEqual(result.problems, []);
  }
});

test("the «отдельным PR» line needs an existing PR: open or merged, not closed, not missing, not this one", async () => {
  const lookups = [];
  const run = async (body, found, currentPullRequest = 77) => {
    lookups.length = 0;
    return evaluateParity({
      files: [CABINET_FILE],
      currentPullRequest,
      readBody: async () => body,
      lookupPullRequest: async (number) => { lookups.push(number); return typeof found === "function" ? found(number) : found; },
    });
  };
  const line = "Приложение: отдельным PR #1540";

  const open = await run(line, { found: true, state: "open", merged: false });
  assert.deepEqual([open.outcome, open.reason, open.number, open.merged, lookups], ["pass", "separate-pr", 1540, false, [1540]]);
  const merged = await run(line, { found: true, state: "closed", merged: true });
  assert.deepEqual([merged.outcome, merged.merged], ["pass", true]);

  const closed = await run(line, { found: true, state: "closed", merged: false });
  assert.equal(closed.outcome, "fail");
  assert.match(closed.problems.join("\n"), /PR #1540: закрыт без слияния/u);
  const missing = await run(line, { found: false });
  assert.equal(missing.outcome, "fail");
  assert.match(missing.problems.join("\n"), /PR #1540: такого PR нет/u);

  const self = await run("Приложение: отдельным PR #77", { found: true, state: "open" }, 77);
  assert.equal(self.outcome, "fail");
  assert.match(self.problems.join("\n"), /это сам этот PR/u);
  assert.deepEqual(lookups, [], "the PR itself is not looked up");

  // A bad note followed by a good PR line passes; the first valid declaration wins.
  const mixed = await run(`Приложение: не нужно — коротко\nПриложение: отдельным PR #1540`, { found: true, state: "open" });
  assert.equal(mixed.outcome, "pass");
  const second = await run(`Приложение: отдельным PR #5\nПриложение: отдельным PR #1540`, (number) => (number === 1540 ? { found: true, state: "open" } : { found: false }));
  assert.deepEqual([second.outcome, second.number, lookups], ["pass", 1540, [5, 1540]]);
});

test("the guard's own errors never fail the check: they are fail-open results", async () => {
  const boom = (message) => async () => { throw new Error(message); };
  const body = await evaluateParity({ files: [CABINET_FILE], readBody: boom("API 500"), lookupPullRequest: never("lookup") });
  assert.equal(body.outcome, "fail-open");
  assert.match(body.warning, /не удалось прочитать описание PR \(API 500\)/u);

  const lookup = await evaluateParity({ files: [CABINET_FILE], readBody: async () => "Приложение: отдельным PR #1540", lookupPullRequest: boom("timeout") });
  assert.equal(lookup.outcome, "fail-open");
  assert.match(lookup.warning, /не удалось проверить PR #1540 \(timeout\)/u);
});

test("the failure message says what triggered it, the three ways to fix and how to re-run", () => {
  const files = Array.from({ length: 17 }, (_, index) => `src/components/portal/home/Part${index}.tsx`);
  const text = renderFailure({ cabinet: files, problems: ["строка «Приложение:» не заполнена"], runId: "9001" });
  assert.match(text, /кабинет студента изменён, а приложение — нет/u);
  assert.match(text, /\(17 файлов\)/u);
  assert.ok(text.includes("  - src/components/portal/home/Part0.tsx"));
  assert.ok(text.includes("  - src/components/portal/home/Part14.tsx"));
  assert.ok(!text.includes("Part15.tsx"));
  assert.ok(text.includes("… и ещё 2"));
  assert.ok(text.includes("Что не так в описании:\n  - строка «Приложение:» не заполнена"));
  assert.ok(text.includes("1. Обновить приложение в этом же PR"));
  assert.ok(text.includes("Приложение: не нужно — <причина, не короче 12 знаков>"));
  assert.ok(text.includes("Приложение: отдельным PR #<номер>"));
  assert.ok(text.includes("gh run rerun 9001 --failed --repo izzhackt/evo_AI_CRM"));
  assert.match(text, /Правка описания проверку сама не запускает/u);
  assert.ok(text.includes('git commit --allow-empty -m "chore: перезапуск проверок" && git push'), "a way out for those who cannot re-run jobs");
  assert.match(text, /AGENTS\.md, раздел «Кабинет и приложение идут вместе»/u);
  assert.match(renderFailure({ cabinet: ["src/components/portal/a.tsx"] }), /\(1 файл\)[\s\S]*gh run rerun <run-id> --failed/u);
  assert.match(renderFailure({ cabinet: files.slice(0, 3) }), /\(3 файла\)/u);
  assert.equal(renderFailure({ cabinet: files.slice(0, 3) }).includes("Что не так в описании"), false);
});

// ---------------------------------------------------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------------------------------------------------

test("the API client reads one pull request, retries network errors, 5xx and 429, and gives up on other statuses", async () => {
  const calls = [];
  const client = (responses, options = {}) => {
    let index = 0;
    return createGitHubClient({
      repository: "izzhackt/evo_AI_CRM",
      token: "test-token",
      sleep: async () => {},
      fetchImpl: async (url, init) => {
        calls.push({ url, headers: init.headers });
        const next = responses[Math.min(index, responses.length - 1)];
        index += 1;
        if (next instanceof Error) throw next;
        return next;
      },
      ...options,
    });
  };

  calls.length = 0;
  const ok = await client([reply(200, { body: "text", state: "open" })]).getPull(77);
  assert.deepEqual(ok, { found: true, data: { body: "text", state: "open" } });
  assert.equal(calls[0].url, "https://api.github.com/repos/izzhackt/evo_AI_CRM/pulls/77");
  assert.equal(calls[0].headers.Authorization, "Bearer test-token");
  assert.match(calls[0].headers.Accept, /application\/vnd\.github\+json/u);
  assert.ok(calls[0].headers["User-Agent"]);

  calls.length = 0;
  assert.deepEqual(await client([reply(404)]).getPull(5), { found: false });
  assert.equal(calls.length, 1, "a missing PR is an answer, not an error");

  calls.length = 0;
  assert.equal((await client([reply(502), new Error("socket hang up"), reply(200, { body: "ok" })]).getPull(1)).found, true);
  assert.equal(calls.length, 3);
  calls.length = 0;
  assert.equal((await client([reply(429), reply(200, {})]).getPull(1)).found, true);

  for (const status of [401, 403, 422]) {
    calls.length = 0;
    await assert.rejects(client([reply(status)]).getPull(1), new RegExp(`GitHub API ответил ${status}`, "u"));
    assert.equal(calls.length, 1, `${status} is not retried`);
  }
  calls.length = 0;
  await assert.rejects(client([reply(500)]).getPull(1), /GitHub API ответил 500/u);
  assert.equal(calls.length, 3, "three attempts, then the error");
  calls.length = 0;
  await assert.rejects(client([new Error("ECONNRESET")]).getPull(1), /ECONNRESET/u);

  const anonymous = createGitHubClient({ repository: "a/b", apiUrl: "https://ghe.example.test/api/v3/", fetchImpl: async (url, init) => { calls.push({ url, headers: init.headers }); return reply(404); } });
  calls.length = 0;
  await anonymous.getPull(9);
  assert.equal(calls[0].url, "https://ghe.example.test/api/v3/repos/a/b/pulls/9");
  assert.equal("Authorization" in calls[0].headers, false, "no token, no header");
});

// ---------------------------------------------------------------------------------------------------------------------
// The command: exit codes, output, fail-open
// ---------------------------------------------------------------------------------------------------------------------

function inputs(t, { files = [CABINET_FILE], body = "" } = {}) {
  const dir = scratch(t);
  writeFileSync(join(dir, "files.txt"), `${files.join("\n")}\n`);
  writeFileSync(join(dir, "body.md"), body);
  return { dir, filesFile: join(dir, "files.txt"), bodyFile: join(dir, "body.md") };
}
async function run(argv, env = {}, deps = {}) {
  const stdout = collector();
  const code = await main({ argv, env, stdout, deps });
  return { code, text: stdout.text() };
}

test("command: a cabinet change without the app and without a line fails with the Russian message", async (t) => {
  const { filesFile, bodyFile, dir } = inputs(t);
  const summary = join(dir, "summary.md");
  const local = await run(["--files-file", filesFile, "--body-file", bodyFile]);
  assert.equal(local.code, 1);
  assert.match(local.text, /^Mobile parity: кабинет студента изменён, а приложение — нет\./u);
  assert.ok(local.text.includes(`  - ${CABINET_FILE}`));
  assert.equal(local.text.includes("::error"), false, "annotations are for Actions only");

  const actions = await run(["--files-file", filesFile, "--body-file", bodyFile], { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "pull_request", GITHUB_RUN_ID: "4242", GITHUB_STEP_SUMMARY: summary });
  assert.equal(actions.code, 1);
  assert.ok(actions.text.includes("gh run rerun 4242 --failed --repo izzhackt/evo_AI_CRM"));
  const annotation = actions.text.split("\n").find((line) => line.startsWith("::error title=Mobile parity::"));
  assert.ok(annotation, "an error annotation");
  assert.equal(annotation.includes("\n"), false);
  assert.match(annotation, /Приложение: не нужно — <причина>/u);
  assert.match(readFileSync(summary, "utf8"), /^## Mobile parity\n\n    Mobile parity: кабинет студента изменён/u);
});

test("command: text from a pull request never starts a workflow command and never carries control characters", async (t) => {
  const body = [
    "Приложение: ::error::fake annotation",
    "Приложение: не нужно — \u001b[31m::x",
    "::stop-commands::token",
    "Приложение: отдельным PR #5 \u0085 \u2028 ::warning::x",
  ].join("\n");
  const { filesFile, bodyFile, dir } = inputs(t, { files: [CABINET_FILE, "src/components/portal/we\u001bird.tsx", "src/components/portal/a\u0007b.tsx"], body });
  const summary = join(dir, "summary.md");
  const result = await run(["--files-file", filesFile, "--body-file", bodyFile, "--pr", "9"], { GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: summary }, { fetchImpl: async () => reply(404) });
  assert.equal(result.code, 1);
  // Only the guard's own annotations may begin a line with «::».
  const commands = result.text.split("\n").filter((line) => line.trimStart().startsWith("::"));
  assert.equal(commands.length, 1, commands.join("\n"));
  assert.match(commands[0], /^::error title=Mobile parity::/u);
  assert.equal(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/u.test(result.text.replace(/\n/gu, "")), false, "no control characters in the log");
  assert.ok(result.text.includes("  - src/components/portal/we ird.tsx"), "the escape character became a space");
  assert.ok(result.text.includes("  - src/components/portal/a b.tsx"), "the bell character became a space");
  assert.equal(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/u.test(readFileSync(summary, "utf8").replace(/\n/gu, "")), false);
});

test("command: every way to pass exits 0 and says why", async (t) => {
  const withBody = (body, files) => inputs(t, { body, files });

  let given = withBody("описание");
  let result = await run(["--files-file", given.filesFile, "--body-file", given.bodyFile], {}, {});
  assert.equal(result.code, 1);

  given = withBody("описание", ["src/lib/portal/home-dates.ts", "docs/x.md"]);
  result = await run(["--files-file", given.filesFile, "--body-file", given.bodyFile]);
  assert.deepEqual([result.code, /пропуск — PR не меняет кабинет студента/u.test(result.text)], [0, true]);

  given = withBody("", [CABINET_FILE, MOBILE_FILE]);
  result = await run(["--files-file", given.filesFile, "--body-file", given.bodyFile]);
  assert.deepEqual([result.code, /OK — вместе с кабинетом \(1 файл\) изменено приложение: mobile\/src\/features\/home\/HomeScreen\.tsx\./u.test(result.text)], [0, true]);

  given = withBody(`**Приложение:** не нужно – ${REASON}`);
  result = await run(["--files-file", given.filesFile, "--body-file", given.bodyFile]);
  assert.equal(result.code, 0);
  assert.match(result.text, /OK — в описании PR сказано, почему приложению это не нужно/u);

  given = withBody("Приложение: отдельным PR #1540");
  const fetchImpl = async (url) => (url.endsWith("/pulls/1540") ? reply(200, { state: "closed", merged: true, merged_at: "2026-11-25T10:00:00Z" }) : reply(404));
  result = await run(["--files-file", given.filesFile, "--body-file", given.bodyFile, "--pr", "77"], {}, { fetchImpl });
  assert.equal(result.code, 0);
  assert.match(result.text, /приложение в отдельном PR #1540 \(слит\)/u);

  given = withBody("Приложение: отдельным PR #999999");
  result = await run(["--files-file", given.filesFile, "--body-file", given.bodyFile, "--pr", "77"], {}, { fetchImpl });
  assert.equal(result.code, 1);
  assert.match(result.text, /PR #999999: такого PR нет/u);
});

test("command: only pull_request events are checked", async (t) => {
  const { filesFile, bodyFile } = inputs(t);
  for (const event of ["push", "merge_group", "workflow_dispatch", "schedule"]) {
    const result = await run(["--files-file", filesFile, "--body-file", bodyFile], { GITHUB_EVENT_NAME: event });
    assert.equal(result.code, 0, event);
    assert.match(result.text, new RegExp(`пропуск — событие «${event}»`, "u"));
  }
  assert.equal((await run(["--files-file", filesFile, "--body-file", bodyFile, "--event", "push"])).code, 0);
  assert.equal((await run(["--files-file", filesFile, "--body-file", bodyFile], { GITHUB_EVENT_NAME: "pull_request" })).code, 1);
  assert.equal((await run(["--files-file", filesFile, "--body-file", bodyFile, "--event", "pull_request"], { GITHUB_EVENT_NAME: "push" })).code, 1, "the option wins");
});

test("command: its own errors print a warning and exit 0, they never block a PR", async (t) => {
  const { dir, filesFile, bodyFile } = inputs(t);
  const failOpen = async (label, argv, env = {}, deps = {}, expected) => {
    const result = await run(argv, env, deps);
    assert.equal(result.code, 0, label);
    assert.match(result.text, /ВНИМАНИЕ: /u, label);
    assert.match(result.text, /Проверка пропущена, PR из-за этого не блокируется\./u, label);
    if (expected) assert.match(result.text, expected, label);
    const inActions = await run(argv, { ...env, GITHUB_ACTIONS: "true" }, deps);
    assert.equal(inActions.code, 0, `${label} (Actions)`);
    assert.match(inActions.text, /^::warning title=Mobile parity::/mu, label);
    assert.equal(inActions.text.includes("::error"), false, label);
  };

  await failOpen("unknown flag", ["--nope"], {}, {}, /неизвестный аргумент --nope/u);
  await failOpen("flag without a value", ["--base"], {}, {}, /--base: нужно значение/u);
  await failOpen("missing body file", ["--files-file", filesFile, "--body-file", join(dir, "missing.md")], {}, {}, /не удалось прочитать описание PR/u);
  await failOpen("missing files file", ["--files-file", join(dir, "missing.txt"), "--body-file", bodyFile], {}, {}, /проверка сама дала сбой/u);
  await failOpen("a directory instead of a file", ["--files-file", dir, "--body-file", bodyFile]);
  await failOpen("git fails", ["--body-file", bodyFile], {}, { listChangedFiles: () => { throw new Error("git diff origin/main...HEAD не выполнился: bad revision"); } }, /bad revision/u);
  await failOpen("no PR number and no body file", ["--files-file", filesFile], {}, {}, /номер PR неизвестен/u);
  await failOpen("strange repository name", ["--files-file", filesFile, "--pr", "5", "--repo", "not a repo"], {}, {}, /странное имя репозитория/u);
  await failOpen("API 500 on the description", ["--files-file", filesFile, "--pr", "5"], {}, { fetchImpl: async () => reply(500), sleep: async () => {} }, /GitHub API ответил 500/u);
  await failOpen("API 403 on the description", ["--files-file", filesFile, "--pr", "5"], {}, { fetchImpl: async () => reply(403) }, /GitHub API ответил 403/u);
  await failOpen("network error", ["--files-file", filesFile, "--pr", "5"], {}, { fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND"); }, sleep: async () => {} }, /ENOTFOUND/u);
  await failOpen("PR not found for the description", ["--files-file", filesFile, "--pr", "5"], {}, { fetchImpl: async () => reply(404) }, /API не нашёл PR #5/u);
  await failOpen("API fails on the «отдельным PR» lookup", ["--files-file", filesFile, "--body-file", (writeFileSync(join(dir, "separate.md"), "Приложение: отдельным PR #1540"), join(dir, "separate.md")), "--pr", "5"], {}, { fetchImpl: async () => reply(503), sleep: async () => {} }, /не удалось проверить PR #1540/u);
});

test("command: the description comes from the API, with the PR number from the option, PR_NUMBER or the event payload", async (t) => {
  const { dir, filesFile } = inputs(t);
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, authorization: init.headers.Authorization ?? null });
    return reply(200, { body: `Приложение: не нужно — ${REASON}`, state: "open" });
  };
  const eventPath = join(dir, "event.json");
  writeFileSync(eventPath, JSON.stringify({ action: "synchronize", pull_request: { number: 31 } }));

  assert.equal((await run(["--files-file", filesFile, "--pr", "12"], { GITHUB_REPOSITORY: "o/r", GITHUB_TOKEN: "tok" }, { fetchImpl })).code, 0);
  assert.equal((await run(["--files-file", filesFile], { PR_NUMBER: "13", GITHUB_REPOSITORY: "o/r" }, { fetchImpl })).code, 0);
  assert.equal((await run(["--files-file", filesFile], { GITHUB_EVENT_PATH: eventPath }, { fetchImpl })).code, 0);
  assert.equal((await run(["--files-file", filesFile], { GH_TOKEN: "gh-tok", PR_NUMBER: "14" }, { fetchImpl })).code, 0);
  assert.deepEqual(seen.map((entry) => entry.url), [
    "https://api.github.com/repos/o/r/pulls/12",
    "https://api.github.com/repos/o/r/pulls/13",
    "https://api.github.com/repos/izzhackt/evo_AI_CRM/pulls/31",
    "https://api.github.com/repos/izzhackt/evo_AI_CRM/pulls/14",
  ]);
  assert.deepEqual(seen.map((entry) => entry.authorization), ["Bearer tok", null, null, "Bearer gh-tok"]);

  // Nothing is fetched when the check does not need the description.
  seen.length = 0;
  const quiet = inputs(t, { files: ["src/lib/portal/a.ts"] });
  assert.equal((await run(["--files-file", quiet.filesFile, "--pr", "12"], {}, { fetchImpl })).code, 0);
  assert.deepEqual(seen, []);
});

test("command: --help prints the usage and parseArgs reads every option", () => {
  assert.deepEqual(parseArgs(["--base", "main", "--head", "feature", "--files-file", "-", "--body-file", "b.md", "--pr", "7", "--repo", "o/r", "--event", "pull_request"]), {
    base: "main", head: "feature", filesFile: "-", bodyFile: "b.md", pr: "7", repo: "o/r", event: "pull_request", help: false,
  });
  assert.deepEqual(parseArgs([]), { base: "origin/main", head: "HEAD", filesFile: null, bodyFile: null, pr: null, repo: null, event: null, help: false });
  assert.equal(parseArgs(["-h"]).help, true);
  assert.throws(() => parseArgs(["--bogus"]), /неизвестный аргумент/u);
});

test("command: --help and the script as a real process: exit 1 only for a violation", (t) => {
  const { filesFile, bodyFile, dir } = inputs(t);
  const cli = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8", cwd: dir });

  assert.equal(cli(["--help"]).status, 0);
  assert.match(cli(["--help"]).stdout, /кабинет студента и приложение идут вместе/u);
  const violation = cli(["--files-file", filesFile, "--body-file", bodyFile]);
  assert.equal(violation.status, 1);
  assert.match(violation.stdout, /Как исправить/u);
  writeFileSync(bodyFile, `Приложение: не нужно — ${REASON}\n`);
  assert.equal(cli(["--files-file", filesFile, "--body-file", bodyFile]).status, 0);
  writeFileSync(bodyFile, "");
  assert.equal(cli(["--files-file", filesFile, "--body-file", bodyFile], { GITHUB_EVENT_NAME: "push" }).status, 0);
  // Its own failures: bad arguments, a directory instead of a file, git outside a repository.
  assert.equal(cli(["--nope"]).status, 0);
  assert.equal(cli(["--files-file", dir]).status, 0);
  const noGit = cli(["--body-file", bodyFile], { GIT_CEILING_DIRECTORIES: dir, GIT_DIR: join(dir, "no-such-git-dir") });
  assert.equal(noGit.status, 0);
  assert.match(noGit.stdout, /ВНИМАНИЕ: .*git diff origin\/main\.\.\.HEAD не выполнился/u);
});

test("command: stdin as the file list", (t) => {
  const { bodyFile, dir } = inputs(t);
  const result = spawnSync(process.execPath, [script, "--files-file", "-", "--body-file", bodyFile], { input: `${CABINET_FILE}\n`, env: { PATH: process.env.PATH }, encoding: "utf8", cwd: dir });
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes(`  - ${CABINET_FILE}`));
});

test("command: the real HTTP path, against a loopback server that behaves like api.github.com", async (t) => {
  const { filesFile } = inputs(t);
  const requests = [];
  const pulls = { 77: { body: "Просто описание", state: "open" }, 78: { body: `Приложение: не нужно — ${REASON}`, state: "open" }, 79: { body: "Приложение: отдельным PR #1540", state: "open" }, 1540: { body: "app", state: "closed", merged_at: "2026-11-25T09:00:00Z" } };
  const server = createServer((request, response) => {
    requests.push({ url: request.url, headers: request.headers });
    const number = request.url?.match(/^\/repos\/izzhackt\/evo_AI_CRM\/pulls\/(\d+)$/u)?.[1];
    const pull = number ? pulls[number] : undefined;
    response.writeHead(pull ? 200 : 404, { "content-type": "application/json" });
    response.end(JSON.stringify(pull ?? { message: "Not Found" }));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => { server.closeAllConnections?.(); server.close(done); }));
  const env = (pr) => ({ GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_TOKEN: "loopback-token", GITHUB_REPOSITORY: "izzhackt/evo_AI_CRM", PR_NUMBER: String(pr), GITHUB_EVENT_NAME: "pull_request" });

  const noLine = await run(["--files-file", filesFile], env(77));
  assert.equal(noLine.code, 1);
  assert.equal((await run(["--files-file", filesFile], env(78))).code, 0);
  const separate = await run(["--files-file", filesFile], env(79));
  assert.equal(separate.code, 0);
  assert.match(separate.text, /отдельном PR #1540 \(слит\)/u);
  const missing = await run(["--files-file", filesFile], env(404));
  assert.equal(missing.code, 0, "an unknown PR number is the guard's problem, not a violation");
  assert.match(missing.text, /API не нашёл PR #404/u);

  assert.equal(requests[0].url, "/repos/izzhackt/evo_AI_CRM/pulls/77");
  assert.equal(requests[0].headers.authorization, "Bearer loopback-token");
  assert.match(requests[0].headers.accept, /application\/vnd\.github\+json/u);
  assert.equal(requests[0].headers["x-github-api-version"], "2022-11-28");
});

// ---------------------------------------------------------------------------------------------------------------------
// Real git: the list of changed files comes from `git diff <base>...<head>`
// ---------------------------------------------------------------------------------------------------------------------

function repository(t) {
  const dir = scratch(t);
  const env = { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => {
    const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: dir, env, encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const put = (path, text = "x\n") => { mkdirSync(join(dir, path, ".."), { recursive: true }); writeFileSync(join(dir, path), text); };
  const commit = (message, paths) => { git("add", "-A"); git("commit", "-q", "-m", message); return paths; };
  git("init", "-q", "-b", "main");
  // The description lives outside the repository: `git add -A` and branch switches must not touch it.
  const bodyFile = join(scratch(t), "body.txt");
  writeFileSync(bodyFile, "описание\n");
  return { dir, env, git, put, commit, bodyFile };
}

test("git: the PR's own files only, also when main moves on, and a moved file counts on both sides", (t) => {
  const repo = repository(t);
  repo.put("src/components/portal/home/Old.tsx");
  repo.put("src/lib/portal/shared.ts");
  repo.put("README.md");
  repo.commit("base");

  repo.git("checkout", "-q", "-b", "feature");
  repo.put("src/components/portal/home/HomeHero.tsx");
  repo.put("src/app/(portal)/portal.css", "a{}\n");
  repo.put("docs/note.md");
  repo.commit("pr");
  const prHead = repo.git("rev-parse", "HEAD");

  // The merge commit GitHub builds for a pull_request run: main + the PR.
  repo.git("checkout", "-q", "main");
  repo.git("checkout", "-q", "-b", "merge-ref");
  repo.git("merge", "-q", "--no-ff", "-m", "merge", prHead);
  // main moves on with another cabinet change: it must not leak into the PR's list.
  repo.git("checkout", "-q", "main");
  repo.put("src/components/portal/other/Elsewhere.tsx");
  repo.commit("main moves on");

  const cli = (args) => spawnSync(process.execPath, [script, "--body-file", repo.bodyFile, ...args], { cwd: repo.dir, env: repo.env, encoding: "utf8" });
  const result = cli(["--base", "main", "--head", "merge-ref"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\(2 файла\)/u);
  assert.ok(result.stdout.includes("  - src/app/(portal)/portal.css"));
  assert.ok(result.stdout.includes("  - src/components/portal/home/HomeHero.tsx"));
  assert.equal(result.stdout.includes("Elsewhere.tsx"), false, "a change that arrived through main is not the PR's");
  assert.equal(result.stdout.includes("docs/note.md"), false);

  // The same PR with an app change passes.
  repo.git("checkout", "-q", "feature");
  repo.put("mobile/src/features/home/HomeScreen.tsx");
  repo.commit("app");
  assert.match(cli(["--base", "main", "--head", "feature"]).stdout, /OK — вместе с кабинетом \(2 файла\) изменено приложение/u);

  // A cabinet file moved OUT of the cabinet folders is a cabinet change: the old path is listed (no rename detection).
  repo.git("checkout", "-q", "-b", "mover", "main");
  repo.git("mv", "src/components/portal/home/Old.tsx", "src/components/shared-moved-Old.tsx");
  repo.commit("move out");
  const moved = cli(["--base", "main", "--head", "mover"]);
  assert.equal(moved.status, 1, moved.stdout);
  assert.ok(moved.stdout.includes("  - src/components/portal/home/Old.tsx"));

  // Only shared logic and docs: nothing to say.
  repo.git("checkout", "-q", "-b", "shared", "main");
  repo.put("src/lib/portal/shared.ts", "changed\n");
  repo.put("README.md", "changed\n");
  repo.commit("shared");
  assert.match(cli(["--base", "main", "--head", "shared"]).stdout, /пропуск — PR не меняет кабинет студента/u);

  // Unknown base: the guard's own problem.
  const broken = cli(["--base", "no-such-branch", "--head", "shared"]);
  assert.equal(broken.status, 0);
  assert.match(broken.stdout, /ВНИМАНИЕ: .*git diff no-such-branch\.\.\.shared не выполнился/u);
});

// ---------------------------------------------------------------------------------------------------------------------
// The workflow: the guard is a job of the fast PR checks and «Fast checks» requires it
// ---------------------------------------------------------------------------------------------------------------------

const workflow = read(".github/workflows/evo-fast-pr-checks.yml");
const executable = workflow.split("\n").filter((line) => !/^\s*#/u.test(line)).join("\n");
const guardJob = executable.slice(executable.indexOf("\n  mobile-parity:\n"), executable.indexOf("\n  migration_boundary:\n"));
const gate = executable.slice(executable.indexOf("\n  fast-checks:\n"));

test("workflow: «Mobile parity» is a small read-only job that looks at every pull request", () => {
  assert.notEqual(executable.indexOf("\n  mobile-parity:\n"), -1);
  assert.match(guardJob, /^\n  mobile-parity:\n    name: Mobile parity\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    permissions:\n      contents: read\n      pull-requests: read\n    steps:\n/u);
  // No condition: it always looks, so the gate can insist on «success». No way for the job to hide a failure either.
  assert.doesNotMatch(guardJob, /\n    (?:if|needs|continue-on-error|strategy|environment):/u);
  assert.doesNotMatch(guardJob, /continue-on-error|working-directory|secrets\.|pull_request_target|always\(\)/u);
  assert.match(guardJob, /- name: Check out full history\n        uses: actions\/checkout@[0-9a-f]{40} # v7\n        with:\n          fetch-depth: 0\n          persist-credentials: false\n/u);
  assert.match(guardJob, /uses: actions\/setup-node@[0-9a-f]{40} # v6\n        with:\n          node-version-file: \.nvmrc\n/u);
  for (const [, reference] of guardJob.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gmu)) assert.match(reference, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u, reference);
  assert.match(guardJob, /env:\n          GITHUB_TOKEN: \$\{\{ github\.token \}\}\n          PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}\n        run: node scripts\/ci\/mobile-parity-check\.mjs --base origin\/main\n/u);
  assert.equal([...guardJob.matchAll(/^      - name:/gmu)].length, 3, "checkout, Node, the check: nothing that could fail for another reason");
});

test("workflow: the only job with permissions of its own is «Mobile parity», read-only; the workflow default stays contents: read", () => {
  assert.match(executable, /^permissions:\n  contents: read\n(?!  )/mu);
  const blocks = [...executable.matchAll(/^( *)permissions:\n((?:\1  .+\n)+)/gmu)].map((match) => match[2].trim().split("\n").map((line) => line.trim()));
  assert.deepEqual(blocks, [["contents: read"], ["contents: read", "pull-requests: read"]]);
  assert.doesNotMatch(executable, /:\s*write\b/u);
});

test("workflow: «Fast checks» waits for «Mobile parity» and fails unless it succeeded", () => {
  assert.equal((executable.match(/^    name: Fast checks$/gmu) ?? []).length, 1);
  // Appended after the old list, so the older contract tests that pin its order keep matching.
  assert.match(gate, /needs:\n      - changed-range\n      - typecheck\n      - tests\n      - preview\n      - contracts\n      - lint\n      - build\n      - mobile\n      - migration_boundary\n      - mobile-parity\n    runs-on:/u);
  assert.match(gate, /\n          MOBILE_PARITY_RESULT: \$\{\{ needs\.mobile-parity\.result \}\}\n/u);
  assert.match(gate, /"\$MIGRATION_BOUNDARY_RESULT" "\$MOBILE_PARITY_RESULT"; do/u);
  assert.match(gate, /\n          test "\$MOBILE_PARITY_RESULT" = "success"\n/u);

  // Every job but the gate is awaited by the gate, every awaited job exists, every result it reads is awaited.
  const jobs = [...executable.slice(executable.indexOf("\njobs:\n")).matchAll(/^  ([\w-]+):\s*$/gmu)].map((match) => match[1]);
  const needs = gate.match(/needs:\n((?:      - [\w-]+\n)+)/u)[1].trim().split("\n").map((line) => line.replace(/^\s*- /u, ""));
  assert.deepEqual([...needs].sort(), jobs.filter((job) => job !== "fast-checks").sort());
  const read = [...gate.matchAll(/needs\.([\w-]+)\.result/gu)].map((match) => match[1]);
  assert.deepEqual([...new Set(read)].sort(), [...needs].sort());
});

test("workflow: the real «Fast checks» shell blocks on a parity failure, a skip or a cancel, with or without code checks", () => {
  const step = gate.split("      - name: Require selected fast PR checks\n")[1];
  assert.ok(step);
  const body = step.split("        run: |\n")[1].replace(/^          /gmu, "");
  const names = [...step.matchAll(/^          ([A-Z_]+): \$\{\{/gmu)].map((match) => match[1]);
  const env = {
    PATH: process.env.PATH,
    ...Object.fromEntries(names.map((name) => [name, name.endsWith("_RESULT") ? "skipped" : ""])),
    RANGE_RESULT: "success", HAS_CHANGES: "true", UNKNOWN: "false", ORDINARY_DOCS: "true", MOBILE_PARITY_RESULT: "success",
  };
  const code = (changes) => spawnSync("bash", ["-c", body], { env: { ...env, ...changes }, encoding: "utf8" });
  const allGreen = { ORDINARY_DOCS: "false", TYPECHECK_RESULT: "success", TESTS_RESULT: "success", PREVIEW_RESULT: "success", CONTRACTS_RESULT: "success", LINT_RESULT: "success", BUILD_RESULT: "success", MOBILE_RESULT: "success", MIGRATION_BOUNDARY_RESULT: "success" };

  assert.ok(names.includes("MOBILE_PARITY_RESULT"));
  assert.equal(code({}).status, 0, "docs only, the guard passed");
  assert.equal(code(allGreen).status, 0, "everything green");
  for (const result of ["failure", "cancelled", "skipped", "", "unknown"]) {
    for (const changes of [{}, allGreen]) {
      const outcome = code({ ...changes, MOBILE_PARITY_RESULT: result });
      assert.notEqual(outcome.status, 0, `MOBILE_PARITY_RESULT=${result}`);
    }
  }
  assert.match(code({ MOBILE_PARITY_RESULT: "failure" }).stdout, /::error::A selected fast PR check failed or was cancelled/u);
});

// ---------------------------------------------------------------------------------------------------------------------
// The PR template and the rule text
// ---------------------------------------------------------------------------------------------------------------------

test("the PR template asks the four usual questions and carries the three forms in a comment", () => {
  const template = read(".github/pull_request_template.md");
  for (const heading of ["Что изменилось", "Зачем", "Как проверено", "Что не проверено", "Приложение"]) {
    assert.match(template, new RegExp(`^## ${heading}$`, "mu"), heading);
  }
  const comments = [...template.matchAll(/<!--([\s\S]*?)-->/gu)].map((match) => match[1]).join("\n");
  assert.match(comments, /^ *Приложение: обновлено в этом PR \(папка mobile\/\)$/mu);
  assert.match(comments, /^ *Приложение: не нужно — <причина, не короче 12 знаков.*>$/mu);
  assert.match(comments, /^ *Приложение: отдельным PR #<номер>$/mu);
  assert.match(comments, /Mobile parity/u);
  assert.match(comments, /AGENTS\.md/u);

  // Left as it is, the template declares nothing (the comment is invisible), so a cabinet PR cannot pass by accident.
  assert.match(stripHtmlComments(template), /^Приложение:\s*$/mu);
  assert.deepEqual(parseDeclarations(template), { notNeeded: [], separate: [], unrecognized: ["Приложение:"] });
  // Filled in with a form, it does.
  const filled = (line) => template.replace(/^Приложение:\s*$/mu, line);
  assert.equal(parseDeclarations(filled(`Приложение: не нужно — ${REASON}`)).notNeeded[0].ok, true);
  assert.deepEqual(parseDeclarations(filled("Приложение: отдельным PR #1540")).separate.map((entry) => entry.number), [1540]);
});

test("AGENTS.md holds the rule once and CLAUDE.md points to it with the key lines", () => {
  const agents = read("AGENTS.md");
  const claude = read("CLAUDE.md");
  const heading = "## Кабинет и приложение идут вместе";
  assert.equal(agents.split(heading).length - 1, 1, "one section in AGENTS.md");
  const section = agents.slice(agents.indexOf(heading)).split("\n## ")[0];
  for (const needle of [
    "mobile/", "src/lib/portal/*", "@web/", "Приложение: не нужно — <причина>", "Приложение: отдельным PR #<номер>",
    "Mobile parity", "Fast checks", "gh run rerun", "cd mobile && npm ci && npm run check", "eas build", "eas submit", "eas update", "App Store", "Google Play", "TestFlight",
  ]) assert.ok(section.includes(needle), `AGENTS.md section: ${needle}`);

  assert.equal(claude.split(heading).length - 1, 1, "one section in CLAUDE.md");
  const pointer = claude.slice(claude.indexOf(heading)).split("\n## ")[0];
  assert.match(pointer, /AGENTS\.md/u);
  for (const needle of ["Приложение: не нужно — <причина>", "Приложение: отдельным PR #<номер>", "Mobile parity", "src/lib/portal/*", "mobile/"]) {
    assert.ok(pointer.includes(needle), `CLAUDE.md section: ${needle}`);
  }
  assert.ok(pointer.length < section.length, "CLAUDE.md carries the short version, not a second copy");
  assert.ok(pointer.length < 2200, `the CLAUDE.md section stays short (${pointer.length})`);
});
