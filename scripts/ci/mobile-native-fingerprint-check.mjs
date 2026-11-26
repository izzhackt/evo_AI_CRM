#!/usr/bin/env node
// «Native fingerprint lock»: the native fingerprint of the phone app is locked in the repository
// (AGENTS.md, «Кабинет и приложение идут вместе», «Замок отпечатка нативной сборки»).
//
// WHY. The app (mobile/, Expo) uses `runtimeVersion: { policy: "fingerprint" }`. An EAS Update (an over-the-air, JS-only
// release) is delivered ONLY to builds whose native fingerprint equals the update's. Any native change (a native
// dependency, app.config.ts, an icon, a config plugin, the `scripts` of mobile/package.json) gives a fingerprint that no
// installed build has: the update would reach nobody, and nothing would say so. This guard compares the fingerprints of
// the working tree with mobile/native-fingerprint.lock.json, the fingerprints of the build the students actually have.
//
// WHAT IT RUNS. The same command a person runs, per platform, in mobile/ with the project's own copy of the tool:
//   node node_modules/@expo/fingerprint/bin/cli.js fingerprint:generate --platform ios|android      (hash only is compared)
// It is the engine and the default options that `eas build` and `eas update` use through expo-updates (checked on
// 26.11.2026: `expo-updates runtimeversion:resolve` gives the same two hashes). Only hashes decide; the JSON sources the
// tool prints are used afterwards to EXPLAIN a difference.
//
// DETERMINISM (measured 26.11.2026 on main 4e7a17ea3, Expo SDK 58, @expo/fingerprint 0.21.9, on macOS; the pull request's
// own CI run adds Linux): the same two hashes come out of five repeated runs, a minimal environment, CI=true, NODE_ENV, TZ,
// every LANG and LC_ALL tried (cs, sk, da, et, tr, ky, ...), a fresh `git clone` with a fresh `npm ci`, a `git archive` copy
// without .git in another folder, untracked and modified JS files, a stray file or an unreferenced asset in mobile/, git-ignored
// mobile/ios and mobile/android folders (even with their marker files), a lock file inside mobile/, and edits of the root
// package.json, next.config.ts and the shared ../src. What DOES move the hashes without any change of the project is two
// environment variables (CLEARED_ENV). They are removed before the tool runs, and the locale is pinned (PINNED_ENV), so what a
// person has in their shell can neither fake a difference nor hide one. The message this guard prints lists what moves them in the files.
//
// OUTCOMES, kept apart on purpose:
//   - pass: both fingerprints equal the lock;
//   - mismatch (a violation): exit 1, names the platform(s), the sources that changed and what to do;
//   - the guard's OWN trouble (lock missing or corrupt, the tool missing or crashing, a bug): FAIL CLOSED, exit 1.
//     A guard that passes when it cannot compute is worse than no guard.
// MOBILE_FINGERPRINT_LOCK_MODE=warn (the repository variable of the same name) is the emergency switch: both kinds of
// failure become warnings and the exit code is 0. The workflows only run this guard when mobile/ (or what the app shares
// with the web) changed, or on a push to main; this script itself has no notion of events.
//
//   node scripts/ci/mobile-native-fingerprint-check.mjs                     check (CI and laptop), explains against origin/main
//   node scripts/ci/mobile-native-fingerprint-check.mjs --base HEAD^        explain against another commit
//   node scripts/ci/mobile-native-fingerprint-check.mjs --update            record the CURRENT fingerprints (new store build intended)
import { execFile, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CHECK_NAME = "Native fingerprint lock";
export const MODE_VARIABLE = "MOBILE_FINGERPRINT_LOCK_MODE";
export const PLATFORMS = Object.freeze(["ios", "android"]);
/** The exact key set of the lock file: anything else is a corrupt lock. */
export const LOCK_KEYS = Object.freeze(["android", "builtAt", "ios", "note"]);
export const LOCK_FILE = "mobile/native-fingerprint.lock.json";
export const FINGERPRINT_CLI = "node_modules/@expo/fingerprint/bin/cli.js";
export const UPDATE_COMMAND = "node scripts/ci/mobile-native-fingerprint-check.mjs --update";
export const CHECK_COMMAND = "node scripts/ci/mobile-native-fingerprint-check.mjs";
export const DEFAULT_BASE = "origin/main";
export const MAX_NOTE_LENGTH = 500;
export const DEFAULT_NOTE = "Отпечатки Expo (runtimeVersion) сборки, которая стоит у студентов: EAS Update доходит только до сборок с таким же отпечатком. "
  + "Менять только вместе с новой сборкой в магазинах. "
  + "Fingerprints (runtimeVersion) of the build students have installed; change only together with a new store build. "
  + "AGENTS.md, «Кабинет и приложение идут вместе».";
/**
 * Environment variables that change the fingerprint WITHOUT any change of the project (measured 26.11.2026):
 *  - EAS_PROJECT_ID: read by mobile/app.config.ts (the update URL and `extra`);
 *  - USE_RNCORE_AUTOLINKING_FROM_EXPO: read by the fingerprint CLI (`=0` gives other autolinking sources).
 * DEBUG and EXPO_DEBUG do not change the hash, but turn on the tool's verbose output. All four are removed for the child
 * process, so the result depends on the checkout only. (A mobile/.env file with EAS_PROJECT_ID would still be read by
 * app.config.ts: such a file is local and git-ignored, a CI checkout has none.)
 */
export const CLEARED_ENV = Object.freeze(["EAS_PROJECT_ID", "USE_RNCORE_AUTOLINKING_FROM_EXPO", "DEBUG", "EXPO_DEBUG"]);
/**
 * Pinned, not removed: the tool sorts its sources with the default locale's `localeCompare` and the hash follows that order.
 * Every locale tried gives the current sources the same order (measured), but a locale with rules of its own (Czech sorts «ch»
 * after «h») would order other names differently, so the locale is the one a CI runner has (Node maps C, POSIX, C.UTF-8 and
 * en_US all to en-US).
 */
export const PINNED_ENV = Object.freeze({ LC_ALL: "en_US.UTF-8" });

const HASH_PATTERN = /^[0-9a-f]{40}$/u;
const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SHELL_SAFE_REF = /^[A-Za-z0-9_][A-Za-z0-9_./@^~-]*$/u;
const MAX_LISTED = 12;

// ---------------------------------------------------------------------------------------------------------------------
// Text helpers (text from git, from files and from the tool is untrusted: no control characters reach the log)
// ---------------------------------------------------------------------------------------------------------------------

const LINE_SEPARATORS = String.fromCharCode(0x2028, 0x2029);
const printable = (text) => String(text).replace(new RegExp(`[\\u0000-\\u001f\\u007f-\\u009f${LINE_SEPARATORS}]`, "gu"), " ");
const clip = (text, length = 160) => {
  const clean = printable(text);
  return clean.length > length ? `${clean.slice(0, length - 1)}…` : clean;
};
const describeError = (error) => {
  const cause = error?.cause?.message ? `: ${error.cause.message}` : "";
  return printable(`${error instanceof Error ? error.message : error}${cause}`).slice(0, 400);
};
/** The runner trims leading spaces and then reads «::name::» at the start of a line as a command: text of ours must never do that. */
export const defang = (text) => String(text).split("\n").map((line) => (/^\s*::/u.test(line) ? `| ${line}` : line)).join("\n");
const escapeAnnotation = (text) => String(text).replace(/%/gu, "%25").replace(/\r/gu, "%0D").replace(/\n/gu, "%0A");
const firstLines = (text, count = 3) => String(text ?? "").split(/\r\n|\r|\n/u).map((line) => line.trim()).filter(Boolean).slice(0, count).join(" | ");

// ---------------------------------------------------------------------------------------------------------------------
// The lock file
// ---------------------------------------------------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/u;

function isIsoDate(value) {
  const match = ISO_DATE.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Strict: exactly the keys ios, android, builtAt, note; the two fingerprints are 40 lowercase hex digits; builtAt is an
 * ISO date; note is one short non-empty text. Returns { ok: true, lock } or { ok: false, problems: [...] } (all problems at once).
 */
export function parseLock(text) {
  let data;
  try {
    data = JSON.parse(String(text));
  } catch (error) {
    return { ok: false, problems: [`это не JSON / not valid JSON (${clip(describeError(error), 120)})`] };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, problems: ["корень должен быть объектом { ios, android, builtAt, note } / the root must be an object"] };
  }
  const problems = [];
  const keys = Object.keys(data);
  const extra = keys.filter((key) => !LOCK_KEYS.includes(key));
  const missing = LOCK_KEYS.filter((key) => !keys.includes(key));
  if (extra.length > 0) problems.push(`лишние ключи / unexpected keys: ${extra.map((key) => `«${clip(key, 40)}»`).join(", ")}`);
  if (missing.length > 0) problems.push(`нет ключей / missing keys: ${missing.join(", ")}`);
  for (const platform of PLATFORMS) {
    if (keys.includes(platform) && !(typeof data[platform] === "string" && HASH_PATTERN.test(data[platform]))) {
      problems.push(`${platform}: нужны 40 шестнадцатеричных знаков в нижнем регистре / needs 40 lowercase hex digits`);
    }
  }
  if (keys.includes("builtAt") && !(typeof data.builtAt === "string" && isIsoDate(data.builtAt))) {
    problems.push("builtAt: нужна дата ISO, например 2026-11-26 / needs an ISO date such as 2026-11-26");
  }
  if (keys.includes("note") && !(typeof data.note === "string" && data.note.trim() !== "" && data.note.length <= MAX_NOTE_LENGTH)) {
    problems.push(`note: нужен непустой текст не длиннее ${MAX_NOTE_LENGTH} знаков / needs a non-empty text of at most ${MAX_NOTE_LENGTH} characters`);
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, lock: { ios: data.ios, android: data.android, builtAt: data.builtAt, note: data.note } };
}

/** The one canonical form of the lock file: fixed key order, two-space indent, one trailing newline. */
export function serializeLock({ ios, android, builtAt, note }) {
  return `${JSON.stringify({ ios, android, builtAt, note }, null, 2)}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Computing the fingerprints
// ---------------------------------------------------------------------------------------------------------------------

/** The environment of the fingerprint tool: the caller's, without the variables that change the hash by themselves, with the locale pinned. */
export function fingerprintEnv(env) {
  const clean = { ...env };
  for (const name of CLEARED_ENV) delete clean[name];
  return { ...clean, ...PINNED_ENV };
}

/** The tool prints one JSON document: { sources: [...], hash }. Other lines before it are tolerated, a broken document is not. */
export function parseFingerprintOutput(stdout, platform = "?") {
  const text = String(stdout ?? "").trim();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const last = text.split(/\r\n|\r|\n/u).map((line) => line.trim()).filter(Boolean).pop() ?? "";
    try {
      data = JSON.parse(last);
    } catch {
      throw new Error(`fingerprint:generate --platform ${platform} напечатал не JSON / printed no JSON: «${clip(text, 80)}»`);
    }
  }
  if (data === null || typeof data !== "object" || typeof data.hash !== "string" || !HASH_PATTERN.test(data.hash)) {
    throw new Error(`fingerprint:generate --platform ${platform}: в ответе нет корректного hash / the answer has no valid hash`);
  }
  return { hash: data.hash, sources: Array.isArray(data.sources) ? data.sources : [] };
}

/** Runs the tool of the project (default: mobile/) for one platform. Throws with a readable reason. */
export function createFingerprintComputer({ projectDir, env = process.env, nodePath = process.execPath, timeoutMs = 180_000 }) {
  return async (platform) => {
    if (!existsSync(join(projectDir, FINGERPRINT_CLI))) {
      throw new Error(`нет ${FINGERPRINT_CLI} в ${projectDir}: выполните «cd mobile && npm ci» / the project's dependencies are not installed: run «cd mobile && npm ci»`);
    }
    let result;
    try {
      result = await execFileAsync(nodePath, [FINGERPRINT_CLI, "fingerprint:generate", "--platform", platform], {
        cwd: projectDir,
        env: fingerprintEnv(env),
        timeout: timeoutMs,
        maxBuffer: 256 * 1024 * 1024,
        encoding: "utf8",
      });
    } catch (error) {
      const reason = error?.killed ? `не уложился в ${Math.round(timeoutMs / 1000)} с / timed out` : firstLines(error?.stderr) || describeError(error);
      throw new Error(`fingerprint:generate --platform ${platform} не выполнился / failed: ${clip(reason, 240)}`);
    }
    return parseFingerprintOutput(result.stdout, platform);
  };
}

