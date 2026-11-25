#!/usr/bin/env node
// «Mobile parity»: the student cabinet and the phone app go together (AGENTS.md, «Кабинет и приложение идут вместе»,
// owner's rule of 25.11.2026; PLAN_CHANGES 25.11.2026).
//
// A pull request that changes what a student sees in the cabinet (src/app/(portal)/** and src/components/portal/**,
// test files excluded) must do ONE of three things:
//   1. change the app: at least one non-markdown file under mobile/;
//   2. say so in its description, on one line:   Приложение: не нужно — <reason, 12+ characters>
//   3. point at the separate app PR:             Приложение: отдельным PR #<number>   (open or merged; checked through the API)
//
// The description is read through the GitHub API when the check runs, not from the event payload. The payload of a
// re-run is the original one, so only an API read lets «edit the description, re-run the failed job» work
// (`gh run rerun <run-id> --failed`).
//
// FAIL OPEN. The script exits 1 only when it positively knows: the cabinet UI changed, mobile/ did not, and there is
// no valid line. Any error of its own (git, API, unreadable input, a bug) prints a warning and exits 0, so a broken
// guard never blocks a pull request. Events other than `pull_request` are skipped.
//
//   node scripts/ci/mobile-parity-check.mjs --base origin/main                          CI: PR number and token from the environment
//   node scripts/ci/mobile-parity-check.mjs --base origin/main --body-file body.md      laptop: the description from a file
//   node scripts/ci/mobile-parity-check.mjs --files-file files.txt --body-file body.md   dry runs and tests: no git, no API
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CHECK_NAME = "Mobile parity";
export const DEFAULT_REPOSITORY = "izzhackt/evo_AI_CRM";
/** Cabinet UI: what a student sees. Shared logic in src/lib/portal/** is not here on purpose: the app imports it as @web/*. */
export const CABINET_UI_PREFIXES = Object.freeze(["src/app/(portal)/", "src/components/portal/"]);
export const MOBILE_PREFIX = "mobile/";
export const MIN_REASON_LENGTH = 12;

// ---------------------------------------------------------------------------------------------------------------------
// Which files count
// ---------------------------------------------------------------------------------------------------------------------

