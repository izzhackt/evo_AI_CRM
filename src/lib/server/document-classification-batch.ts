import "server-only";

import { createHash } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import {
  classificationStatus, DOCUMENT_CLASSIFICATION_POLICY, type DocumentClassificationFailure,
} from "../document-classification.ts";
import {
  CLASSIFICATION_MAX_INLINE_BYTES, createGeminiDocumentClassifier, type ClassificationBinding, type ClassificationOutcome,
} from "./document-classification-gemini.ts";
import {
  DocumentRecognitionProviderError, maximumDocumentRecognitionCostMicros, parseDocumentRecognitionProviderConfig,
} from "./gemini-document-recognition.ts";
import { getPlatformSupabaseBackendConfig, PlatformSupabaseBackendConfigurationError } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

// Пакетная команда: раскладка файлов из amoCRM по видам. Работает на сервере, не в браузере. Идемпотентна: уже обработанное
// база не отдаёт повторно, результат повторно не пишется и решение куратора не затрагивает (миграция 333).
// Согласие студента проверяет база (ai_agent_student_ai_allowed, миграция 320) при выборе файлов и ещё раз при записи;
// команда сама ничего не решает о согласии и не отправляет провайдеру файл, которого база ей не отдала.

export const DOCUMENT_CLASSIFICATION_LIMITS = Object.freeze({
  defaultChunk: 10, maxChunk: 50, defaultMaxFiles: 300, maxFiles: 1000, defaultDelayMs: 1500, maxDelayMs: 60_000,
  /** Подряд неудачных обращений к провайдеру, после которых прогон останавливается (провайдер недоступен). */
  abortAfterConsecutiveProviderFailures: 3,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export type ClassificationOptions = Readonly<{
  organizationId: string; dryRun: boolean; onlyExplicitConsent: boolean; chunkSize: number; maxFiles: number; delayMs: number; runId: string;
}>;
export type ClassificationCandidate = Readonly<{
  student_case_id: string; document_slot_id: string; document_version_id: string; sha256: string; bytes: number;
  mime: ClassificationBinding["mime"]; bucket_id: string; object_name: string; attempts: number;
}>;
export type ClassificationSummary = Readonly<{
  schema: "evo-document-classification/v1"; mode: "dry-run" | "run"; run_id: string; policy: string;
  plan: Record<string, unknown> | null; estimate: Readonly<{ provider_calls: number; chunks: number; worst_case_cost_micros: number | null; budget_left_micros: number | null }> | null;
  processed: number; suggested: number; unsure: number; failed: number; transient_failures: number; skipped_no_consent: number; skipped_not_candidate: number; provider_calls: number;
  spent_micros: number; stopped: "completed" | "max_files" | "budget_exhausted" | "provider_unavailable" | "interrupted" | "no_candidates" | null;
}>;
export type ClassificationDependencies = Readonly<{
  rpc(name: string, parameters: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  loadSource(candidate: ClassificationCandidate, signal: AbortSignal): Promise<ClassificationBinding>;
  /** Создаётся только для настоящего прогона: пробный прогон ключа не читает и провайдера не зовёт. */
  createClassifier(config: unknown): ReturnType<typeof createGeminiDocumentClassifier>;
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
}>;

export class DocumentClassificationBatchError extends Error {
  readonly code: "invalid_arguments" | "provider_not_configured" | "backend_not_configured" | "run_in_progress" | "unavailable";
  constructor(code: DocumentClassificationBatchError["code"]) { super("Document classification batch unavailable"); this.name = "DocumentClassificationBatchError"; this.code = code; }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseDocumentClassificationArguments(args: readonly string[], randomRunId: () => string): ClassificationOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === "--dry-run" || name === "--only-explicit-consent") { if (flags.has(name)) throw new DocumentClassificationBatchError("invalid_arguments"); flags.add(name); continue; }
    if (!["--organization-id", "--chunk-size", "--max-files", "--delay-ms", "--run-id"].includes(name) || values.has(name)) throw new DocumentClassificationBatchError("invalid_arguments");
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new DocumentClassificationBatchError("invalid_arguments");
    values.set(name, value);
  }
  const organizationId = values.get("--organization-id") ?? "";
  const number = (name: string, fallback: number, min: number, max: number) => {
    const raw = values.get(name);
    if (raw === undefined) return fallback;
    if (!/^[0-9]{1,6}$/.test(raw)) throw new DocumentClassificationBatchError("invalid_arguments");
    const parsed = Number(raw);
    if (parsed < min || parsed > max) throw new DocumentClassificationBatchError("invalid_arguments");
    return parsed;
  };
  const runId = values.get("--run-id") ?? randomRunId();
  if (!UUID.test(organizationId) || !RUN_ID.test(runId)) throw new DocumentClassificationBatchError("invalid_arguments");
  const limits = DOCUMENT_CLASSIFICATION_LIMITS;
  return Object.freeze({
    organizationId, dryRun: flags.has("--dry-run"), onlyExplicitConsent: flags.has("--only-explicit-consent"), runId,
    chunkSize: number("--chunk-size", limits.defaultChunk, 1, limits.maxChunk),
    maxFiles: number("--max-files", limits.defaultMaxFiles, 1, limits.maxFiles),
    delayMs: number("--delay-ms", limits.defaultDelayMs, 0, limits.maxDelayMs),
  });
}

function parseCandidates(value: unknown): ClassificationCandidate[] {
  if (!Array.isArray(value) || value.length > 50) throw new DocumentClassificationBatchError("unavailable");
  return value.map((item) => {
    if (!record(item) || ![item.student_case_id, item.document_slot_id, item.document_version_id].every((id) => typeof id === "string" && UUID.test(id))
      || typeof item.sha256 !== "string" || !SHA.test(item.sha256) || !Number.isSafeInteger(item.bytes) || (item.bytes as number) < 1
      || !["application/pdf", "image/jpeg", "image/png"].includes(String(item.mime)) || item.bucket_id !== "platform-documents"
      || typeof item.object_name !== "string" || !/^[0-9a-f]{2}\/[0-9a-f]{62}$/.test(item.object_name)
      || !Number.isSafeInteger(item.attempts)) throw new DocumentClassificationBatchError("unavailable");
    return item as unknown as ClassificationCandidate;
  });
}

function emptySummary(options: ClassificationOptions): ClassificationSummary {
  return { schema: "evo-document-classification/v1", mode: options.dryRun ? "dry-run" : "run", run_id: options.runId,
    policy: DOCUMENT_CLASSIFICATION_POLICY, plan: null, estimate: null, processed: 0, suggested: 0, unsure: 0, failed: 0, transient_failures: 0,
    skipped_no_consent: 0, skipped_not_candidate: 0, provider_calls: 0, spent_micros: 0, stopped: null };
}

/**
 * Пробный прогон ничего не отправляет и не читает файлов: только числа плана и оценка. Настоящий прогон идёт порциями
 * (chunkSize), по одному файлу, с паузой (delayMs), до maxFiles и до остатка общего дневного бюджета.
 */
export async function runDocumentClassification(options: ClassificationOptions, deps: ClassificationDependencies, signal: AbortSignal): Promise<ClassificationSummary> {
  const summary: { -readonly [K in keyof ClassificationSummary]: ClassificationSummary[K] } = emptySummary(options);
  const plan = await deps.rpc("document_classification_plan_v1", { p_organization_id: options.organizationId, p_only_explicit_consent: options.onlyExplicitConsent }, signal);
  if (!record(plan)) throw new DocumentClassificationBatchError("unavailable");
  summary.plan = plan;
  const toClassify = Number(plan.to_classify_files);
  if (!Number.isSafeInteger(toClassify) || toClassify < 0) throw new DocumentClassificationBatchError("unavailable");

  let context: Record<string, unknown>;
  try {
    const raw = await deps.rpc("document_classification_context_v1", { p_organization_id: options.organizationId }, signal);
    if (!record(raw) || !record(raw.config) || !Number.isSafeInteger(raw.budget_left_micros)) throw new DocumentClassificationBatchError("unavailable");
    context = raw;
  } catch (error) {
    if (options.dryRun && error instanceof DocumentClassificationBatchError && error.code === "provider_not_configured") {
      // Пробный прогон всё равно показывает числа; отсутствие настройки провайдера называется отдельно.
      summary.estimate = { provider_calls: Math.min(toClassify, options.maxFiles), chunks: Math.ceil(Math.min(toClassify, options.maxFiles) / options.chunkSize),
        worst_case_cost_micros: null, budget_left_micros: null };
      summary.stopped = "completed";
      return summary;
    }
    throw error;
  }
  let budgetLeft = context.budget_left_micros as number;
  const calls = Math.min(toClassify, options.maxFiles);

  if (options.dryRun) {
    // Верхняя оценка на вызов считается из той же конфигурации, без ключа и без обращения к провайдеру.
    const perCall = maximumDocumentRecognitionCostMicros(parseDocumentRecognitionProviderConfig(context.config));
    summary.estimate = { provider_calls: calls, chunks: Math.ceil(calls / options.chunkSize), worst_case_cost_micros: perCall * calls, budget_left_micros: budgetLeft };
    summary.stopped = "completed";
    return summary;
  }

  const classifier = deps.createClassifier(context.config);
  const perCall = classifier.maximumCallCostMicros;
  summary.estimate = { provider_calls: calls, chunks: Math.ceil(calls / options.chunkSize), worst_case_cost_micros: perCall * calls, budget_left_micros: budgetLeft };
  let consecutiveProviderFailures = 0;
  // Файл, чей результат выброшен (согласие отозвано, файл разобран), база снова вернёт как кандидата: в одном прогоне он не повторяется.
  const seen = new Set<string>();

  const record_ = async (candidate: ClassificationCandidate, status: "suggested" | "unsure" | "failed", kind: string | null, confidence: number | null,
    usage: { input: number | null; output: number | null; cost: number }, failure: DocumentClassificationFailure | null) => {
    try {
      const response = await deps.rpc("document_classification_record_v1", {
        p_organization_id: options.organizationId, p_document_version_id: candidate.document_version_id, p_status: status, p_kind_key: kind,
        p_confidence: confidence, p_model: classifier.config.model,
        p_provider_project_id: classifier.config.projectId, p_config_version: classifier.config.configVersion,
        p_input_tokens: usage.input, p_output_tokens: usage.output, p_cost_micros: usage.cost, p_failure_code: failure, p_run_id: options.runId,
      }, signal);
      return record(response) && response.recorded === true;
    } catch (error) {
      // Согласие отозвано или файл уже разобран куратором, пока шёл прогон: результат выбрасывается, ничего не записано.
      if (error instanceof Error && error.message === "ai_consent_missing") { summary.skipped_no_consent++; return false; }
      if (error instanceof Error && error.message === "not_candidate") { summary.skipped_not_candidate++; return false; }
      throw error;
    }
  };

  while (summary.processed < options.maxFiles) {
    signal.throwIfAborted();
    const limit = Math.min(options.chunkSize, options.maxFiles - summary.processed);
    const batch = parseCandidates(await deps.rpc("document_classification_candidates_v1", {
      p_organization_id: options.organizationId, p_limit: limit, p_only_explicit_consent: options.onlyExplicitConsent, p_run_id: options.runId, p_exclude: [...seen] }, signal))
      .filter((candidate) => !seen.has(candidate.document_version_id));
    for (const candidate of batch) seen.add(candidate.document_version_id);
    if (batch.length === 0) { summary.stopped = summary.processed === 0 ? "no_candidates" : "completed"; return summary; }
    for (const candidate of batch) {
      signal.throwIfAborted();
      if (summary.processed >= options.maxFiles) break;
      if (budgetLeft < perCall) { summary.stopped = "budget_exhausted"; return summary; }
      summary.processed++;
      let source: ClassificationBinding;
      try { source = await deps.loadSource(candidate, signal); }
      catch (error) {
        if (signal.aborted) throw error;
        summary.failed++;
        await record_(candidate, "failed", null, null, { input: null, output: null, cost: 0 }, "source_unavailable");
        continue;
      }
      if (source.bytes.byteLength > CLASSIFICATION_MAX_INLINE_BYTES) {
        summary.failed++;
        await record_(candidate, "failed", null, null, { input: null, output: null, cost: 0 }, "too_large");
        continue;
      }
      // Согласие могло смениться за секунды или минуты после выбора порции: перед КАЖДЫМ вызовом провайдера база решает ещё раз
      // тем же правилом, что при выборе кандидатов (и продлевает аренду прогона). Нет - файл не уходит.
      const stillAllowed = await deps.rpc("document_classification_recheck_v1", {
        p_organization_id: options.organizationId, p_document_version_id: candidate.document_version_id,
        p_only_explicit_consent: options.onlyExplicitConsent, p_run_id: options.runId }, signal);
      if (stillAllowed !== true) { summary.skipped_no_consent++; continue; }
      summary.provider_calls++;
      const outcome: ClassificationOutcome = await classifier.classify(source, signal);
      if (outcome.outcome === "failed") {
        if (outcome.failure === "provider_unavailable") {
          // Временный сбой (429, 5xx, таймаут): строку не пишем и попытку не тратим, файл останется кандидатом для следующего запуска.
          summary.transient_failures++;
          consecutiveProviderFailures++;
        } else {
          summary.failed++;
          if (outcome.failure === "provider_rejected") consecutiveProviderFailures++;
          await record_(candidate, "failed", null, null, { input: null, output: null, cost: 0 }, outcome.failure);
        }
        if (consecutiveProviderFailures >= DOCUMENT_CLASSIFICATION_LIMITS.abortAfterConsecutiveProviderFailures) { summary.stopped = "provider_unavailable"; return summary; }
      } else {
        consecutiveProviderFailures = 0;
        budgetLeft -= outcome.costMicros;
        summary.spent_micros += outcome.costMicros;
        const status = classificationStatus(outcome.result.kind, outcome.result.confidence);
        const stored = await record_(candidate, status, outcome.result.kind, outcome.result.confidence,
          { input: outcome.inputTokens, output: outcome.outputTokens, cost: outcome.costMicros }, null);
        if (stored) { if (status === "suggested") summary.suggested++; else summary.unsure++; }
      }
      // Ограничение частоты: пауза между вызовами провайдеру.
      if (options.delayMs > 0) await deps.sleep(options.delayMs, signal);
    }
  }
  summary.stopped = "max_files";
  return summary;
}

// ---------------------------------------------------------------------------
// Настоящие зависимости: служебный клиент базы, ключ из окружения, чтение файла из закрытого хранилища.
// ---------------------------------------------------------------------------
export function createDocumentClassificationDependencies(env: NodeJS.ProcessEnv = process.env): ClassificationDependencies {
  const backend = getPlatformSupabaseBackendConfig();
  const client = createPlatformSupabaseServiceClient(backend);
  return {
    async rpc(name, parameters, signal) {
      const response = await client.schema("platform").rpc(name, parameters).abortSignal(AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
      if (response.error) {
        const { code, message } = response.error;
        if (code === "55000" && message === "provider_not_configured") throw new DocumentClassificationBatchError("provider_not_configured");
        if (code === "42501") throw new Error(message === "ai_consent_missing" ? "ai_consent_missing" : "forbidden");
        if (code === "22023" && message === "not_candidate") throw new Error("not_candidate");
        if (code === "55P03" && message === "run_in_progress") throw new DocumentClassificationBatchError("run_in_progress");
        throw new DocumentClassificationBatchError("unavailable");
      }
      return response.data;
    },
    async loadSource(candidate, signal) {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
      const headers: Record<string, string> = { apikey: backend.supabaseSecretKey, "Accept-Encoding": "identity" };
      if (!backend.supabaseSecretKey.startsWith("sb_secret_")) headers.Authorization = `Bearer ${backend.supabaseSecretKey}`;
      const response = await fetch(new URL(`/storage/v1/object/${candidate.bucket_id}/${candidate.object_name}`, backend.supabaseUrl).href,
        { method: "GET", headers, redirect: "error", cache: "no-store", signal: deadline });
      if (response.status !== 200) { await response.body?.cancel(); throw new Error("source_unavailable"); }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== candidate.bytes || createHash("sha256").update(bytes).digest("hex") !== candidate.sha256) throw new Error("source_changed");
      const magic = candidate.mime === "application/pdf" ? [0x25, 0x50, 0x44, 0x46, 0x2d] : candidate.mime === "image/jpeg" ? [0xff, 0xd8, 0xff]
        : [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      if (!magic.every((value, index) => bytes[index] === value)) throw new Error("document_not_eligible");
      return { bytes, mime: candidate.mime };
    },
    createClassifier(config) {
      const key = env.EVO_PLATFORM_GEMINI_API_KEY ?? "";
      if (!key || key.length > 512 || /\s/.test(key)) throw new DocumentClassificationBatchError("provider_not_configured");
      try { return createGeminiDocumentClassifier(key, config); }
      catch (error) {
        if (error instanceof DocumentRecognitionProviderError) throw new DocumentClassificationBatchError("provider_not_configured");
        throw error;
      }
    },
    sleep: async (milliseconds, signal) => { await pause(milliseconds, undefined, { signal }); },
  };
}
export { PlatformSupabaseBackendConfigurationError };
