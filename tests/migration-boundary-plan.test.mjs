import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ARCHIVE_NAME,
  END_OF_CHAIN_ONLY_PATHS,
  HARNESS_PATH,
  HELPER_PATHS,
  INPUT_PATHSPECS,
  MANIFEST_NAME,
  baselineKey,
  planMigrationBoundary,
} from "../scripts/test-runners/migration-baseline.mjs";

// Pins the choice between the fast baseline mode and the whole chain for the «Migration boundary» check
// (docs/PLAN_CHANGES.md, 22.11.2026). Real git repositories in a temp directory, no Docker: additions only ->
// fast; anything else, or no usable baseline -> the whole chain, with a reason.

const realHarness = readFileSync(new URL(`../${HARNESS_PATH}`, import.meta.url), "utf8");

const HARNESS = `#!/usr/bin/env bash
set -euo pipefail
preamble_marker=1

while IFS= read -r migration; do
  if [[ "$(basename "$migration")" == 001_* ]]; then
    echo first
  fi
  # Second block.
  if [[ "$(basename "$migration")" == *_two.sql ]]; then
    echo second
  fi
done < <(
  cd "$repo_root"
  find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort
)

echo end-of-chain \\
  --flag
psql -f /workspace/supabase/tests/final.sql
`;

const BASE_FILES = {
  [HARNESS_PATH]: HARNESS,
  "scripts/local-dev/resolve-postgres-test-image.sh": "#!/usr/bin/env bash\necho image\n",
  "scripts/test-runners/migration-baseline.mjs": "// planner placeholder\n",
  "supabase/migrations/001_one.sql": "select 1;\n",
  "supabase/migrations/002_two.sql": "select 2;\n",
  "supabase/tests/one.sql": "select 'one';\n",
  "supabase/tests/final.sql": "select 'final';\n",
  "docs/notes.md": "notes\n",
};

const NEW_BLOCK = `  if [[ "$(basename "$migration")" == *_three.sql ]]; then
    echo third
  fi
`;

function run(repo, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
}

function write(repo, files) {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      rmSync(join(repo, path), { force: true });
      continue;
    }
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
}

function commit(repo, files, message) {
  write(repo, files);
  run(repo, "add", "-A");
  run(repo, "commit", "-q", "-m", message);
  return run(repo, "rev-parse", "HEAD");
}