function readToolVersion(projectDir) {
  try {
    return JSON.parse(readFileSync(join(projectDir, "node_modules/@expo/fingerprint/package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/** [{ platform, expected, actual }] for each platform whose computed fingerprint differs from the lock. */
export function compareFingerprints(lock, computed) {
  return PLATFORMS
    .filter((platform) => lock[platform] !== computed[platform]?.hash)
    .map((platform) => ({ platform, expected: lock[platform], actual: computed[platform]?.hash }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Explaining a difference: which sources of the fingerprint changed
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The key of a source: its type and its path or id. A package that was reached through a symlinked node_modules has a
 * path with leading «../» parts and the real location; only the part from «node_modules/» counts, so two runs compare.
 */
export function sourceKey(source) {
  const raw = String(source?.filePath ?? source?.id ?? source?.name ?? "").replace(/\\/gu, "/");
  const cut = raw.search(/(?:^|\/)node_modules\//u);
  const path = cut === -1 ? raw : raw.slice(cut).replace(/^\//u, "");
  return `${source?.type ?? "?"} ${path}`;
}

/** Dotted paths where two JSON values differ (objects are walked, arrays and scalars compared whole). At most `limit`. */
export function jsonDifferences(before, after, limit = 8) {
  const found = [];
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const walk = (a, b, path) => {
    if (found.length >= limit) return;
    if (isObject(a) && isObject(b)) {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) walk(a[key], b[key], path ? `${path}.${key}` : key);
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      found.push(path || "(всё содержимое / everything)");
    }
  };
  walk(before, after, "");
  return found;
}

/** What a source IS, in words (Russian first, English after). */
export function describeSource(source) {
  const reasons = Array.isArray(source?.reasons) ? source.reasons : [];
  const id = String(source?.id ?? "");
  if (source?.type === "contents" && id === "expoConfig") return "собранный app.config.ts / the evaluated app.config.ts";
  if (source?.type === "contents" && id === "packageJson:scripts") return "раздел scripts в mobile/package.json / the «scripts» section of mobile/package.json";
  if (source?.type === "contents" && /autolinking/iu.test(id)) return "список нативных модулей (autolinking) / the list of native modules (autolinking)";
  if (source?.type === "package") return "нативный пакет в node_modules / a native package in node_modules";
  if (source?.type === "file" && reasons.includes("bareGitIgnore")) return "mobile/.gitignore";
  if (source?.type === "file" && reasons.includes("expoConfigPlugins")) return "файл config-плагина / a config plugin file";
  if (source?.type === "file" && reasons.includes("expoConfigExternalFile")) return "файл из app.config.ts (значок, заставка) / a file referenced from app.config.ts (icon, splash)";
  if (source?.type === "dir") return "папка нативного проекта / a native project folder";
  return "";
}

function describeChange(before, after) {
  if (after.type === "package") {
    return before.version !== after.version
      ? `${printable(after.name ?? "?")} ${printable(before.version ?? "?")} → ${printable(after.version ?? "?")}`
      : `${printable(after.name ?? "package.json")}: package.json изменён / changed`;
  }
  if (after.type === "contents") {
    try {
      const paths = jsonDifferences(JSON.parse(before.contents), JSON.parse(after.contents));
      if (paths.length > 0) return `поля / fields: ${paths.map((path) => clip(path, 60)).join(", ")}`;
    } catch { /* not JSON: fall through */ }
  }
  return "содержимое изменилось / the content changed";
}

/** Sources of `before` (the base) against `after` (this tree): changed (same key, other hash), added, removed. */
export function diffSources(before = [], after = []) {
  const index = (list) => new Map(list.map((source) => [sourceKey(source), source]));
  const old = index(before);
  const now = index(after);
  const changed = [];
  const added = [];
  const removed = [];
  for (const [key, source] of now) {
    const previous = old.get(key);
    if (!previous) added.push({ key, source });
    else if (previous.hash !== source.hash) changed.push({ key, source, detail: describeChange(previous, source) });
  }
  for (const [key, source] of old) if (!now.has(key)) removed.push({ key, source });
  const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return { changed: changed.sort(byKey), added: added.sort(byKey), removed: removed.sort(byKey) };
}

const isSafeRef = (ref) => SHELL_SAFE_REF.test(ref);

/**
 * Files under mobile/ that differ between `base` and the working tree (staged, unstaged and new files; on a CI checkout
 * the working tree is the commit), minus the folders the fingerprint never reads.
 */
export function createChangedFilesLister({ repoRoot, projectDir }) {
  const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "buffer", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
    .toString("utf8").split("\0").filter(Boolean);
  return (base) => {
    if (!isSafeRef(base)) throw new Error(`странное имя ветки или коммита «${clip(base, 40)}»`);
    const prefix = `${relative(repoRoot, projectDir).split(sep).join("/")}/`;
    const ignored = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:src|scripts|\\.maestro)/`, "u");
    const paths = [
      ...git("diff", "--name-only", "--no-renames", "-z", base, "--", prefix),
      ...git("ls-files", "--others", "--exclude-standard", "-z", "--", prefix),
    ];
    // The lock itself is not a source of the fingerprint (measured: a file in mobile/ the config does not name changes nothing).
    return [...new Set(paths)].filter((path) => !ignored.test(path) && path !== `${prefix}native-fingerprint.lock.json`).sort();
  };
}

/**
 * An extract of the project as it is in `base`, with the working tree's node_modules linked in, and the tool run there.
 * Exact for everything but a changed installed package (a version bump of a native module looks the same on both sides:
 * the message says so). The extract is a throwaway folder; the real node_modules is only linked, never touched.
 */
export function createBaselineOpener({ repoRoot, projectDir, env = process.env, nodePath = process.execPath, timeoutMs = 180_000 }) {
  return async (base) => {
    if (!isSafeRef(base)) throw new Error(`странное имя ветки или коммита «${clip(base, 40)}»`);
    const relativeProject = relative(repoRoot, projectDir).split(sep).join("/");
    if (relativeProject === "" || relativeProject.startsWith("..")) throw new Error("проект вне репозитория / the project is outside the repository");
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", `${base}^{commit}`], { cwd: repoRoot, stdio: "ignore" });
    } catch {
      throw new Error(`нет «${clip(base, 40)}» в этой копии репозитория (в CI шаг делает git fetch) / «${clip(base, 40)}» is not available in this checkout`);
    }
    if (!existsSync(join(projectDir, "node_modules"))) throw new Error("нет mobile/node_modules / mobile/node_modules is missing");
    const dir = mkdtempSync(join(tmpdir(), "evo-fingerprint-base-"));
    const link = join(dir, relativeProject, "node_modules");
    const close = () => {
      try { unlinkSync(link); } catch { /* not created yet */ }
      rmSync(dir, { recursive: true, force: true });
    };
    try {
      const archive = execFileSync("git", ["archive", "--format=tar", base, "--", relativeProject], { cwd: repoRoot, maxBuffer: 1024 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      execFileSync("tar", ["-x", "-f", "-", "-C", dir], { input: archive, stdio: ["pipe", "ignore", "pipe"] });
      symlinkSync(join(projectDir, "node_modules"), link, "dir");
    } catch (error) {
      close();
      throw new Error(`не удалось развернуть «${clip(base, 40)}» / could not extract «${clip(base, 40)}»: ${clip(firstLines(error?.stderr) || describeError(error), 160)}`);
    }
    const compute = createFingerprintComputer({ projectDir: join(dir, relativeProject), env, nodePath, timeoutMs });
    return { compute, close };
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Messages (Russian first, English after: the owner reads Russian, agents often read English)
// ---------------------------------------------------------------------------------------------------------------------

const WHAT_CHANGES_A_FINGERPRINT = [
  "Что меняет отпечаток (Expo SDK 58, @expo/fingerprint, набор «balanced»; проверено 26.11.2026):",
  "  - mobile/app.config.ts: почти всё (name, scheme, plugins, разрешения, значки, updates, extra), кроме номеров версий;",
  "  - раздел «scripts» в mobile/package.json: любая новая или изменённая команда;",
  "  - нативные зависимости: версии установленных пакетов с нативным кодом и config-плагинов (mobile/package.json и package-lock.json вместе);",
  "  - mobile/plugins/**; значок, адаптивный значок и заставка, подключённые в app.config.ts; mobile/.gitignore; .fingerprintignore и fingerprint.config.js;",
  "  - папки mobile/ios и mobile/android, если их закоммитят.",
  "Не меняют: mobile/src/** и тесты, общий код ../src, eas.json, номер версии, package-lock.json сам по себе, зависимости без нативного кода.",
  "What changes a fingerprint (Expo SDK 58, @expo/fingerprint, the «balanced» preset; checked on 2026-11-26):",
  "  - mobile/app.config.ts: almost everything (name, scheme, plugins, permissions, icons, updates, extra) except the version numbers;",
  "  - the «scripts» section of mobile/package.json: any new or changed command;",
  "  - native dependencies: the installed versions of packages with native code and of config plugins (mobile/package.json and package-lock.json together);",
  "  - mobile/plugins/**; the icon, adaptive icon and splash referenced from app.config.ts; mobile/.gitignore; .fingerprintignore and fingerprint.config.js;",
  "  - mobile/ios and mobile/android folders, if they get committed.",
  "It does NOT change: mobile/src/** and tests, the shared web code ../src, eas.json, the version number, package-lock.json alone, dependencies without native code.",
];

function renderPlatformTable(lock, computed) {
  return PLATFORMS.map((platform) => {
    const actual = computed[platform]?.hash;
    const same = lock[platform] === actual;
    return `  ${platform.padEnd(8)} замок / lock ${lock[platform]}   сейчас / now ${actual ?? "—"}   ${same ? "совпадает / same" : "РАЗЛИЧАЕТСЯ / DIFFERS"}`;
  });
}

function renderExplanation(explanation, differing, base) {
  if (!explanation) return [];
  const lines = ["", `Что изменилось по сравнению с ${base} / What changed compared with ${base}:`];
  const names = differing.map((entry) => entry.platform);
  if (explanation.unavailable) {
    lines.push(`  Источники сравнить не удалось / Could not compare the sources: ${clip(explanation.unavailable, 240)}`);
  } else {
    for (const platform of names) {
      const info = explanation.platforms?.[platform];
      if (!info) continue;
      // The base runs with THIS checkout's node_modules (re-installing the base would be slow), so «equal to the lock» is
      // proof that the project files introduced the difference, while «not equal» can also mean a changed installed package.
      lines.push(`  ${platform}: ${info.matchesLock
        ? `файлы ${base} с вашими установленными пакетами дают замок, различие внесено этим изменением / the files of ${base}, with your installed packages, give the lock: this change introduced the difference`
        : `файлы ${base} с вашими установленными пакетами тоже не дают замок: либо расхождение уже есть в ${base}, либо изменились установленные пакеты (см. mobile/package.json и package-lock.json) / `
          + `the files of ${base}, with your installed packages, do not give the lock either: ${base} has already drifted, or an installed package changed (see mobile/package.json and package-lock.json)`}`);
      const { changed, added, removed } = info.diff;
      const rows = [
        ...changed.map(({ key, source, detail }) => `~ ${key}: ${detail}${describeSource(source) ? ` — ${describeSource(source)}` : ""}`),
        ...added.map(({ key, source }) => `+ ${key} (новый / new)${describeSource(source) ? ` — ${describeSource(source)}` : ""}`),
        ...removed.map(({ key, source }) => `- ${key} (исчез / removed)${describeSource(source) ? ` — ${describeSource(source)}` : ""}`),
      ];
      if (rows.length === 0) {
        lines.push("    ни один источник не отличается: различие в установленных пакетах (версия нативного модуля), а не в файлах проекта; сравните mobile/package.json и mobile/package-lock.json с main /",
          "    no source differs: the difference is in an installed package (a native module version), not in project files; compare mobile/package.json and mobile/package-lock.json with main");
      } else {
        for (const row of rows.slice(0, MAX_LISTED)) lines.push(`    ${clip(row, 220)}`);
        if (rows.length > MAX_LISTED) lines.push(`    … и ещё / and ${rows.length - MAX_LISTED} more`);
      }
    }
  }
  if (Array.isArray(explanation.changedFiles)) {
    lines.push(explanation.changedFiles.length === 0
      ? `  Файлы mobile/ вне src, scripts и .maestro не отличаются от ${base} / No file under mobile/ outside src, scripts and .maestro differs from ${base}`
      : "  Файлы этого изменения, от которых может зависеть отпечаток / Files of this change the fingerprint may depend on:");
    for (const file of explanation.changedFiles.slice(0, MAX_LISTED)) lines.push(`    ${clip(file, 200)}`);
    if (explanation.changedFiles.length > MAX_LISTED) lines.push(`    … и ещё / and ${explanation.changedFiles.length - MAX_LISTED} more`);
  } else if (explanation.filesUnavailable) {
    lines.push(`  Список изменённых файлов недоступен / The list of changed files is not available: ${clip(explanation.filesUnavailable, 200)}`);
  }
  return lines;
}

const modeSwitchLines = (repository) => [
  `Аварийный режим (только владелец, настройки GitHub править не нужно): gh variable set ${MODE_VARIABLE} --body warn --repo ${repository}`,
  `Emergency switch (owner only, no settings edit): the command above turns this failure into a warning; gh variable delete ${MODE_VARIABLE} --repo ${repository} brings the strict mode back.`,
];

export function renderMismatch({ differing, lock, computed, explanation = null, base = DEFAULT_BASE, repository = "izzhackt/evo_AI_CRM" }) {
  const names = differing.map((entry) => entry.platform).join(", ");
  return [
    `${CHECK_NAME}: отпечаток нативной сборки приложения изменился (${names}).`,
    `${CHECK_NAME}: the native fingerprint of the phone app changed (${names}).`,
    "",
    "Почему это важно: обновление по воздуху (EAS Update) приходит только в сборки с тем же отпечатком (runtimeVersion = fingerprint).",
    `Замок ${LOCK_FILE} хранит отпечатки сборки, которая стоит у студентов (записано ${lock.builtAt}). С другим отпечатком ни одно установленное приложение не получит обновление: оно уйдёт в никуда.`,
    "Why it matters: an over-the-air update (EAS Update) is delivered only to builds with the same native fingerprint (runtimeVersion = fingerprint).",
    `The lock ${LOCK_FILE} holds the fingerprints of the build students have installed (recorded ${lock.builtAt}). With a different fingerprint no installed app would receive an update: it would reach nobody.`,
    "",
    "Что не совпало / What differs:",
    ...renderPlatformTable(lock, computed),
    ...renderExplanation(explanation, differing, base),
    "",
    ...WHAT_CHANGES_A_FINGERPRINT,
    "",
    "Что делать / What to do:",
    "  1. Нативное изменение случайно (почти всегда так): верните то, что вы изменили, к состоянию main (git checkout origin/main -- <файл>) и проверьте:",
    `       ${CHECK_COMMAND}`,
    "     Accidental native change (almost always): restore what you changed to the state of main (git checkout origin/main -- <file>) and run the command above.",
    "  2. Новая нативная сборка задумана (владелец собирает eas build): в ЭТОМ ЖЕ PR обновите замок и закоммитьте его:",
    "       cd mobile && npm ci && cd ..",
    `       ${UPDATE_COMMAND}`,
    "     После слияния НУЖНА НОВАЯ СБОРКА в магазинах (eas build и eas submit запускает только владелец). Пока её нет, обновление по воздуху с новым отпечатком не дойдёт ни до одного установленного приложения;",
    "     не запускайте eas update из такой ветки.",
    "     A NEW native build is intended (the owner runs eas build): in THIS pull request update the lock with the command above and commit it.",
    "     A new STORE BUILD is then required after the merge (only the owner runs eas build and eas submit). Until it ships, an over-the-air update with the new fingerprint reaches no installed app; do not run eas update from such a branch.",
    "  Замок руками не правят: он должен быть равен тому, что считает команда. / Do not edit the lock by hand: it must equal what the command computes.",
    "",
    ...modeSwitchLines(repository),
    "",
    "Правило: AGENTS.md, раздел «Кабинет и приложение идут вместе», пункт «Замок отпечатка нативной сборки». / Rule: AGENTS.md, «Кабинет и приложение идут вместе», «Замок отпечатка нативной сборки».",
  ].join("\n");
}

/** The guard could not do its job (lock missing or corrupt, the tool missing or crashing, a bug). Not a violation, and never a pass. */
export function renderGuardError({ reason, problems = [], repository = "izzhackt/evo_AI_CRM" }) {
  return [
    `${CHECK_NAME}: проверка не смогла выполниться, поэтому PR не пропускается.`,
    `${CHECK_NAME}: the check could not run, so the pull request is not let through.`,
    "",
    `Причина / Reason: ${clip(reason, 400)}`,
    ...(problems.length > 0 ? ["Что не так / What is wrong:", ...problems.map((problem) => `  - ${clip(problem, 240)}`)] : []),
    "",
    "Молча пропускать такой случай нельзя: проверка, которая зеленеет, когда не может посчитать, хуже, чем её отсутствие.",
    "A check that passes when it cannot compute is worse than no check, so this case fails.",
    "",
    "Что делать / What to do:",
    `  - замок потерян или испорчен: верните его из main (git checkout origin/main -- ${LOCK_FILE}); руками не правьте / the lock is missing or corrupt: restore it from main;`,
    "  - не установлены зависимости: cd mobile && npm ci / dependencies are not installed: cd mobile && npm ci;",
    "  - ошибка самого инструмента отпечатка: прочтите причину выше и повторите; если это ошибка в этой проверке, скажите владельцу /",
    "    the fingerprint tool itself failed: read the reason above and retry; if the bug is in this check, tell the owner.",
    "",
    ...modeSwitchLines(repository),
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------------------------------

export const USAGE = [
  `${CHECK_NAME}: замок отпечатка нативной сборки приложения (AGENTS.md) / the native fingerprint lock of the phone app.`,
  "",
  "  node scripts/ci/mobile-native-fingerprint-check.mjs [--base origin/main] [--no-explain]",
  "  node scripts/ci/mobile-native-fingerprint-check.mjs --update [--note \"текст\"]",
  "",
  "  (без флагов)    посчитать отпечатки iOS и Android в mobile/ и сравнить с mobile/native-fingerprint.lock.json / compute both and compare with the lock",
  "  --base <ref>    с чем сравнивать источники, когда отпечаток не совпал (по умолчанию origin/main; в CI после слияния HEAD^) / what to explain a difference against",
  "  --no-explain    не искать, какие источники изменились / skip the explanation",
  "  --update        записать ТЕКУЩИЕ отпечатки в замок (только когда задумана новая сборка в магазинах; в CI запрещено) / record the CURRENT fingerprints (a new store build is intended; refused in CI)",
  "  --note <текст>  заметка в замке при --update (по умолчанию прежняя) / the note stored by --update (default: the previous one)",
  "  --repo, --project, --lock   другие пути (для тестов) / other paths (tests)",
  "",
  `Переменная ${MODE_VARIABLE}=warn: нарушение и сбой проверки становятся предупреждением, код выхода 0.`,
  "Код выхода 1: отпечаток не совпал с замком либо проверка не смогла посчитать (замок потерян или испорчен, нет зависимостей, сбой инструмента).",
].join("\n");

export function parseArgs(argv) {
  const options = { update: false, base: DEFAULT_BASE, explain: true, note: null, lock: null, project: null, repo: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`${argument}: нужно значение / needs a value`);
      index += 1;
      return next;
    };
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--update") options.update = true;
    else if (argument === "--no-explain") options.explain = false;
    else if (argument === "--base") options.base = value();
    else if (argument === "--note") options.note = value();
    else if (argument === "--lock") options.lock = value();
    else if (argument === "--project") options.project = value();
    else if (argument === "--repo") options.repo = value();
    else throw new Error(`неизвестный аргумент / unknown argument ${clip(argument, 40)}`);
  }
  if (!isSafeRef(options.base)) throw new Error(`--base: странное имя ветки или коммита «${clip(options.base, 40)}» / odd ref`);
  if (options.note !== null && !(options.note.trim() !== "" && options.note.length <= MAX_NOTE_LENGTH && !/[\r\n]/u.test(options.note))) {
    throw new Error(`--note: нужна одна непустая строка не длиннее ${MAX_NOTE_LENGTH} знаков / one non-empty line of at most ${MAX_NOTE_LENGTH} characters`);
  }
  return options;
}

function readMode(env) {
  const raw = String(env[MODE_VARIABLE] ?? "").trim().toLowerCase();
  return { warn: raw === "warn", unknown: raw !== "" && raw !== "warn" && raw !== "enforce" ? raw : null };
}

/** One block of the job summary. An indented block, not a fence: nothing in the text can close it. */
function writeSummary(env, title, message, lead = null) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  const indented = String(message).split("\n").map((line) => `    ${line}`).join("\n");
  try {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `## ${title}\n\n${lead ? `**${lead}**\n\n` : ""}${indented}\n\n`);
  } catch { /* the summary is a courtesy */ }
}

function readLockFile(lockPath) {
  let text;
  try {
    text = readFileSync(lockPath, "utf8");
  } catch (error) {
    return { ok: false, problems: [error?.code === "ENOENT" ? `файла нет / the file does not exist: ${LOCK_FILE}` : `не читается / unreadable: ${clip(describeError(error), 160)}`] };
  }
  return parseLock(text);
}

const today = (now) => now().toISOString().slice(0, 10);

export async function main({ argv = process.argv.slice(2), env = process.env, stdout = process.stdout, deps = {} } = {}) {
  const log = (text = "") => { stdout.write(`${text}\n`); };
  const inActions = env.GITHUB_ACTIONS === "true";
  const repository = env.GITHUB_REPOSITORY && /^[\w.-]+\/[\w.-]+$/u.test(env.GITHUB_REPOSITORY) ? env.GITHUB_REPOSITORY : "izzhackt/evo_AI_CRM";
  const notice = (level, message) => log(inActions ? `::${level} title=${CHECK_NAME}::${escapeAnnotation(message)}` : `${level === "error" ? "ОШИБКА / ERROR" : "ВНИМАНИЕ / WARNING"}: ${message}`);
  const mode = readMode(env);
  // Blocks the pull request, unless the emergency switch (MOBILE_FINGERPRINT_LOCK_MODE=warn) turns the block into a warning.
  const block = ({ message, short, title }) => {
    log(defang(message));
    if (mode.warn) {
      notice("warning", `Режим предупреждений / Warning mode (${MODE_VARIABLE}=warn): ${short} PR не блокируется / the pull request is not blocked.`);
      writeSummary(env, `${title} (режим предупреждений / warning mode)`, message, `Включён ${MODE_VARIABLE}=warn: нарушение показано, но не блокирует PR / the failure is shown but does not block.`);
      return 0;
    }
    if (inActions) {
      notice("error", short);
      writeSummary(env, title, message);
    }
    return 1;
  };
  const guardError = (reason, problems = []) => block({
    message: renderGuardError({ reason, problems, repository }),
    short: `Проверка не смогла выполниться: ${clip(reason, 200)} / The check could not run. Подробности в логе шага / Details in the step log.`,
    title: `${CHECK_NAME}: ПРОВЕРКА НЕ СМОГЛА ВЫПОЛНИТЬСЯ / THE CHECK COULD NOT RUN`,
  });

  try {
    let options;
    try {
      options = parseArgs(argv);
    } catch (error) {
      log(USAGE);
      return guardError(`неверные аргументы / bad arguments: ${describeError(error)}`);
    }
    if (options.help) {
      log(USAGE);
      return 0;
    }
    if (mode.unknown) notice("warning", `${MODE_VARIABLE}=«${clip(mode.unknown, 40)}» не распознано (допустимо warn или пусто), проверка работает в строгом режиме / not recognized (warn or empty), the strict mode is on.`);

    const repoRoot = options.repo ? resolve(options.repo) : DEFAULT_REPO_ROOT;
    const projectDir = options.project ? resolve(options.project) : join(repoRoot, "mobile");
    const lockPath = options.lock ? resolve(options.lock) : join(projectDir, "native-fingerprint.lock.json");
    const now = deps.now ?? (() => new Date());
    const computeFingerprint = deps.computeFingerprint ?? createFingerprintComputer({ projectDir, env });
    const toolVersion = readToolVersion(projectDir);

    const computeAll = async () => {
      log(`${CHECK_NAME}: считаю отпечатки / computing the fingerprints${toolVersion ? ` (@expo/fingerprint ${toolVersion})` : ""}: cd mobile && node ${FINGERPRINT_CLI} fingerprint:generate --platform ${PLATFORMS.join("|")}`);
      const computed = {};
      for (const platform of PLATFORMS) computed[platform] = await computeFingerprint(platform);
      return computed;
    };

    if (options.update) {
      if (inActions) {
        return guardError("--update не запускается в CI: замок обновляет человек в своём PR / --update never runs in CI: a person updates the lock in their pull request");
      }
      let computed;
      try {
        computed = await computeAll();
      } catch (error) {
        return guardError(describeError(error));
      }
      const existing = readLockFile(lockPath);
      const unchanged = existing.ok && PLATFORMS.every((platform) => existing.lock[platform] === computed[platform].hash);
      const note = options.note ?? (existing.ok ? existing.lock.note : DEFAULT_NOTE);
      if (unchanged && note === existing.lock.note) {
        log(`${CHECK_NAME}: замок уже равен текущим отпечаткам, файл не менялся / the lock already equals the current fingerprints, the file is untouched (ios ${computed.ios.hash}, android ${computed.android.hash}).`);
        return 0;
      }
      const lock = {
        ios: computed.ios.hash,
        android: computed.android.hash,
        builtAt: unchanged ? existing.lock.builtAt : today(now),
        note,
      };
      writeFileSync(lockPath, serializeLock(lock));
      const shown = relative(process.cwd(), lockPath);
      log(`${CHECK_NAME}: замок записан / the lock is written: ${shown === "" || shown.startsWith("..") ? lockPath : shown}`);
      for (const platform of PLATFORMS) log(`  ${platform.padEnd(8)} ${existing.ok ? existing.lock[platform] : "—"}  →  ${lock[platform]}`);
      log("");
      log("ВАЖНО: это значит, что нужна НОВАЯ СБОРКА в магазинах (eas build и eas submit запускает только владелец). Закоммитьте замок в этом же PR.");
      log("Пока новая сборка не вышла, обновление по воздуху (EAS Update) с этим отпечатком не дойдёт до установленных приложений; eas update из этой ветки не запускайте.");
      log("IMPORTANT: a NEW STORE BUILD is now required (only the owner runs eas build and eas submit). Commit the lock in this same pull request.");
      log("Until the new build ships, an over-the-air update (EAS Update) with this fingerprint reaches no installed app; do not run eas update from this branch.");
      return 0;
    }

    const parsed = readLockFile(lockPath);
    if (!parsed.ok) return guardError("замок отпечатка потерян или испорчен / the fingerprint lock is missing or corrupt", parsed.problems);
    const { lock } = parsed;

    let computed;
    try {
      computed = await computeAll();
    } catch (error) {
      return guardError(describeError(error));
    }

    const differing = compareFingerprints(lock, computed);
    if (differing.length === 0) {
      log(`${CHECK_NAME}: OK — отпечатки равны замку / both fingerprints equal the lock (записан / recorded ${lock.builtAt}): ios ${computed.ios.hash}, android ${computed.android.hash}.`);
      return 0;
    }

    let explanation = null;
    if (options.explain) {
      explanation = { platforms: {}, changedFiles: null };
      const listChangedFiles = deps.listChangedFiles ?? createChangedFilesLister({ repoRoot, projectDir });
      try {
        explanation.changedFiles = listChangedFiles(options.base);
      } catch (error) {
        explanation.filesUnavailable = describeError(error);
      }
      let session = null;
      try {
        session = await (deps.openBaseline ?? createBaselineOpener({ repoRoot, projectDir, env }))(options.base);
        for (const { platform } of differing) {
          const baseline = await session.compute(platform);
          explanation.platforms[platform] = {
            matchesLock: baseline.hash === lock[platform],
            diff: diffSources(baseline.sources, computed[platform].sources),
          };
        }
      } catch (error) {
        explanation.unavailable = describeError(error);
      } finally {
        try { session?.close(); } catch { /* a throwaway folder */ }
      }
    }

    const names = differing.map((entry) => entry.platform).join(", ");
    return block({
      message: renderMismatch({ differing, lock, computed, explanation, base: options.base, repository }),
      short: `Отпечаток нативной сборки изменился (${names}): обновление по воздуху не дойдёт до установленных приложений. Верните нативное изменение или, если задумана новая сборка, обновите замок командой «${UPDATE_COMMAND}» в этом же PR (нужна новая сборка в магазинах). / `
        + `The native fingerprint changed (${names}): an EAS Update would reach no installed app. Revert the native change or, if a new build is intended, update the lock with «${UPDATE_COMMAND}» in this PR (a new store build is then required). Подробности в логе шага / Details in the step log.`,
      title: `${CHECK_NAME}: ОТПЕЧАТОК ИЗМЕНИЛСЯ / THE FINGERPRINT CHANGED (${names})`,
    });
  } catch (error) {
    return guardError(`проверка сама дала сбой / the check itself failed: ${describeError(error)}`);
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
      // main() catches everything itself; this is the last resort. Fail closed unless the emergency switch is on.
      const warn = String(process.env[MODE_VARIABLE] ?? "").trim().toLowerCase() === "warn";
      const message = `проверка сама дала сбой / the check itself failed: ${describeError(error)}`;
      process.stdout.write(`::${warn ? "warning" : "error"} title=${CHECK_NAME}::${escapeAnnotation(message)}\n`);
      process.exitCode = warn ? 0 : 1;
    },
  );
}
