import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { v2RuntimeState } from "../../db/schema/index.ts";

type Environment = NodeJS.ProcessEnv;

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigError";
  }
}

export type DatabaseConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  url: string;
};

function readRequired(environment: Environment, name: string): string {
  const value = environment[name];
  if (!value) {
    throw new DatabaseConfigError(`${name} is required`);
  }
  if (value !== value.trim()) {
    throw new DatabaseConfigError(`${name} must not contain leading or trailing whitespace`);
  }
  return value;
}

function readPort(environment: Environment, name: string): number {
  const value = readRequired(environment, name);
  if (!/^\d+$/.test(value)) {
    throw new DatabaseConfigError(`${name} must be an integer port`);
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DatabaseConfigError(`${name} must be an integer port`);
  }
  return port;
}

export function readDatabaseConfig(environment: Environment = process.env): DatabaseConfig {
  const user = readRequired(environment, "EVO_POSTGRES_USER");
  const password = readRequired(environment, "EVO_POSTGRES_PASSWORD");
  const host = readRequired(environment, "EVO_POSTGRES_HOST");
  const port = readPort(environment, "EVO_POSTGRES_PORT");
  const database = readRequired(environment, "EVO_POSTGRES_DB");

  return {
    host,
    port,
    database,
    user,
    password,
    url: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`,
  };
}

type DatabaseSingleton = {
  client?: ReturnType<typeof postgres>;
  db?: ReturnType<typeof drizzle>;
};

const databaseSingleton = globalThis as typeof globalThis & {
  __evoV2Database?: DatabaseSingleton;
};

function getSingleton(): DatabaseSingleton {
  if (!databaseSingleton.__evoV2Database) {
    databaseSingleton.__evoV2Database = {};
  }
  return databaseSingleton.__evoV2Database;
}

export function getPostgresClient() {
  const singleton = getSingleton();
  if (singleton.client) {
    return singleton.client;
  }

  const config = readDatabaseConfig();
  singleton.client = postgres(config.url, {
    max: 1,
    prepare: false,
  });
  return singleton.client;
}

export function getDatabase() {
  const singleton = getSingleton();
  if (singleton.db) {
    return singleton.db;
  }

  singleton.db = drizzle(getPostgresClient(), {
    schema: { v2RuntimeState },
  });
  return singleton.db;
}

export async function closeDatabaseConnections(): Promise<void> {
  const singleton = getSingleton();
  if (!singleton.client) {
    return;
  }

  await singleton.client.end({ timeout: 5 });
  singleton.client = undefined;
  singleton.db = undefined;
}

export async function probeDatabaseHealth(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const rows = await getDatabase().select().from(v2RuntimeState).limit(1);
    const row = rows[0];
    if (!row || row.key !== "foundation" || row.value !== "ready") {
      return { ok: false, message: "v2 runtime marker is missing" };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown database error";
    return { ok: false, message };
  }
}
