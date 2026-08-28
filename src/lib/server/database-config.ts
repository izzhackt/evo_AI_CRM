import "server-only";

type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;

export class DatabaseConfigError extends Error {
  code = "database_configuration_missing";

  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigError";
  }
}

export function readDatabaseUrl(environment: Environment = process.env): string {
  const value = environment.DATABASE_URL;
  if (!value) {
    throw new DatabaseConfigError("DATABASE_URL is required");
  }
  if (value !== value.trim()) {
    throw new DatabaseConfigError("DATABASE_URL must not contain leading or trailing whitespace");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DatabaseConfigError("DATABASE_URL must be a valid URL");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new DatabaseConfigError("DATABASE_URL must use the postgres or postgresql scheme");
  }
  if (!parsed.username || !parsed.password || !parsed.hostname || parsed.pathname === "/") {
    throw new DatabaseConfigError(
      "DATABASE_URL must include user, password, host and database name",
    );
  }

  return value;
}
