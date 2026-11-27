// «Native fingerprint lock» (AGENTS.md, «Кабинет и приложение идут вместе», 26.11.2026): the guard script, the lock file,
// the step in «Mobile app», the aggregator rule in «Fast checks», the workflow for main and the rule text.
// Nothing here needs mobile/node_modules or the network. The fingerprint tool is a FAKE one (a node script that hashes a
// few files and the two environment variables the real tool is sensitive to), run as a real child process in a real
// throwaway git repository: so the real spawn, git archive, tar and the symlinked node_modules are exercised. The real
// tool is exercised by the «Mobile app» step of the PR checks (and was measured by hand: see the PR description).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { classifyChangedEntries } from "../scripts/checks/classify-pr-changes.mjs";
import {
  CHECK_NAME,
  CLEARED_ENV,
  DEFAULT_NOTE,
  FINGERPRINT_CLI,
  LOCK_FILE,
  LOCK_KEYS,
  MAX_NOTE_LENGTH,
  MODE_VARIABLE,
  PINNED_ENV,
  PLATFORMS,
  UPDATE_COMMAND,
  compareFingerprints,
  createChangedFilesLister,
  defang,
  describeSource,
  diffSources,
  fingerprintEnv,
  jsonDifferences,
  main,
  parseArgs,
  parseFingerprintOutput,
  parseLock,
  renderGuardError,
  renderMismatch,
  serializeLock,
  sourceKey,
} from "../scripts/ci/mobile-native-fingerprint-check.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = join(root, "scripts/ci/mobile-native-fingerprint-check.mjs");
const read = (path) => readFileSync(join(root, path), "utf8");

// A throwaway repository must not see the person's or the machine's git configuration.
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";

const hash = (digit) => digit.repeat(40);
const IOS = hash("a");
const ANDROID = hash("b");
const validLock = (changes = {}) => ({ ios: IOS, android: ANDROID, builtAt: "2026-11-25", note: "тест / test", ...changes });
const computedOf = (ios = IOS, android = ANDROID, sources = {}) => ({
  ios: { hash: ios, sources: sources.ios ?? [] },
  android: { hash: android, sources: sources.android ?? [] },
});
const collector = () => {
  const chunks = [];
  return { write: (text) => { chunks.push(text); return true; }, text: () => chunks.join("") };
};
function scratch(t, prefix = "evo-fingerprint-test-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------------------------------------------------------------------------------------------------------------------
// The lock file
// ---------------------------------------------------------------------------------------------------------------------

test("lock: exactly the keys ios, android, builtAt, note are accepted, and nothing else", () => {
  assert.deepEqual([...LOCK_KEYS], ["android", "builtAt", "ios", "note"]);
  assert.deepEqual(PLATFORMS, ["ios", "android"]);
  const parsed = parseLock(JSON.stringify(validLock()));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.lock, validLock());
  // A full ISO time is a date too.
  assert.equal(parseLock(JSON.stringify(validLock({ builtAt: "2026-11-25T21:41:12.345Z" }))).ok, true);
  assert.equal(parseLock(JSON.stringify(validLock({ builtAt: "2026-11-25T21:41+04:00" }))).ok, true);
});

test("lock: not JSON, not an object, a missing key, an extra key, a bad hash, a bad date and a bad note are all refused with a reason", () => {
  const refused = (text, pattern, label) => {
    const result = parseLock(text);
    assert.equal(result.ok, false, label);
    assert.match(result.problems.join("\n"), pattern, label);
  };
  refused("", /не JSON/u, "empty file");
  refused("{ios:", /не JSON/u, "broken JSON");
  refused("<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> branch", /не JSON/u, "merge conflict markers");
  for (const text of ["null", "[]", "42", '"text"']) refused(text, /должен быть объектом/u, `root ${text}`);
  for (const key of LOCK_KEYS) {
    const lock = validLock();
    delete lock[key];
    refused(JSON.stringify(lock), new RegExp(`нет ключей.*${key}`, "u"), `missing ${key}`);
  }
  refused(JSON.stringify({ ...validLock(), sources: [] }), /лишние ключи.*sources/u, "extra key");
  refused(JSON.stringify({ ...validLock(), "ios ": IOS }), /лишние ключи/u, "a key with a trailing space is another key");
  for (const platform of PLATFORMS) {
    for (const bad of [IOS.toUpperCase(), "a".repeat(39), "a".repeat(41), `${"a".repeat(39)}g`, "", 12, null, [IOS]]) {
      refused(JSON.stringify(validLock({ [platform]: bad })), new RegExp(`${platform}: нужны 40`, "u"), `${platform}=${JSON.stringify(bad)}`);
    }
  }
  for (const bad of ["2026-13-01", "2026-02-30", "26-11-25", "yesterday", "", 20261125, null, "2026-11-25T99:00:00Z", "2026-11-25 21:41"]) {
    refused(JSON.stringify(validLock({ builtAt: bad })), /builtAt: нужна дата ISO/u, `builtAt=${JSON.stringify(bad)}`);
  }
  for (const bad of ["", "   ", 7, null, "x".repeat(MAX_NOTE_LENGTH + 1)]) {
    refused(JSON.stringify(validLock({ note: bad })), /note: нужен непустой текст/u, `note=${JSON.stringify(bad)}`);
  }
  // Everything wrong is named at once, not one thing per run.
  const many = parseLock(JSON.stringify({ ios: "x", android: "y", builtAt: "z", note: "", extra: 1 }));
  assert.equal(many.problems.length, 5);
});

test("lock: serializing is one canonical form: fixed key order, two spaces, a trailing newline, no stray keys", () => {
  const text = serializeLock({ note: "n", builtAt: "2026-11-25", android: ANDROID, ios: IOS, extra: "dropped" });
  assert.equal(text, `{\n  "ios": "${IOS}",\n  "android": "${ANDROID}",\n  "builtAt": "2026-11-25",\n  "note": "n"\n}\n`);
  assert.deepEqual(parseLock(text).lock, { ios: IOS, android: ANDROID, builtAt: "2026-11-25", note: "n" });
  assert.ok(DEFAULT_NOTE.length <= MAX_NOTE_LENGTH && DEFAULT_NOTE.trim() !== "", "the default note passes its own validation");
  assert.equal(parseLock(serializeLock(validLock({ note: DEFAULT_NOTE }))).ok, true);
});

// ---------------------------------------------------------------------------------------------------------------------
// Computing: the environment, the tool's answer, the comparison
// ---------------------------------------------------------------------------------------------------------------------

test("environment: the variables that move the hash by themselves are removed, everything else stays, the input is not touched", () => {
  // Measured on 26.11.2026: these two change the hash with no change of the project.
  assert.ok(CLEARED_ENV.includes("EAS_PROJECT_ID"));
  assert.ok(CLEARED_ENV.includes("USE_RNCORE_AUTOLINKING_FROM_EXPO"));
  // DEBUG and EXPO_DEBUG do not move the hash but make the tool print more than one JSON document: the list is exact on purpose.
  assert.deepEqual([...CLEARED_ENV].sort(), ["DEBUG", "EAS_PROJECT_ID", "EXPO_DEBUG", "USE_RNCORE_AUTOLINKING_FROM_EXPO"]);
  const input = Object.fromEntries([...CLEARED_ENV.map((name) => [name, "1"]), ["PATH", "/bin"], ["HOME", "/home/x"], ["CI", "true"]]);
  const clean = fingerprintEnv(input);
  assert.deepEqual(clean, { PATH: "/bin", HOME: "/home/x", CI: "true", LC_ALL: "en_US.UTF-8" });
  assert.equal(input.EAS_PROJECT_ID, "1", "the caller's object is not changed");
  assert.equal("LC_ALL" in input, false, "nor does the pinned locale leak into it");
  // The tool sorts its sources by the default locale: the caller's locale cannot reach it (a Czech one orders «ch» after «h»).
  assert.deepEqual({ ...PINNED_ENV }, { LC_ALL: "en_US.UTF-8" });
  assert.equal(fingerprintEnv({ LC_ALL: "cs_CZ.UTF-8", LANG: "cs_CZ.UTF-8" }).LC_ALL, "en_US.UTF-8");
  assert.equal(fingerprintEnv({}).LC_ALL, "en_US.UTF-8");
});

test("tool output: one JSON document with a 40-digit hash; a noise line before it is tolerated; anything else is an error", () => {
  const document = JSON.stringify({ sources: [{ type: "file", filePath: "a", hash: hash("1") }], hash: IOS });
  assert.deepEqual(parseFingerprintOutput(document, "ios"), { hash: IOS, sources: [{ type: "file", filePath: "a", hash: hash("1") }] });
  assert.deepEqual(parseFingerprintOutput(`warning: something\n${document}\n`, "ios").hash, IOS);
  assert.deepEqual(parseFingerprintOutput(JSON.stringify({ hash: IOS }), "ios"), { hash: IOS, sources: [] });
  for (const bad of ["", "not json", "[]", "null", JSON.stringify({ sources: [] }), JSON.stringify({ hash: IOS.toUpperCase() }), JSON.stringify({ hash: "abc" }), JSON.stringify({ hash: 5 })]) {
    assert.throws(() => parseFingerprintOutput(bad, "android"), /fingerprint:generate --platform android/u, JSON.stringify(bad));
  }
});

test("comparison: equal gives nothing; one platform gives only that platform; both come in the fixed order ios, android", () => {
  assert.deepEqual(compareFingerprints(validLock(), computedOf()), []);
  assert.deepEqual(compareFingerprints(validLock(), computedOf(hash("c"), ANDROID)), [{ platform: "ios", expected: IOS, actual: hash("c") }]);
  assert.deepEqual(compareFingerprints(validLock(), computedOf(IOS, hash("d"))), [{ platform: "android", expected: ANDROID, actual: hash("d") }]);
  assert.deepEqual(compareFingerprints(validLock(), computedOf(hash("c"), hash("d"))).map((entry) => entry.platform), ["ios", "android"]);
  // The platforms are not interchangeable: the lock's ios value does not match the computed android value.
  assert.equal(compareFingerprints(validLock(), computedOf(ANDROID, IOS)).length, 2);
  // A missing computed platform is a difference, never a pass.
  assert.equal(compareFingerprints(validLock(), { ios: { hash: IOS, sources: [] } }).length, 1);
});

// ---------------------------------------------------------------------------------------------------------------------
// Explaining a difference
// ---------------------------------------------------------------------------------------------------------------------

test("sources: a package reached through a symlinked node_modules has the same key as the one in place", () => {
  const inPlace = sourceKey({ type: "package", filePath: "node_modules/expo/package.json" });
  assert.equal(inPlace, "package node_modules/expo/package.json");
  assert.equal(sourceKey({ type: "package", filePath: "../../../../x/y/mobile/node_modules/expo/package.json" }), inPlace);
  assert.equal(sourceKey({ type: "package", filePath: "..\\..\\x\\mobile\\node_modules\\expo\\package.json" }), inPlace);
  assert.equal(sourceKey({ type: "package", filePath: "node_modules/a/node_modules/b/package.json" }), "package node_modules/a/node_modules/b/package.json");
  assert.equal(sourceKey({ type: "file", filePath: "assets/images/icon.png" }), "file assets/images/icon.png");
  assert.equal(sourceKey({ type: "contents", id: "expoConfig" }), "contents expoConfig");
  assert.notEqual(sourceKey({ type: "file", filePath: "a" }), sourceKey({ type: "contents", id: "a" }), "the type is part of the key");
});

