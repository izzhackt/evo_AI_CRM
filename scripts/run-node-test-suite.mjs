import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const DEFAULT_ENTRY_SCRIPTS = Object.freeze([
  "test:security",
  "test:frontend",
  "test:u1",
  "test:u2",
  "test:u4",
  "test:u7",
  "test:u8",
  "test:u9",
  "test:u10",
  "test:u11",
  "test:unit:supplemental",
  "test:unit:core",
]);

export const UNIT_ENTRY_SCRIPTS = Object.freeze([
  "test:frontend",
  "test:u1",
  "test:u2",
  "test:u4",
  "test:u7",
  "test:u8",
  "test:u9",
  "test:u10",
  "test:u11",
  "test:unit:supplemental",
  "test:unit:core",
]);

export const SERIAL_PROVIDER_TEST_FILES = new Set([
  "tests/platform-gemini-provider.test.mjs",
  "tests/platform-provider-action-contract.test.mjs",
  "tests/platform-provider-orchestrator.test.mjs",
  "tests/platform-provider-readiness.test.mjs",
  "tests/platform-provider-workflows.test.mjs",
  "tests/platform-provider-actions.test.mjs",
  "tests/platform-provider-controls.test.mjs",
  "tests/v3-inbox-integration.test.mjs",
  "tests/platform-waha-local-fetch.test.mjs",
  "tests/platform-waha-provider.test.mjs",
  "tests/platform-waha-webhook.test.mjs",
  "tests/platform-waha-projector.test.mjs",
  "tests/platform-waha-projector-recovery.test.mjs",
  "tests/platform-provider-acceptance-harness.test.mjs",
  "tests/platform-whatsapp-pages.test.mjs",
  "tests/platform-communications-local-provisioner.test.mjs",
  "tests/platform-amocrm-discovery-repository.test.mjs",
  "tests/platform-amocrm-runtime.test.mjs",
  "tests/platform-amocrm-command-service.test.mjs",
  "tests/platform-amocrm-command-rpc.test.mjs",
]);

const DEFAULT_TEST_CONCURRENCY = 4;

const TEST_FILE_PATTERN = /^tests\/[A-Za-z0-9._/-]+\.test\.mjs$/u;
const SAFE_SCRIPT_NAME_PATTERN = /^[A-Za-z0-9:_-]+$/u;
const SUPPORTED_NODE_FLAGS = new Set([
  "--conditions=react-server",
  "--experimental-strip-types",
]);

function tokenize(command) {
  const tokens = [];
  let token = "";
  let quote = null;
  let escaped = false;

  for (const character of command) {
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (token) tokens.push(token);
      token = "";
      continue;
    }
    token += character;
  }

  if (escaped || quote) throw new Error(`Unterminated shell token in test command: ${command}`);
  if (token) tokens.push(token);
  return tokens;
}

