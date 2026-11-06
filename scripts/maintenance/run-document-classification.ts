import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, writeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createDocumentClassificationDependencies, DocumentClassificationBatchError, parseDocumentClassificationArguments,
  PlatformSupabaseBackendConfigurationError, runDocumentClassification,
  type ClassificationDependencies, type ClassificationOptions, type ClassificationSummary,
} from "../../src/lib/server/document-classification-batch.ts";

// Команда владельца: раскладка файлов из amoCRM по видам документов (миграция 333). Запуск на сервере внутри приложения:
//   docker exec evo-crm-app-1 node /app/document-classification-batch.mjs --organization-id <uuid> --dry-run
//   docker exec evo-crm-app-1 node /app/document-classification-batch.mjs --organization-id <uuid>
// В вывод идут только числа: ни имён, ни идентификаторов дел и файлов, ни ключей.
const USAGE = "Usage: node document-classification-batch.mjs --organization-id <uuid> [--dry-run] [--only-explicit-consent] "
  + "[--chunk-size 1..50] [--max-files 1..1000] [--delay-ms 0..60000] [--run-id <id>]\n";
const HARD_DEADLINE_MS = 60 * 60 * 1000;

type Failure = Readonly<{ schema: "evo-document-classification/v1"; error: string }>;
type Runtime = Readonly<{
  createDependencies: () => ClassificationDependencies;
  run: (options: ClassificationOptions, deps: ClassificationDependencies, signal: AbortSignal) => Promise<ClassificationSummary>;
  write: (value: ClassificationSummary | Failure) => void;
  runId: () => string;
}>;
const DEFAULT_RUNTIME: Runtime = {
  createDependencies: () => createDocumentClassificationDependencies(),
  run: runDocumentClassification,
  write: (value) => { writeSync(1, `${JSON.stringify(value)}\n`); },
  runId: () => `classify-${randomUUID()}`,
};
const failure = (error: string): Failure => ({ schema: "evo-document-classification/v1", error });

/** Код выхода: 0 готово, 64 неверные аргументы, 69 недоступно, 75 прогон остановлен до конца, 78 не настроено, 130 прервано. */
export async function runDocumentClassificationCli(args: readonly string[], overrides: Partial<Runtime> = {}): Promise<number> {
  const runtime = { ...DEFAULT_RUNTIME, ...overrides };
  if (args.length === 1 && args[0] === "--help") { writeSync(1, USAGE); return 0; }
  let options: ClassificationOptions;
  try { options = parseDocumentClassificationArguments(args, runtime.runId); }
  catch { runtime.write(failure("invalid_arguments")); return 64; }
  const controller = new AbortController();
  let interrupted = false;
  const stop = () => { interrupted = true; controller.abort(); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const deadline = setTimeout(stop, HARD_DEADLINE_MS);
  try {
    const summary = await runtime.run(options, runtime.createDependencies(), controller.signal);
    runtime.write(summary);
    return summary.stopped === "completed" || summary.stopped === "no_candidates" ? 0 : 75;
  } catch (error) {
    if (interrupted) { runtime.write(failure("interrupted")); return 130; }
    if (error instanceof DocumentClassificationBatchError && (error.code === "provider_not_configured" || error.code === "backend_not_configured")) {
      runtime.write(failure(error.code)); return 78;
    }
    if (error instanceof DocumentClassificationBatchError && error.code === "run_in_progress") { runtime.write(failure("run_in_progress")); return 75; }
    if (error instanceof PlatformSupabaseBackendConfigurationError) { runtime.write(failure("backend_not_configured")); return 78; }
    runtime.write(failure("unavailable")); return 69;
  } finally {
    clearTimeout(deadline);
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runDocumentClassificationCli(process.argv.slice(2));
}