test("sources: changed, added and removed are told apart, sorted, and unchanged ones are not mentioned", () => {
  const before = [
    { type: "contents", id: "expoConfig", hash: hash("1"), contents: JSON.stringify({ name: "EVO", scheme: "evo", updates: { url: "u" } }) },
    { type: "contents", id: "packageJson:scripts", hash: hash("2"), contents: JSON.stringify({ start: "expo start" }) },
    { type: "file", filePath: "plugins/gone.js", hash: hash("3") },
    { type: "file", filePath: "assets/images/icon.png", hash: hash("4") },
    { type: "package", name: "expo-image", version: "58.0.18", filePath: "node_modules/expo-image/package.json", hash: hash("5") },
  ];
  const after = [
    { type: "contents", id: "expoConfig", hash: hash("9"), contents: JSON.stringify({ name: "EVO X", scheme: "evo", updates: { url: "v" } }) },
    { type: "contents", id: "packageJson:scripts", hash: hash("2"), contents: JSON.stringify({ start: "expo start" }) },
    { type: "file", filePath: "assets/images/icon.png", hash: hash("4") },
    { type: "file", filePath: "plugins/new.js", hash: hash("6") },
    { type: "package", name: "expo-image", version: "58.0.19", filePath: "../../elsewhere/mobile/node_modules/expo-image/package.json", hash: hash("7") },
  ];
  const diff = diffSources(before, after);
  assert.deepEqual(diff.changed.map((entry) => entry.key), ["contents expoConfig", "package node_modules/expo-image/package.json"]);
  assert.match(diff.changed[0].detail, /name, updates\.url/u, "the fields inside the config that differ");
  assert.match(diff.changed[1].detail, /expo-image 58\.0\.18 → 58\.0\.19/u);
  assert.deepEqual(diff.added.map((entry) => entry.key), ["file plugins/new.js"]);
  assert.deepEqual(diff.removed.map((entry) => entry.key), ["file plugins/gone.js"]);
  assert.deepEqual(diffSources(before, before), { changed: [], added: [], removed: [] });
  assert.deepEqual(diffSources(undefined, undefined), { changed: [], added: [], removed: [] });
});

test("sources: differences inside JSON are named by path; arrays and scalars are compared whole; the list is capped", () => {
  assert.deepEqual(jsonDifferences({ a: 1, b: { c: 2, d: 3 } }, { a: 1, b: { c: 2, d: 4 } }), ["b.d"]);
  assert.deepEqual(jsonDifferences({ plugins: ["a", "b"] }, { plugins: ["a", "c"] }), ["plugins"]);
  assert.deepEqual(jsonDifferences({ a: 1 }, { a: 1 }), []);
  assert.deepEqual(jsonDifferences({ a: 1 }, { b: 1 }), ["a", "b"]);
  assert.deepEqual(jsonDifferences({ a: 1 }, 5), ["(всё содержимое / everything)"]);
  const wide = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`k${String(index).padStart(2, "0")}`, index]));
  assert.equal(jsonDifferences(wide, {}).length, 8);
  assert.equal(jsonDifferences(wide, {}, 3).length, 3);
});

test("sources: each kind of source is named in words, an unknown one in no words", () => {
  assert.match(describeSource({ type: "contents", id: "expoConfig" }), /app\.config\.ts/u);
  assert.match(describeSource({ type: "contents", id: "packageJson:scripts" }), /scripts/u);
  assert.match(describeSource({ type: "contents", id: "expoAutolinkingConfig:ios" }), /autolinking/u);
  assert.match(describeSource({ type: "package", name: "expo-image" }), /node_modules/u);
  assert.match(describeSource({ type: "file", reasons: ["bareGitIgnore"] }), /\.gitignore/u);
  assert.match(describeSource({ type: "file", reasons: ["expoConfigPlugins"] }), /config plugin/u);
  assert.match(describeSource({ type: "file", reasons: ["expoConfigExternalFile"] }), /icon, splash/u);
  assert.equal(describeSource({ type: "mystery" }), "");
  assert.equal(describeSource(undefined), "");
});

// ---------------------------------------------------------------------------------------------------------------------
// The messages
// ---------------------------------------------------------------------------------------------------------------------

const differingIos = [{ platform: "ios", expected: IOS, actual: hash("c") }];
const explained = (overrides = {}) => ({
  changedFiles: ["mobile/app.config.ts", "mobile/package.json"],
  platforms: {
    ios: {
      matchesLock: true,
      diff: diffSources(
        [{ type: "contents", id: "expoConfig", hash: hash("1"), contents: JSON.stringify({ name: "A" }) }],
        [{ type: "contents", id: "expoConfig", hash: hash("2"), contents: JSON.stringify({ name: "B" }) }, { type: "file", filePath: "plugins/new.js", hash: hash("3") }],
      ),
    },
  },
  ...overrides,
});

test("message: names the platform that differs, shows both values, says why it matters, what changes a fingerprint and what to do, in Russian and English", () => {
  const text = renderMismatch({ differing: differingIos, lock: validLock(), computed: computedOf(hash("c"), ANDROID), explanation: explained() });
  // Which platform: the headline names only ios, the table marks android as the same.
  assert.match(text, /^Native fingerprint lock: отпечаток нативной сборки приложения изменился \(ios\)\.$/mu);
  assert.match(text, /^Native fingerprint lock: the native fingerprint of the phone app changed \(ios\)\.$/mu);
  assert.doesNotMatch(text, /изменился \(ios, android\)/u);
  assert.match(text, new RegExp(`^  ios {6}замок / lock ${IOS} {3}сейчас / now ${hash("c")} {3}РАЗЛИЧАЕТСЯ / DIFFERS$`, "mu"));
  assert.match(text, new RegExp(`^  android {2}замок / lock ${ANDROID} {3}сейчас / now ${ANDROID} {3}совпадает / same$`, "mu"));
  // Why it matters, in both languages.
  assert.match(text, /^Почему это важно: обновление по воздуху \(EAS Update\) приходит только в сборки с тем же отпечатком/mu);
  assert.match(text, /^Why it matters: an over-the-air update \(EAS Update\) is delivered only to builds with the same native fingerprint/mu);
  assert.match(text, /ни одно установленное приложение не получит обновление/u);
  assert.match(text, /no installed app would receive an update/u);
  // What changes a fingerprint, and what does not (measured facts).
  assert.match(text, /mobile\/app\.config\.ts: почти всё .* кроме номеров версий/u);
  assert.match(text, /раздел «scripts» в mobile\/package\.json/u);
  assert.match(text, /Не меняют: mobile\/src\/\*\* и тесты, общий код \.\.\/src, eas\.json, номер версии, package-lock\.json сам по себе/u);
  assert.match(text, /It does NOT change: mobile\/src\/\*\* and tests, the shared web code \.\.\/src, eas\.json, the version number, package-lock\.json alone/u);
  // What to do: revert, or update the lock in the same PR, and a new store build is then required.
  assert.match(text, /1\. Нативное изменение случайно/u);
  assert.match(text, /git checkout origin\/main -- <файл>/u);
  assert.match(text, /2\. Новая нативная сборка задумана .* в ЭТОМ ЖЕ PR обновите замок/u);
  assert.ok(text.includes(`\n       ${UPDATE_COMMAND}\n`), "the exact update command on a line of its own");
  assert.match(text, /НУЖНА НОВАЯ СБОРКА в магазинах/u);
  assert.match(text, /A new STORE BUILD is then required after the merge/u);
  assert.match(text, /не запускайте eas update из такой ветки/u);
  assert.match(text, /do not run eas update from such a branch/u);
  // The emergency switch is named with its exact variable, the rule with its exact place.
  assert.ok(text.includes(`gh variable set ${MODE_VARIABLE} --body warn --repo izzhackt/evo_AI_CRM`));
  assert.ok(text.includes(`gh variable delete ${MODE_VARIABLE} --repo izzhackt/evo_AI_CRM`));
  assert.match(text, /Правило: AGENTS\.md, раздел «Кабинет и приложение идут вместе»/u);
});

test("message: both platforms are named when both differ; the source lines say which source changed and how", () => {
  const text = renderMismatch({
    differing: [{ platform: "ios", expected: IOS, actual: hash("c") }, { platform: "android", expected: ANDROID, actual: hash("d") }],
    lock: validLock(), computed: computedOf(hash("c"), hash("d")), explanation: explained(),
  });
  assert.match(text, /изменился \(ios, android\)/u);
  assert.match(text, /changed \(ios, android\)/u);
  assert.equal((text.match(/РАЗЛИЧАЕТСЯ \/ DIFFERS/gu) ?? []).length, 2);
  // The explanation shows the changed source with its fields, the added source, and that main matches the lock.
  assert.match(text, /Что изменилось по сравнению с origin\/main \/ What changed compared with origin\/main:/u);
  assert.match(text, /~ contents expoConfig: поля \/ fields: name — собранный app\.config\.ts/u);
  assert.match(text, /\+ file plugins\/new\.js \(новый \/ new\)/u);
  assert.match(text, /файлы origin\/main с вашими установленными пакетами дают замок, различие внесено этим изменением/u);
  assert.match(text, /^ {4}mobile\/app\.config\.ts$/mu);
  assert.match(text, /^ {4}mobile\/package\.json$/mu);
});

test("message: when the base does not give the lock either, it says so without blaming main; an empty difference points at the installed packages", () => {
  const empty = { changed: [], added: [], removed: [] };
  const text = renderMismatch({
    differing: differingIos, lock: validLock(), computed: computedOf(hash("c"), ANDROID), base: "HEAD^",
    explanation: { changedFiles: [], platforms: { ios: { matchesLock: false, diff: empty } } },
  });
  assert.match(text, /файлы HEAD\^ с вашими установленными пакетами тоже не дают замок: либо расхождение уже есть в HEAD\^, либо изменились установленные пакеты/u);
  assert.match(text, /ни один источник не отличается: различие в установленных пакетах/u);
  assert.match(text, /no source differs: the difference is in an installed package/u);
  assert.match(text, /Файлы mobile\/ вне src, scripts и \.maestro не отличаются от HEAD\^/u);
  assert.doesNotMatch(text, /дают замок, различие внесено/u);
});

test("message: an unavailable explanation says why and never replaces the verdict; long lists are cut", () => {
  const text = renderMismatch({
    differing: differingIos, lock: validLock(), computed: computedOf(hash("c"), ANDROID),
    explanation: { unavailable: "нет «origin/main» в этой копии репозитория", changedFiles: null, filesUnavailable: "git diff не выполнился" },
  });
  assert.match(text, /Источники сравнить не удалось \/ Could not compare the sources: нет «origin\/main»/u);
  assert.match(text, /Список изменённых файлов недоступен \/ The list of changed files is not available: git diff не выполнился/u);
  assert.match(text, /отпечаток нативной сборки приложения изменился \(ios\)/u, "the verdict is still there");
  const many = Array.from({ length: 30 }, (_, index) => `mobile/file-${index}.png`);
  const listed = renderMismatch({ differing: differingIos, lock: validLock(), computed: computedOf(hash("c"), ANDROID), explanation: explained({ changedFiles: many }) });
  assert.equal((listed.match(/^ {4}mobile\/file-\d+\.png$/gmu) ?? []).length, 12);
  assert.match(listed, /… и ещё \/ and 18 more/u);
  assert.equal(renderMismatch({ differing: differingIos, lock: validLock(), computed: computedOf(hash("c"), ANDROID) }).includes("Что изменилось по сравнению"), false, "no explanation requested, none printed");
});

