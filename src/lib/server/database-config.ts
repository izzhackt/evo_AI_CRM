import "server-only";

type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;
type DatabaseConfigErrorCode =
  | "database_configuration_missing"
  | "database_configuration_invalid";

export class DatabaseConfigError extends Error {
  code: DatabaseConfigErrorCode;

  constructor(message: string, code: DatabaseConfigErrorCode) {
    super(message);
    this.name = "DatabaseConfigError";
    this.code = code;
  }
}

export function readDatabaseUrl(environment: Environment = process.env): string {
  const value = environment.DATABASE_URL;
  if (!value) {
    throw new DatabaseConfigError("DATABASE_URL is required", "database_configuration_missing");
  }
  if (value !== value.trim()) {
    throw new DatabaseConfigError(
      "DATABASE_URL must not contain leading or trailing whitespace",
      "database_configuration_invalid",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DatabaseConfigError(
      "DATABASE_URL must be a valid URL",
      "database_configuration_invalid",
    );
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new DatabaseConfigError(
      "DATABASE_URL must use the postgres or postgresql scheme",
      "database_configuration_invalid",
    );
  }
  if (!parsed.username || !parsed.password || !parsed.hostname || parsed.pathname === "/") {
    throw new DatabaseConfigError(
      "DATABASE_URL must include user, password, host and database name",
      "database_configuration_invalid",
    );
  }

  return value;
}
