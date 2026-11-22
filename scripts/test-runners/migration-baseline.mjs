#!/usr/bin/env node
// Baseline snapshot planner for the «Migration boundary» check
// (docs/PLAN_CHANGES.md, 22.11.2026).
//
// scripts/test-runners/test-postgres-authorization.sh applies every forward-only migration and runs each
// migration's boundary suite right after it. Migrations on main never change, so a pull request that only ADDS
// migrations can start from a saved copy of the database at the tail of main. This file decides, from git alone,
// whether that is exact enough:
//
//   key       the cache key of a revision: a content hash of everything the saved database depends on;
//   plan      baseline manifest + the revision under test -> "fast" (restore, apply only the new migrations) or
//             "full" (the whole chain), always with a reason; anything doubtful is "full", never a silent skip;
//   manifest  writes the manifest next to a freshly saved snapshot;
//   precheck-save  refuses to save a snapshot from a tree whose boundary inputs differ from git HEAD.
//
// Fast mode is allowed only when, between the revision the snapshot was built from and the revision under test:
//   - every changed path among the inputs is an ADDED migration (sorting after every existing one) or an ADDED file
//     under supabase/tests/;
//   - no existing migration or suite changed, and the helper scripts (image resolver, this file) are untouched;
//   - the harness changed by pure insertions only, each one either a whole `if [[ "$(basename "$migration")" == GLOB ]]`
//     block for a new migration (GLOB matching no existing migration) or lines in the end-of-chain section.
// The end-of-chain section and every new migration's block still run in fast mode.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export const KEY_PREFIX = "migration-baseline-v1-";
export const MANIFEST_NAME = "baseline.json";
export const ARCHIVE_NAME = "data.tar.zst";
export const HARNESS_PATH = "scripts/test-runners/test-postgres-authorization.sh";
export const MIGRATIONS_DIR = "supabase/migrations/";
export const TESTS_DIR = "supabase/tests/";
// Files whose content the saved database depends on. Their blobs go into the key. A change to either of the
// helper files is never "additive": it forces the full chain.
export const HELPER_PATHS = [
  "scripts/local-dev/resolve-postgres-test-image.sh",
  "scripts/test-runners/migration-baseline.mjs",
];
export const INPUT_PATHSPECS = [MIGRATIONS_DIR, TESTS_DIR, HARNESS_PATH, ...HELPER_PATHS];

const LOOP_START = /^while IFS= read -r migration; do$/u;
const LOOP_END = /^done < <\($/u;
const LOOP_CLOSE = /^\)$/u;
const MIGRATION_IF = /^ {2}if \[\[ "\$\(basename "\$migration"\)" == (\S+) \]\]; then$/u;
const MIGRATION_NAME = /^\d+_[A-Za-z0-9_.-]+\.sql$/u;

function git(repo, args, options = {}) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