test("message: the guard's own failure is not a violation; it says the PR is not let through and how to get unstuck", () => {
  const text = renderGuardError({ reason: "замок отпечатка потерян или испорчен", problems: ["нет ключей / missing keys: note"] });
  assert.match(text, /проверка не смогла выполниться, поэтому PR не пропускается/u);
  assert.match(text, /the check could not run, so the pull request is not let through/u);
  assert.match(text, /Причина \/ Reason: замок отпечатка потерян или испорчен/u);
  assert.match(text, /  - нет ключей \/ missing keys: note/u);
  assert.match(text, /проверка, которая зеленеет, когда не может посчитать, хуже, чем её отсутствие/u);
  assert.match(text, /git checkout origin\/main -- mobile\/native-fingerprint\.lock\.json/u);
  assert.match(text, /cd mobile && npm ci/u);
  assert.ok(text.includes(`gh variable set ${MODE_VARIABLE} --body warn`));
});

test("message: text from the repository or the tool can never start a workflow command or carry control characters", () => {
  assert.equal(defang("a\n  ::error::boom\n::warning::x\nfine ::inline"), "a\n|   ::error::boom\n| ::warning::x\nfine ::inline");
  const hostile = "mobile/x\n::error::injected\u0007\u2028::stop-commands::";
  const text = renderMismatch({
    differing: differingIos, lock: validLock(), computed: computedOf(hash("c"), ANDROID),
    explanation: explained({
      changedFiles: [hostile],
      platforms: { ios: { matchesLock: true, diff: { changed: [{ key: `file ${hostile}`, source: {}, detail: hostile }], added: [], removed: [] } } },
    }),
  });
  assert.doesNotMatch(defang(text), /^\s*::/mu);
  assert.doesNotMatch(text, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/u);
  const error = renderGuardError({ reason: hostile, problems: [hostile] });
  assert.doesNotMatch(defang(error), /^\s*::/mu);
  assert.doesNotMatch(error, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/u);
});

// ---------------------------------------------------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------------------------------------------------

test("arguments: defaults, every flag, and what is refused", () => {
  assert.deepEqual(parseArgs([]), { update: false, base: "origin/main", explain: true, note: null, lock: null, project: null, repo: null, help: false });
  const all = parseArgs(["--update", "--base", "HEAD^", "--no-explain", "--note", "новая сборка 2.2.0", "--lock", "l.json", "--project", "p", "--repo", "r"]);
  assert.deepEqual(all, { update: true, base: "HEAD^", explain: false, note: "новая сборка 2.2.0", lock: "l.json", project: "p", repo: "r", help: false });
  assert.equal(parseArgs(["-h"]).help, true);
  assert.equal(parseArgs(["--help"]).help, true);
  assert.throws(() => parseArgs(["--nope"]), /неизвестный аргумент/u);
  assert.throws(() => parseArgs(["--base"]), /нужно значение/u);
  assert.throws(() => parseArgs(["--base", "--update"]), /нужно значение/u);
  for (const base of ["--evil", "a b", "-x", "x;y", "$(id)", "a\nb", ""]) assert.throws(() => parseArgs(["--base", base]), /--base|нужно значение/u, JSON.stringify(base));
  for (const base of ["origin/main", "HEAD^", "HEAD~2", "main", "4e7a17ea3", "refs/remotes/origin/main", "feature/x-1"]) assert.equal(parseArgs(["--base", base]).base, base);
  for (const note of ["", "   ", "a\nb", "x".repeat(MAX_NOTE_LENGTH + 1)]) assert.throws(() => parseArgs(["--note", note]), /--note|нужно значение/u, JSON.stringify(note));
});

// ---------------------------------------------------------------------------------------------------------------------
// main(): the decision, with the tool, git and the clock replaced by fakes
// ---------------------------------------------------------------------------------------------------------------------

/**
 * One run of the guard in a scratch folder. `computed` maps a platform to a result or an Error to throw; `baseline` is what
 * the base of the explanation gives per platform. `calls` records what the guard asked for.
 */
function harness(t, { lock, computed = computedOf(), baseline = {}, env = {}, argv = [], deps = {} } = {}) {
  const dir = scratch(t);
  const lockPath = join(dir, "lock.json");
  if (lock !== undefined) writeFileSync(lockPath, typeof lock === "string" ? lock : serializeLock(lock));
  const calls = { compute: [], baseline: [], baselineCompute: [], closed: 0, listed: [] };
  const out = collector();
  const fakes = {
    computeFingerprint: async (platform) => {
      calls.compute.push(platform);
      if (computed[platform] instanceof Error) throw computed[platform];
      return computed[platform];
    },
    openBaseline: async (base) => {
      calls.baseline.push(base);
      return {
        compute: async (platform) => {
          calls.baselineCompute.push(platform);
          return baseline[platform] ?? { hash: platform === "ios" ? IOS : ANDROID, sources: [] };
        },
        close: () => { calls.closed += 1; },
      };
    },
    listChangedFiles: (base) => { calls.listed.push(base); return ["mobile/app.config.ts"]; },
    now: () => new Date("2026-12-01T10:00:00Z"),
  };
  const run = (changes = {}) => main({
    argv: ["--lock", lockPath, "--project", join(dir, "mobile"), ...(changes.argv ?? argv)],
    env: { PATH: process.env.PATH, ...env, ...(changes.env ?? {}) },
    stdout: out,
    deps: { ...fakes, ...deps, ...(changes.deps ?? {}) },
  });
  return { dir, lockPath, calls, out, run, read: () => readFileSync(lockPath, "utf8") };
}

test("check: both fingerprints equal the lock - pass, exit 0, nothing explained, each platform computed once, ios then android", async (t) => {
  const h = harness(t, { lock: validLock() });
  assert.equal(await h.run(), 0);
  assert.match(h.out.text(), new RegExp(`Native fingerprint lock: OK — .*ios ${IOS}, android ${ANDROID}`, "u"));
  assert.deepEqual(h.calls.compute, ["ios", "android"]);
  assert.deepEqual([h.calls.baseline, h.calls.listed], [[], []], "a pass never looks at git");
  assert.equal(h.read(), serializeLock(validLock()), "a check never writes the lock");
});

test("check: ios differs only - fail, exit 1, the message names ios and not android, the base is asked about ios only and closed", async (t) => {
  const h = harness(t, { lock: validLock(), computed: computedOf(hash("c"), ANDROID), baseline: { ios: { hash: IOS, sources: [] } } });
  assert.equal(await h.run(), 1);
  const text = h.out.text();
  assert.match(text, /изменился \(ios\)\./u);
  assert.doesNotMatch(text, /изменился \(ios, android\)/u);
  assert.match(text, /android {2}замок \/ lock .*совпадает \/ same/u);
  assert.deepEqual(h.calls.baseline, ["origin/main"]);
  assert.deepEqual(h.calls.baselineCompute, ["ios"]);
  assert.deepEqual(h.calls.listed, ["origin/main"]);
  assert.equal(h.calls.closed, 1);
});

test("check: android differs only, and both differ - each fails and names exactly the platforms that differ", async (t) => {
  const android = harness(t, { lock: validLock(), computed: computedOf(IOS, hash("d")) });
  assert.equal(await android.run(), 1);
  assert.match(android.out.text(), /изменился \(android\)\./u);
  assert.deepEqual(android.calls.baselineCompute, ["android"]);

  const both = harness(t, { lock: validLock(), computed: computedOf(hash("c"), hash("d")) });
  assert.equal(await both.run(), 1);
  assert.match(both.out.text(), /изменился \(ios, android\)\./u);
  assert.deepEqual(both.calls.baselineCompute, ["ios", "android"]);
});

test("check: a platform swap is still a difference (the lock's ios is not the android value)", async (t) => {
  const h = harness(t, { lock: validLock(), computed: computedOf(ANDROID, IOS) });
  assert.equal(await h.run(), 1);
  assert.match(h.out.text(), /изменился \(ios, android\)/u);
});

test("check: a missing lock fails closed, before anything is computed, and says how to get it back", async (t) => {
  const h = harness(t, {});
  assert.equal(await h.run(), 1);
  assert.deepEqual(h.calls.compute, []);
  assert.match(h.out.text(), /проверка не смогла выполниться, поэтому PR не пропускается/u);
  assert.match(h.out.text(), /файла нет \/ the file does not exist: mobile\/native-fingerprint\.lock\.json/u);
  assert.match(h.out.text(), /git checkout origin\/main -- mobile\/native-fingerprint\.lock\.json/u);
});

test("check: a corrupt lock fails closed with the reason: not JSON, an extra key, a missing key, a bad hash", async (t) => {
  const cases = [
    ["", /не JSON/u],
    ["{", /не JSON/u],
    [JSON.stringify({ ...validLock(), extra: 1 }), /лишние ключи.*extra/u],
    [JSON.stringify({ ios: IOS, android: ANDROID, builtAt: "2026-11-25" }), /нет ключей.*note/u],
    [JSON.stringify(validLock({ android: "abc" })), /android: нужны 40/u],
  ];
  for (const [text, pattern] of cases) {
    const h = harness(t, { lock: text });
    assert.equal(await h.run(), 1, text);
    assert.match(h.out.text(), pattern, text);
    assert.deepEqual(h.calls.compute, [], "a corrupt lock is refused before computing");
    assert.equal(h.read(), text, "and left exactly as it was");
  }
});

test("check: the tool failing is the guard's own trouble and FAILS CLOSED, whichever platform it fails on", async (t) => {
  for (const computed of [
    { ios: new Error("fingerprint:generate --platform ios не выполнился: boom"), android: computedOf().android },
    { ios: computedOf().ios, android: new Error("fingerprint:generate --platform android не выполнился: boom") },
  ]) {
    const h = harness(t, { lock: validLock(), computed });
    assert.equal(await h.run(), 1);
    assert.match(h.out.text(), /проверка не смогла выполниться, поэтому PR не пропускается/u);
    assert.match(h.out.text(), /Причина \/ Reason: .*boom/u);
    assert.doesNotMatch(h.out.text(), /OK/u);
  }
  // Even a failure that is not an Error object, and a crash in an unexpected place, do not turn into a pass.
  const odd = harness(t, { lock: validLock(), deps: { computeFingerprint: async () => { throw "строка вместо ошибки"; } } });
  assert.equal(await odd.run(), 1);
  assert.match(odd.out.text(), /строка вместо ошибки/u);
  // A base that answers nonsense (no compute function, a list that is not a list) is one more way the explanation fails.
  const nonsense = harness(t, { lock: validLock(), computed: computedOf(hash("c"), ANDROID), deps: { openBaseline: async () => ({}), listChangedFiles: () => "not a list" } });
  assert.equal(await nonsense.run(), 1, "a mismatch stays a failure whatever the explanation does");
  assert.match(nonsense.out.text(), /Источники сравнить не удалось/u);
});

