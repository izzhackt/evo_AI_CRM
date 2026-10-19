#!/usr/bin/env node

// Ledger и миграции self-hosted Supabase без Management API и без открытого порта базы
// (docs/runbooks/selfhosted-cutover.md). Вызывается из evo-schema-ledger.yml в режиме
// EVO_SUPABASE_TARGET=selfhosted. Режимы:
//   check — только прочитать леджер и напечатать расхождение (как облачный шаг чтения);
//   apply — сухой прогон, затем недостающие файлы по порядку, затем повторное чтение.
// Применение повторяет `supabase db push`: файл миграции и запись о нём в
// supabase_migrations.schema_migrations выполняются одним вызовом psql внутри
// begin … commit; миграция со своим begin/commit ведёт себя так же, как под CLI.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expectedMigrationVersions,
  normalizeRemoteMigrationVersions,
} from "./fast-release-ledger-gate.mjs";
import {
  MIGRATION_APPLY_COMMAND,
  readSelfHostedLedgerRows,
  runSelfHostedRemote,
} from "./lib/selfhosted-database.mjs";

const MIGRATION_FILE = /^(\d{3})_([a-z0-9_]+)\.sql$/u;
const MAX_MIGRATION_BYTES = 8 * 1024 * 1024;

export class SchemaLedgerError extends Error {
  constructor(code) {
    super(code);
    this.name = "SchemaLedgerError";
    this.code = code;
  }
}

const fail = (code) => {
  throw new SchemaLedgerError(code);
};

function migrationFiles(directory) {
  const files = new Map();
  for (const name of readdirSync(directory)) {
    const match = MIGRATION_FILE.exec(name);
    if (match) files.set(match[1], { version: match[1], name: match[2], file: name });
  }
  return files;
}

/**
 * Недостающий хвост: самая длинная общая цепочка 001…N у леджера базы и дерева,
 * остальное дерево — к применению. Леджер базы длиннее дерева или с другими
 * версиями — отказ (normalizeRemoteMigrationVersions уже требует 001…N подряд).
 */
export function pendingVersions(localVersions, remoteVersions) {
  if (
    remoteVersions.length > localVersions.length ||
    remoteVersions.some((version, index) => version !== localVersions[index])
  ) {
    fail("ledger_not_a_prefix_of_the_release_tree");
  }
  return localVersions.slice(remoteVersions.length);
}

/**
 * Один вызов psql на файл. Запись в леджер — в той же транзакции. Версия и имя
 * проверены регулярным выражением имени файла, поэтому в SQL попадают только
 * цифры и [a-z0-9_]. Завершающая «;» закрывает последнюю команду файла.
 */
export function buildMigrationSql({ version, name }, content) {
  if (!/^\d{3}$/u.test(version) || !/^[a-z0-9_]+$/u.test(name)) fail("migration_name_invalid");
  if (typeof content !== "string" || content.includes("\0")) fail("migration_content_invalid");
  return [
    "begin;",
    content.endsWith("\n") ? content.slice(0, -1) : content,
    ";",
    `insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}');`,
    "commit;",
    "",
  ].join("\n");
}

async function readRemoteVersions(readRows) {
  return normalizeRemoteMigrationVersions(await readRows());
}

function printLedgerSummary(log, local, remote) {
  const remoteSet = new Set(remote);
  const localSet = new Set(local);
  log(`== локальные миграции: ${local.length} (по ${local.at(-1)})`);
  log(`== применено в базе: ${remote.length} (по ${remote.at(-1) ?? ""})`);
  log("== недостающие в базе:");
  log(`${local.filter((version) => !remoteSet.has(version)).join(" ")} `);
  log("== лишние в базе (должно быть пусто):");
  log(`${remote.filter((version) => !localSet.has(version)).join(" ")} `);
}

export async function checkSelfHostedLedger({
  migrationDirectory,
  readRows = readSelfHostedLedgerRows,
  log = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  const local = expectedMigrationVersions(migrationDirectory);
  const remote = await readRemoteVersions(readRows);
  printLedgerSummary(log, local, remote);
  // Как облачный шаг чтения: расхождение печатается, но шаг не падает.
  return { local, remote };
}

export async function applySelfHostedMigrations({
  migrationDirectory,
  readRows = readSelfHostedLedgerRows,
  run = runSelfHostedRemote,
  log = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  const local = expectedMigrationVersions(migrationDirectory);
  const files = migrationFiles(migrationDirectory);
  const before = await readRemoteVersions(readRows);
  const pending = pendingVersions(local, before);
  log("== dry-run ==");
  printLedgerSummary(log, local, before);
  log(`к применению: ${pending.length === 0 ? "ничего" : pending.join(" ")}`);
  if (pending.length === 0) {
    log("== леджер после применения ==");
    log(before.join(" "));
    return { applied: [], ledger: before };
  }
  const prepared = pending.map((version) => {
    const entry = files.get(version);
    if (!entry) fail("migration_file_missing");
    const content = readFileSync(join(migrationDirectory, entry.file), "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_MIGRATION_BYTES) fail("migration_too_large");
    return { entry, sql: buildMigrationSql(entry, content) };
  });
  log("== apply ==");
  const applied = [];
  for (const { entry, sql } of prepared) {
    try {
      await run(MIGRATION_APPLY_COMMAND, {
        input: sql,
        timeoutMs: 30 * 60_000,
        // Журнал Actions публичный: psql запущен с VERBOSITY=sqlstate, поэтому в stderr только
        // код SQLSTATE и номер строки, без текста ошибки и значений строк. Подробности — на
        // сервере тем же файлом (runbook, «Если миграция не применилась»).
        onStderr: (text) => process.stderr.write(text.endsWith("\n") ? text : `${text}\n`),
      });
    } catch {
      log(`миграция ${entry.version}_${entry.name} не применена`);
      fail("migration_apply_failed");
    }
    applied.push(entry.version);
    log(`применена ${entry.version}_${entry.name}`);
  }
  const after = await readRemoteVersions(readRows);
  if (after.join("\0") !== local.join("\0")) fail("ledger_after_apply_mismatch");
  log("== леджер после применения ==");
  log(after.join(" "));
  return { applied, ledger: after };
}

async function main(argv) {
  const mode = argv[0];
  const migrationDirectory = resolve(process.env.EVO_RELEASE_REPO ?? ".", "supabase/migrations");
  if (mode === "check") {
    await checkSelfHostedLedger({ migrationDirectory });
  } else if (mode === "apply") {
    await applySelfHostedMigrations({ migrationDirectory });
  } else {
    fail("mode_invalid");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`selfhosted schema ledger failed: ${error instanceof SchemaLedgerError ? error.code : "unexpected"}\n`);
    process.exitCode = 2;
  });
}
