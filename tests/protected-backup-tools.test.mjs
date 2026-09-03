import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("protected-volume helper rejects production destinations before reading source", () => {
  let error;
  try {
    execFileSync("sh", ["scripts/backup-protected-volume.sh", "/tmp", "/opt/evo-crm/backup.tar", "waha"], {
      stdio: "pipe",
    });
  } catch (caught) {
    error = caught;
  }
  assert.equal(error?.status, 66);
});

test("protected-volume helper creates private archive and complete manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-volume-dr-"));
  const source = join(root, "source");
  const destination = join(root, "isolated", "state.tar");
  mkdirSync(source);
  writeFileSync(join(source, "state.bin"), "protected");
  execFileSync("sh", ["scripts/backup-protected-volume.sh", source, destination, "test-state"], {
    stdio: "pipe",
  });
  assert.equal(statSync(join(root, "isolated")).mode & 0o777, 0o700);
  assert.equal(statSync(destination).mode & 0o777, 0o600);
  assert.equal(statSync(`${destination}.manifest`).mode & 0o777, 0o600);
  const manifest = readFileSync(`${destination}.manifest`, "utf8");
  for (const field of ["format_version=1", "sha256=", "bytes=", "entries=", "archive_list_verified=true"]) {
    assert.match(manifest, new RegExp(field));
  }
});

test("retained backup tools contain no command that prints secret values", () => {
  const tools = [
    readFileSync("scripts/backup-protected-volume.sh", "utf8"),
    readFileSync("scripts/backup-release-config.sh", "utf8"),
  ];
  for (const forbidden of [
    "printenv",
    "env |",
    "set -x",
    "cat .env",
    "docker inspect --format='{{json .Config.Env}}'",
  ]) {
    assert.equal(tools.some((source) => source.includes(forbidden)), false, forbidden);
  }
});

test("release-config helper rejects production destinations and unapproved source roots", () => {
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