test("check: the explanation can fail in every way and the verdict is still the same failure, with the reason said", async (t) => {
  const broken = harness(t, {
    lock: validLock(), computed: computedOf(hash("c"), ANDROID),
    deps: { openBaseline: async () => { throw new Error("нет «origin/main» в этой копии репозитория"); }, listChangedFiles: () => { throw new Error("git diff не выполнился"); } },
  });
  assert.equal(await broken.run(), 1);
  assert.match(broken.out.text(), /Источники сравнить не удалось \/ Could not compare the sources: нет «origin\/main»/u);
  assert.match(broken.out.text(), /Список изменённых файлов недоступен.*git diff не выполнился/u);

  // The base's tool crashing in the middle still closes the throwaway copy.
  let closed = 0;
  const midway = harness(t, {
    lock: validLock(), computed: computedOf(hash("c"), hash("d")),
    deps: { openBaseline: async () => ({ compute: async () => { throw new Error("tool crashed"); }, close: () => { closed += 1; } }) },
  });
  assert.equal(await midway.run(), 1);
  assert.equal(closed, 1);
  assert.match(midway.out.text(), /tool crashed/u);

  const skipped = harness(t, { lock: validLock(), computed: computedOf(hash("c"), ANDROID), argv: ["--no-explain"] });
  assert.equal(await skipped.run(), 1);
  assert.deepEqual([skipped.calls.baseline, skipped.calls.listed], [[], []], "--no-explain asks git for nothing");
  assert.doesNotMatch(skipped.out.text(), /Что изменилось по сравнению/u);
});

test("check: --base is passed on to the explanation, and an odd one is refused before anything runs", async (t) => {
  const ok = harness(t, { lock: validLock(), computed: computedOf(hash("c"), ANDROID), argv: ["--base", "HEAD^"] });
  assert.equal(await ok.run(), 1);
  assert.deepEqual([ok.calls.baseline, ok.calls.listed], [["HEAD^"], ["HEAD^"]]);
  assert.match(ok.out.text(), /Что изменилось по сравнению с HEAD\^/u);

  const odd = harness(t, { lock: validLock(), argv: ["--base", "--output=/etc/passwd"] });
  assert.equal(await odd.run(), 1);
  assert.deepEqual([odd.calls.compute, odd.calls.baseline], [[], []]);
  assert.match(odd.out.text(), /неверные аргументы/u);
});

test("emergency switch: warn turns a mismatch, a broken lock and a failing tool into a warning with exit 0, and says so", async (t) => {
  const mismatch = harness(t, { lock: validLock(), computed: computedOf(hash("c"), ANDROID), env: { [MODE_VARIABLE]: "warn" } });
  assert.equal(await mismatch.run(), 0);
  assert.match(mismatch.out.text(), /изменился \(ios\)/u, "the failure is still shown in full");
  assert.match(mismatch.out.text(), /Режим предупреждений \/ Warning mode \(MOBILE_FINGERPRINT_LOCK_MODE=warn\).*PR не блокируется/u);

  for (const spec of [{ lock: "{" }, { lock: undefined }, { lock: validLock(), computed: { ios: new Error("boom"), android: computedOf().android } }]) {
    const h = harness(t, { ...spec, env: { [MODE_VARIABLE]: " Warn " } });
    assert.equal(await h.run(), 0, JSON.stringify(spec).slice(0, 60));
    assert.match(h.out.text(), /Режим предупреждений/u);
  }
  // The switch does not hide a pass, does not touch the lock and does not change `--update`.
  const pass = harness(t, { lock: validLock(), env: { [MODE_VARIABLE]: "warn" } });
  assert.equal(await pass.run(), 0);
  assert.match(pass.out.text(), /OK/u);
  assert.doesNotMatch(pass.out.text(), /Режим предупреждений/u);
});

test("emergency switch: only «warn» (any case) downgrades; empty and «enforce» are strict; anything else is strict and says it was not understood", async (t) => {
  for (const value of ["", "enforce", "ENFORCE", undefined]) {
    const h = harness(t, { lock: validLock(), computed: computedOf(hash("c"), ANDROID), env: { [MODE_VARIABLE]: value } });
    assert.equal(await h.run(), 1, String(value));
    assert.doesNotMatch(h.out.text(), /не распознано/u, String(value));
  }
  for (const value of ["off", "false", "0", "warning", "true", "warn,x"]) {
    const h = harness(t, { lock: validLock(), computed: computedOf(hash("c"), ANDROID), env: { [MODE_VARIABLE]: value } });
    assert.equal(await h.run(), 1, value);
    assert.match(h.out.text(), new RegExp(`ВНИМАНИЕ / WARNING: ${MODE_VARIABLE}=«${value}» не распознано`, "u"), value);
  }
});

test("emergency switch: the commands in the message name the repository of the run, and a hostile value never gets into them", async (t) => {
  const own = harness(t, { lock: validLock(), computed: computedOf(hash("c"), ANDROID), env: { GITHUB_REPOSITORY: "acme/phone-app" } });
  assert.equal(await own.run(), 1);
  assert.ok(own.out.text().includes(`gh variable set ${MODE_VARIABLE} --body warn --repo acme/phone-app`));
  assert.ok(own.out.text().includes(`gh variable delete ${MODE_VARIABLE} --repo acme/phone-app`));
  for (const hostile of ["acme/app; rm -rf ~", "acme", "a/b/c", "", "acme/app\n::error::x", "$(id)/x"]) {
    const h = harness(t, { lock: validLock(), computed: computedOf(hash("c"), ANDROID), env: { GITHUB_REPOSITORY: hostile } });
    assert.equal(await h.run(), 1);
    assert.ok(h.out.text().includes("--repo izzhackt/evo_AI_CRM"), JSON.stringify(hostile));
    assert.doesNotMatch(h.out.text(), /rm -rf|\$\(id\)|::error::x/u, JSON.stringify(hostile));
  }
});

