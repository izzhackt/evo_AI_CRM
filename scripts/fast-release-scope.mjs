#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA40 = /^[0-9a-f]{40}$/u;

const SAFE_RUNTIME_PATHS = [
  /^public\//u,
  /^src\/app\/\(staff\)\//u,
  /^src\/app\/\(portal\)\//u,
  /^src\/components\//u,
  /^src\/app\/globals\.css$/u,
  /^src\/lib\/i18n(?:-data)?\.ts$/u,
];

const SAFE_NON_RUNTIME_PATHS = [
  /^docs\//u,
  /^tests\//u,
  /^README(?:\.[^/]+)?$/u,
];

const FORBIDDEN_BASENAMES = /(?:^|\/)(?:action|actions|route|middleware|proxy)\.(?:ts|tsx|js|mjs|cjs)$/u;

export function classifyFastReleasePaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { allowed: false, reason: "empty_change_set", paths: [] };
  }

  const normalized = [...new Set(paths)].sort();
  for (const path of normalized) {
    if (
      typeof path !== "string" ||
      path.length === 0 ||
      path.startsWith("/") ||
      path.includes("..") ||
      path.includes("\0")
    ) {
      return { allowed: false, reason: "invalid_path", paths: normalized };
    }

    const safeRuntime = SAFE_RUNTIME_PATHS.some((pattern) => pattern.test(path));
    const safeNonRuntime = SAFE_NON_RUNTIME_PATHS.some((pattern) => pattern.test(path));
    if ((!safeRuntime && !safeNonRuntime) || FORBIDDEN_BASENAMES.test(path)) {
      return { allowed: false, reason: "controlled_release_required", paths: normalized };
    }
  }

  return { allowed: true, reason: "app_only", paths: normalized };
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function readFastReleaseDiff({ repo, from, to }) {
  if (!SHA40.test(from) || !SHA40.test(to) || from === to) {
    throw new Error("release revisions must be distinct full lowercase Git SHAs");
  }
  git(repo, ["merge-base", "--is-ancestor", from, to]);
  const output = git(repo, [
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    `${from}..${to}`,
  ]);
  return output.split("\0").filter(Boolean);
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("invalid arguments");
    values.set(key.slice(2), value);
  }
  return {
    repo: resolve(values.get("repo") ?? "."),
    from: values.get("from") ?? "",
    to: values.get("to") ?? "",
    output: values.get("output") ? resolve(values.get("output")) : null,
  };
}

export function runFastReleaseScopeCli(argv) {
  const options = parseArguments(argv);
  const paths = readFastReleaseDiff(options);
  const result = classifyFastReleasePaths(paths);
  const body = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) writeFileSync(options.output, body, { mode: 0o600 });
  process.stdout.write(JSON.stringify({
    allowed: result.allowed,
    reason: result.reason,
    changedPathCount: result.paths.length,
  }) + "\n");
  if (!result.allowed) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runFastReleaseScopeCli(process.argv.slice(2));
  } catch {
    process.stderr.write("fast release scope gate failed\n");
    process.exitCode = 2;
  }
}
