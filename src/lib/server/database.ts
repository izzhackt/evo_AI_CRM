import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../db/schema/index.ts";
import { readDatabaseUrl } from "./database-config.ts";

type DatabaseSingleton = {
  client?: ReturnType<typeof postgres>;
  database?: ReturnType<typeof drizzle<typeof schema>>;
};

const databaseGlobal = globalThis as typeof globalThis & {
  __evoDatabase?: DatabaseSingleton;
};

function getSingleton(): DatabaseSingleton {
  databaseGlobal.__evoDatabase ??= {};
  return databaseGlobal.__evoDatabase;
}

export function getPostgresClient(): ReturnType<typeof postgres> {
  const singleton = getSingleton();
  if (!singleton.client) {
    singleton.client = postgres(readDatabaseUrl(), {
      connect_timeout: 10,
      idle_timeout: 20,
      max: 10,
    });
  }
  return singleton.client;
}

export function getDatabase(): ReturnType<typeof drizzle<typeof schema>> {
  const singleton = getSingleton();
  if (!singleton.database) {
    singleton.database = drizzle(getPostgresClient(), { schema });
  }
  return singleton.database;
}

export async function closeDatabaseConnections(): Promise<void> {
  const singleton = getSingleton();
  if (singleton.client) {
    await singleton.client.end({ timeout: 5 });
  }
  singleton.client = undefined;
  singleton.database = undefined;
}
