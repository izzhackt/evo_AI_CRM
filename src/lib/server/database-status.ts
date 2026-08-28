import "server-only";

import { eq } from "drizzle-orm";

import {
  DATABASE_CONTRACT_AUTHORITY,
  DATABASE_CONTRACT_ROW_ID,
  DATABASE_CONTRACT_VERSION,
  evoDatabaseContract,
} from "../../db/schema/index.ts";
import { getDatabase } from "./database.ts";
import { DatabaseConfigError } from "./database-config.ts";

type DatabaseStatusCode =
  | "database_configuration_missing"
  | "database_configuration_invalid"
  | "database_migration_required"
  | "database_contract_mismatch"
  | "database_unavailable";

export type DatabaseStatus =
  | {
      ok: true;
      status: "ready";
      database: "postgresql";
      contractVersion: number;
    }
  | {
      ok: false;
      status: "blocked";
      database: "postgresql";
      code: DatabaseStatusCode;
    };

function isSchemaMissingError(error: unknown): boolean {
  let candidate = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) {
      return false;
    }
    if (
      "code" in candidate &&
      (candidate.code === "42P01" || candidate.code === "3F000")
    ) {
      return true;
    }
    candidate = "cause" in candidate ? candidate.cause : undefined;
  }
  return false;
}

export async function readDatabaseStatus(): Promise<DatabaseStatus> {
  try {
    const rows = await getDatabase()
      .select()
      .from(evoDatabaseContract)
      .where(eq(evoDatabaseContract.id, DATABASE_CONTRACT_ROW_ID))
      .limit(1);

    const contract = rows[0];
    if (!contract) {
      return {
        ok: false,
        status: "blocked",
        database: "postgresql",
        code: "database_migration_required",
      };
    }

    if (
      contract.authority !== DATABASE_CONTRACT_AUTHORITY ||
      contract.version !== DATABASE_CONTRACT_VERSION
    ) {
      return {
        ok: false,
        status: "blocked",
        database: "postgresql",
        code: "database_contract_mismatch",
      };
    }

    return {
      ok: true,
      status: "ready",
      database: "postgresql",
      contractVersion: DATABASE_CONTRACT_VERSION,
    };
  } catch (error) {
    if (error instanceof DatabaseConfigError) {
      return {
        ok: false,
        status: "blocked",
        database: "postgresql",
        code: error.code,
      };
    }

    if (isSchemaMissingError(error)) {
      return {
        ok: false,
        status: "blocked",
        database: "postgresql",
        code: "database_migration_required",
      };
    }

    return {
      ok: false,
      status: "blocked",
      database: "postgresql",
      code: "database_unavailable",
    };
  }
}
