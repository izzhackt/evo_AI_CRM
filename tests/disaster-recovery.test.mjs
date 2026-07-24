import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { assertSafeDestination, createVerifiedBackup, verifyBackup } from "../scripts/backup-sqlite.mjs";

test("rejects production, broad, relative, and missing destinations", () => {
  for (const path of ["/", "/tmp", "/var/tmp", "/tmp/recovery.db", "/var/tmp/recovery.db", "/opt/evo-crm/recovery.db", "/opt/evo-inbox/x", "relative.db", ""]) {
    assert.throws(() => assertSafeDestination(path));
  }
});

test("creates a private online backup with checksum manifest and full verification", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-dr-"));
  chmodSync(root, 0o700);
  const source = join(root, "source.db");
  const destination = join(root, "isolated", "restored.db");
  const db = new Database(source);
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO records(value) VALUES ('protected');");
  db.close();

  const result = await createVerifiedBackup({ source, destination, store: "test-store" });
  assert.equal(result.manifest.verification.integrityCheck, "ok");
  assert.equal(result.manifest.verification.foreignKeyCheck, "ok");
  assert.equal(result.manifest.verification.tableCount, 1);
  assert.equal(statSync(destination).mode & 0o777, 0o600);
  assert.equal(statSync(result.manifestPath).mode & 0o777, 0o600);
  assert.equal(verifyBackup({ artifact: destination, manifestPath: result.manifestPath }).verification.tableCount, 1);
});

test("requires a complete manifest and rejects checksum drift", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-dr-"));
  const source = join(root, "source.db");
  const destination = join(root, "isolated", "restored.db");
  const db = new Database(source);
  db.exec("CREATE TABLE records (id INTEGER PRIMARY KEY)");
  db.close();
  const result = await createVerifiedBackup({ source, destination, store: "test-store" });

  assert.throws(() => verifyBackup({ artifact: destination, manifestPath: join(root, "missing.json") }));
  const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
  delete manifest.sha256;
  writeFileSync(result.manifestPath, JSON.stringify(manifest));
  assert.throws(() => verifyBackup({ artifact: destination, manifestPath: result.manifestPath }), /missing sha256/);
});

test("protected-volume helper rejects production destinations before reading source", () => {
  let error;
  try {
    execFileSync("sh", ["scripts/backup-protected-volume.sh", "/tmp", "/opt/evo-crm/backup.tar", "waha"], { stdio: "pipe" });
  } catch (caught) {
    error = caught;
  }
  assert.equal(error?.status, 66);
});

test("failed backup never changes an existing shared parent mode", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-parent-mode-"));
  chmodSync(root, 0o755);
  const source = join(root, "source.db");
  const db = new Database(source);
  db.exec("CREATE TABLE records (id INTEGER PRIMARY KEY)");
  db.close();
  assert.rejects(
    createVerifiedBackup({ source, destination: join(root, "backup.db"), store: "test" }),
    /mode 0700/,
  );
  assert.equal(statSync(root).mode & 0o777, 0o755);
});

test("protected-volume helper creates private archive and complete manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-volume-dr-"));
  const source = join(root, "source");
  const destination = join(root, "isolated", "state.tar");
  mkdirSync(source);
  writeFileSync(join(source, "state.bin"), "protected");
  execFileSync("sh", ["scripts/backup-protected-volume.sh", source, destination, "test-state"], { stdio: "pipe" });
  assert.equal(statSync(join(root, "isolated")).mode & 0o777, 0o700);
  assert.equal(statSync(destination).mode & 0o777, 0o600);
  assert.equal(statSync(`${destination}.manifest`).mode & 0o777, 0o600);
  const manifest = readFileSync(`${destination}.manifest`, "utf8");
  for (const field of ["format_version=1", "sha256=", "bytes=", "entries=", "archive_list_verified=true"]) {
    assert.match(manifest, new RegExp(field));
  }
});

test("backup tools contain no command that prints secret values", () => {
  const sqlite = readFileSync("scripts/backup-sqlite.mjs", "utf8");
  const volume = readFileSync("scripts/backup-protected-volume.sh", "utf8");
  const settings = readFileSync("scripts/verify-restored-settings.mjs", "utf8");
  const release = readFileSync("scripts/backup-release-config.sh", "utf8");
  for (const forbidden of ["printenv", "env |", "set -x", "cat .env", "docker inspect --format='{{json .Config.Env}}'"]) {
    assert.equal(
      sqlite.includes(forbidden) || volume.includes(forbidden) || settings.includes(forbidden) || release.includes(forbidden),
      false,
      forbidden,
    );
  }
  assert.equal(settings.includes("console.log(plaintext"), false);
  assert.match(settings, /plaintextPrinted: false/);
});

test("release-config helper rejects a production destination and unapproved source root", () => {
  for (const args of [
    ["/opt/evo-crm/config.tar", "config", "/opt/evo-crm/.env.production"],
    [join(tmpdir(), "isolated", "config.tar"), "config", "/etc/passwd"],
  ]) {
    let error;
    try {
      execFileSync("sh", ["scripts/backup-release-config.sh", ...args], { stdio: "pipe" });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error?.status > 0);
  }
});
