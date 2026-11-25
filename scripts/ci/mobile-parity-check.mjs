#!/usr/bin/env node
// «Mobile parity»: what a student sees on the web and the phone app go together (AGENTS.md, «Кабинет и приложение идут
// вместе», owner's rule of 25.11.2026; PLAN_CHANGES 25.11.2026).
//
// A pull request that changes what a student sees (the cabinet, sign-in, the application: CABINET_UI_PATHS, test files
// excluded) must do ONE of three things:
//   1. change the app: a non-test file in mobile/src, or mobile/assets, or mobile/app.config.ts;
//   2. say so in its description, on one line:   Приложение: не нужно — <reason, 12+ characters>
//   3. point at the separate app PR:             Приложение: отдельным PR #<number>   (open or merged; checked through the API)
//
// The description is read through the GitHub API when the check runs, not from the event payload. The payload of a
// re-run is the original one, so only an API read lets «edit the description, re-run the failed job» work
// (`gh run rerun <run-id> --failed`).
//
// Three kinds of failure, kept apart on purpose:
//   - a violation (cabinet changed, app did not, no valid line): exit 1;
//   - FAIL OPEN, the guard's own transient trouble (network, 5xx after retries, git, bad input, a bug): a warning in the
//     log, the annotations and the step summary, exit 0, so a broken guard never blocks a pull request;
//   - FAIL CLOSED, a broken setup that retrying cannot cure: in Actions, reading THIS pull request answered 401/403/404
//     (not a rate limit). It must not silently turn every cabinet PR green: exit 1 with a clear message.
// MOBILE_PARITY_MODE=warn (the repository variable of the same name) is the emergency switch: violations and broken-setup
// failures become warnings and the exit code is 0. Events other than `pull_request` are skipped.
//
//   node scripts/ci/mobile-parity-check.mjs --base origin/main                          CI: PR number and token from the environment
//   node scripts/ci/mobile-parity-check.mjs --base origin/main --body-file body.md      laptop: the description from a file
//   node scripts/ci/mobile-parity-check.mjs --files-file files.txt --body-file body.md   dry runs and tests: no git, no API
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CHECK_NAME = "Mobile parity";
export const DEFAULT_REPOSITORY = "izzhackt/evo_AI_CRM";
export const MODE_VARIABLE = "MOBILE_PARITY_MODE";

/**
 * What a student sees on the web. A path ending with «/» is a folder, anything else is one file. Shared logic in
 * src/lib/portal/** is not here on purpose: the app imports it as @web/*, so a change there already reaches both.
 */
export const CABINET_UI_PATHS = Object.freeze([
  // The cabinet.
  "src/app/(portal)/",
  "src/components/portal/",
  // Sign-in, password recovery and the application: they have counterparts in mobile/src/app/(auth) (owner, 25.11.2026).
  "src/app/apply/",
  "src/app/login/",
  "src/app/auth/",
  "src/components/student-application/",
  "src/components/student-recovery/",
  "src/components/AuthForms.tsx",
  "src/components/PasswordInput.tsx",
  // The components behind the student routes of src/app/auth.
  "src/components/StudentAccountPending.tsx",
  "src/components/StudentInviteCallback.tsx",
  "src/components/StudentSetPasswordForm.tsx",
]);
/** Staff-only screens inside those folders: there is no app counterpart. */
export const CABINET_UI_EXCLUDED = Object.freeze(["src/app/auth/staff/"]);
/** The app itself: what reaches users. Lockfiles, tests, .maestro flows, eas.json and markdown are not the app. */
export const MOBILE_APP_PATHS = Object.freeze(["mobile/src/", "mobile/assets/", "mobile/app.config.ts"]);
export const MIN_REASON_LENGTH = 12;
/** A longer line is not parsed (it only costs time); a «Приложение:» line is one short sentence. */
export const MAX_DECLARATION_LINE = 1000;
const KEY_WINDOW = 120;

// ---------------------------------------------------------------------------------------------------------------------
// Which files count
// ---------------------------------------------------------------------------------------------------------------------

