import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { parseNameStatus } from "./classify-pr-changes.mjs";
import { INBOX_PREFIX, isInboxFormatCandidate } from "./inbox-format-policy.mjs";

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Git verification failed: ${args[0]}`);
  return result.stdout;
}

function entry(root, revision, path) {
  const match = /^(100644|100755) blob ([a-f0-9]{40})\t[^\0]+\0$/u.exec(
    git(root, ["ls-tree", "-z", revision, "--", path]),
  );
  if (!match) throw new Error(`Not a regular tracked file: ${path}`);
  return { mode: match[1], oid: match[2] };
}

export function inspectInboxFormatScope(root, base, head) {
  if (![base, head].every((sha) => /^[a-f0-9]{40}$/u.test(sha))) throw new Error("Immutable base/head SHAs required");
  if (git(root, ["merge-base", base, head]).trim() !== base) throw new Error("Base must be the frozen merge base");
  if (git(root, ["rev-parse", "HEAD"]).trim() !== head) throw new Error("Checkout must match the frozen head");
  if (git(root, ["status", "--porcelain", "--untracked-files=no"]).trim()) throw new Error("Tracked checkout must be clean");
  const entries = parseNameStatus(Buffer.from(git(root, ["diff", "--name-status", "--no-renames", "-z", base, head])));
  const paths = [];
  for (const change of entries) {
    const path = change.paths[0];
    if (!path.startsWith(INBOX_PREFIX)) {
      if (!/^docs\/.+\.md$/u.test(path) || !["A", "M"].includes(change.status)) {
        throw new Error(`Mixed non-documentation change: ${path}`);
      }
      entry(root, head, path);
      continue;
    }
    if (change.status !== "M" || !isInboxFormatCandidate(path)) throw new Error(`Unsupported formatting change: ${path}`);
    if (entry(root, base, path).mode !== entry(root, head, path).mode) throw new Error(`File mode changed: ${path}`);
    paths.push(path);
  }
  if (paths.length === 0) throw new Error("No Inbox formatting changes to prove");
  return paths;
}

export async function stableFormat(prettier, source, options) {
  let current = source;
  // Some existing member chains need two passes with the locked formatter.
  // Accept at most three transformations, then require a stable confirmation.
  for (let pass = 0; pass <= 3; pass += 1) {
    const next = await prettier.format(current, options);
    if (next === current) return current;
    current = next;
  }
  throw new Error("Locked formatter did not converge within three transformations");
}

export async function verifyInboxFormat({ root, base, head, scopeOnly = false }) {
  const paths = inspectInboxFormatScope(root, base, head);
  if (scopeOnly) return { base, head, files: paths.length, scopeOnly: true };
  const companion = resolve(root, INBOX_PREFIX);
  const prettier = await import(pathToFileURL(resolve(companion, "node_modules/prettier/index.mjs")).href);
  const previousCwd = process.cwd();
  process.chdir(companion);
  try {
    for (const path of paths) {
      const filepath = resolve(root, path);
      const info = await prettier.getFileInfo(filepath, {
        ignorePath: [resolve(companion, ".prettierignore"), resolve(companion, ".gitignore")],
        resolveConfig: false,
      });
      if (info.ignored || !info.inferredParser) throw new Error(`Ignored or unsupported formatter input: ${path}`);
      const options = await prettier.resolveConfig(filepath, { editorconfig: true, useCache: false });
      if (!options) throw new Error(`Missing formatter config: ${path}`);
      const original = git(root, ["show", `${base}:${path}`]);
      const proposed = git(root, ["show", `${head}:${path}`]);
      const formatted = await stableFormat(prettier, original, { ...options, filepath });
      if (formatted !== proposed) throw new Error(`Not the exact base formatting result: ${path}`);
      if (readFileSync(filepath, "utf8") !== proposed) throw new Error(`Checkout differs from head: ${path}`);
    }
  } finally {
    process.chdir(previousCwd);
  }
  return { base, head, files: paths.length, scopeOnly: false, prettier: prettier.version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const options = { root: git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim() };
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === "--scope-only") options.scopeOnly = true;
      else if (["--base", "--head"].includes(args[index]) && args[index + 1]) options[args[index].slice(2)] = args[++index];
      else throw new Error("Usage: verify-inbox-format.mjs --base SHA --head SHA [--scope-only]");
    }
    console.log(JSON.stringify(await verifyInboxFormat(options)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
