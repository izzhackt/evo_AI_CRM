import assert from "node:assert/strict";
import test from "node:test";

import {
  DatabaseConfigError,
  readDatabaseUrl,
} from "../src/lib/server/database-config.ts";

test("DATABASE_URL is the only accepted application database authority", () => {
  const url = "postgresql://evo:private@127.0.0.1:55432/evo";

  assert.equal(readDatabaseUrl({ DATABASE_URL: url }), url);
  assert.equal(
    readDatabaseUrl({ DATABASE_URL: "postgres://evo:private@database:5432/evo" }),
    "postgres://evo:private@database:5432/evo",
  );
});

test("missing DATABASE_URL fails closed even when legacy database settings exist", () => {
  assert.throws(
    () =>
      readDatabaseUrl({
        EVO_DB_PATH: "/tmp/legacy.sqlite",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        EVO_POSTGRES_HOST: "127.0.0.1",
        EVO_POSTGRES_PASSWORD: "legacy-split-value",
      }),
    (error) => {
      assert.ok(error instanceof DatabaseConfigError);
      assert.equal(error.code, "database_configuration_missing");
      return true;
    },
  );
});

test("DATABASE_URL rejects whitespace, other drivers and incomplete credentials", () => {
  for (const value of [
    " postgresql://evo:private@127.0.0.1:55432/evo",
    "mysql://evo:private@127.0.0.1:3306/evo",
    "postgresql://evo@127.0.0.1:55432/evo",
    "postgresql://evo:private@127.0.0.1:55432/",
  ]) {
    assert.throws(() => readDatabaseUrl({ DATABASE_URL: value }), DatabaseConfigError);
  }
});
