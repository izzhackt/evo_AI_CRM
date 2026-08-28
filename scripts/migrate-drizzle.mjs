#!/usr/bin/env node

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import {
  DRIZZLE_MIGRATIONS_FOLDER,
  DRIZZLE_MIGRATIONS_SCHEMA,
  DRIZZLE_MIGRATIONS_TABLE,
  formatSafeCliError,
  readDatabaseUrl,
  validateCommittedDrizzleMigrations,
  verifyDrizzleHistory,
} from "./verify-drizzle-history.mjs";

async function applyMigrations(connectionString) {
  const migrationClient = postgres(connectionString, {
    idle_timeout: 5,
    max: 1,
    onnotice: () => undefined,
  });

  try {
    await migrate(drizzle(migrationClient), {
      migrationsFolder: DRIZZLE_MIGRATIONS_FOLDER,
      migrationsSchema: DRIZZLE_MIGRATIONS_SCHEMA,
      migrationsTable: DRIZZLE_MIGRATIONS_TABLE,
    });
  } finally {
    await migrationClient.end({ timeout: 5 });
  }
}

async function main() {
  const connectionString = readDatabaseUrl();

  await validateCommittedDrizzleMigrations();
  await applyMigrations(connectionString);
  const result = await verifyDrizzleHistory({ connectionString });
  console.log(
    `Applied and verified ${result.migrationCount} committed Drizzle migration(s).`,
  );
}

main().catch((error) => {
  console.error(formatSafeCliError(error, "Drizzle migration failed"));
  process.exitCode = 1;
});
