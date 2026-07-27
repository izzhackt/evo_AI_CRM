import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { verifyBackup } from "./backup-sqlite.mjs";

const MIGRATION_ID = "p1a-visa-role-to-curator-v1";

function fail(message) {
  throw new Error(message);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function assertPrivateOutput(path) {
  if (!path || !isAbsolute(path)) fail("report path must be absolute");
  const output = resolve(path);
  if (existsSync(output)) fail("report path already exists");

  const parent = dirname(output);
  if (!existsSync(parent)) fail("report parent directory must already exist");
  const parentStat = statSync(parent);
  if (
    !parentStat.isDirectory()
    || (parentStat.mode & 0o777) !== 0o700
    || parentStat.uid !== process.getuid()
  ) {
    fail("report parent directory must be owned by the current user with mode 0700");
  }
  return output;
}

function assertReadableDatabase(source) {
  if (!source || !isAbsolute(source)) fail("SQLite source must be an absolute path");
  const resolved = resolve(source);
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    fail("SQLite source does not exist");
  }
  return resolved;
}

function assertPrivateFile(path, label) {
  if (!path || !isAbsolute(path)) fail(`${label} path must be absolute`);
  const resolved = resolve(path);
  if (!existsSync(resolved)) fail(`${label} does not exist`);
  const file = statSync(resolved);
  if (!file.isFile() || (file.mode & 0o777) !== 0o600 || file.uid !== process.getuid()) {
    fail(`${label} must be owned by the current user with mode 0600`);
  }
  return resolved;
}

function readPrivateJson(path, label) {
  const resolved = assertPrivateFile(path, label);
  return JSON.parse(readFileSync(resolved, "utf8"));
}

function assertDatabaseIntegrity(database) {
  const integrity = database.pragma("integrity_check").map((row) => Object.values(row)[0]);
  if (integrity.length !== 1 || integrity[0] !== "ok") {
    fail("SQLite integrity_check failed");
  }
  if (database.pragma("foreign_key_check").length !== 0) {
    fail("SQLite foreign_key_check failed");
  }
}

function userReferenceColumns(database) {
  const tables = database
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  const references = [];
  for (const { name } of tables) {
    const foreignKeys = database.pragma(`foreign_key_list(${quoteIdentifier(name)})`);
    for (const foreignKey of foreignKeys) {
      if (foreignKey.table === "users" && foreignKey.to === "id") {
        references.push({ table: name, column: foreignKey.from });
      }
    }
  }
  return references.sort(
    (left, right) =>
      left.table.localeCompare(right.table) || left.column.localeCompare(right.column),
  );
}

function collectInventory(database) {
  assertDatabaseIntegrity(database);
  const userRoleState = database
    .prepare("SELECT id, role FROM users ORDER BY id")
    .all()
    .map(({ id, role }) => ({ userId: id, role }));
  const visaUsers = database
    .prepare("SELECT id FROM users WHERE role = 'visa' ORDER BY id")
    .all();
  const referenceColumns = userReferenceColumns(database);

  const users = visaUsers.map(({ id }) => ({
    userId: id,
    roleBefore: "visa",
    roleAfter: "curator",
    references: referenceColumns.map(({ table, column }) => ({
      table,
      column,
      count: database
        .prepare(
          `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(column)} = ?`,
        )
        .pluck()
        .get(id),
    })),
  }));

  return {
    formatVersion: 1,
    migrationId: MIGRATION_ID,
    sourceRole: "visa",
    targetRole: "curator",
    schemaVersion: database.pragma("schema_version", { simple: true }),
    userVersion: database.pragma("user_version", { simple: true }),
    visaUserCount: users.length,
    userRoleStateSha256: createHash("sha256")
      .update(JSON.stringify(userRoleState))
      .digest("hex"),
    users,
  };
}

export function createInventoryReport({ source, reportPath }) {
  const databasePath = assertReadableDatabase(source);
  const output = assertPrivateOutput(reportPath);
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  let inventory;
  try {
    inventory = collectInventory(database);
  } finally {
    database.close();
  }

  const inventorySha256 = createHash("sha256")
    .update(JSON.stringify(inventory))
    .digest("hex");
  const report = { ...inventory, inventorySha256 };
  const descriptor = openSync(output, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(report, null, 2)}\n`);
  } finally {
    closeSync(descriptor);
  }
  return report;
}

function inventoryFromReport(report) {
  const { inventorySha256, ...inventory } = report;
  const actualSha256 = createHash("sha256")
    .update(JSON.stringify(inventory))
    .digest("hex");
  if (!inventorySha256 || inventorySha256 !== actualSha256) {
    fail("inventory report checksum is invalid");
  }
  if (
    inventory.formatVersion !== 1
    || inventory.migrationId !== MIGRATION_ID
    || inventory.sourceRole !== "visa"
    || inventory.targetRole !== "curator"
    || !Array.isArray(inventory.users)
    || inventory.visaUserCount !== inventory.users.length
  ) {
    fail("inventory report format is invalid");
  }
  return { inventory, inventorySha256 };
}

function assertSameInventory(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(message);
}

function installRoleGuards(database) {
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS users_role_insert_guard
    BEFORE INSERT ON users
    WHEN NEW.role NOT IN ('admin', 'sales', 'curator', 'finance', 'client')
    BEGIN
      SELECT RAISE(ABORT, 'unsupported user role');
    END;

    CREATE TRIGGER IF NOT EXISTS users_role_update_guard
    BEFORE UPDATE OF role ON users
    WHEN NEW.role NOT IN ('admin', 'sales', 'curator', 'finance', 'client')
    BEGIN
      SELECT RAISE(ABORT, 'unsupported user role');
    END;
  `);
}

