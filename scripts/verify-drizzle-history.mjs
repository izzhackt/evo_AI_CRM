#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";

export const DRIZZLE_MIGRATIONS_SCHEMA = "drizzle";
export const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";
export const DRIZZLE_MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../drizzle/", import.meta.url),
);

export class DrizzleHistoryError extends Error {
  constructor(message) {
    super(message);
    this.name = "DrizzleHistoryError";
  }
}

export function readDatabaseUrl(environment = process.env) {
  const value = environment.DATABASE_URL;
  if (!value) {
    throw new DrizzleHistoryError("DATABASE_URL must be set for database commands.");
  }
  if (value !== value.trim()) {
    throw new DrizzleHistoryError(
      "DATABASE_URL must not contain leading or trailing whitespace.",
    );
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new DrizzleHistoryError("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new DrizzleHistoryError(
      "DATABASE_URL must use the postgres or postgresql scheme.",
    );
  }
  if (!parsed.username || !parsed.password || !parsed.hostname || parsed.pathname === "/") {
    throw new DrizzleHistoryError(
      "DATABASE_URL must include a user, password, host and database name.",
    );
  }

  return value;
}

function databaseErrorCode(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  return typeof code === "string" && /^[A-Z0-9]{3,10}$/.test(code) ? code : null;
}

export function formatSafeCliError(error, safeMessage) {
  if (error instanceof DrizzleHistoryError) {
    return error.message;
  }

  const code = databaseErrorCode(error);
  return code ? `${safeMessage} (database error ${code}).` : `${safeMessage}.`;
}

async function readExpectedMigrations(migrationsFolder) {
  let migrations;
  let journal;

  try {
    migrations = readMigrationFiles({ migrationsFolder });
    journal = JSON.parse(
      await readFile(path.join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    );
  } catch {
    throw new DrizzleHistoryError(
      "Committed Drizzle migration files or their journal are missing or invalid.",
    );
  }

  if (!Array.isArray(journal?.entries) || journal.entries.length !== migrations.length) {
    throw new DrizzleHistoryError(
      "Committed Drizzle migration files do not match their journal.",
    );
  }
  if (migrations.length === 0) {
    throw new DrizzleHistoryError("No committed Drizzle migrations were found.");
  }

  const seenTags = new Set();
  let previousTimestamp = null;

  return migrations.map((migration, index) => {
    const journalEntry = journal.entries[index];
    const tag = journalEntry?.tag;
    const timestamp = migration.folderMillis;

    if (typeof tag !== "string" || tag.length === 0 || seenTags.has(tag)) {
      throw new DrizzleHistoryError(
        `Committed Drizzle migration ${index + 1} has an invalid or duplicate tag.`,
      );
    }
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new DrizzleHistoryError(
        `Committed Drizzle migration ${index + 1} has an invalid timestamp.`,
      );
    }
    if (previousTimestamp !== null && timestamp <= previousTimestamp) {
      throw new DrizzleHistoryError(
        "Committed Drizzle migration timestamps must be strictly increasing.",
      );
    }
    if (typeof migration.hash !== "string" || !/^[a-f0-9]{64}$/.test(migration.hash)) {
      throw new DrizzleHistoryError(
        `Committed Drizzle migration ${index + 1} has an invalid content hash.`,
      );
    }

    seenTags.add(tag);
    previousTimestamp = timestamp;
    return {
      hash: migration.hash,
      tag,
      timestamp: BigInt(timestamp).toString(),
    };
  });
}

export async function validateCommittedDrizzleMigrations(
  migrationsFolder = DRIZZLE_MIGRATIONS_FOLDER,
) {
  const expected = await readExpectedMigrations(migrationsFolder);
  return { migrationCount: expected.length };
}

function normalizeDatabaseInteger(value) {
  if (typeof value === "bigint") {
    return value >= 0n ? value.toString() : null;
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value).toString();
  }
  return null;
}

async function readAppliedMigrations(client) {
  try {
    return await client`
      select id, hash, created_at
      from drizzle.__drizzle_migrations
      order by id asc
    `;
  } catch (error) {
    const code = databaseErrorCode(error);
    if (code === "42P01" || code === "3F000") {
      throw new DrizzleHistoryError(
        "The Drizzle migration journal is missing from the database; run db:migrate.",
      );
    }
    throw error;
  }
}

function assertExactHistory(expected, applied) {
  if (applied.length !== expected.length) {
    throw new DrizzleHistoryError(
      `Database migration count is ${applied.length}; expected exactly ${expected.length}.`,
    );
  }

  for (let index = 0; index < expected.length; index += 1) {
    const expectedMigration = expected[index];
    const appliedMigration = applied[index];
    const appliedTimestamp = normalizeDatabaseInteger(appliedMigration?.created_at);

    if (appliedMigration?.hash !== expectedMigration.hash) {
      throw new DrizzleHistoryError(
        `Database migration ${index + 1} (${expectedMigration.tag}) has an unexpected hash or order.`,
      );
    }
    if (appliedTimestamp !== expectedMigration.timestamp) {
      throw new DrizzleHistoryError(
        `Database migration ${index + 1} (${expectedMigration.tag}) has an unexpected timestamp or order.`,
      );
    }
  }
}

export async function verifyDrizzleHistory({
  connectionString = readDatabaseUrl(),
  migrationsFolder = DRIZZLE_MIGRATIONS_FOLDER,
} = {}) {
  const expected = await readExpectedMigrations(migrationsFolder);
  const client = postgres(connectionString, {
    idle_timeout: 5,
    max: 1,
    onnotice: () => undefined,
  });

  try {
    const applied = await readAppliedMigrations(client);
    assertExactHistory(expected, applied);
    return { migrationCount: expected.length };
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function main() {
  const result = await verifyDrizzleHistory();
  console.log(
    `Drizzle migration history matches ${result.migrationCount} committed migration(s).`,
  );
}

const entryUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(formatSafeCliError(error, "Drizzle migration verification failed"));
    process.exitCode = 1;
  });
}