function splitSegments(command, scriptName) {
  if (/[;|<>`\n\r]/u.test(command) || /\$\(/u.test(command)) {
    throw new Error(`Unsupported shell syntax in package script ${scriptName}`);
  }
  return command.split(/\s*&&\s*/u).filter(Boolean);
}

function modeFromFlags(flags) {
  const conditions = flags
    .filter((flag) => flag.startsWith("--conditions="))
    .map((flag) => flag.slice("--conditions=".length))
    .sort();
  const stripTypes = flags.includes("--experimental-strip-types");
  const key = JSON.stringify({ conditions, stripTypes });
  const nodeArgs = [
    ...conditions.map((condition) => `--conditions=${condition}`),
    ...(stripTypes ? ["--experimental-strip-types"] : []),
  ];
  return { key, nodeArgs, conditions, stripTypes };
}

export function resolveNodeTestPlan({
  packageJson,
  repositoryRoot,
  entryScripts = DEFAULT_ENTRY_SCRIPTS,
}) {
  const scripts = packageJson?.scripts;
  if (!scripts || typeof scripts !== "object") throw new Error("package.json scripts are required");
  const root = resolve(repositoryRoot);
  const occurrences = [];
  const visiting = new Set();

  function visit(scriptName, chain = []) {
    if (!SAFE_SCRIPT_NAME_PATTERN.test(scriptName)) {
      throw new Error(`Unsafe package script name: ${scriptName}`);
    }
    const command = scripts[scriptName];
    if (typeof command !== "string" || command.trim() === "") {
      throw new Error(`Missing package script: ${scriptName}`);
    }
    if (visiting.has(scriptName)) {
      throw new Error(`Recursive package script chain: ${[...chain, scriptName].join(" -> ")}`);
    }
    visiting.add(scriptName);

    for (const segment of splitSegments(command, scriptName)) {
      const tokens = tokenize(segment);
      if (tokens[0] === "npm" && tokens[1] === "run" && tokens.length === 3) {
        visit(tokens[2], [...chain, scriptName]);
        continue;
      }
      if (tokens[0] !== "node") {
        throw new Error(`Unsupported command in package script ${scriptName}: ${segment}`);
      }
      const testIndex = tokens.indexOf("--test");
      if (testIndex < 0) throw new Error(`Node command in ${scriptName} is missing --test`);
      const flags = tokens.slice(1, testIndex);
      for (const flag of flags) {
        if (!SUPPORTED_NODE_FLAGS.has(flag)) {
          throw new Error(`Unsupported Node test flag in ${scriptName}: ${flag}`);
        }
      }
      const files = tokens.slice(testIndex + 1);
      if (files.length === 0) throw new Error(`Node command in ${scriptName} has no test files`);
      const mode = modeFromFlags(flags);
      for (const file of files) {
        if (!TEST_FILE_PATTERN.test(file) || isAbsolute(file) || file.split("/").includes("..")) {
          throw new Error(`Unsafe or unsupported test path in ${scriptName}: ${file}`);
        }
        const absolutePath = resolve(root, file);
        if (relative(root, absolutePath).startsWith(`..${sep}`) || !existsSync(absolutePath)) {
          throw new Error(`Missing test file referenced by ${scriptName}: ${file}`);
        }
        occurrences.push({ file, mode, scriptName });
      }
    }
    visiting.delete(scriptName);
  }

  for (const entryScript of entryScripts) visit(entryScript);

  const byFile = new Map();
  for (const occurrence of occurrences) {
    const existing = byFile.get(occurrence.file);
    if (existing && existing.mode.key !== occurrence.mode.key) {
      throw new Error(
        `Conflicting Node flags for ${occurrence.file}: ${existing.scriptName} and ${occurrence.scriptName}`,
      );
    }
    if (!existing) byFile.set(occurrence.file, occurrence);
  }

  const groupsByMode = new Map();
  for (const occurrence of byFile.values()) {
    const concurrency = SERIAL_PROVIDER_TEST_FILES.has(occurrence.file)
      ? 1
      : occurrence.mode.stripTypes
        ? DEFAULT_TEST_CONCURRENCY
        : 1;
    const groupKey = `${occurrence.mode.key}:${concurrency}`;
    let group = groupsByMode.get(groupKey);
    if (!group) {
      group = { ...occurrence.mode, concurrency, files: [] };
      groupsByMode.set(groupKey, group);
    }
    group.files.push(occurrence.file);
  }

  return {
    entryScripts: [...entryScripts],
    occurrenceCount: occurrences.length,
    uniqueFileCount: byFile.size,
    duplicateCount: occurrences.length - byFile.size,
    files: [...byFile.keys()],
    groups: [...groupsByMode.values()],
  };
}

export function loadDefaultNodeTestPlan(repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
  return resolveNodeTestPlan({ packageJson, repositoryRoot });
}

export function runNodeTestPlan(plan, { repositoryRoot, nodeExecutable = process.execPath } = {}) {
  const root = resolve(repositoryRoot);
  for (const group of plan.groups) {
    const result = spawnSync(
      nodeExecutable,
      [...group.nodeArgs, `--test-concurrency=${group.concurrency}`, "--test", ...group.files],
      {
        cwd: root,
        stdio: "inherit",
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const cliArguments = process.argv.slice(2);
  let suiteName = "ci";
  let listJson = false;
  let validateOnly = false;
  for (let index = 0; index < cliArguments.length; index += 1) {
    if (cliArguments[index] === "--list-json") listJson = true;
    else if (cliArguments[index] === "--validate-only") validateOnly = true;
    else if (cliArguments[index] === "--suite") suiteName = cliArguments[++index] ?? "";
    else throw new Error(`Unknown argument: ${cliArguments[index]}`);
  }
  if (!new Set(["ci", "unit"]).has(suiteName)) throw new Error(`Unknown Node test suite: ${suiteName}`);
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
  const plan = resolveNodeTestPlan({
    packageJson,
    repositoryRoot,
    entryScripts: suiteName === "unit" ? UNIT_ENTRY_SCRIPTS : DEFAULT_ENTRY_SCRIPTS,
  });
  if (listJson) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else if (validateOnly) {
    process.stdout.write(`Validated ${plan.uniqueFileCount} unique Node test files.\n`);
  } else {
    process.stdout.write(
      `Running ${plan.uniqueFileCount} unique Node test files (${plan.duplicateCount} duplicate invocations removed).\n`,
    );
    process.exitCode = runNodeTestPlan(plan, { repositoryRoot });
  }
}
