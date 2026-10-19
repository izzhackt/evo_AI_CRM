import { spawn } from "node:child_process";

// Транспорт к базе self-hosted Supabase для CI (docs/runbooks/selfhosted-cutover.md).
// Порт Postgres наружу не открывается и не пробрасывается: ssh выполняет на сервере
// фиксированную команду `docker exec … psql` в контейнере базы. Пользовательские
// значения в командную строку не попадают; тело миграции идёт через stdin.
// Доступ тот же, что у выпуска: алиас `evo-production` настраивает шаг
// «Configure pinned SSH trust» из секретов EVO_DEPLOY_*.

export const SELFHOSTED_SSH_HOST = "evo-production";
export const SELFHOSTED_DB_CONTAINER = "evo-supabase-db";

const PSQL = `docker exec -i ${SELFHOSTED_DB_CONTAINER} psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1`;

/** Только чтение: версии из леджера миграций, по одной в строке. */
export const LEDGER_READ_COMMAND =
  `${PSQL} -A -t -c 'select version from supabase_migrations.schema_migrations order by version'`;

/**
 * SQL читается из stdin. Транзакцией управляет сам вводимый текст (см. buildMigrationSql).
 * VERBOSITY=sqlstate: сообщения сервера сводятся к коду SQLSTATE, чтобы значения строк
 * из текста ошибки не попали в публичный журнал Actions.
 */
export const MIGRATION_APPLY_COMMAND = `${PSQL} -v VERBOSITY=sqlstate -f -`;

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

export class SelfHostedDatabaseError extends Error {
  constructor(code) {
    super(code);
    this.name = "SelfHostedDatabaseError";
    this.code = code;
  }
}

/**
 * Выполняет фиксированную команду на сервере. Возвращает stdout только при коде 0.
 * Текст stderr в ошибку не попадает (он может содержать фрагменты SQL), сообщение
 * ошибки — только код.
 */
export function runSelfHostedRemote(command, {
  input = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl = spawn,
  host = SELFHOSTED_SSH_HOST,
  onStderr = null,
} = {}) {
  if (typeof command !== "string" || command === "") {
    return Promise.reject(new SelfHostedDatabaseError("selfhosted_command_invalid"));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    let child;
    try {
      child = spawnImpl("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "--", host, command], {
        stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch {
      reject(new SelfHostedDatabaseError("selfhosted_remote_unavailable"));
      return;
    }
    const timer = setTimeout(() => {
      finish(new SelfHostedDatabaseError("selfhosted_remote_timeout"));
      child.kill("SIGKILL");
    }, timeoutMs);
    const out = [];
    const err = [];
    let outBytes = 0;
    let errBytes = 0;
    child.stdout.on("data", (chunk) => {
      outBytes += chunk.length;
      if (outBytes > MAX_STDOUT_BYTES) {
        finish(new SelfHostedDatabaseError("selfhosted_remote_output_too_large"));
        child.kill("SIGKILL");
        return;
      }
      out.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      errBytes += chunk.length;
      if (errBytes <= MAX_STDERR_BYTES) err.push(chunk);
    });
    child.on("error", () => finish(new SelfHostedDatabaseError("selfhosted_remote_unavailable")));
    child.on("close", (code) => {
      if (onStderr !== null && err.length > 0) onStderr(Buffer.concat(err).toString("utf8"));
      if (code !== 0) finish(new SelfHostedDatabaseError("selfhosted_remote_failed"));
      else finish(null, Buffer.concat(out).toString("utf8"));
    });
    if (input !== null) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
  });
}

/** Строки леджера в том виде, который ждёт normalizeRemoteMigrationVersions. */
export async function readSelfHostedLedgerRows(run = runSelfHostedRemote) {
  const stdout = await run(LEDGER_READ_COMMAND, { timeoutMs: 30_000 });
  if (typeof stdout !== "string") throw new SelfHostedDatabaseError("selfhosted_ledger_invalid");
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((version) => ({ version }));
}