/** A repo whose first commit is the baseline source, a baseline dir for it, and a helper to add the PR commit. */
function scenario(t, { baselineFiles = BASE_FILES } = {}) {
  const root = mkdtempSync(join(tmpdir(), "evo-boundary-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const baselineDir = join(root, "baseline");
  mkdirSync(repo);
  mkdirSync(baselineDir);
  run(repo, "init", "-q");
  const sourceRev = commit(repo, baselineFiles, "baseline");
  const archive = Buffer.from("not a real archive, only its checksum matters here");
  writeFileSync(join(baselineDir, ARCHIVE_NAME), archive);
  const manifest = {
    schema: 1,
    key: baselineKey(repo, sourceRev),
    sourceRev,
    archive: { name: ARCHIVE_NAME, bytes: archive.length, sha256: createHash("sha256").update(archive).digest("hex") },
  };
  const writeManifest = value => writeFileSync(join(baselineDir, MANIFEST_NAME), JSON.stringify(value));
  writeManifest(manifest);
  return {
    repo,
    baselineDir,
    sourceRev,
    manifest,
    writeManifest,
    pr: (files, message = "pr") => commit(repo, files, message),
    plan: () => planMigrationBoundary({ repo, baselineDir }),
  };
}

const withBlock = harness => harness.replace('done < <(', `${NEW_BLOCK}done < <(`);

test("additions only (new migration, new suite, new migration block, end-of-chain line) run in fast mode", async t => {
  const s = scenario(t);
  s.pr({
    "supabase/migrations/003_three.sql": "select 3;\n",
    "supabase/tests/three.sql": "select 'three';\n",
    [HARNESS_PATH]: withBlock(HARNESS).replace("psql -f /workspace/supabase/tests/final.sql\n", "psql -f /workspace/supabase/tests/final.sql\npsql -f /workspace/supabase/tests/three.sql\n"),
    "docs/notes.md": "changed notes\n",
  });
  const plan = await s.plan();
  assert.equal(plan.mode, "fast", plan.reason);
  assert.deepEqual(plan.addedMigrations, ["supabase/migrations/003_three.sql"]);
  assert.deepEqual(plan.addedSuites, ["supabase/tests/three.sql"]);
});

test("a block added at the start of the loop body is also fast", async t => {
  const s = scenario(t);
  s.pr({
    "supabase/migrations/003_three.sql": "select 3;\n",
    [HARNESS_PATH]: HARNESS.replace("migration; do\n", `migration; do\n${NEW_BLOCK}`),
  });
  assert.equal((await s.plan()).mode, "fast");
});

test("an end-of-chain-only PR with no new migration is fast with nothing to apply", async t => {
  const s = scenario(t);
  s.pr({ [HARNESS_PATH]: HARNESS + "echo more\n" });
  const plan = await s.plan();
  assert.equal(plan.mode, "fast", plan.reason);
  assert.deepEqual(plan.addedMigrations, []);
});

test("the real harness accepts a new migration block inserted before the end of the loop", async t => {
  const insertion = NEW_BLOCK;
  const marker = "\ndone < <(\n  cd \"$repo_root\"\n  find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort\n)";
  assert.ok(realHarness.includes(marker), "the real harness keeps its loop markers");
  const s = scenario(t, { baselineFiles: { ...BASE_FILES, [HARNESS_PATH]: realHarness } });
  s.pr({
    "supabase/migrations/003_three.sql": "select 3;\n",
    [HARNESS_PATH]: realHarness.replace(marker, `\n${insertion}${marker.slice(1)}`),
  });
  const plan = await s.plan();
  assert.equal(plan.mode, "fast", plan.reason);
});

test("a modified existing migration runs the whole chain", async t => {
  const s = scenario(t);
  s.pr({ "supabase/migrations/002_two.sql": "select 22;\n", "supabase/migrations/003_three.sql": "select 3;\n" });
  const plan = await s.plan();
  assert.equal(plan.mode, "full");
  assert.match(plan.reason, /existing migration 002_two\.sql was modified/u);
});

test("a deleted existing migration runs the whole chain", async t => {
  const s = scenario(t);
  s.pr({ "supabase/migrations/002_two.sql": null });
  assert.match((await s.plan()).reason, /deleted/u);
});

test("a modified existing suite runs the whole chain", async t => {
  const s = scenario(t);
  s.pr({ "supabase/tests/one.sql": "select 'changed';\n" });
  const plan = await s.plan();
  assert.equal(plan.mode, "full");
  assert.match(plan.reason, /existing suite supabase\/tests\/one\.sql was modified/u);
});

test("a migration that sorts before the last existing one runs the whole chain", async t => {
  const s = scenario(t);
  s.pr({ "supabase/migrations/001_zero.sql": "select 0;\n" });
  assert.match((await s.plan()).reason, /does not sort after/u);
});

test("harness changes other than new migration blocks or end-of-chain insertions run the whole chain", async t => {
  const cases = {
    "a removed or changed line": h => h.replace("echo second", "echo SECOND"),
    "an insertion in the preamble": h => h.replace("preamble_marker=1\n", "preamble_marker=1\nextra=1\n"),
    "an insertion inside an existing block": h => h.replace("    echo first\n", "    echo first\n    echo sneaked\n"),
    "a loop statement that is not migration-gated": h => h.replace("done < <(", "  echo ungated\ndone < <("),
    "a block matching an existing migration": h => h.replace("done < <(", `  if [[ "$(basename "$migration")" == *_two.sql ]]; then\n    echo again\n  fi\ndone < <(`),
    "a block matching no added migration": h => h.replace("done < <(", `  if [[ "$(basename "$migration")" == *_other.sql ]]; then\n    echo x\n  fi\ndone < <(`),
    "an insertion inside the migration list command": h => h.replace('  cd "$repo_root"\n', '  cd "$repo_root"\n  echo hidden\n'),
    "an insertion in the middle of a continued statement": h => h.replace("echo end-of-chain \\\n", "echo end-of-chain \\\n  --extra \\\n"),
  };
  for (const [name, edit] of Object.entries(cases)) {
    const s = scenario(t);
    s.pr({ "supabase/migrations/003_three.sql": "select 3;\n", [HARNESS_PATH]: edit(HARNESS) });
    const plan = await s.plan();
    assert.equal(plan.mode, "full", `${name}: ${plan.reason}`);
    assert.match(plan.reason, /harness/u, name);
  }
});

test("a changed image resolver or planner runs the whole chain", async t => {
  for (const path of HELPER_PATHS) {
    const s = scenario(t);
    s.pr({ [path]: "changed\n" });
    const plan = await s.plan();
    assert.equal(plan.mode, "full");
    assert.match(plan.reason, /changed/u);
  }
});

test("no baseline, a missing or damaged one, or a mismatching one runs the whole chain with a reason", async t => {
  const none = scenario(t);
  none.pr({ "supabase/migrations/003_three.sql": "select 3;\n" });
  assert.match((await planMigrationBoundary({ repo: none.repo, baselineDir: join(none.baselineDir, "nope") })).reason, /no baseline manifest/u);
  assert.match((await planMigrationBoundary({ repo: none.repo, baselineDir: undefined })).reason, /no baseline directory/u);

  const badSum = scenario(t);
  badSum.writeManifest({ ...badSum.manifest, archive: { ...badSum.manifest.archive, sha256: "0".repeat(64) } });
  badSum.pr({ "supabase/migrations/003_three.sql": "select 3;\n" });
  assert.match((await badSum.plan()).reason, /checksum/u);

  const badSize = scenario(t);
  badSize.writeManifest({ ...badSize.manifest, archive: { ...badSize.manifest.archive, bytes: 1 } });
  assert.match((await badSize.plan()).reason, /wrong size/u);

  const badKey = scenario(t);
  badKey.writeManifest({ ...badKey.manifest, key: "migration-baseline-v1-deadbeef" });
  assert.match((await badKey.plan()).reason, /key does not match/u);

  const malformed = scenario(t);
  malformed.writeManifest({ schema: 2 });
  assert.match((await malformed.plan()).reason, /malformed/u);
});

test("a baseline built from a revision that is not an ancestor runs the whole chain", async t => {
  const s = scenario(t);
  // Same repository, a sibling history: build the baseline on a side branch the tested head does not contain.
  run(s.repo, "checkout", "-q", "-b", "side");
  const sideRev = commit(s.repo, { "supabase/migrations/003_side.sql": "select 3;\n" }, "side");
  s.writeManifest({ ...s.manifest, sourceRev: sideRev, key: baselineKey(s.repo, sideRev) });
  run(s.repo, "checkout", "-q", "-");
  s.pr({ "supabase/migrations/003_three.sql": "select 3;\n" });
  assert.match((await s.plan()).reason, /not an ancestor/u);
});

test("uncommitted or untracked boundary inputs run the whole chain", async t => {
  const s = scenario(t);
  s.pr({ "supabase/migrations/003_three.sql": "select 3;\n" });
  write(s.repo, { "supabase/migrations/004_loose.sql": "select 4;\n" });
  assert.match((await s.plan()).reason, /uncommitted/u);
});

test("the key follows the content of the inputs only", t => {
  const s = scenario(t);
  const before = baselineKey(s.repo, s.sourceRev);
  const docs = s.pr({ "docs/notes.md": "other\n" });
  assert.equal(baselineKey(s.repo, docs), before);
  const migration = s.pr({ "supabase/migrations/002_two.sql": "select 22;\n" });
  assert.notEqual(baselineKey(s.repo, migration), before);
  const harness = s.pr({ [HARNESS_PATH]: HARNESS + "echo more\n" });
  assert.notEqual(baselineKey(s.repo, harness), baselineKey(s.repo, migration));
  assert.match(before, /^migration-baseline-v1-[0-9a-f]{64}$/u);
});

test("an unknown glob shape (extglob, classes, alternation) in a new block runs the whole chain", async t => {
  for (const glob of ["@(a|b)_three.sql", "!(x)_three.sql", "+(3)_three.sql", "*(3)_three.sql", "?(3)_three.sql", "[0-9]*_three.sql"]) {
    const s = scenario(t);
    s.pr({
      "supabase/migrations/003_three.sql": "select 3;\n",
      [HARNESS_PATH]: HARNESS.replace("done < <(", `  if [[ "$(basename "$migration")" == ${glob} ]]; then\n    echo x\n  fi\ndone < <(`),
    });
    const plan = await s.plan();
    assert.equal(plan.mode, "full", `${glob}: ${plan.reason}`);
  }
});

test("a baseline built with another Postgres image runs the whole chain", async t => {
  const s = scenario(t);
  s.writeManifest({ ...s.manifest, image: "public.ecr.aws/supabase/postgres@sha256:aaa" });
  s.pr({ "supabase/migrations/003_three.sql": "select 3;\n" });
  assert.equal((await planMigrationBoundary({ repo: s.repo, baselineDir: s.baselineDir, image: "public.ecr.aws/supabase/postgres@sha256:aaa" })).mode, "fast");
  const other = await planMigrationBoundary({ repo: s.repo, baselineDir: s.baselineDir, image: "supabase/postgres@sha256:bbb" });
  assert.equal(other.mode, "full");
  assert.match(other.reason, /another Postgres image/u);
});

// Bare path tokens that are known not to be files the harness reads (none today). Add an entry only with a reason.
const BARE_PATH_ALLOW_LIST = new Set([]);

test("every file the real harness reads is a baseline input (or read only after the loop)", () => {
  const lines = realHarness.split("\n");
  const loopClose = lines.findIndex((line, i) => i > 0 && /^\)$/u.test(line) && lines.slice(0, i).some(l => /^done < <\($/u.test(l)));
  assert.ok(loopClose > 0);
  const covered = path => INPUT_PATHSPECS.some(spec => (spec.endsWith("/") ? `${path}/`.startsWith(spec) : path === spec));
  const refs = [];
  lines.forEach((line, index) => {
    if (/^\s*#/u.test(line)) return;
    for (const match of line.matchAll(/(?:\$repo_root|\$\{repo_root\}|\/workspace)"?\/([A-Za-z0-9_./-]+)/gu)) {
      refs.push({ path: match[1].replace(/[.]$/u, ""), line: index });
    }
    // Bare tokens: relative paths after `cd "$repo_root"`, a path inside a git revision spec, and so on.
    for (const match of line.matchAll(/(?<![A-Za-z0-9_./$-])((?:scripts|supabase|docs)\/[A-Za-z0-9_./-]+)/gu)) {
      const path = match[1].replace(/[.]$/u, "");
      if (!BARE_PATH_ALLOW_LIST.has(path)) refs.push({ path, line: index });
    }
  });
  assert.ok(refs.length > 100, "the extraction must see the harness references");
  const paths = new Set(refs.map(ref => ref.path));
  for (const expected of ["supabase/config.toml", "scripts/test-runners/test-p2g-queues-runtime.sh", "scripts/test-runners/test-platform-migration-077-runtime.sh"]) {
    assert.ok(paths.has(expected), `${expected} is referenced by the harness`);
  }
  for (const { path, line } of refs) {
    const ok = covered(path) || (line > loopClose && END_OF_CHAIN_ONLY_PATHS.includes(path));
    assert.ok(ok, `harness line ${line + 1} reads ${path}, which is not part of the baseline key (add it to HELPER_PATHS)`);
  }
});

test("the harness takes its decision from the planner of the baseline's source commit", () => {
  assert.match(realHarness, /git -C "\$repo_root" show "\$baseline_source_rev:scripts\/test-runners\/migration-baseline\.mjs"/u);
  assert.match(realHarness, /node "\$trusted_planner" plan /u);
  assert.doesNotMatch(realHarness, /node "\$baseline_planner" plan/u);
});

test("the bare path scan sees relative paths and a quote closed before the slash", () => {
  const sample = ['  find supabase/migrations -maxdepth 1', 'bash "$repo_root"/scripts/x.sh', 'git show "$rev:scripts/y.mjs"'];
  const found = [];
  for (const line of sample) {
    for (const m of line.matchAll(/(?:\$repo_root|\$\{repo_root\}|\/workspace)"?\/([A-Za-z0-9_./-]+)/gu)) found.push(m[1]);
    for (const m of line.matchAll(/(?<![A-Za-z0-9_./$-])((?:scripts|supabase|docs)\/[A-Za-z0-9_./-]+)/gu)) found.push(m[1]);
  }
  assert.deepEqual(found, ["supabase/migrations", "scripts/x.sh", "scripts/y.mjs"]);
});

test("the fast PR checks restore the baseline and run the harness in auto mode", () => {
  const fastPr = readFileSync(new URL("../.github/workflows/evo-fast-pr-checks.yml", import.meta.url), "utf8");
  const job = fastPr.slice(fastPr.indexOf("\n  migration_boundary:\n"), fastPr.indexOf("\n  fast-checks:\n"));
  assert.match(job, /fetch-depth: 0/u, "the planner needs history for the merge base");
  assert.match(job, /node scripts\/test-runners\/migration-baseline\.mjs key --merge-base-with origin\/main/u);
  assert.match(job, /uses: actions\/cache\/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6\.1\.0\n        with:\n          path: \.cache\/migration-baseline\n          key: \$\{\{ steps\.baseline\.outputs\.key \}\}\n          restore-keys: migration-baseline-v1-/u);
  assert.doesNotMatch(job, /actions\/cache\/save|actions\/cache@/u, "a PR never saves a baseline");
  assert.match(job, /env:\n          EVO_MIGRATION_BOUNDARY_MODE: auto\n          EVO_MIGRATION_BASELINE_DIR: \$\{\{ github\.workspace \}\}\/\.cache\/migration-baseline\n        run: npm run test:database:migration-boundaries/u);
});

test("auto mode without a usable baseline runs the whole chain instead of stopping silently", t => {
  // The REAL harness preamble with a stand-in docker that refuses to start a container, so each run ends right after
  // the mode decision. On 22.11 the first CI cache miss ended here with exit 2 and no message: `set -e` plus a read of
  // the missing manifest.
  const dir = mkdtempSync(join(tmpdir(), "evo-boundary-preamble-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const dockerLog = join(dir, "docker.log");
  writeFileSync(join(bin, "docker"), [
    "#!/bin/sh",
    `echo "$*" >> ${JSON.stringify(dockerLog)}`,
    'case "$1" in',
    '  run|create) echo "stand-in docker: no containers here" >&2; exit 97 ;;',
    "esac",
    "exit 0",
    "",
  ].join("\n"), { mode: 0o755 });
  mkdirSync(join(dir, "empty"));
  mkdirSync(join(dir, "foreign"));
  writeFileSync(join(dir, "foreign", MANIFEST_NAME), JSON.stringify({ sourceRev: "0".repeat(40) }));
  const harness = fileURLToPath(new URL(`../${HARNESS_PATH}`, import.meta.url));
  const run = overrides => {
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    delete env.EVO_MIGRATION_BASELINE_DIR;
    delete env.POSTGRES_TEST_IMAGE;
    writeFileSync(dockerLog, "");
    const result = spawnSync("bash", [harness], { env: { ...env, ...overrides }, encoding: "utf8", timeout: 60_000 });
    return { ...result, docker: readFileSync(dockerLog, "utf8") };
  };

  for (const [label, baselineDir] of [["no directory", join(dir, "missing")], ["no manifest", join(dir, "empty")], ["a source commit this clone lacks", join(dir, "foreign")], ["no variable", undefined]]) {
    const result = run({ EVO_MIGRATION_BOUNDARY_MODE: "auto", ...(baselineDir ? { EVO_MIGRATION_BASELINE_DIR: baselineDir } : {}) });
    assert.match(result.stdout, /^MIGRATION_BOUNDARY_MODE=full reason="no baseline, or its trusted planner is not in this clone" new_migrations=0$/mu, `${label}: ${result.stderr}`);
    assert.match(result.docker, /^run --detach /mu, `${label}: the whole chain starts a fresh container`);
    assert.doesNotMatch(result.docker, /^create /mu, label);
    assert.match(result.stderr, /stand-in docker: no containers here/u, `${label}: the run went on to the container start`);
    assert.notEqual(result.status, 0, label);
  }

  const unknown = run({ EVO_MIGRATION_BOUNDARY_MODE: "quick" });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /EVO_MIGRATION_BOUNDARY_MODE must be full, auto or save/u);
  assert.doesNotMatch(unknown.docker, /^run /mu, "an unknown mode never starts a container");
});
