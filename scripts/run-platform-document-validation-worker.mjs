import { createHash } from "node:crypto";
import { hostname } from "node:os";

import {
  PLATFORM_DOCUMENT_MAX_BYTES,
  PlatformClamAvClient,
  PlatformClamAvError,
} from "../src/lib/server/platform-clamav-client.ts";
import {
  PlatformDocumentValidationWorkerError,
  runPlatformDocumentValidationOnce,
} from "../src/lib/server/platform-document-validation-worker.ts";
import { createPlatformServiceSupabaseClient } from "../src/lib/server/platform-service-supabase.ts";

function configInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/u.test(raw)) throw new Error("worker_configuration_invalid");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error("worker_configuration_invalid");
  }
  return value;
}

function requiredHost(name) {
  const value = process.env[name];
  if (
    !value ||
    value !== value.trim() ||
    value.length > 253 ||
    /[\s\0/]/u.test(value)
  ) {
    throw new Error("worker_configuration_invalid");
  }
  return value;
}

function loadConfig() {
  const enabled = process.env.EVO_DOCUMENT_VALIDATION_WORKER_ENABLED;
  if (enabled !== "true" && enabled !== "false") {
    throw new Error("worker_configuration_invalid");
  }
  const workerRef =
    process.env.EVO_DOCUMENT_VALIDATION_WORKER_REF ??
    `document-validation:${hostname().slice(0, 120)}:${process.pid}`;
  if (
    workerRef.length === 0 ||
    workerRef.length > 200 ||
    workerRef !== workerRef.trim() ||
    /[\0\r\n]/u.test(workerRef)
  ) {
    throw new Error("worker_configuration_invalid");
  }

  return {
    enabled: enabled === "true",
    workerRef,
    clamAvHost: requiredHost("EVO_CLAMAV_HOST"),
    clamAvPort: configInteger("EVO_CLAMAV_PORT", 3310, 1, 65_535),
    clamAvConnectTimeoutMs: configInteger(
      "EVO_CLAMAV_CONNECT_TIMEOUT_MS",
      5_000,
      10,
      60_000,
    ),
    clamAvResponseTimeoutMs: configInteger(
      "EVO_CLAMAV_RESPONSE_TIMEOUT_MS",
      120_000,
      10,
      300_000,
    ),
    visibilityTimeoutSeconds: configInteger(
      "EVO_DOCUMENT_VALIDATION_VISIBILITY_TIMEOUT_SECONDS",
      180,
      30,
      3_600,
    ),
    retryDelaySeconds: configInteger(
      "EVO_DOCUMENT_VALIDATION_RETRY_DELAY_SECONDS",
      30,
      1,
      86_400,
    ),
    idlePollMs: configInteger(
      "EVO_DOCUMENT_VALIDATION_IDLE_POLL_MS",
      1_000,
      100,
      60_000,
    ),
    errorBackoffMs: configInteger(
      "EVO_DOCUMENT_VALIDATION_ERROR_BACKOFF_MS",
      5_000,
      100,
      60_000,
    ),
    maximumBackoffMs: configInteger(
      "EVO_DOCUMENT_VALIDATION_MAX_BACKOFF_MS",
      60_000,
      1_000,
      300_000,
    ),
  };
}