export function applyVisaRoleMigration({
  source,
  reportPath,
  confirm,
  backupArtifact,
  backupManifest,
  receiptPath,
}) {
  if (!backupArtifact || !backupManifest) {
    fail("verified backup artifact and manifest are required");
  }
  const databasePath = assertReadableDatabase(source);
  const report = readPrivateJson(reportPath, "inventory report");
  const { inventory, inventorySha256 } = inventoryFromReport(report);
  if (!confirm || confirm !== inventorySha256) {
    fail("explicit inventory checksum confirmation is required");
  }
  if (inventory.visaUserCount === 0) {
    fail("inventory contains no legacy visa users; apply is not required");
  }

  const verifiedBackupArtifact = assertPrivateFile(backupArtifact, "backup artifact");
  readPrivateJson(backupManifest, "backup manifest");
  const verifiedBackup = verifyBackup({
    artifact: verifiedBackupArtifact,
    manifestPath: backupManifest,
  });
  if (verifiedBackup.manifest.store !== "main-crm") {
    fail("backup manifest store must be main-crm");
  }
  const backupDatabase = new Database(verifiedBackupArtifact, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const backupInventory = collectInventory(backupDatabase);
    assertSameInventory(
      { ...backupInventory, schemaVersion: inventory.schemaVersion },
      inventory,
      "verified backup does not match the reviewed inventory",
    );
  } finally {
    backupDatabase.close();
  }

  const output = assertPrivateOutput(receiptPath);
  const pendingReceipt = {
    formatVersion: 1,
    migrationId: MIGRATION_ID,
    status: "pending",
    inventorySha256,
  };
  const descriptor = openSync(output, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(pendingReceipt, null, 2)}\n`);
  } finally {
    closeSync(descriptor);
  }

  const database = new Database(databasePath, { fileMustExist: true });
  database.pragma("foreign_keys = ON");
  const appliedAt = new Date().toISOString();
  try {
    const migrate = database.transaction(() => {
      assertSameInventory(
        collectInventory(database),
        inventory,
        "current database no longer matches the reviewed inventory",
      );
      database.exec(`
        CREATE TABLE IF NOT EXISTS staff_role_migrations (
          migration_id TEXT PRIMARY KEY,
          source_role TEXT NOT NULL,
          target_role TEXT NOT NULL,
          migrated_user_count INTEGER NOT NULL,
          inventory_sha256 TEXT NOT NULL,
          backup_sha256 TEXT NOT NULL,
          applied_at TEXT NOT NULL
        )
      `);

      const update = database.prepare(
        "UPDATE users SET role = 'curator' WHERE id = ? AND role = 'visa'",
      );
      let migratedUserCount = 0;
      for (const user of inventory.users) {
        migratedUserCount += update.run(user.userId).changes;
      }
      if (migratedUserCount !== inventory.visaUserCount) {
        fail("migrated user count does not match the reviewed inventory");
      }
      if (database.prepare("SELECT COUNT(*) FROM users WHERE role = 'visa'").pluck().get() !== 0) {
        fail("legacy visa users remain after migration");
      }
      installRoleGuards(database);
      if (database.pragma("foreign_key_check").length !== 0) {
        fail("SQLite foreign_key_check failed after migration");
      }

      database
        .prepare(`
          INSERT INTO staff_role_migrations (
            migration_id, source_role, target_role, migrated_user_count,
            inventory_sha256, backup_sha256, applied_at
          ) VALUES (?, 'visa', 'curator', ?, ?, ?, ?)
        `)
        .run(
          MIGRATION_ID,
          migratedUserCount,
          inventorySha256,
          verifiedBackup.manifest.sha256,
          appliedAt,
        );
      return migratedUserCount;
    });
    const migratedUserCount = migrate.immediate();
    const receipt = {
      formatVersion: 1,
      migrationId: MIGRATION_ID,
      status: "applied",
      inventorySha256,
      backupSha256: verifiedBackup.manifest.sha256,
      migratedUserCount,
      appliedAt,
    };
    writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    return receipt;
  } finally {
    database.close();
  }
}

function parseArguments(values) {
  return Object.fromEntries(
    values.map((value) => {
      const separator = value.indexOf("=");
      if (separator < 1) fail("arguments must use key=value");
      return [value.slice(0, separator), value.slice(separator + 1)];
    }),
  );
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  const command = args.command || "inventory";
  if (command === "inventory") {
    const report = createInventoryReport({
      source: args.source,
      reportPath: args.report,
    });
    console.log(
      JSON.stringify({
        status: "inventory_ready",
        migrationId: report.migrationId,
        visaUserCount: report.visaUserCount,
        inventorySha256: report.inventorySha256,
      }),
    );
    return;
  }
  if (command === "apply") {
    const receipt = applyVisaRoleMigration({
      source: args.source,
      reportPath: args.report,
      confirm: args.confirm,
      backupArtifact: args.backup,
      backupManifest: args["backup-manifest"],
      receiptPath: args.receipt,
    });
    console.log(JSON.stringify(receipt));
    return;
  }
  fail("unsupported migration command");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    console.error(`visa role migration failed: ${error.message}`);
    process.exitCode = 1;
  }
}
