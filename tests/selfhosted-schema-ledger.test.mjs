import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  LEDGER_READ_COMMAND,
  MIGRATION_APPLY_COMMAND,
  readSelfHostedLedgerRows,
  runSelfHostedRemote,
  SelfHostedDatabaseError,
} from "../scripts/lib/selfhosted-database.mjs";
import {
  applySelfHostedMigrations,
  buildMigrationSql,
  checkSelfHostedLedger,
  pendingVersions,
  SchemaLedgerError,
} from "../scripts/selfhosted-schema-ledger.mjs";

// docs/runbooks/selfhosted-cutover.md: ledger and migrations of the self-hosted stack run over SSH
// inside the database container. The transport is the only seam; everything above it is the real code.

function fakeSpawn({ stdout = "", stderr = "", code = 0, hang = false, flood = 0 } = {}) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    const received = [];
    child.stdin.on("data", (chunk) => received.push(chunk));
    child.killed = false;
    child.kill = (signal) => { child.killed = signal; child.stdout.end(); child.emit("close", null); };
    calls.push({ command, args, options, received });
    if (!hang) {
      setImmediate(() => {
        if (flood > 0) child.stdout.write(Buffer.alloc(flood, 65));
        else if (stdout) child.stdout.write(stdout);
        if (stderr) child.stderr.write(stderr);
        child.stdout.end();
        child.emit("close", code);
      });
    }
    return child;
  };
  return { spawnImpl, calls };
}

function migrationsFixture(files) {
  const root = mkdtempSync(join(tmpdir(), "evo-selfhosted-ledger-"));
  const directory = join(root, "migrations");
  mkdirSync(directory);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content);
  return { root, directory };
}