test("Actions: a failure is one error annotation on one line plus the summary; a warning-mode failure is a warning annotation; nothing else is annotated", async (t) => {
  const summaryPath = join(scratch(t), "summary.md");
  const actions = { GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: summaryPath };
  const failed = harness(t, { lock: validLock(), computed: computedOf(hash("c"), ANDROID), env: actions });
  assert.equal(await failed.run(), 1);
  const errors = failed.out.text().split("\n").filter((line) => line.startsWith("::error "));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^::error title=Native fingerprint lock::Отпечаток нативной сборки изменился \(ios\)/u);
  assert.match(errors[0], /node scripts\/ci\/mobile-native-fingerprint-check\.mjs --update/u, "the annotation already says what to do");
  assert.match(errors[0], /The native fingerprint changed \(ios\)/u);
  assert.doesNotMatch(errors[0].slice(2), /\n/u);
  const summary = readFileSync(summaryPath, "utf8");
  assert.match(summary, /^## Native fingerprint lock: ОТПЕЧАТОК ИЗМЕНИЛСЯ \/ THE FINGERPRINT CHANGED \(ios\)\n\n    Native fingerprint lock: отпечаток/u, "an indented block, not a fence");
  assert.doesNotMatch(summary, /```/u);

  const warned = harness(t, { lock: validLock(), computed: computedOf(hash("c"), ANDROID), env: { ...actions, [MODE_VARIABLE]: "warn" } });
  assert.equal(await warned.run(), 0);
  assert.equal(warned.out.text().split("\n").filter((line) => line.startsWith("::error ")).length, 0);
  assert.equal(warned.out.text().split("\n").filter((line) => line.startsWith("::warning ")).length, 1);

  const passed = harness(t, { lock: validLock(), env: actions });
  assert.equal(await passed.run(), 0);
  assert.doesNotMatch(passed.out.text(), /::(?:error|warning)/u);

  const brokenLock = harness(t, { lock: "{", env: actions });
  assert.equal(await brokenLock.run(), 1);
  assert.match(brokenLock.out.text(), /^::error title=Native fingerprint lock::Проверка не смогла выполниться/mu);
  // Outside Actions the same failure carries no annotation syntax at all.
  const plain = harness(t, { lock: validLock(), computed: computedOf(hash("c"), ANDROID) });
  await plain.run();
  assert.doesNotMatch(plain.out.text(), /^::/mu);
});

test("Actions: text that came from git or from the tool never turns into a workflow command in the log - only the guard's own annotation is one", async (t) => {
  const h = harness(t, {
    lock: validLock(), computed: computedOf(hash("c"), ANDROID), env: { GITHUB_ACTIONS: "true" },
    deps: {
      listChangedFiles: () => ["::error::pwned by a file name", "  ::stop-commands::x", "\n::add-mask::y"],
      openBaseline: async () => { throw new Error("\n::error::from the tool\n::warning::more"); },
    },
  });
  assert.equal(await h.run(), 1);
  const commands = h.out.text().split("\n").filter((line) => /^\s*::/u.test(line));
  assert.equal(commands.length, 1, commands.join(" | "));
  assert.match(commands[0], /^::error title=Native fingerprint lock::/u);
  assert.match(h.out.text(), /^\| {5}::error::pwned by a file name$/mu, "the text itself is still shown, defanged");
});

test("help and bad arguments: --help prints the usage and passes; an unknown flag fails (a typo in the workflow must not pass)", async (t) => {
  const help = harness(t, { argv: ["--help"] });
  assert.equal(await help.run(), 0);
  assert.match(help.out.text(), /--update/u);
  assert.match(help.out.text(), /MOBILE_FINGERPRINT_LOCK_MODE=warn/u);
  assert.deepEqual(help.calls.compute, []);
  const typo = harness(t, { lock: validLock(), argv: ["--updat"] });
  assert.equal(await typo.run(), 1);
  assert.match(typo.out.text(), /неизвестный аргумент.*--updat/u);
  assert.deepEqual(typo.calls.compute, []);
});

// ---------------------------------------------------------------------------------------------------------------------
// --update: records the CURRENT values, exactly, and nothing else
// ---------------------------------------------------------------------------------------------------------------------

const treeOf = (dir) => readdirSync(dir, { recursive: true }).sort();

test("update: writes exactly the computed values, the date from the clock (UTC) and the default note - four keys, one canonical form, no other file", async (t) => {
  const h = harness(t, { computed: computedOf(hash("1"), hash("2")), argv: ["--update"] });
  const before = treeOf(h.dir);
  assert.equal(await h.run(), 0);
  assert.equal(h.read(), serializeLock({ ios: hash("1"), android: hash("2"), builtAt: "2026-12-01", note: DEFAULT_NOTE }));
  assert.deepEqual(Object.keys(JSON.parse(h.read())), ["ios", "android", "builtAt", "note"]);
  assert.deepEqual(treeOf(h.dir), [...before, "lock.json"].sort(), "the lock is the only thing written");
  assert.equal(parseLock(h.read()).ok, true);
  // The clock decides the date, and it is the UTC day: a late evening east of Greenwich is still the day before there.
  const zone = process.env.TZ;
  process.env.TZ = "Pacific/Kiritimati"; // UTC+14: here it is already the 26th, whatever the machine's own zone is
  try {
    const late = harness(t, { computed: computedOf(hash("1"), hash("2")), argv: ["--update"], deps: { now: () => new Date("2026-11-25T21:41:00Z") } });
    await late.run();
    assert.equal(JSON.parse(late.read()).builtAt, "2026-11-25");
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
  // And says what it means: a new store build is needed.
  assert.match(h.out.text(), /НОВАЯ СБОРКА в магазинах/u);
  assert.match(h.out.text(), /a NEW STORE BUILD is now required/u);
  assert.match(h.out.text(), /ios {6}—  →  1{40}/u);
  assert.deepEqual(h.calls.compute, ["ios", "android"]);
  assert.deepEqual([h.calls.baseline, h.calls.listed], [[], []], "an update does not look at git");
});

test("update: replaces different values, keeps the previous note, moves the date; --note replaces the note", async (t) => {
  const h = harness(t, { lock: validLock({ builtAt: "2026-01-01", note: "сборка 2.1.0 (6)" }), computed: computedOf(hash("1"), hash("2")), argv: ["--update"] });
  assert.equal(await h.run(), 0);
  assert.deepEqual(JSON.parse(h.read()), { ios: hash("1"), android: hash("2"), builtAt: "2026-12-01", note: "сборка 2.1.0 (6)" });
  assert.match(h.out.text(), new RegExp(`ios {6}${IOS}  →  1{40}`, "u"));

  const noted = harness(t, { lock: validLock(), computed: computedOf(hash("1"), hash("2")), argv: ["--update", "--note", "сборка 2.2.0 (7)"] });
  assert.equal(await noted.run(), 0);
  assert.equal(JSON.parse(noted.read()).note, "сборка 2.2.0 (7)");
});

test("update: when the lock already equals the computed values the file is not touched at all (no new date, same bytes, same mtime)", async (t) => {
  const h = harness(t, { lock: validLock({ builtAt: "2026-01-01" }), argv: ["--update"] });
  const before = { text: h.read(), mtime: statSync(h.lockPath).mtimeMs };
  assert.equal(await h.run(), 0);
  assert.equal(h.read(), before.text);
  assert.equal(statSync(h.lockPath).mtimeMs, before.mtime);
  assert.match(h.out.text(), /замок уже равен текущим отпечаткам, файл не менялся/u);
  // A new note on equal values is a real change of the file (the date stays).
  const renoted = harness(t, { lock: validLock({ builtAt: "2026-01-01" }), argv: ["--update", "--note", "другая заметка"] });
  assert.equal(await renoted.run(), 0);
  assert.deepEqual(JSON.parse(renoted.read()), validLock({ builtAt: "2026-01-01", note: "другая заметка" }));
});

test("update: it repairs a corrupt lock and drops extra keys, so the file is again exactly the four keys", async (t) => {
  for (const broken of ["", "{", "[]", JSON.stringify({ ...validLock(), extra: "gone", sources: [1] }), JSON.stringify({ ios: IOS })]) {
    const h = harness(t, { lock: broken, computed: computedOf(hash("1"), hash("2")), argv: ["--update"] });
    assert.equal(await h.run(), 0, broken);
    assert.deepEqual(Object.keys(JSON.parse(h.read())), ["ios", "android", "builtAt", "note"], broken);
    assert.equal(JSON.parse(h.read()).note, DEFAULT_NOTE, "no valid previous note to keep");
  }
});

test("update: never in CI, and never when the values could not be computed - the lock stays exactly as it was", async (t) => {
  const ci = harness(t, { lock: validLock(), computed: computedOf(hash("1"), hash("2")), argv: ["--update"], env: { GITHUB_ACTIONS: "true" } });
  assert.equal(await ci.run(), 1);
  assert.match(ci.out.text(), /--update не запускается в CI/u);
  assert.equal(ci.read(), serializeLock(validLock()));
  assert.deepEqual(ci.calls.compute, [], "refused before computing");

  for (const computed of [{ ios: new Error("boom"), android: computedOf().android }, { ios: computedOf().ios, android: new Error("boom") }]) {
    const h = harness(t, { lock: validLock(), computed, argv: ["--update"] });
    assert.equal(await h.run(), 1);
    assert.equal(h.read(), serializeLock(validLock()), "no partial lock");
    assert.match(h.out.text(), /boom/u);
  }
  // A folder that does not exist is a failure, not a silent skip.
  const nowhere = harness(t, { computed: computedOf(hash("1"), hash("2")), argv: ["--update", "--lock", join(scratch(t), "missing-folder", "lock.json")] });
  assert.equal(await nowhere.run(), 1);
});

test("update: the emergency switch does not change it (it only softens failures of the check)", async (t) => {
  const h = harness(t, { lock: validLock(), computed: computedOf(hash("1"), hash("2")), argv: ["--update"], env: { [MODE_VARIABLE]: "warn" } });
  assert.equal(await h.run(), 0);
  assert.equal(JSON.parse(h.read()).ios, hash("1"));
});

// ---------------------------------------------------------------------------------------------------------------------
// The real thing end to end: a real child process, a real git repository, a fake fingerprint tool
// ---------------------------------------------------------------------------------------------------------------------

// The fake tool does what the real one does in the ways that matter here: it reads the project from the current folder,
// skips the version number like the «balanced» preset, answers per platform, reacts to EAS_PROJECT_ID and
// USE_RNCORE_AUTOLINKING_FROM_EXPO, reports a package it reached through node_modules by its REAL path (relative to the
// current folder, so «../…» when node_modules is a symlink), and prints one JSON document.
const FAKE_TOOL = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const args = process.argv.slice(2);
if (process.env.FAKE_TOOL_LOG) fs.appendFileSync(process.env.FAKE_TOOL_LOG, JSON.stringify({ args, cwd: fs.realpathSync(process.cwd()) }) + "\\n");
if (process.env.FAKE_TOOL_MODE === "crash") { console.error("Error: Cannot read properties of undefined\\n    at stack frame"); process.exit(3); }
if (process.env.FAKE_TOOL_MODE === "garbage") { console.log("this is not json"); process.exit(0); }
if (args[0] !== "fingerprint:generate" || args[1] !== "--platform") process.exit(2);
const platform = args[2];
const sha = (text) => crypto.createHash("sha1").update(text).digest("hex");
const readFile = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
const config = JSON.parse(readFile("app.config.json"));
delete config.version;
config.extra = { projectId: process.env.EAS_PROJECT_ID || "default-project", autolinking: process.env.USE_RNCORE_AUTOLINKING_FROM_EXPO || "default", locale: process.env.LC_ALL || "none" };
const scripts = JSON.stringify(JSON.parse(readFile("package.json")).scripts || {});
const packagePath = fs.realpathSync("node_modules/native-lib/package.json");
const sources = [
  { type: "contents", id: "expoConfig", contents: JSON.stringify(config), reasons: ["expoConfig"], hash: sha(JSON.stringify(config)) },
  { type: "contents", id: "packageJson:scripts", contents: scripts, reasons: ["packageJson:scripts"], hash: sha(scripts) },
  { type: "file", filePath: "plugins/plugin.js", reasons: ["expoConfigPlugins"], hash: sha(readFile("plugins/plugin.js")) },
  { type: "package", name: "native-lib", version: JSON.parse(readFile(packagePath)).version, filePath: path.relative(process.cwd(), packagePath), reasons: ["expoAutolinking"], hash: sha(readFile(packagePath)) },
];
console.log(JSON.stringify({ sources, hash: sha(platform + sources.map((source) => source.hash).join()) }));
`;

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
const git = (cwd, ...args) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** A repository with a mobile/ folder (a fake tool in an ignored node_modules) on branch `main`, a lock written by the guard itself, checked out on `feature`. */
async function project(t) {
  const repo = mkdtempSync(join(tmpdir(), "evo-fingerprint-repo-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const mobile = join(repo, "mobile");
  for (const dir of ["mobile/src", "mobile/plugins", "mobile/node_modules/@expo/fingerprint/bin", "mobile/node_modules/native-lib"]) mkdirSync(join(repo, dir), { recursive: true });
  writeFileSync(join(repo, ".gitignore"), "");
  writeFileSync(join(mobile, ".gitignore"), "node_modules/\n");
  writeFileSync(join(mobile, "app.config.json"), JSON.stringify({ name: "EVO", scheme: "evo", version: "1.0.0" }, null, 2));
  writeFileSync(join(mobile, "package.json"), JSON.stringify({ name: "m", version: "1.0.0", scripts: { start: "expo start" } }, null, 2));
  writeFileSync(join(mobile, "src/app.ts"), "export const answer = 1;\n");
  writeFileSync(join(mobile, "plugins/plugin.js"), "module.exports = (config) => config;\n");
  writeFileSync(join(mobile, FINGERPRINT_CLI), FAKE_TOOL);
  chmodSync(join(mobile, FINGERPRINT_CLI), 0o755);
  writeFileSync(join(mobile, "node_modules/@expo/fingerprint/package.json"), JSON.stringify({ name: "@expo/fingerprint", version: "0.0.0-fake" }));
  writeFileSync(join(mobile, "node_modules/native-lib/package.json"), JSON.stringify({ name: "native-lib", version: "1.0.0" }));
  git(repo, "init", "-q", "-b", "main");
  const guard = (argv = [], env = {}) => {
    const out = collector();
    return main({ argv: ["--repo", repo, ...argv], env: { PATH: process.env.PATH, ...env }, stdout: out, deps: { now: () => new Date("2026-12-01T10:00:00Z") } })
      .then((code) => ({ code, text: out.text() }));
  };
  assert.equal((await guard(["--update"])).code, 0, "the lock is written by the guard from the tool's answer");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "main: the project and its lock");
  git(repo, "checkout", "-q", "-b", "feature");
  return { repo, mobile, guard, tool: join(mobile, FINGERPRINT_CLI), lock: join(mobile, "native-fingerprint.lock.json") };
}
const edit = (file, change) => writeFileSync(file, change(readFileSync(file, "utf8")));
const throwawayFolders = () => readdirSync(tmpdir()).filter((name) => name.startsWith("evo-fingerprint-base-"));

test("end to end: a clean tree passes; JS-only changes, the version number, the lock itself and untracked files do not matter", async (t) => {
  const p = await project(t);
  const clean = await p.guard();
  assert.equal(clean.code, 0, clean.text);
  assert.match(clean.text, /OK — отпечатки равны замку/u);
  assert.match(clean.text, /@expo\/fingerprint 0\.0\.0-fake/u, "the tool's version is in the log");

  edit(join(p.mobile, "src/app.ts"), (text) => `${text}export const more = 2;\n`);
  writeFileSync(join(p.mobile, "src/new-screen.ts"), "export {};\n");
  writeFileSync(join(p.repo, "root-file.txt"), "x");
  edit(join(p.mobile, "app.config.json"), (text) => text.replace('"1.0.0"', '"1.0.1"'));
  edit(join(p.mobile, "package.json"), (text) => text.replace('"version": "1.0.0"', '"version": "1.0.1"'));
  git(p.repo, "add", "-A");
  git(p.repo, "commit", "-q", "-m", "js only");
  assert.equal((await p.guard()).code, 0);
  // Dirty (uncommitted) state is the same as committed state for the verdict.
  edit(join(p.mobile, "src/app.ts"), (text) => `${text}// dirty\n`);
  assert.equal((await p.guard()).code, 0);
});

test("end to end: a native change fails, names BOTH platforms, shows which source and which field changed, and that main matches the lock", async (t) => {
  const p = await project(t);
  edit(join(p.mobile, "app.config.json"), (text) => text.replace('"scheme": "evo"', '"scheme": "evo-x"'));
  const result = await p.guard(["--base", "main"]);
  assert.equal(result.code, 1, result.text);
  assert.match(result.text, /изменился \(ios, android\)\./u);
  assert.match(result.text, /~ contents expoConfig: поля \/ fields: scheme — собранный app\.config\.ts/u);
  assert.match(result.text, /ios: файлы main с вашими установленными пакетами дают замок, различие внесено этим изменением/u);
  assert.match(result.text, /android: файлы main с вашими установленными пакетами дают замок/u);
  assert.match(result.text, /^ {4}mobile\/app\.config\.json$/mu, "the changed file is listed");
  assert.doesNotMatch(result.text, /^ {4}mobile\/(?:src|scripts|\.maestro)\//mu, "JS-only folders are never listed");
  assert.doesNotMatch(result.text, /^ {4}mobile\/native-fingerprint\.lock\.json$/mu, "the lock itself is not a source");
  // A committed native change is judged the same as an uncommitted one.
  git(p.repo, "add", "-A");
  git(p.repo, "commit", "-q", "-m", "native change");
  const committed = await p.guard(["--base", "main"]);
  assert.equal(committed.code, 1);
  assert.match(committed.text, /~ contents expoConfig: поля \/ fields: scheme/u);
});

test("end to end: each kind of native change is caught and named - the scripts of package.json, a plugin file, a native package", async (t) => {
  const p = await project(t);
  const nativePackage = join(p.mobile, "node_modules/native-lib/package.json");
  const cases = [
    ["scripts of package.json", () => edit(join(p.mobile, "package.json"), (text) => text.replace('"start": "expo start"', '"start": "expo start", "probe": "echo"')), /~ contents packageJson:scripts: поля \/ fields: probe/u],
    ["a config plugin file", () => edit(join(p.mobile, "plugins/plugin.js"), (text) => `${text}// native\n`), /~ file plugins\/plugin\.js: содержимое изменилось \/ the content changed — файл config-плагина \/ a config plugin file/u],
    // The base runs with this checkout's node_modules, so a changed installed package shows no changed source: it says so.
    ["a native package version", () => edit(nativePackage, (text) => text.replace("1.0.0", "1.0.1")), /ни один источник не отличается: различие в установленных пакетах/u],
  ];
  for (const [label, change, pattern] of cases) {
    const original = readFileSync(nativePackage, "utf8");
    change();
    const result = await p.guard(["--base", "main"]);
    assert.equal(result.code, 1, label);
    assert.match(result.text, pattern, label);
    git(p.repo, "checkout", "--", "mobile");
    writeFileSync(nativePackage, original);
    assert.equal((await p.guard()).code, 0, `${label}: and back to a pass once reverted`);
  }
});

test("end to end: the tool is run exactly as a person runs it, in mobile/, once per platform; the explanation runs it in a copy of the base", async (t) => {
  const p = await project(t);
  const log = join(scratch(t), "tool.log");
  const calls = () => readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal((await p.guard([], { FAKE_TOOL_LOG: log })).code, 0);
  assert.deepEqual(calls().map((call) => call.args), [["fingerprint:generate", "--platform", "ios"], ["fingerprint:generate", "--platform", "android"]]);
  assert.ok(calls().every((call) => call.cwd.endsWith("/mobile")), "cwd is mobile/");
  // A mismatch adds the two runs on the base, in another folder, with the same arguments.
  rmSync(log);
  edit(join(p.mobile, "app.config.json"), (text) => text.replace('"scheme": "evo"', '"scheme": "evo-x"'));
  assert.equal((await p.guard(["--base", "main"], { FAKE_TOOL_LOG: log })).code, 1);
  const all = calls();
  assert.deepEqual(all.map((call) => call.args[2]), ["ios", "android", "ios", "android"]);
  assert.ok(all.slice(0, 2).every((call) => call.cwd === all[0].cwd));
  assert.ok(all.slice(2).every((call) => call.cwd !== all[0].cwd && call.cwd.includes("evo-fingerprint-base-") && call.cwd.endsWith("/mobile")), "the base is a throwaway copy");
});

test("end to end: the caller's EAS_PROJECT_ID, USE_RNCORE_AUTOLINKING_FROM_EXPO and locale cannot fake a difference; the tool does react to them (so this test can fail)", async (t) => {
  const p = await project(t);
  // Proof the fake tool is sensitive: run it by hand with the variable.
  const byHand = (env) => JSON.parse(execFileSync(process.execPath, [FINGERPRINT_CLI, "fingerprint:generate", "--platform", "ios"], { cwd: p.mobile, env: { PATH: process.env.PATH, ...env }, encoding: "utf8" })).hash;
  assert.notEqual(byHand({ EAS_PROJECT_ID: "other-project" }), byHand({}));
  assert.notEqual(byHand({ USE_RNCORE_AUTOLINKING_FROM_EXPO: "0" }), byHand({}));
  assert.notEqual(byHand({ LC_ALL: "cs_CZ.UTF-8" }), byHand({ LC_ALL: "en_US.UTF-8" }));
  // The guard removes them, so the verdict does not move.
  const hostile = await p.guard([], { EAS_PROJECT_ID: "other-project", USE_RNCORE_AUTOLINKING_FROM_EXPO: "0", DEBUG: "*", EXPO_DEBUG: "1", LC_ALL: "cs_CZ.UTF-8", LANG: "cs_CZ.UTF-8" });
  assert.equal(hostile.code, 0, hostile.text);
});

test("end to end: the same input gives the same output twice, and leaves no throwaway folder and no damage to node_modules", async (t) => {
  const p = await project(t);
  edit(join(p.mobile, "app.config.json"), (text) => text.replace('"scheme": "evo"', '"scheme": "evo-x"'));
  const foldersBefore = throwawayFolders();
  const first = await p.guard(["--base", "main"]);
  const second = await p.guard(["--base", "main"]);
  assert.equal(first.code, 1);
  assert.equal(first.text, second.text, "deterministic");
  assert.deepEqual(throwawayFolders(), foldersBefore, "the extract of the base is removed");
  assert.equal(lstatSync(join(p.mobile, "node_modules")).isSymbolicLink(), false, "the real node_modules is still a real folder");
  assert.equal(JSON.parse(readFileSync(join(p.mobile, "node_modules/native-lib/package.json"), "utf8")).version, "1.0.0");
  assert.ok(readdirSync(join(p.mobile, "node_modules/@expo/fingerprint/bin")).length > 0);
});

test("end to end: the tool missing, crashing or printing nonsense FAILS CLOSED with the reason; nothing is passed", async (t) => {
  const p = await project(t);
  const crash = await p.guard([], { FAKE_TOOL_MODE: "crash" });
  assert.equal(crash.code, 1);
  assert.match(crash.text, /fingerprint:generate --platform ios не выполнился \/ failed: Error: Cannot read properties of undefined/u);
  assert.doesNotMatch(crash.text, /OK/u);
  const garbage = await p.guard([], { FAKE_TOOL_MODE: "garbage" });
  assert.equal(garbage.code, 1);
  assert.match(garbage.text, /напечатал не JSON \/ printed no JSON/u);
  // No tool at all: the dependencies are not installed.
  rmSync(join(p.mobile, "node_modules"), { recursive: true });
  const missing = await p.guard();
  assert.equal(missing.code, 1);
  assert.match(missing.text, /нет node_modules\/@expo\/fingerprint\/bin\/cli\.js .*cd mobile && npm ci/u);
  // And the emergency switch makes each of them a warning.
  const warned = await p.guard([], { [MODE_VARIABLE]: "warn" });
  assert.equal(warned.code, 0);
});

test("end to end: without a base to compare with, the failure is the same failure and says why it cannot explain", async (t) => {
  const p = await project(t);
  edit(join(p.mobile, "app.config.json"), (text) => text.replace('"scheme": "evo"', '"scheme": "evo-x"'));
  const result = await p.guard(["--base", "origin/main"]);
  assert.equal(result.code, 1);
  assert.match(result.text, /изменился \(ios, android\)/u);
  assert.match(result.text, /Источники сравнить не удалось \/ Could not compare the sources: нет «origin\/main» в этой копии репозитория/u);
  assert.match(result.text, /Список изменённых файлов недоступен/u);
  const none = await p.guard(["--no-explain"]);
  assert.equal(none.code, 1);
  assert.doesNotMatch(none.text, /Что изменилось по сравнению/u);
});

test("end to end: --update after an intended native change makes the check pass, writes four keys, and touches nothing else in the repository", async (t) => {
  const p = await project(t);
  edit(join(p.mobile, "app.config.json"), (text) => text.replace('"scheme": "evo"', '"scheme": "evo-x"'));
  assert.equal((await p.guard()).code, 1);
  const status = () => git(p.repo, "status", "--porcelain").split("\n").filter(Boolean).sort();
  assert.deepEqual(status(), [" M mobile/app.config.json"]);
  const update = await p.guard(["--update", "--note", "сборка 2.2.0 (7)"]);
  assert.equal(update.code, 0, update.text);
  assert.deepEqual(status(), [" M mobile/app.config.json", " M mobile/native-fingerprint.lock.json"], "only the lock was written");
  const lock = JSON.parse(readFileSync(p.lock, "utf8"));
  assert.deepEqual(Object.keys(lock), ["ios", "android", "builtAt", "note"]);
  assert.equal(lock.note, "сборка 2.2.0 (7)");
  assert.equal(lock.builtAt, "2026-12-01");
  assert.equal((await p.guard()).code, 0, "and now the check passes");
  // Reverting only the native change (the new lock stays) is a mismatch again: the lock follows the tree, not the other way round.
  git(p.repo, "checkout", "--", "mobile/app.config.json");
  assert.equal((await p.guard()).code, 1, "the new lock no longer matches the reverted tree");
  // Reverting both brings the old, matching pair back.
  git(p.repo, "checkout", "--", "mobile");
  assert.equal((await p.guard()).code, 0);
});

test("end to end: the lister names files of mobile/ that differ from the base, new files too, never src, scripts, .maestro or the lock", async (t) => {
  const p = await project(t);
  mkdirSync(join(p.mobile, ".maestro"), { recursive: true });
  mkdirSync(join(p.mobile, "scripts"), { recursive: true });
  writeFileSync(join(p.mobile, ".maestro/flow.yaml"), "x");
  writeFileSync(join(p.mobile, "scripts/tool.mjs"), "x");
  writeFileSync(join(p.mobile, "src/changed.ts"), "x");
  writeFileSync(join(p.mobile, "plugins/new-plugin.js"), "x");
  edit(join(p.mobile, "package.json"), (text) => `${text} `);
  edit(p.lock, (text) => `${text} `);
  assert.ok(git(p.repo, "status", "--porcelain").includes("mobile/native-fingerprint.lock.json"), "the lock really differs from the base");
  writeFileSync(join(p.repo, "unrelated.txt"), "x");
  const list = createChangedFilesLister({ repoRoot: p.repo, projectDir: p.mobile });
  assert.deepEqual(list("main"), ["mobile/package.json", "mobile/plugins/new-plugin.js"]);
  assert.throws(() => list("--output=x"), /странное имя/u);
});

test("end to end: the script is a real command - exit codes of the process, the symlinked entry path, help, and a hostile --base", async (t) => {
  const p = await project(t);
  const run = (args, env = {}) => spawnSync(process.execPath, [script, "--repo", p.repo, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  const pass = run([]);
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.match(pass.stdout, /OK — отпечатки равны замку/u);
  edit(join(p.mobile, "app.config.json"), (text) => text.replace('"scheme": "evo"', '"scheme": "evo-x"'));
  const fail = run(["--base", "main"]);
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /изменился \(ios, android\)/u);
  assert.equal(run(["--base", "main"], { [MODE_VARIABLE]: "warn" }).status, 0);
  assert.equal(run(["--base", "main"], { GITHUB_ACTIONS: "true" }).status, 1);
  assert.match(run(["--base", "main"], { GITHUB_ACTIONS: "true" }).stdout, /^::error title=Native fingerprint lock::/mu);
  assert.equal(run(["--help"]).status, 0);
  assert.equal(run(["--base", "--update"]).status, 1);
  // Run through a symlink to the script (a symlinked checkout): it still runs, it does not silently do nothing.
  const link = join(scratch(t), "linked-check.mjs");
  symlinkSync(script, link);
  const linked = spawnSync(process.execPath, [link, "--repo", p.repo, "--no-explain"], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(linked.status, 1);
  assert.match(linked.stdout, /изменился/u);
});

// ---------------------------------------------------------------------------------------------------------------------
// The workflows: the step in «Mobile app», what «Fast checks» does with a skip, the workflow for main
// ---------------------------------------------------------------------------------------------------------------------

const code = (text) => text.split("\n").filter((line) => !/^\s*#/u.test(line)).join("\n");
const prExecutable = code(read(".github/workflows/evo-fast-pr-checks.yml"));
const mobileJob = prExecutable.slice(prExecutable.indexOf("\n  mobile:\n"), prExecutable.indexOf("\n  mobile-parity:\n"));
const gate = prExecutable.slice(prExecutable.indexOf("\n  fast-checks:\n"));
const COMPILED_STEP = "Run the mobile Jest suite through the React Compiler";
const stepNames = (job) => [...job.matchAll(/^      - name: (.+)$/gmu)].map((match) => match[1]);
const stepBlock = (job, name) => {
  const start = job.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `step «${name}»`);
  const next = job.indexOf("\n      - name:", start + 1);
  return job.slice(start, next === -1 ? job.length : next);
};

test("PR workflow: the lock is its own named step of «Mobile app», right after npm ci and before the app check, strict, with the emergency variable", () => {
  assert.notEqual(prExecutable.indexOf("\n  mobile:\n"), -1);
  assert.deepEqual(stepNames(mobileJob), [
    "Check out source", "Set up Node.js", "Install locked dependencies", "Check the native fingerprint lock", "Check the mobile app", COMPILED_STEP,
  ]);
  const step = stepBlock(mobileJob, "Check the native fingerprint lock");
  assert.match(step, /\n        env:\n          MOBILE_FINGERPRINT_LOCK_MODE: \$\{\{ vars\.MOBILE_FINGERPRINT_LOCK_MODE \}\}\n        run: \|\n/u);
  assert.match(step, /\n          set -Eeuo pipefail\n/u);
  assert.match(step, /\n          node scripts\/ci\/mobile-native-fingerprint-check\.mjs --base origin\/main\n?$/u);
  // The fetch only helps to explain a difference; its failure is a warning, never a pass and never the verdict.
  assert.match(step, /git fetch --no-tags --depth=1 origin main:refs\/remotes\/origin\/main \\\n            \|\| echo "::warning title=Native fingerprint lock::/u);
  // Nothing that could make the step pass without running: no condition, no continue-on-error, no other folder, no secrets.
  assert.doesNotMatch(step, /\n        (?:if|continue-on-error|working-directory|timeout-minutes):/u);
  assert.doesNotMatch(step, /secrets\.|\|\| true|exit 0/u);
  assert.equal([...step.matchAll(/\$\{\{ [^}]+\}\}/gu)].map((match) => match[0]).join("|"), "${{ vars.MOBILE_FINGERPRINT_LOCK_MODE }}");
  // The scripts of mobile/package.json are part of the fingerprint: the guard is called from here and from the root, never from there.
  assert.doesNotMatch(read("mobile/package.json"), /fingerprint-check|native-fingerprint/u);
});

test("PR workflow: the compiled Jest run is its own named step of «Mobile app», after the app check, the same `npm run verify` lane as on a laptop, and not through mobile/package.json", () => {
  const step = stepBlock(mobileJob, COMPILED_STEP);
  assert.ok(mobileJob.indexOf("      - name: Check the mobile app\n") < mobileJob.indexOf(`      - name: ${COMPILED_STEP}\n`), "after the ordinary app check");
  assert.match(step, /\n        run: npm run verify -- --only mobile-compiled\n?$/u);
  // Nothing that could make the step pass without running, and no other folder: verify runs from the repository root, as for the ordinary check.
  assert.doesNotMatch(step, /\n        (?:if|continue-on-error|timeout-minutes|working-directory):/u);
  assert.doesNotMatch(step, /secrets\.|\|\| true|exit 0/u);
  // The job has a timeout like its siblings (Types 15 minutes, Tests and Preview 20): it runs two Jest suites now.
  assert.match(mobileJob, /\n    runs-on: ubuntu-latest\n    timeout-minutes: 20\n/u);
  // The step runs the config and the transform it names, and none of it goes through the scripts of mobile/package.json: they are part of the
  // native fingerprint, so a script added there would give a build no student has and an EAS Update that reaches nobody.
  for (const file of ["mobile/jest.compiler.config.js", "mobile/jest.compiler.transform.js"]) assert.ok(statSync(join(root, file)).isFile(), file);
  assert.match(read("mobile/jest.compiler.transform.js"), /const compiled = make\(\{ supportsReactCompiler: true \}\);/u, "app code goes through the compiler, as in Metro");
  assert.doesNotMatch(read("mobile/package.json"), /jest\.compiler|test:compiled/u);
});

test("compiled Jest config: the project's own `jest` block plus the transform and the flag, with no list of skipped suites", () => {
  const config = createRequire(import.meta.url)("../mobile/jest.compiler.config.js");
  const base = JSON.parse(read("mobile/package.json")).jest;
  // Nothing but the transform and the flag differs from `npm test`: the same roots, the same ignore patterns. A suite skipped here would drop out of
  // the compiled run silently (the review of 26.11.2026 found a list that could grow with every other root test and the canary still green).
  assert.deepEqual(Object.keys(config).sort(), [...Object.keys(base), "globals", "transform"].sort());
  assert.deepEqual(config.testPathIgnorePatterns, base.testPathIgnorePatterns, "no suite is skipped in the compiled run");
  assert.deepEqual(config.roots, base.roots);
  assert.deepEqual(config.transform, { "\\.[jt]sx?$": "<rootDir>/jest.compiler.transform.js" });
  // The flag the canary test and `itUncompiledOnly` read. The canary (src/__tests__/react-compiler-canary.test.tsx) fails when the compiled run does not
  // compile, but it only runs when the flag is set.
  assert.equal(config.globals.__EVO_REACT_COMPILER__, true);
  assert.match(read("mobile/src/__tests__/react-compiler-canary.test.tsx"), /__EVO_REACT_COMPILER__/u);
  assert.match(read("mobile/src/test-fixtures/uncompiled-only.ts"), /__EVO_REACT_COMPILER__/u);
});

test("compiled Jest run: the only tests it skips are the marked `itUncompiledOnly` ones, each with its reason in the comment right above (four today, in two files)", () => {
  const found = {};
  const walk = (directory) => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.test\.tsx?$/u.test(entry.name)) {
        const lines = read(path).split("\n");
        lines.forEach((line, index) => {
          if (!/^\s*itUncompiledOnly\(/u.test(line)) return;
          found[path] = (found[path] ?? 0) + 1;
          assert.match(lines[index - 1] ?? "", /^\s*\/\/ \S/u, `${path}:${index + 1} needs its reason in the comment right above`);
        });
      }
    }
  };
  walk("mobile/src");
  assert.deepEqual(found, {
    "mobile/src/features/learning/__tests__/csca-test-navigator.test.tsx": 2,
    "mobile/src/features/universities/__tests__/tile-memo.test.tsx": 2,
  });
});

test("PR workflow: the job that holds the lock runs exactly when the pull request changes mobile/ or what the app shares with the web, and is never skipped for such a pull request", () => {
  assert.match(mobileJob, /^\n  mobile:\n    name: Mobile app\n    needs: changed-range\n    if: \$\{\{ needs\.changed-range\.outputs\.mobile == 'true' && needs\.changed-range\.outputs\.unknown != 'true' \}\}\n/u);
  // The trigger is the repository's own classifier: every path under mobile/ - whatever it is - selects the job.
  for (const path of [
    "mobile/app.config.ts", "mobile/package.json", "mobile/package-lock.json", "mobile/eas.json", "mobile/.gitignore", "mobile/plugins/with-scene-config.js",
    "mobile/assets/images/icon.png", "mobile/fingerprint.config.js", "mobile/.fingerprintignore", "mobile/native-fingerprint.lock.json", "mobile/ios/Podfile", "mobile/android/build.gradle", "mobile/src/x.ts",
  ]) {
    assert.equal(classifyChangedEntries([{ status: "M", paths: [path] }]).mobile, true, path);
    assert.equal(classifyChangedEntries([{ status: "D", paths: [path] }]).mobile, true, `deleted ${path}`);
    assert.equal(classifyChangedEntries([{ status: "R100", paths: [path, `elsewhere/${path}`] }]).mobile, true, `renamed ${path}`);
  }
  // The web code the app imports (@web/*) selects it too; the root files that cannot change the fingerprint (measured) do not.
  for (const path of ["src/lib/portal/x.ts", "src/content/x.ts", "src/components/portal/x.tsx"]) assert.equal(classifyChangedEntries([{ status: "M", paths: [path] }]).mobile, true, path);
  for (const path of ["package.json", "package-lock.json", "next.config.ts", "src/lib/server/x.ts", "docs/mobile/PLAN.md", ".github/workflows/evo-fast-pr-checks.yml"]) assert.equal(classifyChangedEntries([{ status: "M", paths: [path] }]).mobile, false, path);
});

test("«Fast checks»: a skipped «Mobile app» is «nothing to lock» only when changed-range said mobile=false; mobile=true needs «success»", () => {
  const step = gate.split("      - name: Require selected fast PR checks\n")[1];
  assert.ok(step);
  assert.match(step, /\n          MOBILE_CHANGED: \$\{\{ needs\.changed-range\.outputs\.mobile \}\}\n/u, "the classifier's answer reaches the gate");
  const body = step.split("        run: |\n")[1].replace(/^          /gmu, "");
  const names = [...step.matchAll(/^          ([A-Z_]+): \$\{\{/gmu)].map((match) => match[1]);
  const env = {
    PATH: process.env.PATH,
    ...Object.fromEntries(names.map((name) => [name, name.endsWith("_RESULT") ? "skipped" : ""])),
    RANGE_RESULT: "success", HAS_CHANGES: "true", UNKNOWN: "false", ORDINARY_DOCS: "false", MOBILE_PARITY_RESULT: "success",
    TYPECHECK_RESULT: "success", TESTS_RESULT: "success", PREVIEW_RESULT: "success",
  };
  const run = (changes) => spawnSync("bash", ["-c", body], { env: { ...env, ...changes }, encoding: "utf8" });
  const message = /::error::The mobile app checks and the native-fingerprint lock must succeed when the pull request changes mobile\/ or the web code the app shares, but their result is '([^']*)' \(skipped means they never looked\)/u;

  assert.equal(run({ MOBILE_CHANGED: "false", MOBILE_RESULT: "skipped" }).status, 0, "mobile/ untouched: skipped is fine");
  assert.equal(run({ MOBILE_CHANGED: "false", MOBILE_RESULT: "success" }).status, 0, "it ran anyway");
  assert.equal(run({ MOBILE_CHANGED: "true", MOBILE_RESULT: "success" }).status, 0, "mobile/ touched, the lock and the app checks passed");

  const skipped = run({ MOBILE_CHANGED: "true", MOBILE_RESULT: "skipped" });
  assert.notEqual(skipped.status, 0, "mobile/ touched and «Mobile app» did not run: the lock never looked");
  assert.match(skipped.stdout, message);
  assert.equal(skipped.stdout.match(message)[1], "skipped");
  for (const result of ["failure", "cancelled", "", "unknown"]) {
    assert.notEqual(run({ MOBILE_CHANGED: "true", MOBILE_RESULT: result }).status, 0, `true/${result}`);
    assert.notEqual(run({ MOBILE_CHANGED: "false", MOBILE_RESULT: result }).status, 0, `false/${result}`);
  }
  assert.match(run({ MOBILE_CHANGED: "true", MOBILE_RESULT: "failure" }).stdout, /::error::A selected fast PR check failed or was cancelled/u);
  // The older rules stand: ordinary docs need no code check, and an unknown range or a failed range still blocks.
  assert.equal(run({ ORDINARY_DOCS: "true", TYPECHECK_RESULT: "skipped", TESTS_RESULT: "skipped", PREVIEW_RESULT: "skipped", MOBILE_CHANGED: "false", MOBILE_RESULT: "skipped" }).status, 0);
  assert.notEqual(run({ MOBILE_CHANGED: "false", MOBILE_RESULT: "skipped", UNKNOWN: "true" }).status, 0);
  assert.notEqual(run({ MOBILE_CHANGED: "false", MOBILE_RESULT: "skipped", RANGE_RESULT: "failure" }).status, 0);
  // «Mobile parity» keeps its own, stricter rule (it has no condition, so a skip means it never looked).
  assert.notEqual(run({ MOBILE_CHANGED: "false", MOBILE_RESULT: "skipped", MOBILE_PARITY_RESULT: "skipped" }).status, 0);
});

const mainWorkflow = read(".github/workflows/evo-native-fingerprint.yml");
const mainExecutable = code(mainWorkflow);

test("main workflow: the same guard runs after a merge to main when mobile/ (or the guard) changed, by hand, and on a pull request only for its own file", () => {
  assert.match(mainExecutable, /^name: EVO native fingerprint lock\n/u);
  assert.match(mainExecutable, /^on:\n  push:\n    branches:\n      - main\n    paths:\n      - mobile\/\*\*\n      - scripts\/ci\/mobile-native-fingerprint-check\.mjs\n      - \.github\/workflows\/evo-native-fingerprint\.yml\n  pull_request:\n    branches:\n      - main\n    paths:\n      - \.github\/workflows\/evo-native-fingerprint\.yml\n  workflow_dispatch:\n/mu);
  assert.doesNotMatch(mainExecutable, /pull_request_target|workflow_run|schedule:|issue_comment/u);
  assert.match(mainExecutable, /^jobs:\n  lock:\n    name: Native fingerprint lock\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n/mu);
  assert.deepEqual(stepNames(mainExecutable), ["Check out source", "Set up Node.js", "Install locked dependencies", "Check the native fingerprint lock"]);
});

test("main workflow: read-only, no secrets, pinned actions, no stored credentials, the emergency variable is the only input", () => {
  assert.match(mainExecutable, /^permissions:\n  contents: read\n\n/mu);
  assert.equal([...mainExecutable.matchAll(/^\s*permissions:/gmu)].length, 1, "one workflow-level block, nothing wider anywhere");
  assert.doesNotMatch(mainExecutable, /:\s*write\b|id-token|secrets\.|github\.token|GITHUB_TOKEN|\benvironment:|continue-on-error|\|\| true|exit 0/u);
  const uses = [...mainExecutable.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gmu)].map((match) => match[1]);
  assert.equal(uses.length, 2);
  for (const reference of uses) assert.match(reference, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u, reference);
  assert.match(mainExecutable, /uses: actions\/checkout@[0-9a-f]{40} # v7\n        with:\n          fetch-depth: 2\n          persist-credentials: false\n/u);
  assert.match(mainExecutable, /uses: actions\/setup-node@[0-9a-f]{40} # v6\n        with:\n          node-version-file: \.nvmrc\n          cache: npm\n          cache-dependency-path: mobile\/package-lock\.json\n/u);
  assert.match(mainExecutable, /name: Install locked dependencies\n        working-directory: mobile\n        run: npm ci\n/u);
  assert.equal((mainExecutable.match(/working-directory:/gu) ?? []).length, 1, "only npm ci runs inside mobile/");
  const step = stepBlock(mainExecutable.slice(mainExecutable.indexOf("\njobs:\n")), "Check the native fingerprint lock");
  assert.match(step, /\n        env:\n          EVENT_NAME: \$\{\{ github\.event_name \}\}\n          MOBILE_FINGERPRINT_LOCK_MODE: \$\{\{ vars\.MOBILE_FINGERPRINT_LOCK_MODE \}\}\n        run: \|\n          set -Eeuo pipefail\n/u);
  assert.match(step, /node scripts\/ci\/mobile-native-fingerprint-check\.mjs --base "\$base"\n?$/u);
  // A push explains against the previous main (a squash merge has one parent), a pull request against the fetched main.
  assert.match(step, /if test "\$EVENT_NAME" = "pull_request"; then\n            git fetch --no-tags --depth=1 origin main:refs\/remotes\/origin\/main \\\n              \|\| echo "::warning title=Native fingerprint lock::/u);
  assert.match(step, /base=origin\/main\n          else\n            base='HEAD\^'\n          fi/u);
  assert.match(mainExecutable, /concurrency:\n  group: evo-native-fingerprint-\$\{\{ github\.ref \}\}\n  cancel-in-progress: false\n/u);
});

test("main workflow: it is not a required check of the pull request gate and does not touch the release gate", () => {
  assert.doesNotMatch(gate, /needs:[\s\S]*\n      - lock\b/u, "«Fast checks» does not wait for it");
  assert.doesNotMatch(prExecutable, /evo-native-fingerprint/u, "the pull request workflow does not know about it");
  const releaseGate = read("scripts/release/fast-release-ci-gate.mjs");
  assert.doesNotMatch(releaseGate, /fingerprint/iu, "a drift on main shows as a red check; it does not stop a CRM release");
});

// ---------------------------------------------------------------------------------------------------------------------
// The lock file and the rule text
// ---------------------------------------------------------------------------------------------------------------------

test("lock file: it exists where the script says, is valid, is in the canonical form, and is not ignored", () => {
  assert.equal(LOCK_FILE, "mobile/native-fingerprint.lock.json");
  const text = read(LOCK_FILE);
  const parsed = parseLock(text);
  assert.equal(parsed.ok, true, parsed.problems?.join("; "));
  assert.equal(text, serializeLock(parsed.lock), "so that --update never makes a diff of its own");
  assert.notEqual(parsed.lock.ios, parsed.lock.android, "the two platforms have different fingerprints");
  assert.doesNotMatch(read("mobile/.gitignore"), /native-fingerprint|\.lock\.json|^\*\.json$/mu);
  assert.equal(spawnSync("git", ["check-ignore", "-q", LOCK_FILE], { cwd: root }).status, 1, "git does not ignore the lock (0 would mean ignored, 128 not a repository)");
});

test("rule text: AGENTS.md explains the lock, what trips it, the exact update procedure and the emergency switch; CLAUDE.md points at it", () => {
  const rules = read("AGENTS.md");
  const section = rules.slice(rules.indexOf("**Замок отпечатка нативной сборки.**"), rules.indexOf("## How To Work In This Repo"));
  assert.ok(section.length > 500, "the paragraph exists inside «Кабинет и приложение идут вместе»");
  assert.ok(rules.indexOf("## Кабинет и приложение идут вместе") < rules.indexOf("**Замок отпечатка нативной сборки.**"));
  for (const needle of [
    "`mobile/native-fingerprint.lock.json`", "`runtimeVersion`", "EAS Update", "Native fingerprint lock", "Check the native fingerprint lock",
    "node node_modules/@expo/fingerprint/bin/cli.js fingerprint:generate --platform ios",
    "`mobile/app.config.ts` (почти всё, кроме номера", "раздел `scripts` в `mobile/package.json`", "нативные зависимости", "`mobile/plugins/**`", "`mobile/.gitignore`",
    "**Не меняют:**", "`eas.json`", "`mobile/src/**`",
    "верните нативное изменение", "cd mobile && npm ci", `\`${UPDATE_COMMAND}\``, "нужна новая сборка в магазинах", "`eas build`, только владелец", "`eas update` с новым отпечатком не",
    `gh variable set ${MODE_VARIABLE} --body warn`, `gh variable delete ${MODE_VARIABLE}`, "а не пропускает PR",
  ]) assert.ok(section.includes(needle), `AGENTS.md: ${needle}`);
  assert.ok(rules.includes("node scripts/ci/mobile-native-fingerprint-check.mjs`"), "the local command is next to the app check");
  const claude = read("CLAUDE.md");
  assert.match(claude, /проверка «Native fingerprint\s+lock» \(замок `mobile\/native-fingerprint\.lock\.json`\)/u);
  // The text of the message and the rule agree on the commands.
  assert.ok(renderMismatch({ differing: differingIos, lock: validLock(), computed: computedOf(hash("c"), ANDROID) }).includes(UPDATE_COMMAND));
  assert.equal(CHECK_NAME, "Native fingerprint lock");
});

test("registration: the file is part of the CI test manifest and the guard lives where the workflows call it", () => {
  const manifest = JSON.parse(read("package.json")).scripts["test:unit:supplemental"];
  assert.ok(manifest.split(/\s+/u).includes("tests/mobile-native-fingerprint-check.test.mjs"));
  assert.ok(readFileSync(script, "utf8").startsWith("#!/usr/bin/env node\n"));
  assert.ok(read(".github/workflows/evo-fast-pr-checks.yml").includes("node scripts/ci/mobile-native-fingerprint-check.mjs --base origin/main"));
  assert.ok(mainWorkflow.includes("node scripts/ci/mobile-native-fingerprint-check.mjs --base \"$base\""));
});
