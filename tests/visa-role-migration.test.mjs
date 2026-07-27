import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import Database from "better-sqlite3";

import { createVerifiedBackup } from "../scripts/backup-sqlite.mjs";
import {
  applyVisaRoleMigration,
  createInventoryReport,
} from "../scripts/migrate-visa-role.mjs";

function createLegacyDatabase(root) {
  const source = join(root, "legacy.db");
  const database = new Database(source);
  database.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT,
      name TEXT,
      phone TEXT,
      role TEXT NOT NULL,
      created_at TEXT
    );
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      manager_id INTEGER REFERENCES users(id),
      curator_id INTEGER REFERENCES users(id)
    );
  `);
  database
    .prepare("INSERT INTO users (id, email, name, phone, role, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(10, "legacy.visa@example.test", "Legacy Visa User", "+996000000010", "visa", "2026-01-01 00:00:00");
  database
    .prepare("INSERT INTO users (id, email, name, phone, role, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(20, "student@example.test", "Test Student", "+996000000020", "client", "2026-01-02 00:00:00");
  database
    .prepare("INSERT INTO clients (id, user_id, manager_id, curator_id) VALUES (?, ?, ?, ?)")
    .run(1, 20, 10, 10);
  database.close();
  return source;
}

test("inventory writes a deterministic private report without changing legacy visa users", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-visa-role-"));
  chmodSync(root, 0o700);
  const source = createLegacyDatabase(root);
  const reportPath = join(root, "inventory.json");

  const report = createInventoryReport({ source, reportPath });

  assert.deepEqual(report, {
    formatVersion: 1,
    migrationId: "p1a-visa-role-to-curator-v1",
    sourceRole: "visa",
    targetRole: "curator",
    schemaVersion: 2,
    userVersion: 0,
    visaUserCount: 1,
    userRoleStateSha256: "fb9f938a0ee5f6a3ce7d3af674484e78ed351e688cc34f25a9b33883f202bd17",
    users: [
      {
        userId: 10,
        roleBefore: "visa",
        roleAfter: "curator",
        references: [
          { table: "clients", column: "curator_id", count: 1 },
          { table: "clients", column: "manager_id", count: 1 },
          { table: "clients", column: "user_id", count: 0 },
        ],
      },
    ],
    inventorySha256: "16c4e728ea960db513026b33db455a950d570afa11189ca148161a94cb77aa65",
  });
  assert.equal(statSync(reportPath).mode & 0o777, 0o600);

  const serialized = readFileSync(reportPath, "utf8");
  assert.equal(serialized, `${JSON.stringify(report, null, 2)}\n`);
  assert.doesNotMatch(serialized, /legacy\.visa@example\.test|Legacy Visa User|\+996000000010/);

  const database = new Database(source);
  try {
    assert.equal(database.prepare("SELECT role FROM users WHERE id = 10").pluck().get(), "visa");
  } finally {
    database.close();
  }
});

test("apply refuses to change a legacy role without a verified backup", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-visa-role-"));
  chmodSync(root, 0o700);
  const source = createLegacyDatabase(root);
  const reportPath = join(root, "inventory.json");
  const report = createInventoryReport({ source, reportPath });

  assert.throws(
    () =>
      applyVisaRoleMigration({
        source,
        reportPath,
        confirm: report.inventorySha256,
        receiptPath: join(root, "receipt.json"),
      }),
    /verified backup artifact and manifest are required/,
  );

  const database = new Database(source);
  try {
    assert.equal(database.prepare("SELECT role FROM users WHERE id = 10").pluck().get(), "visa");
  } finally {
    database.close();
  }
});

test("apply migrates the reviewed inventory transactionally and leaves a private receipt", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-visa-role-"));
  chmodSync(root, 0o700);
  const source = createLegacyDatabase(root);
  const reportPath = join(root, "inventory.json");
  const receiptPath = join(root, "receipt.json");
  const report = createInventoryReport({ source, reportPath });
  const backup = await createVerifiedBackup({
    source,
    destination: join(root, "backups", "pre-migration.db"),
    store: "main-crm",
  });

  const apply = spawnSync(
    process.execPath,
    [
      "scripts/migrate-visa-role.mjs",
      "command=apply",
      `source=${source}`,
      `report=${reportPath}`,
      `confirm=${report.inventorySha256}`,
      `backup=${backup.output}`,
      `backup-manifest=${backup.manifestPath}`,
      `receipt=${receiptPath}`,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(apply.status, 0, apply.stderr);
  const receipt = JSON.parse(apply.stdout);

  assert.equal(receipt.formatVersion, 1);
  assert.equal(receipt.migrationId, "p1a-visa-role-to-curator-v1");
  assert.equal(receipt.status, "applied");
  assert.equal(receipt.inventorySha256, report.inventorySha256);
  assert.equal(receipt.backupSha256, backup.manifest.sha256);
  assert.equal(receipt.migratedUserCount, 1);
  assert.match(receipt.appliedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(statSync(receiptPath).mode & 0o777, 0o600);
  assert.doesNotMatch(
    readFileSync(receiptPath, "utf8"),
    /legacy\.visa@example\.test|Legacy Visa User|\+996000000010/,
  );

  const database = new Database(source);
  try {
    assert.deepEqual(
      database.prepare("SELECT id, role FROM users ORDER BY id").all(),
      [
        { id: 10, role: "curator" },
        { id: 20, role: "client" },
      ],
    );
    assert.deepEqual(
      database.prepare("SELECT user_id, manager_id, curator_id FROM clients WHERE id = 1").get(),
      { user_id: 20, manager_id: 10, curator_id: 10 },
    );
    assert.deepEqual(
      database
        .prepare(
          "SELECT migration_id, source_role, target_role, migrated_user_count, inventory_sha256, backup_sha256 FROM staff_role_migrations",
        )
        .get(),
      {
        migration_id: "p1a-visa-role-to-curator-v1",
        source_role: "visa",
        target_role: "curator",
        migrated_user_count: 1,
        inventory_sha256: report.inventorySha256,
        backup_sha256: backup.manifest.sha256,
      },
    );
    assert.deepEqual(database.pragma("foreign_key_check"), []);
    assert.throws(
      () =>
        database
          .prepare("INSERT INTO users (id, email, name, phone, role, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(30, "blocked@example.test", "Blocked", null, "visa", "2026-01-03 00:00:00"),
      /unsupported user role/,
    );
    assert.throws(
      () => database.prepare("UPDATE users SET role = 'visa' WHERE id = 10").run(),
      /unsupported user role/,
    );
  } finally {
    database.close();
  }
});

test("inventory CLI prints only sanitized migration evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "evo-visa-role-"));
  chmodSync(root, 0o700);
  const source = createLegacyDatabase(root);
  const reportPath = join(root, "inventory.json");

  const result = spawnSync(
    process.execPath,
    [
      "scripts/migrate-visa-role.mjs",
      "command=inventory",
      `source=${source}`,
      `report=${reportPath}`,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: "inventory_ready",
    migrationId: "p1a-visa-role-to-curator-v1",
    visaUserCount: 1,
    inventorySha256: "16c4e728ea960db513026b33db455a950d570afa11189ca148161a94cb77aa65",
  });
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /legacy\.visa@example\.test|Legacy Visa User|\+996000000010/,
  );
});

test("apply rejects stale inventory without changing any legacy role", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-visa-role-"));
  chmodSync(root, 0o700);
  const source = createLegacyDatabase(root);
  const reportPath = join(root, "inventory.json");
  const report = createInventoryReport({ source, reportPath });
  const backup = await createVerifiedBackup({
    source,
    destination: join(root, "backups", "pre-migration.db"),
    store: "main-crm",
  });

  const database = new Database(source);
  database
    .prepare("INSERT INTO users (id, email, name, phone, role, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(11, "late@example.test", "Late Legacy User", null, "visa", "2026-01-04 00:00:00");
  database.close();

  const receiptPath = join(root, "stale-receipt.json");
  assert.throws(
    () =>
      applyVisaRoleMigration({
        source,
        reportPath,
        confirm: report.inventorySha256,
        backupArtifact: backup.output,
        backupManifest: backup.manifestPath,
        receiptPath,
      }),
    /current database no longer matches the reviewed inventory/,
  );
  assert.doesNotMatch(readFileSync(receiptPath, "utf8"), /"status": "applied"/);

  const unchanged = new Database(source, { readonly: true });
  try {
    assert.deepEqual(
      unchanged.prepare("SELECT id, role FROM users WHERE role = 'visa' ORDER BY id").all(),
      [
        { id: 10, role: "visa" },
        { id: 11, role: "visa" },
      ],
    );
  } finally {
    unchanged.close();
  }
});

test("apply rejects a tampered report before opening the database for writes", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-visa-role-"));
  chmodSync(root, 0o700);
  const source = createLegacyDatabase(root);
  const reportPath = join(root, "inventory.json");
  const report = createInventoryReport({ source, reportPath });
  const backup = await createVerifiedBackup({
    source,
    destination: join(root, "backups", "pre-migration.db"),
    store: "main-crm",
  });
  const tampered = JSON.parse(readFileSync(reportPath, "utf8"));
  tampered.users[0].userId = 999;
  writeFileSync(reportPath, `${JSON.stringify(tampered, null, 2)}\n`, { mode: 0o600 });

  assert.throws(
    () =>
      applyVisaRoleMigration({
        source,
        reportPath,
        confirm: report.inventorySha256,
        backupArtifact: backup.output,
        backupManifest: backup.manifestPath,
        receiptPath: join(root, "receipt.json"),
      }),
    /inventory report checksum is invalid/,
  );

  const database = new Database(source, { readonly: true });
  try {
    assert.equal(database.prepare("SELECT role FROM users WHERE id = 10").pluck().get(), "visa");
  } finally {
    database.close();
  }
});

test("apply rolls back every role change when one reviewed update fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "evo-visa-role-"));
  chmodSync(root, 0o700);
  const source = createLegacyDatabase(root);
  const database = new Database(source);
  database
    .prepare("INSERT INTO users (id, email, name, phone, role, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(11, "second@example.test", "Second Legacy User", null, "visa", "2026-01-04 00:00:00");
  database.exec(`
    CREATE TRIGGER block_second_legacy_role_update
    BEFORE UPDATE OF role ON users
    WHEN OLD.id = 11
    BEGIN
      SELECT RAISE(ABORT, 'synthetic update failure');
    END;
  `);
  database.close();

  const reportPath = join(root, "inventory.json");
  const report = createInventoryReport({ source, reportPath });
  const backup = await createVerifiedBackup({
    source,
    destination: join(root, "backups", "pre-migration.db"),
    store: "main-crm",
  });

  assert.throws(
    () =>
      applyVisaRoleMigration({
        source,
        reportPath,
        confirm: report.inventorySha256,
        backupArtifact: backup.output,
        backupManifest: backup.manifestPath,
        receiptPath: join(root, "receipt.json"),
      }),
    /synthetic update failure/,
  );

  const rolledBack = new Database(source, { readonly: true });
  try {
    assert.deepEqual(
      rolledBack.prepare("SELECT id, role FROM users WHERE id IN (10, 11) ORDER BY id").all(),
      [
        { id: 10, role: "visa" },
        { id: 11, role: "visa" },
      ],
    );
    assert.equal(
      rolledBack
        .prepare("SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'staff_role_migrations'")
        .pluck()
        .get(),
      0,
    );
  } finally {
    rolledBack.close();
  }
});