test("the remote commands are fixed strings in the database container: no port, no tunnel, no password", () => {
  for (const command of [LEDGER_READ_COMMAND, MIGRATION_APPLY_COMMAND]) {
    assert.match(command, /^docker exec -i evo-supabase-db psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 /u);
    assert.doesNotMatch(command, /\s-h\s|\s-p\s|--host|--port|PGPASSWORD|PGHOST|postgres:\/\/|\$|`/u);
  }
  assert.match(LEDGER_READ_COMMAND, / -A -t -c 'select version from supabase_migrations\.schema_migrations order by version'$/u);
  // the Actions log of a public repository must not receive row values from error text
  assert.match(MIGRATION_APPLY_COMMAND, / -v VERBOSITY=sqlstate -f -$/u);
});

test("runSelfHostedRemote runs ssh with a fixed argv, pipes stdin and returns stdout only on success", async () => {
  const fake = fakeSpawn({ stdout: "001\n002\n" });
  const out = await runSelfHostedRemote("echo fixed", { spawnImpl: fake.spawnImpl, input: "select 1;\n" });
  assert.equal(out, "001\n002\n");
  assert.equal(fake.calls[0].command, "ssh");
  assert.deepEqual(fake.calls[0].args, ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "--", "evo-production", "echo fixed"]);
  assert.deepEqual(fake.calls[0].options.stdio, ["pipe", "pipe", "pipe"]);
  assert.equal(Buffer.concat(fake.calls[0].received).toString("utf8"), "select 1;\n");

  const noInput = fakeSpawn({ stdout: "x" });
  await runSelfHostedRemote("echo fixed", { spawnImpl: noInput.spawnImpl });
  assert.equal(noInput.calls[0].options.stdio[0], "ignore");
});

test("runSelfHostedRemote fails with a code only: no remote text in the error, a timeout kills ssh, output is capped", async () => {
  const failing = fakeSpawn({ stdout: "row values", stderr: "ERROR: secret detail", code: 3 });
  await assert.rejects(
    runSelfHostedRemote("echo fixed", { spawnImpl: failing.spawnImpl }),
    (error) => error instanceof SelfHostedDatabaseError && error.message === "selfhosted_remote_failed"
      && !JSON.stringify(error).includes("secret"),
  );
  const seen = [];
  await assert.rejects(runSelfHostedRemote("echo fixed", { spawnImpl: fakeSpawn({ stderr: "WARNING: 25001", code: 1 }).spawnImpl, onStderr: (text) => seen.push(text) }));
  assert.deepEqual(seen, ["WARNING: 25001"]);

  const hanging = fakeSpawn({ hang: true });
  await assert.rejects(
    runSelfHostedRemote("echo fixed", { spawnImpl: hanging.spawnImpl, timeoutMs: 5 }),
    /selfhosted_remote_timeout/u,
  );

  await assert.rejects(
    runSelfHostedRemote("echo fixed", { spawnImpl: fakeSpawn({ flood: 5 * 1024 * 1024 }).spawnImpl }),
    /selfhosted_remote_output_too_large/u,
  );
  await assert.rejects(runSelfHostedRemote("", { spawnImpl: fakeSpawn().spawnImpl }), /selfhosted_command_invalid/u);
  await assert.rejects(
    runSelfHostedRemote("echo fixed", { spawnImpl: () => { throw new Error("spawn ssh ENOENT"); } }),
    /selfhosted_remote_unavailable/u,
  );
});

test("readSelfHostedLedgerRows turns psql output into ledger rows", async () => {
  let command;
  const rows = await readSelfHostedLedgerRows(async (received) => { command = received; return "001\n002\r\n\n 003 \n"; });
  assert.equal(command, LEDGER_READ_COMMAND);
  assert.deepEqual(rows, [{ version: "001" }, { version: "002" }, { version: "003" }]);
});

test("buildMigrationSql wraps the file and its ledger row in one transaction with validated names only", () => {
  const sql = buildMigrationSql({ version: "311", name: "platform_example" }, "create table t(id int);\n");
  assert.equal(
    sql,
    "begin;\ncreate table t(id int);\n;\ninsert into supabase_migrations.schema_migrations (version, name) values ('311', 'platform_example');\ncommit;\n",
  );
  // a file without the trailing newline and a final comment line are still closed correctly
  assert.match(buildMigrationSql({ version: "311", name: "x" }, "select 1 -- end"), /^begin;\nselect 1 -- end\n;\ninsert/u);
  for (const entry of [
    { version: "31", name: "x" }, { version: "3110", name: "x" }, { version: "abc", name: "x" },
    { version: "311", name: "X" }, { version: "311", name: "a-b" }, { version: "311", name: "a'b" }, { version: "311", name: "" },
    { version: "311", name: "x'); drop table t; --" },
  ]) {
    assert.throws(() => buildMigrationSql(entry, "select 1;"), (error) => error instanceof SchemaLedgerError && error.code === "migration_name_invalid", JSON.stringify(entry));
  }
  assert.throws(() => buildMigrationSql({ version: "311", name: "x" }, "select 1;\0"), /migration_content_invalid/u);
});

test("pendingVersions is the tail of the tree after the database ledger and refuses anything else", () => {
  assert.deepEqual(pendingVersions(["001", "002", "003"], ["001"]), ["002", "003"]);
  assert.deepEqual(pendingVersions(["001", "002"], ["001", "002"]), []);
  assert.throws(() => pendingVersions(["001"], ["001", "002"]), /ledger_not_a_prefix_of_the_release_tree/u);
  assert.throws(() => pendingVersions(["001", "002"], ["002"]), /ledger_not_a_prefix_of_the_release_tree/u);
});

test("check prints the same four-part summary as the cloud step and does not fail on a difference", async () => {
  const { root, directory } = migrationsFixture({ "001_one.sql": "select 1;\n", "002_two.sql": "select 2;\n", "003_three.sql": "select 3;\n" });
  try {
    const lines = [];
    await checkSelfHostedLedger({
      migrationDirectory: directory, log: (line) => lines.push(line),
      readRows: async () => [{ version: "001" }],
    });
    assert.deepEqual(lines, [
      "== локальные миграции: 3 (по 003)",
      "== применено в базе: 1 (по 001)",
      "== недостающие в базе:",
      "002 003 ",
      "== лишние в базе (должно быть пусто):",
      " ",
    ]);
    // a ledger ahead of the tree is shown, not hidden
    const ahead = [];
    await checkSelfHostedLedger({
      migrationDirectory: directory, log: (line) => ahead.push(line),
      readRows: async () => ["001", "002", "003", "004"].map((version) => ({ version })),
    });
    assert.equal(ahead.at(-1), "004 ");
    // an unreadable ledger is an error
    await assert.rejects(checkSelfHostedLedger({ migrationDirectory: directory, log() {}, readRows: async () => { throw new SelfHostedDatabaseError("selfhosted_remote_failed"); } }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("apply: dry-run first, each pending file in its own transaction in order, then the ledger is re-read and must match", async () => {
  const { root, directory } = migrationsFixture({
    "001_one.sql": "select 1;\n", "002_two.sql": "create table two(id int);\n",
    "003_three.sql": "begin;\ncreate table three(id int);\ncommit;\n", "004_four.sql": "select 4",
  });
  try {
    let ledger = ["001"];
    const commands = [];
    const lines = [];
    const run = async (command, options = {}) => {
      commands.push({ command, input: options.input });
      const version = /values \('(\d{3})'/u.exec(options.input ?? "")?.[1];
      if (version) ledger = [...ledger, version];
      return "";
    };
    const result = await applySelfHostedMigrations({
      migrationDirectory: directory, run, log: (line) => lines.push(line),
      readRows: async () => ledger.map((version) => ({ version })),
    });
    assert.deepEqual(result.applied, ["002", "003", "004"]);
    assert.deepEqual(result.ledger, ["001", "002", "003", "004"]);
    assert.equal(commands.length, 3);
    assert.ok(commands.every((entry) => entry.command === MIGRATION_APPLY_COMMAND));
    assert.deepEqual(commands.map((entry) => /values \('(\d{3})', '([a-z_]+)'\)/u.exec(entry.input).slice(1)), [["002", "two"], ["003", "three"], ["004", "four"]]);
    assert.match(commands[0].input, /^begin;\ncreate table two\(id int\);\n;\ninsert into supabase_migrations\.schema_migrations \(version, name\) values \('002', 'two'\);\ncommit;\n$/u);
    assert.ok(lines.indexOf("== dry-run ==") < lines.indexOf("== apply =="));
    assert.ok(lines.includes("к применению: 002 003 004"));
    assert.equal(lines.at(-1), "001 002 003 004");
    assert.ok(!lines.join("\n").includes("create table"), "migration text never goes to the log");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("apply stops at the first failing file and applies nothing after it", async () => {
  const { root, directory } = migrationsFixture({ "001_one.sql": "select 1;\n", "002_two.sql": "select 2;\n", "003_three.sql": "select 3;\n", "004_four.sql": "select 4;\n" });
  try {
    const input = [];
    const run = async (command, options) => {
      input.push(options.input);
      if (input.length === 2) throw new SelfHostedDatabaseError("selfhosted_remote_failed");
      return "";
    };
    await assert.rejects(
      applySelfHostedMigrations({ migrationDirectory: directory, run, log() {}, readRows: async () => [{ version: "001" }] }),
      (error) => error instanceof SchemaLedgerError && error.code === "migration_apply_failed",
    );
    assert.equal(input.length, 2, "003 failed, 004 was never sent");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("apply refuses a database that is not a prefix of the tree, applies nothing when nothing is pending and verifies the end state", async () => {
  const { root, directory } = migrationsFixture({ "001_one.sql": "select 1;\n", "002_two.sql": "select 2;\n" });
  try {
    const never = async () => assert.fail("nothing may be sent");
    await assert.rejects(
      applySelfHostedMigrations({ migrationDirectory: directory, run: never, log() {}, readRows: async () => ["001", "002", "003"].map((version) => ({ version })) }),
      /ledger_not_a_prefix_of_the_release_tree/u,
    );
    const lines = [];
    const none = await applySelfHostedMigrations({ migrationDirectory: directory, run: never, log: (line) => lines.push(line), readRows: async () => ["001", "002"].map((version) => ({ version })) });
    assert.deepEqual(none.applied, []);
    assert.ok(lines.includes("к применению: ничего"));
    // the ledger after the run must equal the tree, otherwise the run is reported as failed
    await assert.rejects(
      applySelfHostedMigrations({ migrationDirectory: directory, run: async () => "", log() {}, readRows: async () => [{ version: "001" }] }),
      /ledger_after_apply_mismatch/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the CLI accepts only check and apply and prints a code, not an error object", () => {
  const { root, directory } = migrationsFixture({ "001_one.sql": "select 1;\n" });
  try {
    const result = spawnSync(process.execPath, ["scripts/selfhosted-schema-ledger.mjs", "plan"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, EVO_RELEASE_REPO: root },
      timeout: 30_000,
    });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "selfhosted schema ledger failed: mode_invalid\n");
    void directory;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
