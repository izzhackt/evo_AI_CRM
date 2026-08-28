import assert from "node:assert/strict";
import test from "node:test";

import { DatabaseConfigError, readDatabaseConfig } from "../src/lib/server/database.ts";

test("readDatabaseConfig builds a strict Postgres URL from env", () => {
  const config = readDatabaseConfig({
    EVO_POSTGRES_HOST: "127.0.0.1",
    EVO_POSTGRES_PORT: "55432",
    EVO_POSTGRES_DB: "evo_v2",
    EVO_POSTGRES_USER: "evo_v2",
    EVO_POSTGRES_PASSWORD: "secret",
  });

  assert.deepEqual(config, {
    host: "127.0.0.1",
    port: 55432,
    database: "evo_v2",
    user: "evo_v2",
    password: "secret",
    url: "postgresql://evo_v2:secret@127.0.0.1:55432/evo_v2",
  });
});

test("readDatabaseConfig fails closed when a required value is missing", () => {
  assert.throws(
    () =>
      readDatabaseConfig({
        EVO_POSTGRES_HOST: "127.0.0.1",
        EVO_POSTGRES_PORT: "55432",
        EVO_POSTGRES_DB: "evo_v2",
        EVO_POSTGRES_USER: "evo_v2",
      }),
    DatabaseConfigError,
  );
});

test("readDatabaseConfig rejects a non-integer port", () => {
  assert.throws(
    () =>
      readDatabaseConfig({
        EVO_POSTGRES_HOST: "127.0.0.1",
        EVO_POSTGRES_PORT: "not-a-port",
        EVO_POSTGRES_DB: "evo_v2",
        EVO_POSTGRES_USER: "evo_v2",
        EVO_POSTGRES_PASSWORD: "secret",
      }),
    /integer port/,
  );
});