function log(event, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      component: "platform-document-validation-worker",
      event,
      ...fields,
    })}\n`,
  );
}

function safeErrorCode(error) {
  if (
    error instanceof PlatformClamAvError ||
    error instanceof PlatformDocumentValidationWorkerError
  ) {
    return error.code;
  }
  if (error instanceof Error && error.message === "worker_configuration_invalid") {
    return error.message;
  }
  return "dependency_unavailable";
}

async function waitFor(milliseconds, signal) {
  if (signal.aborted) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function createDependencies(supabase, clamAv) {
  async function platformRpc(name, parameters) {
    const response = await supabase.schema("platform").rpc(name, parameters);
    if (response.error) throw new Error("platform_rpc_unavailable");
    return response.data;
  }

  return {
    claimWork: ({ visibilityTimeoutSeconds, workerRef, requestId }) =>
      platformRpc("claim_document_validation_work", {
        p_visibility_timeout_seconds: visibilityTimeoutSeconds,
        p_worker_ref: workerRef,
        p_request_id: requestId,
      }),
    resolveValidationInput: ({ organizationId, documentVersionId, requestId }) =>
      platformRpc("resolve_document_validation_input", {
        p_organization_id: organizationId,
        p_document_version_id: documentVersionId,
        p_request_id: requestId,
      }),
    downloadObject: async ({ bucketName, objectPath, maximumBytes }) => {
      const response = await supabase.storage.from(bucketName).download(objectPath);
      if (response.error || !(response.data instanceof Blob)) {
        throw new Error("storage_download_unavailable");
      }
      if (response.data.size === 0 || response.data.size > maximumBytes) {
        throw new PlatformDocumentValidationWorkerError(
          "document_size_mismatch",
          false,
        );
      }
      const arrayBuffer = await response.data.arrayBuffer();
      if (arrayBuffer.byteLength > maximumBytes) {
        throw new PlatformDocumentValidationWorkerError(
          "document_size_mismatch",
          false,
        );
      }
      return new Uint8Array(arrayBuffer);
    },
    scanBytes: async (bytes, signal) => {
      const scannerVersion = await clamAv.version(signal);
      const result = await clamAv.scan(bytes, signal);
      return { ...result, scannerVersion };
    },
    attestValidation: (input) =>
      platformRpc("attest_document_validation", {
        p_organization_id: input.organizationId,
        p_document_version_id: input.documentVersionId,
        p_integrity_status: input.integrityStatus,
        p_malware_status: input.malwareStatus,
        p_validation_source: input.validationSource,
        p_evidence_ref: input.evidenceRef,
        p_request_id: input.requestId,
      }),
    finishWork: (input) =>
      platformRpc("finish_durable_work", {
        p_work_item_id: input.workItemId,
        p_attempt_id: input.attemptId,
        p_outcome: input.outcome,
        p_error_code: input.errorCode,
        p_evidence_ref: input.evidenceRef,
        p_retry_delay_seconds: input.retryDelaySeconds,
        p_request_id: input.requestId,
      }),
  };
}

async function main() {
  const config = loadConfig();
  if (!config.enabled) {
    log("worker_disabled", { enabled: false });
    return;
  }

  const supabase = createPlatformServiceSupabaseClient();
  const clamAv = new PlatformClamAvClient({
    host: config.clamAvHost,
    port: config.clamAvPort,
    connectTimeoutMs: config.clamAvConnectTimeoutMs,
    responseTimeoutMs: config.clamAvResponseTimeoutMs,
    maxBytes: PLATFORM_DOCUMENT_MAX_BYTES,
  });
  const dependencies = createDependencies(supabase, clamAv);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  let backoffMs = config.errorBackoffMs;
  let ready = false;
  while (!controller.signal.aborted && !ready) {
    try {
      const readiness = await clamAv.readiness(controller.signal);
      log("scanner_ready", {
        ready: true,
        transport: "private-tcp-instream",
        versionSha256: createHash("sha256")
          .update(readiness.version, "utf8")
          .digest("hex")
          .slice(0, 16),
      });
      ready = true;
      backoffMs = config.errorBackoffMs;
    } catch (error) {
      log("scanner_not_ready", { ready: false, code: safeErrorCode(error) });
      await waitFor(backoffMs, controller.signal);
      backoffMs = Math.min(backoffMs * 2, config.maximumBackoffMs);
    }
  }

  while (!controller.signal.aborted) {
    try {
      const result = await runPlatformDocumentValidationOnce(dependencies, {
        workerRef: config.workerRef,
        visibilityTimeoutSeconds: config.visibilityTimeoutSeconds,
        retryDelaySeconds: config.retryDelaySeconds,
        maximumBytes: PLATFORM_DOCUMENT_MAX_BYTES,
        signal: controller.signal,
      });
      log("work_cycle", { status: result.status, code: result.code ?? null });
      backoffMs = config.errorBackoffMs;
      if (result.status === "idle") {
        await waitFor(config.idlePollMs, controller.signal);
      }
    } catch (error) {
      if (controller.signal.aborted) break;
      log("work_cycle_failed", { code: safeErrorCode(error) });
      await waitFor(backoffMs, controller.signal);
      backoffMs = Math.min(backoffMs * 2, config.maximumBackoffMs);
    }
  }

  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  log("worker_stopped", { reason: "signal" });
}

main().catch((error) => {
  log("worker_fatal", { code: safeErrorCode(error) });
  process.exitCode = 1;
});