/** Tree entries (mode, blob id, path) of every input at a revision, sorted by path. */
export function listInputs(repo, rev) {
  const output = git(repo, ["ls-tree", "-r", "--full-tree", "-z", rev, "--", ...INPUT_PATHSPECS]);
  return output
    .split("\0")
    .filter(Boolean)
    .map(line => {
      const tab = line.indexOf("\t");
      const [mode, , blob] = line.slice(0, tab).split(" ");
      return { mode, blob, path: line.slice(tab + 1) };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The cache key of a revision: a content hash of the migrations, suites, harness and helper scripts. */
export function baselineKey(repo, rev) {
  const hash = createHash("sha256");
  for (const entry of listInputs(repo, rev)) hash.update(`${entry.path}\0${entry.mode}\0${entry.blob}\n`);
  return `${KEY_PREFIX}${hash.digest("hex")}`;
}

function globToRegExp(glob) {
  if (/[[\]\\"'`$]/u.test(glob)) return null;
  const source = glob.replace(/[.+^${}()|]/gu, "\\$&").replace(/\*/gu, ".*").replace(/\?/gu, ".");
  return new RegExp(`^${source}$`, "u");
}

function parseHunks(patch) {
  const hunks = [];
  let current = null;
  for (const line of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        added: [],
        removed: 0,
      };
      hunks.push(current);
    } else if (current && line.startsWith("+")) {
      current.added.push(line.slice(1));
    } else if (current && line.startsWith("-")) {
      current.removed += 1;
    }
  }
  return hunks;
}

/**
 * Is a harness diff made only of insertions that fast mode still executes exactly as the full chain would?
 * `oldLines` are the harness lines at the baseline revision, `hunks` come from `git diff -U0`.
 * Returns { ok, reason }.
 */
export function judgeHarnessChange({ oldLines, hunks, addedMigrations, existingMigrations }) {
  const loopStart = oldLines.findIndex(line => LOOP_START.test(line)) + 1;
  const loopEnd = loopStart ? oldLines.findIndex((line, i) => i + 1 > loopStart && LOOP_END.test(line)) + 1 : 0;
  const loopClose = loopEnd ? oldLines.findIndex((line, i) => i + 1 > loopEnd && LOOP_CLOSE.test(line)) + 1 : 0;
  if (!loopStart || !loopEnd || !loopClose) {
    return { ok: false, reason: "harness: migration loop markers not found in the baseline harness" };
  }
  const added = new Set(addedMigrations.map(path => basename(path)));
  const existing = existingMigrations.map(path => basename(path));

  for (const hunk of hunks) {
    if (hunk.oldCount !== 0 || hunk.removed !== 0) {
      return { ok: false, reason: "harness: existing lines were changed or removed (only insertions are allowed)" };
    }
    const after = hunk.oldStart; // the insertion goes after this 1-based old line (0 = top of file)
    if (after < loopStart) {
      return { ok: false, reason: `harness: insertion before the migration loop (after line ${after}) changes the preamble` };
    }
    if (after >= loopEnd && after < loopClose) {
      return { ok: false, reason: `harness: insertion inside the migration list command (after line ${after})` };
    }

    if (after < loopEnd) {
      // Inside the loop: whole migration-gated blocks only, at a block boundary.
      if (after !== loopStart && oldLines[after - 1] !== "  fi") {
        return { ok: false, reason: `harness: insertion inside an existing block (after line ${after})` };
      }
      let open = false;
      for (const line of hunk.added) {
        if (open) {
          if (line === "  fi") open = false;
          continue;
        }
        if (line.trim() === "" || /^ {2}#/u.test(line)) continue;
        const match = MIGRATION_IF.exec(line);
        const pattern = match && globToRegExp(match[1]);
        if (!pattern) {
          return { ok: false, reason: `harness: an inserted loop statement is not a migration-gated block: ${line.trim().slice(0, 80)}` };
        }
        if (existing.some(name => pattern.test(name))) {
          return { ok: false, reason: `harness: the block for ${match[1]} also matches an existing migration` };
        }
        if (![...added].some(name => pattern.test(name))) {
          return { ok: false, reason: `harness: the block for ${match[1]} matches no added migration` };
        }
        open = true;
      }
      if (open) return { ok: false, reason: "harness: an inserted migration block is not closed" };
      continue;
    }

    // After the loop: the end-of-chain section runs in both modes. Insert only between whole statements.
    if (after >= loopClose) {
      const previous = oldLines[after - 1] ?? "";
      const next = oldLines[after] ?? "";
      if (previous.trimEnd().endsWith("\\") || /^[ \t]/u.test(next) || (hunk.added.at(-1) ?? "").trimEnd().endsWith("\\")) {
        return { ok: false, reason: `harness: insertion in the middle of a statement (after line ${after})` };
      }
    }
  }
  return { ok: true, reason: "harness: only new migration blocks and end-of-chain insertions" };
}

/**
 * Pure classification of the changed inputs between the baseline revision and the revision under test.
 * `changes` are `git diff --name-status` rows: { status, path }.
 */
export function judgeChanges({ changes, existingMigrations, harness }) {
  const last = [...existingMigrations].map(path => basename(path)).sort().at(-1) ?? "";
  const addedMigrations = [];
  const addedSuites = [];
  for (const { status, path } of changes) {
    if (path === HARNESS_PATH) {
      if (status !== "M") return { mode: "full", reason: `harness was ${status === "D" ? "deleted" : "replaced"}` };
      continue;
    }
    if (HELPER_PATHS.includes(path)) return { mode: "full", reason: `${path} changed` };
    if (path.startsWith(MIGRATIONS_DIR)) {
      const name = path.slice(MIGRATIONS_DIR.length);
      if (status !== "A") return { mode: "full", reason: `existing migration ${name} was ${status === "D" ? "deleted" : "modified"}` };
      if (name.includes("/") || !MIGRATION_NAME.test(name)) return { mode: "full", reason: `unrecognised migration path ${path}` };
      if (name <= last) return { mode: "full", reason: `new migration ${name} does not sort after the last existing migration ${last}` };
      addedMigrations.push(path);
      continue;
    }
    if (path.startsWith(TESTS_DIR)) {
      if (status !== "A") return { mode: "full", reason: `existing suite ${path} was ${status === "D" ? "deleted" : "modified"}` };
      addedSuites.push(path);
      continue;
    }
    return { mode: "full", reason: `unexpected changed input ${path}` };
  }
  addedMigrations.sort();
  if (harness) {
    const verdict = judgeHarnessChange({ ...harness, addedMigrations, existingMigrations });
    if (!verdict.ok) return { mode: "full", reason: verdict.reason };
  }
  return {
    mode: "fast",
    reason: `only additions: ${addedMigrations.length} migration(s), ${addedSuites.length} suite file(s)`,
    addedMigrations,
    addedSuites,
  };
}

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path).on("data", chunk => hash.update(chunk)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}

/** Full plan for one run: reads the manifest and the archive, compares against git. Never throws: any doubt is "full". */
export async function planMigrationBoundary({ repo, baselineDir, head = "HEAD" }) {
  const full = reason => ({ mode: "full", reason });
  try {
    if (!baselineDir) return full("no baseline directory configured");
    const manifestPath = join(baselineDir, MANIFEST_NAME);
    if (!existsSync(manifestPath)) return full(`no baseline manifest at ${manifestPath}`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.schema !== 1 || !/^[0-9a-f]{40}$/u.test(manifest.sourceRev ?? "") || !manifest.key || !manifest.archive?.sha256) {
      return full("baseline manifest is malformed");
    }
    const archivePath = join(baselineDir, manifest.archive.name ?? ARCHIVE_NAME);
    if (!existsSync(archivePath) || statSync(archivePath).size !== manifest.archive.bytes) {
      return full("baseline archive is missing or has the wrong size");
    }
    try {
      git(repo, ["cat-file", "-e", `${manifest.sourceRev}^{commit}`]);
    } catch {
      return full(`baseline source revision ${manifest.sourceRev.slice(0, 12)} is not in this clone (shallow history?)`);
    }
    if (baselineKey(repo, manifest.sourceRev) !== manifest.key) {
      return full("baseline manifest key does not match the content of its source revision");
    }
    try {
      git(repo, ["merge-base", "--is-ancestor", manifest.sourceRev, head]);
    } catch {
      return full(`baseline source ${manifest.sourceRev.slice(0, 12)} is not an ancestor of ${head}`);
    }
    const dirty = git(repo, ["status", "--porcelain", "--untracked-files=all", "--", ...INPUT_PATHSPECS]).trim();
    if (dirty) return full("uncommitted changes in the boundary inputs");
    if ((await sha256File(archivePath)) !== manifest.archive.sha256) return full("baseline archive checksum does not match its manifest");

    const rows = git(repo, ["diff", "--name-status", "--no-renames", "-z", manifest.sourceRev, head, "--", ...INPUT_PATHSPECS])
      .split("\0")
      .filter(Boolean);
    const changes = [];
    for (let i = 0; i + 1 < rows.length; i += 2) changes.push({ status: rows[i][0], path: rows[i + 1] });
    const existingMigrations = listInputs(repo, manifest.sourceRev)
      .map(entry => entry.path)
      .filter(path => path.startsWith(MIGRATIONS_DIR));
    let harness = null;
    if (changes.some(change => change.path === HARNESS_PATH)) {
      const oldText = git(repo, ["show", `${manifest.sourceRev}:${HARNESS_PATH}`]);
      const patch = git(repo, ["diff", "-U0", "--no-color", manifest.sourceRev, head, "--", HARNESS_PATH]);
      harness = { oldLines: oldText.split("\n"), hunks: parseHunks(patch) };
    }
    const verdict = judgeChanges({ changes, existingMigrations, harness });
    return { ...verdict, sourceRev: manifest.sourceRev, key: manifest.key };
  } catch (error) {
    return full(`planner error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function arg(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

async function main(argv) {
  const [command] = argv;
  const repo = arg(argv, "--repo", process.cwd());
  if (command === "key") {
    const rev = arg(argv, "--rev") ?? git(repo, ["merge-base", arg(argv, "--merge-base-with", "origin/main"), "HEAD"]).trim();
    console.log(baselineKey(repo, rev));
    return 0;
  }
  if (command === "plan") {
    const plan = await planMigrationBoundary({ repo, baselineDir: arg(argv, "--baseline-dir"), head: arg(argv, "--head", "HEAD") });
    // Machine lines for the harness: MODE / REASON / NEW. Human log lines go to stderr.
    console.log(`MODE ${plan.mode}`);
    console.log(`REASON ${plan.reason}`);
    for (const path of plan.addedMigrations ?? []) console.log(`NEW ${path}`);
    console.error(
      `MIGRATION_BOUNDARY_PLAN mode=${plan.mode} reason="${plan.reason}"` +
        (plan.sourceRev ? ` baseline=${plan.sourceRev.slice(0, 12)}` : ""),
    );
    return 0;
  }
  if (command === "precheck-save") {
    const dirty = git(repo, ["status", "--porcelain", "--untracked-files=all", "--", ...INPUT_PATHSPECS]).trim();
    if (dirty) {
      console.error("Refusing to save a baseline: boundary inputs differ from git HEAD:\n" + dirty);
      return 1;
    }
    return 0;
  }
  if (command === "manifest") {
    const dir = arg(argv, "--dir");
    const archive = join(dir, arg(argv, "--archive", ARCHIVE_NAME));
    const manifest = {
      schema: 1,
      key: baselineKey(repo, "HEAD"),
      sourceRev: git(repo, ["rev-parse", "HEAD"]).trim(),
      createdAt: new Date().toISOString(),
      image: arg(argv, "--image", ""),
      imageId: arg(argv, "--image-id", ""),
      migrations: listInputs(repo, "HEAD").filter(entry => entry.path.startsWith(MIGRATIONS_DIR)).length,
      archive: { name: basename(archive), bytes: statSync(archive).size, sha256: await sha256File(archive) },
    };
    writeFileSync(join(dir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
    console.error(`Baseline manifest written: key=${manifest.key} source=${manifest.sourceRev.slice(0, 12)} bytes=${manifest.archive.bytes}`);
    return 0;
  }
  console.error("usage: migration-baseline.mjs key|plan|manifest|precheck-save [options]");
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    code => process.exit(code),
    error => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
