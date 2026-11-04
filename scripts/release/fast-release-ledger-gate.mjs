#!/usr/bin/env node

import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSelfHostedLedgerRows } from "../lib/selfhosted-database.mjs";

export function expectedMigrationVersions(directory) {
  const versions = readdirSync(directory)
    .filter((name) => /^\d{3}_.+\.sql$/u.test(name))
    .map((name) => name.slice(0, 3))
    .sort();
  if (versions.length === 0 || new Set(versions).size !== versions.length) {
    throw new Error("migration source ledger is invalid");
  }
  versions.forEach((version, index) => {
    if (version !== String(index + 1).padStart(3, "0")) {
      throw new Error("migration source ledger is not contiguous");
    }
  });
  return versions;
}

export function normalizeRemoteMigrationVersions(payload) {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error("production migration ledger is invalid");
  }
  const versions = payload.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("production migration ledger is invalid");
    }
    const keys = Object.keys(row);
    if (!keys.includes("version") || keys.some((key) => key !== "version" && key !== "name")) {
      throw new Error("production migration ledger is invalid");
    }
    if (typeof row.version !== "string" || !/^\d{3}$/u.test(row.version)) {
      throw new Error("production migration ledger is invalid");
    }
    if (row.name !== undefined && typeof row.name !== "string") {
      throw new Error("production migration ledger is invalid");
    }
    return row.version;
  });
  versions.forEach((version, index) => {
    if (version !== String(index + 1).padStart(3, "0")) {
      throw new Error("production migration ledger is invalid");
    }
  });
  return versions;
}

function compareLedger(expected, actual) {
  if (actual.join("\0") !== expected.join("\0")) {
    throw new Error("production migration ledger does not match the release tree");
  }
  return {
    ok: true,
    count: actual.length,
    range: `${actual[0]}-${actual.at(-1)}`,
  };
}

// Леджер читается из базы self-hosted Supabase по SSH. Недоступная база останавливает
// выпуск: другого источника леджера нет.
export async function verifySelfHostedMigrationLedger({
  migrationDirectory,
  readRemoteRows = readSelfHostedLedgerRows,
}) {
  const expected = expectedMigrationVersions(migrationDirectory);
  const actual = normalizeRemoteMigrationVersions(await readRemoteRows());
  return compareLedger(expected, actual);
}

async function main() {
  const migrationDirectory = resolve(process.env.EVO_RELEASE_REPO ?? ".", "supabase/migrations");
  const result = await verifySelfHostedMigrationLedger({ migrationDirectory });
  process.stdout.write(JSON.stringify(result) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("production migration ledger gate failed\n");
    process.exitCode = 2;
  });
}