export function normalizePath(path) {
  return String(path).trim().replace(/\\/gu, "/").replace(/^\.\//u, "");
}

/**
 * `*.test.*`, `*.spec.*` or anything under `__tests__`, `__mocks__`, `__snapshots__`. A folder named `tests` is NOT a
 * test folder: src/components/portal/tests is product UI.
 */
export function isTestFile(path) {
  const segments = path.split("/");
  return segments.some((segment) => segment === "__tests__" || segment === "__mocks__" || segment === "__snapshots__")
    || /\.(?:test|spec)\./u.test(segments[segments.length - 1]);
}

const within = (path, entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry);

export function isCabinetUiPath(path) {
  return CABINET_UI_PATHS.some((entry) => within(path, entry))
    && !CABINET_UI_EXCLUDED.some((entry) => within(path, entry))
    && !isTestFile(path);
}

/** A change of the app itself: non-test mobile/src/**, mobile/assets/** or mobile/app.config.ts; never markdown. */
export function isMobileAppChange(path) {
  return MOBILE_APP_PATHS.some((entry) => within(path, entry))
    && !isTestFile(path)
    && !/\.(?:md|mdx|markdown)$/iu.test(path);
}

// ---------------------------------------------------------------------------------------------------------------------
// The lines of the description
// ---------------------------------------------------------------------------------------------------------------------

// Hyphen, non-breaking hyphen, figure dash, en dash, em dash, horizontal bar and minus sign: people (and editors) type any.
const DASH = "[-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212]";
// Markdown may stand around the words. Before them: spaces and quote, heading, list and emphasis marks, a list number
// («1.», «2)») or a checkbox («[x]»), in any order: «- [x] Приложение: …», «> Приложение: …», «**Приложение:** …». Backticks too:
// the lines are shown in backticks in AGENTS.md, so a copy brings them along. Each character is read one way only, so a
// match never backtracks across the prefix.
const EMPHASIS = "[*_`\\s]*";
const PREFIX = "(?:[\\s>#*_+`-]|\\d{1,3}[.)](?=\\s)|\\[[ xX]\\](?=\\s))*";
const KEY = `^${PREFIX}приложение${EMPHASIS}[:\\uFF1A]`;
const LINE_KEY = new RegExp(KEY, "iu");
const LINE_BARE = new RegExp(`${KEY}${EMPHASIS}$`, "iu");
const LINE_NOT_NEEDED = new RegExp(`${KEY}${EMPHASIS}не\\s+нужно${EMPHASIS}${DASH}{1,2}([^\\r\\n]*)$`, "iu");
const LINE_SEPARATE = new RegExp(`${KEY}${EMPHASIS}отдельным\\s+(?:(?:pr|пр|pull\\s+request)\\s*)?#\\s*(\\d{1,9})(?!\\d)`, "iu");

/** HTML comments are invisible in the rendered description; the PR template keeps its three example lines in one. An unterminated comment hides the rest, as GitHub renders it. */
export function stripHtmlComments(text) {
  return String(text ?? "").replace(/<!--[\s\S]*?(?:-->|$)/gu, "");
}

const isNoise = (character) => character === "*" || character === "_" || character === "`" || /\s/u.test(character);

/** A reason is real words, 12+ characters, not an unfilled <placeholder>. */
export function checkReason(reason) {
  let text = String(reason ?? "").trim();
  let end = text.length;
  while (end > 0 && isNoise(text[end - 1])) end -= 1;
  text = text.slice(0, end);
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
    // Only the start of a line is looked at first, and a very long line is never matched: the cost stays bounded.
    if (!LINE_KEY.test(line.slice(0, KEY_WINDOW))) continue;
    if (line.length > MAX_DECLARATION_LINE) {
      result.unrecognized.push(`${line.slice(0, 100)}…`);
      continue;
    }
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
const LINE_SEPARATORS = String.fromCharCode(0x2028, 0x2029);
const printable = (text) => String(text).replace(new RegExp(`[\\u0000-\\u001f\\u007f-\\u009f${LINE_SEPARATORS}]`, "gu"), " ");
const quote = (line) => {
  const clean = printable(line);
  return clean.length > 120 ? `${clean.slice(0, 117)}…` : clean;
};
const describeError = (error) => {
  const cause = error?.cause?.message ? `: ${error.cause.message}` : "";
  return printable(`${error instanceof Error ? error.message : error}${cause}`).slice(0, 300);
};

/**
 * `files`: changed paths. `readBody()`: the PR description (asked only when needed). `lookupPullRequest(n)`:
 * `{ found, state, merged }` (asked only for the «отдельным PR» form). Outcomes: `pass`, `fail` (a violation),
 * `fail-open` (the guard's own trouble) and `fail-closed` (readBody threw an error marked `failClosed`: a broken setup).
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
    if (error?.failClosed) return { outcome: "fail-closed", cabinet, error: describeError(error), status: error.status ?? null };
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

const filesWord = (count) => `${count} ${plural(count, "файл", "файла", "файлов")}`;

const rerunCommand = (runId, repository) => `gh run rerun ${runId ?? "<run-id>"} --failed --repo ${repository}`;

function listFiles(cabinet) {
  const shown = cabinet.slice(0, 15);
  const hidden = cabinet.length - shown.length;
  return [...shown.map((path) => `  - ${printable(path)}`), ...(hidden > 0 ? [`  … и ещё ${hidden}`] : [])];
}

export function renderFailure({ cabinet, problems = [], runId = null, repository = DEFAULT_REPOSITORY }) {
  return [
    `${CHECK_NAME}: кабинет студента изменён, а приложение — нет.`,
    "",
    `Этот PR меняет то, что студент видит в кабинете, на входе или в заявке (${filesWord(cabinet.length)}):`,
    ...listFiles(cabinet),
    "",
    "Но приложение не изменено (считаются mobile/src/** без тестов, mobile/assets/** и mobile/app.config.ts; тесты, лок-файлы и .md не считаются), а в описании PR нет подходящей строки про приложение.",
    ...(problems.length > 0 ? ["", "Что не так в описании:", ...problems.map((problem) => `  - ${problem}`)] : []),
    "",
    "Как исправить (достаточно одного способа):",
    "  1. Обновить приложение в этом же PR: изменить код в mobile/. Логику и тексты держите в src/lib/portal/*:",
    "     приложение берёт их как @web/..., а в вебе остаётся тонкая вёрстка.",
    "  2. Если приложению это не нужно, добавить в описание PR одну строку:",
    "       Приложение: не нужно — <причина, не короче 12 знаков>",
    "  3. Если приложение делается отдельным PR в тот же день, добавить строку:",
    "       Приложение: отдельным PR #<номер>",
    `Строка должна начинаться со слова «Приложение:» и быть не длиннее ${MAX_DECLARATION_LINE} знаков. Перед словом допустимы только знаки списка,`,
    "цитаты и выделения: «- », «* », «> », «- [x] », «1. », «**».",
    "",
    "Правка описания проверку сама не запускает. После неё перезапустите только упавшую проверку:",
    `  ${rerunCommand(runId, repository)}`,
    "(или на странице PR: Checks → Re-run failed jobs). Если вы добавили код в mobile/, достаточно обычного push.",
    `Нет прав на перезапуск? Пустой коммит запустит все проверки заново: git commit --allow-empty -m "chore: перезапуск проверок" && git push`,
    "",
    "Правило: AGENTS.md, раздел «Кабинет и приложение идут вместе».",
  ].join("\n");
}

/** A broken setup: the guard could not read THIS pull request in a way that retrying cures. Not a violation, and not to be skipped quietly. */
export function renderMisconfiguration({ cabinet, reason, runId = null, repository = DEFAULT_REPOSITORY }) {
  return [
    `${CHECK_NAME}: проверка не смогла прочитать описание этого PR и остановлена.`,
    "",
    `Причина: ${reason}`,
    "",
    "Это не нарушение правила, а поломка настройки проверки (права токена, номер PR или репозиторий). Молча пропускать такой PR нельзя:",
    "тогда проверка перестала бы работать во всех PR, и никто бы этого не заметил.",
    `PR меняет интерфейс студента (${filesWord(cabinet.length)}), поэтому описание нужно:`,
    ...listFiles(cabinet),
    "",
    "Что проверить:",
    "  - у задания mobile-parity в .github/workflows/evo-fast-pr-checks.yml есть permissions: contents: read и pull-requests: read;",
    "  - в шаг передан токен (GITHUB_TOKEN: ${{ github.token }}) и заполнен PR_NUMBER.",
    "",
    "Пока это чинится, владелец может не блокировать работу и включить режим предупреждений (настройки GitHub править не нужно):",
    `  gh variable set ${MODE_VARIABLE} --body warn`,
    `Вернуть строгий режим: gh variable delete ${MODE_VARIABLE}`,
    `После исправления перезапустите проверку: ${rerunCommand(runId, repository)}`,
    "",
    "Правило: AGENTS.md, раздел «Кабинет и приложение идут вместе».",
  ].join("\n");
}

function describePass(result) {
  switch (result.reason) {
    case "no-cabinet-change":
      return `${CHECK_NAME}: пропуск — PR не меняет кабинет студента, вход и заявку (список путей в AGENTS.md).`;
    case "mobile-changed": {
      const shown = result.mobile.slice(0, 3).map(printable).join(", ");
      const more = result.mobile.length > 3 ? ` и ещё ${result.mobile.length - 3}` : "";
      return `${CHECK_NAME}: OK — вместе с кабинетом (${filesWord(result.cabinet.length)}) изменено приложение: ${shown}${more}.`;
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

/** `status` is the HTTP status (null for a network error); `rateLimited` marks a 403/429 caused by a rate limit; `retriable` errors were already retried. */
export class GitHubApiError extends Error {
  constructor(message, { status = null, rateLimited = false, retriable = false, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GitHubApiError";
    this.status = status;
    this.rateLimited = rateLimited;
    this.retriable = retriable;
    this.failClosed = false;
  }
}

const header = (response, name) => response.headers?.get?.(name) ?? null;
const isRateLimited = (response) => header(response, "x-ratelimit-remaining") === "0" || header(response, "retry-after") !== null;

/**
 * `getPull(n)` -> `{ found: false }` for 404, `{ found: true, data }` for 200. Network errors, timeouts, 408, 429 and 5xx
 * are retried up to `retries` times with a short growing pause; any other status throws a GitHubApiError at once.
 * Redirects are refused: the token must never follow a redirect to another place.
 */
export function createGitHubClient({
  repository,
  token = "",
  apiUrl = "https://api.github.com",
  fetchImpl = globalThis.fetch,
  retries = 3,
  retryDelayMs = 500,
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
      for (let attempt = 0; ; attempt += 1) {
        let failure;
        try {
          const response = await fetchImpl(`${apiUrl.replace(/\/+$/u, "")}${path}`, {
            headers,
            signal: AbortSignal.timeout(timeoutMs),
            redirect: "error",
          });
          if (response.status === 200) return { found: true, data: await response.json() };
          if (response.status === 404) return { found: false };
          const rateLimited = (response.status === 403 || response.status === 429) && isRateLimited(response);
          failure = new GitHubApiError(`GitHub API ответил ${response.status} на GET ${path}`, {
            status: response.status,
            rateLimited,
            retriable: response.status >= 500 || response.status === 408 || response.status === 429,
          });
        } catch (error) {
          failure = error instanceof GitHubApiError ? error : new GitHubApiError(describeError(error), { retriable: true, cause: error });
        }
        if (!failure.retriable || attempt >= retries) throw failure;
        await sleep(retryDelayMs * (attempt + 1));
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
  `Переменная ${MODE_VARIABLE}=warn: нарушение (и поломка настройки) становятся предупреждением, код выхода 0.`,
  "Код выхода 1: нарушение правила, либо в Actions описание этого PR не читается из-за прав или настройки (HTTP 401/403/404).",
  "Любая другая собственная ошибка проверки даёт предупреждение и код 0.",
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

/** One block of the job summary. An indented block, not a fence: nothing in the text can close it. */
function writeSummary(env, title, message, lead = null) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  const indented = String(message).split("\n").map((line) => `    ${line}`).join("\n");
  try {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `## ${title}\n\n${lead ? `**${lead}**\n\n` : ""}${indented}\n\n`);
  } catch { /* the summary is a courtesy */ }
}

const SKIPPED_LEAD = "Проверка сама не смогла сработать и не блокирует этот PR. Если такая запись есть во многих PR, правило не действует: сообщите владельцу.";

function readMode(env) {
  const raw = String(env[MODE_VARIABLE] ?? "").trim().toLowerCase();
  return { warn: raw === "warn", unknown: raw !== "" && raw !== "warn" && raw !== "enforce" ? raw : null };
}

export async function main({ argv = process.argv.slice(2), env = process.env, stdout = process.stdout, deps = {} } = {}) {
  const log = (text = "") => { stdout.write(`${text}\n`); };
  const inActions = env.GITHUB_ACTIONS === "true";
  const notice = (level, message) => log(inActions ? `::${level} title=${CHECK_NAME}::${escapeAnnotation(message)}` : `${level === "error" ? "ОШИБКА" : "ВНИМАНИЕ"}: ${message}`);
  const failOpen = (message) => {
    const full = `${message}. Проверка пропущена, PR из-за этого не блокируется.`;
    notice("warning", full);
    writeSummary(env, `${CHECK_NAME}: ПРОВЕРКА ПРОПУЩЕНА`, full, SKIPPED_LEAD);
    return 0;
  };
  // Blocks the pull request, unless the emergency switch (MOBILE_PARITY_MODE=warn) turns the block into a warning.
  const block = (mode, { message, short, title }) => {
    log(message);
    if (mode.warn) {
      notice("warning", `Режим предупреждений (${MODE_VARIABLE}=warn): ${short} PR не блокируется.`);
      writeSummary(env, `${title} (режим предупреждений, PR не блокируется)`, message, `Включён ${MODE_VARIABLE}=warn: нарушение показано, но не блокирует PR.`);
      return 0;
    }
    if (inActions) {
      notice("error", short);
      writeSummary(env, title, message);
    }
    return 1;
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
    const mode = readMode(env);
    if (mode.unknown) notice("warning", `${MODE_VARIABLE}=«${quote(mode.unknown)}» не распознано (допустимо warn или пусто), проверка работает в обычном режиме.`);

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
    // In Actions, a refusal to read THIS pull request that retrying cannot cure is a broken setup: stop, do not pass silently.
    const closedInActions = (error) => {
      error.failClosed = inActions;
      return error;
    };

    const result = await evaluateParity({
      files,
      currentPullRequest: number,
      readBody: async () => {
        if (options.bodyFile) return readFileSync(options.bodyFile, "utf8");
        if (number === null) throw closedInActions(new Error("номер PR неизвестен: нужен --pr, PR_NUMBER или событие Actions"));
        let pull;
        try {
          pull = await client.getPull(number);
        } catch (error) {
          throw error instanceof GitHubApiError && (error.status === 401 || error.status === 403) && !error.rateLimited ? closedInActions(error) : error;
        }
        if (!pull.found) throw closedInActions(new GitHubApiError(`GitHub API не нашёл PR #${number} (HTTP 404 на GET /repos/${repository}/pulls/${number})`, { status: 404 }));
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
    if (result.outcome === "fail-closed") {
      return block(mode, {
        message: renderMisconfiguration({ cabinet: result.cabinet, reason: result.error, runId: env.GITHUB_RUN_ID ?? null, repository }),
        short: `Проверка не смогла прочитать описание этого PR (${result.error}). Это поломка настройки, а не нарушение: см. лог шага.`,
        title: `${CHECK_NAME}: ПРОВЕРКА НЕ МОЖЕТ ПРОЧИТАТЬ ОПИСАНИЕ`,
      });
    }
    return block(mode, {
      message: renderFailure({ cabinet: result.cabinet, problems: result.problems, runId: env.GITHUB_RUN_ID ?? null, repository }),
      short: `Кабинет студента изменён (${filesWord(result.cabinet.length)}), а приложение — нет: приложение не изменено (mobile/src без тестов, mobile/assets, mobile/app.config.ts) и в описании PR нет строки «Приложение: не нужно — <причина>» или «Приложение: отдельным PR #<номер>». Подробности в логе шага; после правки описания перезапустите упавшую проверку.`,
      title: CHECK_NAME,
    });
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
      const message = `проверка сама дала сбой: ${describeError(error)}. Проверка пропущена, PR из-за этого не блокируется.`;
      process.stdout.write(`::warning title=${CHECK_NAME}::${escapeAnnotation(message)}\n`);
      writeSummary(process.env, `${CHECK_NAME}: ПРОВЕРКА ПРОПУЩЕНА`, message, SKIPPED_LEAD);
      process.exitCode = 0;
    },
  );
}
