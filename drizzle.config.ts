import { defineConfig } from "drizzle-kit";

function readDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error("DATABASE_URL must be set for Drizzle commands");
  }
  if (value !== value.trim()) {
    throw new Error("DATABASE_URL must not contain leading or trailing whitespace");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid URL");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql scheme");
  }
  if (!parsed.username || !parsed.password || !parsed.hostname || parsed.pathname === "/") {
    throw new Error("DATABASE_URL must include user, password, host and database name");
  }

  return value;
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/*.ts",
  out: "./drizzle",
  migrations: {
    schema: "drizzle",
    table: "__drizzle_migrations",
  },
  dbCredentials: {
    url: readDatabaseUrl(),
  },
});