export function normalizePath(path) {
  return String(path).trim().replace(/\\/gu, "/").replace(/^\.\//u, "");
}

/** `*.test.*`, `*.spec.*` or anything under `__tests__`. A folder named `tests` is NOT a test folder: src/components/portal/tests is product UI. */
export function isTestFile(path) {
  const segments = path.split("/");
  return segments.includes("__tests__") || /\.(?:test|spec)\./u.test(segments[segments.length - 1]);
}

export function isCabinetUiPath(path) {
  return CABINET_UI_PREFIXES.some((prefix) => path.startsWith(prefix)) && !isTestFile(path);
}

/** A change of the app itself: anything under mobile/ except markdown. */
export function isMobileAppChange(path) {
  return path.startsWith(MOBILE_PREFIX) && !/\.(?:md|mdx|markdown)$/iu.test(path);
}

// ---------------------------------------------------------------------------------------------------------------------
// The lines of the description
// ---------------------------------------------------------------------------------------------------------------------

// Hyphen, non-breaking hyphen, figure dash, en dash, em dash, horizontal bar and minus sign: people (and editors) type any.
const DASH = "[-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212]";
// Markdown may stand around the words: a heading, quote, list or numbered item before them, emphasis or backticks (the
// lines are shown in backticks in AGENTS.md, so a copy brings them along): «- Приложение: …», «**Приложение:** …», «`Приложение: …`».
const EMPHASIS = "[*_`\\s]*";
const KEY = `^[\\s>#*_+\`-]*(?:\\d+[.)]\\s+)?[*_\`]*приложение${EMPHASIS}[:\\uFF1A]`;
const LINE_KEY = new RegExp(KEY, "iu");
const LINE_BARE = new RegExp(`${KEY}${EMPHASIS}$`, "iu");
const LINE_NOT_NEEDED = new RegExp(`${KEY}${EMPHASIS}не\\s+нужно${EMPHASIS}${DASH}{1,2}([^\\r\\n]*)$`, "iu");
const LINE_SEPARATE = new RegExp(`${KEY}${EMPHASIS}отдельным\\s+(?:(?:pr|пр|pull\\s+request)\\s*)?#\\s*(\\d{1,9})(?!\\d)`, "iu");

/** HTML comments are invisible in the rendered description; the PR template keeps its three example lines in one. An unterminated comment hides the rest, as GitHub renders it. */
export function stripHtmlComments(text) {
  return String(text ?? "").replace(/<!--[\s\S]*?(?:-->|$)/gu, "");
}

/** A reason is real words, 12+ characters, not an unfilled <placeholder>. */
export function checkReason(reason) {
  const text = String(reason ?? "").trim().replace(/[*_`\s]+$/u, "");
  if (/^<[^<>]*>$/u.test(text)) return { ok: false, problem: "вместо причины остался шаблон <…>" };
  const length = [...text].length;
  if (length < MIN_REASON_LENGTH) return { ok: false, problem: `причина короче ${MIN_REASON_LENGTH} знаков (сейчас ${length})` };
  if ((text.match(/\p{L}/gu) ?? []).length < 6) return { ok: false, problem: "в причине почти нет слов" };
  return { ok: true, problem: null };
}

/** The «Приложение:» lines of a description: `notNeeded` (with a verdict on the reason), `separate` (PR numbers), `unrecognized`. */
export function parseDeclarations(body) {
  const result = { notNeeded: [], separate: [], unrecognized: [] };
  for (const rawLine of stripHtmlComments(body).split(/\r\n|\r|\n/u)) {
    const line = rawLine.trim();
    if (!LINE_KEY.test(line)) continue;
    const notNeeded = LINE_NOT_NEEDED.exec(line);
    if (notNeeded) {
      result.notNeeded.push({ line, reason: notNeeded[1].trim(), ...checkReason(notNeeded[1]) });
      continue;
    }
    const separate = LINE_SEPARATE.exec(line);
    if (separate) {
      result.separate.push({ line, number: Number(separate[1]) });
      continue;
    }
    result.unrecognized.push(line);
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------------------------------------------------

// Text from a pull request (lines, file names) is untrusted: control characters never reach the log.
const printable = (text) => String(text).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, " ");
const quote = (line) => {
  const clean = printable(line);
  return clean.length > 120 ? `${clean.slice(0, 117)}…` : clean;
};
const describeError = (error) => String(error instanceof Error ? error.message : error).slice(0, 300);

/**
 * `files`: changed paths. `readBody()`: the PR description (asked only when needed). `lookupPullRequest(n)`:
 * `{ found, state, merged }` (asked only for the «отдельным PR» form). Outcomes: `pass`, `fail`, `fail-open`.
 * An error of readBody or lookupPullRequest is the guard's own problem, hence `fail-open`, never `fail`.
 */
export async function evaluateParity({ files, readBody, lookupPullRequest, currentPullRequest = null }) {
  const cabinet = files.filter(isCabinetUiPath);
  if (cabinet.length === 0) return { outcome: "pass", reason: "no-cabinet-change", cabinet };

  const mobile = files.filter(isMobileAppChange);
  if (mobile.length > 0) return { outcome: "pass", reason: "mobile-changed", cabinet, mobile };

  let body;
  try {
    body = await readBody();
  } catch (error) {
    return { outcome: "fail-open", cabinet, warning: `не удалось прочитать описание PR (${describeError(error)})` };
  }

  const declarations = parseDeclarations(body);
  const problems = [];

  for (const note of declarations.notNeeded) {
    if (note.ok) return { outcome: "pass", reason: "not-needed", cabinet, line: note.line };
    problems.push(`строка «${quote(note.line)}»: ${note.problem}`);
  }

  for (const entry of declarations.separate) {
    if (currentPullRequest !== null && entry.number === currentPullRequest) {
      problems.push(`PR #${entry.number}: это сам этот PR, нужен другой, с изменениями в mobile/`);
      continue;
    }
    let found;
    try {
      found = await lookupPullRequest(entry.number);
    } catch (error) {
      return { outcome: "fail-open", cabinet, warning: `не удалось проверить PR #${entry.number} (${describeError(error)})` };
    }
    if (!found.found) problems.push(`PR #${entry.number}: такого PR нет`);
    else if (found.state === "open" || found.merged) {
      return { outcome: "pass", reason: "separate-pr", cabinet, number: entry.number, merged: Boolean(found.merged), line: entry.line };
    } else problems.push(`PR #${entry.number}: закрыт без слияния`);
  }

  for (const line of declarations.unrecognized) {
    problems.push(LINE_BARE.test(line)
      ? "строка «Приложение:» не заполнена"
      : `строка «${quote(line)}» не подходит ни под одну из форм`);
  }
  return { outcome: "fail", cabinet, problems };
}

function plural(count, one, few, many) {
  const tail = Math.abs(count) % 100;
  const last = tail % 10;
  if (tail > 10 && tail < 20) return many;
  if (last === 1) return one;
  return last > 1 && last < 5 ? few : many;
}

export function renderFailure({ cabinet, problems = [], runId = null, repository = DEFAULT_REPOSITORY }) {
  const shown = cabinet.slice(0, 15);
  const hidden = cabinet.length - shown.length;
  const rerun = `gh run rerun ${runId ?? "<run-id>"} --failed --repo ${repository}`;
  return [
    `${CHECK_NAME}: кабинет студента изменён, а приложение — нет.`,
    "",
    `Этот PR меняет то, что студент видит в кабинете (${cabinet.length} ${plural(cabinet.length, "файл", "файла", "файлов")}):`,
    ...shown.map((path) => `  - ${printable(path)}`),
    ...(hidden > 0 ? [`  … и ещё ${hidden}`] : []),
    "",
    "Но в папке mobile/ нет изменений кода (файлы .md не считаются), а в описании PR нет подходящей строки про приложение.",
    ...(problems.length > 0 ? ["", "Что не так в описании:", ...problems.map((problem) => `  - ${problem}`)] : []),
    "",
    "Как исправить (достаточно одного способа):",
    "  1. Обновить приложение в этом же PR: изменить код в mobile/. Логику и тексты держите в src/lib/portal/*:",
    "     приложение берёт их как @web/..., а в вебе остаётся тонкая вёрстка.",
    "  2. Если приложению это не нужно, добавить в описание PR одну строку:",
    "       Приложение: не нужно — <причина, не короче 12 знаков>",
    "  3. Если приложение делается отдельным PR в тот же день, добавить строку:",
    "       Приложение: отдельным PR #<номер>",
    "",
    "Правка описания проверку сама не запускает. После неё перезапустите только упавшую проверку:",
    `  ${rerun}`,
    "(или на странице PR: Checks → Re-run failed jobs). Если вы добавили код в mobile/, достаточно обычного push.",
    `Нет прав на перезапуск? Пустой коммит запустит все проверки заново: git commit --allow-empty -m "chore: перезапуск проверок" && git push`,
    "",
    "Правило: AGENTS.md, раздел «Кабинет и приложение идут вместе».",
  ].join("\n");
}

function describePass(result) {
  switch (result.reason) {
    case "no-cabinet-change":
      return `${CHECK_NAME}: пропуск — PR не меняет кабинет студента (src/app/(portal)/**, src/components/portal/**).`;
    case "mobile-changed": {
      const shown = result.mobile.slice(0, 3).map(printable).join(", ");
      const more = result.mobile.length > 3 ? ` и ещё ${result.mobile.length - 3}` : "";
      return `${CHECK_NAME}: OK — вместе с кабинетом (${result.cabinet.length} ${plural(result.cabinet.length, "файл", "файла", "файлов")}) изменено приложение: ${shown}${more}.`;
    }
    case "not-needed":
      return `${CHECK_NAME}: OK — в описании PR сказано, почему приложению это не нужно: «${quote(result.line)}».`;
    case "separate-pr":
      return `${CHECK_NAME}: OK — приложение в отдельном PR #${result.number} (${result.merged ? "слит" : "открыт"}): «${quote(result.line)}».`;
    default:
      return `${CHECK_NAME}: OK.`;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// GitHub API (public read of one pull request)
// ---------------------------------------------------------------------------------------------------------------------

/** `getPull(n)` -> `{ found: false }` for 404, `{ found: true, data }` for 200; network errors, 5xx and 429 are retried, any other status throws. */
export function createGitHubClient({
  repository,
  token = "",
  apiUrl = "https://api.github.com",
  fetchImpl = globalThis.fetch,
  attempts = 3,
  retryDelayMs = 700,
  timeoutMs = 15_000,
  sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)),
}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "evo-mobile-parity-check",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  return {
    async getPull(number) {
      const path = `/repos/${repository}/pulls/${number}`;
      for (let attempt = 1; ; attempt += 1) {
        let retriable = true;
        try {
          const response = await fetchImpl(`${apiUrl.replace(/\/+$/u, "")}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
          if (response.status === 200) return { found: true, data: await response.json() };
          if (response.status === 404) return { found: false };
          retriable = response.status >= 500 || response.status === 429;
          throw new Error(`GitHub API ответил ${response.status} на GET ${path}`);
        } catch (error) {
          if (!retriable || attempt >= attempts) throw error;
        }
        await sleep(retryDelayMs * attempt);
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------------------------------

export const USAGE = [
  `${CHECK_NAME}: кабинет студента и приложение идут вместе (AGENTS.md).`,
  "",
  "  node scripts/ci/mobile-parity-check.mjs [--base origin/main] [--head HEAD] [--body-file файл] [--files-file файл|-]",
  "                                          [--pr номер] [--repo владелец/имя] [--event pull_request]",
  "",
  "  --base, --head   какие изменения смотреть: git diff <base>...<head> (по умолчанию origin/main...HEAD)",
  "  --files-file     список изменённых файлов (по одному в строке, «-» читает stdin) вместо git",
  "  --body-file      описание PR из файла вместо API GitHub",
  "  --pr, --repo     PR и репозиторий для API (по умолчанию PR_NUMBER или событие Actions; GITHUB_REPOSITORY)",
  "  --event          имя события; проверяются только pull_request (по умолчанию GITHUB_EVENT_NAME)",
  "",
  "Код выхода 1 только если точно известно: кабинет изменён, mobile/ нет, нужной строки в описании нет.",
  "Любая собственная ошибка проверки даёт предупреждение и код 0.",
].join("\n");

export function parseArgs(argv) {
  const options = { base: "origin/main", head: "HEAD", filesFile: null, bodyFile: null, pr: null, repo: null, event: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || (next.startsWith("--") && next !== "-")) throw new Error(`${argument}: нужно значение`);
      index += 1;
      return next;
    };
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--base") options.base = value();
    else if (argument === "--head") options.head = value();
    else if (argument === "--files-file") options.filesFile = value();
    else if (argument === "--body-file") options.bodyFile = value();
    else if (argument === "--pr") options.pr = value();
    else if (argument === "--repo") options.repo = value();
    else if (argument === "--event") options.event = value();
    else throw new Error(`неизвестный аргумент ${argument}`);
  }
  return options;
}

const parseNumber = (value) => (/^[1-9]\d{0,8}$/u.test(String(value ?? "").trim()) ? Number(String(value).trim()) : null);

function pullRequestNumberFromEvent(path) {
  if (!path) return null;
  try {
    const event = JSON.parse(readFileSync(path, "utf8"));
    return parseNumber(event?.pull_request?.number ?? event?.number);
  } catch {
    return null;
  }
}

export function parseFileList(text) {
  return [...new Set(String(text).split(/\r\n|\r|\n|\0/u).map(normalizePath).filter(Boolean))];
}

function gitChangedFiles(base, head) {
  try {
    const output = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", `${base}...${head}`], {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return parseFileList(output.toString("utf8"));
  } catch (error) {
    const detail = String(error?.stderr ?? "").trim().split("\n")[0] || describeError(error);
    throw new Error(`git diff ${base}...${head} не выполнился: ${detail}`);
  }
}

const escapeAnnotation = (text) => String(text).replace(/%/gu, "%25").replace(/\r/gu, "%0D").replace(/\n/gu, "%0A");

export async function main({ argv = process.argv.slice(2), env = process.env, stdout = process.stdout, deps = {} } = {}) {
  const log = (text = "") => { stdout.write(`${text}\n`); };
  const inActions = env.GITHUB_ACTIONS === "true";
  const notice = (level, message) => log(inActions ? `::${level} title=${CHECK_NAME}::${escapeAnnotation(message)}` : `${level === "error" ? "ОШИБКА" : "ВНИМАНИЕ"}: ${message}`);
  const failOpen = (message) => {
    notice("warning", `${message}. Проверка пропущена, PR из-за этого не блокируется.`);
    return 0;
  };

  try {
    const options = parseArgs(argv);
    if (options.help) {
      log(USAGE);
      return 0;
    }
    const event = options.event ?? env.GITHUB_EVENT_NAME ?? "";
    if (event && event !== "pull_request") {
      log(`${CHECK_NAME}: пропуск — событие «${event}», проверка нужна только для pull_request.`);
      return 0;
    }

    const files = options.filesFile
      ? parseFileList(readFileSync(options.filesFile === "-" ? 0 : options.filesFile, "utf8"))
      : (deps.listChangedFiles ?? gitChangedFiles)(options.base, options.head);

    const repository = options.repo ?? env.GITHUB_REPOSITORY ?? DEFAULT_REPOSITORY;
    if (!/^[\w.-]+\/[\w.-]+$/u.test(repository)) throw new Error(`странное имя репозитория «${quote(repository)}»`);
    const number = parseNumber(options.pr ?? env.PR_NUMBER) ?? pullRequestNumberFromEvent(env.GITHUB_EVENT_PATH);
    const client = createGitHubClient({
      repository,
      token: env.GITHUB_TOKEN || env.GH_TOKEN || "",
      apiUrl: env.GITHUB_API_URL || undefined,
      fetchImpl: deps.fetchImpl,
      sleep: deps.sleep,
    });

    const result = await evaluateParity({
      files,
      currentPullRequest: number,
      readBody: async () => {
        if (options.bodyFile) return readFileSync(options.bodyFile, "utf8");
        if (number === null) throw new Error("номер PR неизвестен: нужен --pr, PR_NUMBER или событие Actions");
        const pull = await client.getPull(number);
        if (!pull.found) throw new Error(`API не нашёл PR #${number}`);
        return pull.data?.body ?? "";
      },
      lookupPullRequest: async (target) => {
        const pull = await client.getPull(target);
        return pull.found
          ? { found: true, state: pull.data?.state, merged: Boolean(pull.data?.merged || pull.data?.merged_at) }
          : { found: false };
      },
    });

    if (result.outcome === "fail-open") return failOpen(result.warning);
    if (result.outcome === "pass") {
      log(describePass(result));
      return 0;
    }

    const message = renderFailure({ cabinet: result.cabinet, problems: result.problems, runId: env.GITHUB_RUN_ID ?? null, repository });
    log(message);
    if (inActions) {
      notice("error", `Кабинет студента изменён (${result.cabinet.length} ${plural(result.cabinet.length, "файл", "файла", "файлов")}), а приложение — нет: в mobile/ нет изменений и в описании PR нет строки «Приложение: не нужно — <причина>» или «Приложение: отдельным PR #<номер>». Подробности в логе шага; после правки описания перезапустите упавшую проверку.`);
      if (env.GITHUB_STEP_SUMMARY) {
        // An indented block, not a fence: nothing in the text can close it.
        const indented = message.split("\n").map((line) => `    ${line}`).join("\n");
        try { appendFileSync(env.GITHUB_STEP_SUMMARY, `## ${CHECK_NAME}\n\n${indented}\n`); } catch { /* the summary is a courtesy */ }
      }
    }
    return 1;
  } catch (error) {
    return failOpen(`проверка сама дала сбой: ${describeError(error)}`);
  }
}

// Real paths on both sides: run through a symlinked checkout, the plain comparison would be false and the check would
// silently do nothing.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stdout.write(`::warning title=${CHECK_NAME}::${escapeAnnotation(`проверка сама дала сбой: ${describeError(error)}. Проверка пропущена.`)}\n`);
      process.exitCode = 0;
    },
  );
}
