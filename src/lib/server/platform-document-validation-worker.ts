import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  PLATFORM_DOCUMENT_MAX_BYTES,
  PlatformClamAvError,
  type PlatformClamAvScanResult,
} from "./platform-clamav-client.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

export const PLATFORM_DOCUMENT_VALIDATION_WORK_KIND = "document_validation";
export const PLATFORM_DOCUMENT_VALIDATION_SOURCE = "clamav-instream-v1";

export class PlatformDocumentValidationWorkerError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable: boolean) {
    super(`Document validation worker failed: ${code}`);
    this.name = "PlatformDocumentValidationWorkerError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface PlatformDocumentValidationClaim {
  claimed: true;
  organizationId: string;
  workItemId: string;
  attemptId: string;
  documentVersionId: string;
  attemptNumber: number;
  maxAttempts: number;
  leaseExpiresAt: string;
}

export interface PlatformDocumentValidationInput {
  organizationId: string;
  studentCaseId: string;
  documentSlotId: string;
  documentVersionId: string;
  documentVersionNo: number;
  bucketName: string;
  objectPath: string;
  originalFilename: string;
  expectedMimeType: PlatformDocumentMimeType;
  expectedByteSize: number;
  expectedSha256: string;
  validationAlreadyFinalized: boolean;
  finalIntegrityStatus: "verified" | "failed" | null;
  finalMalwareStatus: "clean" | "infected" | "error" | null;
}

export type PlatformDocumentMimeType =
  | "application/pdf"
  | "image/jpeg"
  | "image/png";

export type PlatformDocumentWorkerScanResult = PlatformClamAvScanResult & {
  scannerVersion: string;
};

export interface PlatformDocumentValidationWorkerDependencies {
  claimWork(input: {
    visibilityTimeoutSeconds: number;
    workerRef: string;
    requestId: string;
  }): Promise<unknown>;
  resolveValidationInput(input: {
    organizationId: string;
    documentVersionId: string;
    requestId: string;
  }): Promise<unknown>;
  downloadObject(input: {
    bucketName: string;
    objectPath: string;
    maximumBytes: number;
  }): Promise<unknown>;
  scanBytes(bytes: Uint8Array, signal?: AbortSignal): Promise<unknown>;
  attestValidation(input: {
    organizationId: string;
    documentVersionId: string;
    integrityStatus: "verified" | "failed";
    malwareStatus: "clean" | "infected" | "error";
    validationSource: string;
    evidenceRef: string;
    requestId: string;
  }): Promise<unknown>;
  finishWork(input: {
    workItemId: string;
    attemptId: string;
    outcome: "succeeded" | "retryable_error" | "terminal_error";
    errorCode: string | null;
    evidenceRef: string;
    retryDelaySeconds: number | null;
    requestId: string;
  }): Promise<unknown>;
}

export interface RunPlatformDocumentValidationOptions {
  workerRef: string;
  visibilityTimeoutSeconds?: number;
  retryDelaySeconds?: number;
  maximumBytes?: number;
  claimRequestId?: string;
  signal?: AbortSignal;
}

export type PlatformDocumentValidationRunResult =
  | { status: "idle" }
  | {
      status: "succeeded" | "retry_scheduled" | "dead_lettered" | "terminal";
      workItemId: string;
      code: string;
    };

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: RecordValue, key: string, maximum = 512): string {
  const value = record[key];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value !== value.trim() ||
    /[\0\r\n]/u.test(value)
  ) {
    throw new PlatformDocumentValidationWorkerError("boundary_response_invalid", false);
  }
  return value;
}

function requiredUuid(record: RecordValue, key: string): string {
  const value = requiredString(record, key, 36).toLowerCase();
  if (!UUID_PATTERN.test(value)) {
    throw new PlatformDocumentValidationWorkerError("boundary_response_invalid", false);
  }
  return value;
}

function requiredInteger(
  record: RecordValue,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new PlatformDocumentValidationWorkerError("boundary_response_invalid", false);
  }
  return value as number;
}

function boundedOption(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new PlatformDocumentValidationWorkerError("worker_configuration_invalid", false);
  }
  return candidate;
}

export function parseDocumentValidationClaim(
  value: unknown,
): PlatformDocumentValidationClaim | null {
  if (!isRecord(value) || typeof value.claimed !== "boolean") {
    throw new PlatformDocumentValidationWorkerError("claim_response_invalid", true);
  }
  if (!value.claimed) return null;
  if (
    value.kind !== PLATFORM_DOCUMENT_VALIDATION_WORK_KIND ||
    value.queue_payload_is_pointer_only !== true
  ) {
    throw new PlatformDocumentValidationWorkerError("unsupported_claim_kind", true);
  }

  const leaseExpiresAt = requiredString(value, "lease_expires_at", 64);
  if (
    !ISO_TIMESTAMP_PATTERN.test(leaseExpiresAt) ||
    !Number.isFinite(Date.parse(leaseExpiresAt))
  ) {
    throw new PlatformDocumentValidationWorkerError("claim_response_invalid", true);
  }

  return {
    claimed: true,
    organizationId: requiredUuid(value, "organization_id"),
    workItemId: requiredUuid(value, "work_item_id"),
    attemptId: requiredUuid(value, "attempt_id"),
    documentVersionId: requiredUuid(value, "document_version_id"),
    attemptNumber: requiredInteger(value, "attempt_number", 1, 1_000),
    maxAttempts: requiredInteger(value, "max_attempts", 1, 1_000),
    leaseExpiresAt,
  };
}

export function parseDocumentValidationInput(
  value: unknown,
): PlatformDocumentValidationInput {
  if (!isRecord(value)) {
    throw new PlatformDocumentValidationWorkerError("validation_input_invalid", false);
  }

  const mimeType = requiredString(value, "expected_mime_type", 100);
  if (!isPlatformDocumentMimeType(mimeType)) {
    throw new PlatformDocumentValidationWorkerError("validation_metadata_invalid", false);
  }
  const expectedSha256 = requiredString(value, "expected_sha256_hex", 64).toLowerCase();
  if (!SHA256_PATTERN.test(expectedSha256)) {
    throw new PlatformDocumentValidationWorkerError("validation_metadata_invalid", false);
  }
  const validationAlreadyFinalized = requiredBoolean(
    value,
    "validation_already_finalized",
  );
  const finalIntegrityStatus = optionalValidationIntegrityStatus(
    value.final_integrity_status,
  );
  const finalMalwareStatus = optionalValidationMalwareStatus(
    value.final_malware_status,
  );

  if (validationAlreadyFinalized) {
    const isTerminalFinalState =
      (finalIntegrityStatus === "verified" && finalMalwareStatus === "clean") ||
      (finalIntegrityStatus === "verified" && finalMalwareStatus === "infected") ||
      (finalIntegrityStatus === "failed" && finalMalwareStatus === "error");
    if (!isTerminalFinalState) {
      throw new PlatformDocumentValidationWorkerError("validation_metadata_invalid", false);
    }
  } else if (finalIntegrityStatus !== null || finalMalwareStatus !== null) {
    throw new PlatformDocumentValidationWorkerError("validation_metadata_invalid", false);
  }

  return {
    organizationId: requiredUuid(value, "organization_id"),
    studentCaseId: requiredUuid(value, "student_case_id"),
    documentSlotId: requiredUuid(value, "document_slot_id"),
    documentVersionId: requiredUuid(value, "document_version_id"),
    documentVersionNo: requiredInteger(value, "document_version_no", 1, 1_000_000),
    bucketName: requiredString(value, "bucket_id", 100),
    objectPath: requiredString(value, "object_name", 1_024),
    originalFilename: requiredString(value, "expected_original_filename", 512),
    expectedMimeType: mimeType,
    expectedByteSize: requiredInteger(
      value,
      "expected_byte_size",
      1,
      PLATFORM_DOCUMENT_MAX_BYTES,
    ),
    expectedSha256,
    validationAlreadyFinalized,
    finalIntegrityStatus,
    finalMalwareStatus,
  };
}

function isPlatformDocumentMimeType(value: string): value is PlatformDocumentMimeType {
  return ["application/pdf", "image/jpeg", "image/png"].includes(value);
}

function optionalValidationIntegrityStatus(
  value: unknown,
): "verified" | "failed" | null {
  if (value === null) return null;
  if (value === "verified" || value === "failed") return value;
  throw new PlatformDocumentValidationWorkerError("validation_metadata_invalid", false);
}

function optionalValidationMalwareStatus(
  value: unknown,
): "clean" | "infected" | "error" | null {
  if (value === null) return null;
  if (value === "clean" || value === "infected" || value === "error") return value;
  throw new PlatformDocumentValidationWorkerError("validation_metadata_invalid", false);
}

export function parseDownloadedDocumentBytes(
  value: unknown,
  maximumBytes: number,
): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new PlatformDocumentValidationWorkerError("storage_response_invalid", true);
  }
  if (value.byteLength === 0 || value.byteLength > maximumBytes) {
    throw new PlatformDocumentValidationWorkerError("document_size_mismatch", false);
  }
  return value;
}

function requiredBoolean(record: RecordValue, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new PlatformDocumentValidationWorkerError("boundary_response_invalid", false);
  }
  return value;
}

export function sniffPlatformDocumentMimeType(
  bytes: Uint8Array,
): PlatformDocumentMimeType | null {
  if (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return "application/pdf";
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    bytes.byteLength >= pngSignature.length &&
    pngSignature.every((byte, index) => bytes[index] === byte)
  ) {
    return "image/png";
  }
  return null;
}

export function parseDocumentWorkerScanResult(
  value: unknown,
): PlatformDocumentWorkerScanResult {
  if (!isRecord(value) || (value.status !== "clean" && value.status !== "infected")) {
    throw new PlatformDocumentValidationWorkerError("scanner_response_invalid", true);
  }
  const scannerVersion = requiredString(value, "scannerVersion", 512);
  if (!scannerVersion.startsWith("ClamAV ")) {
    throw new PlatformDocumentValidationWorkerError("scanner_response_invalid", true);
  }
  if (value.status === "infected") {
    const signature = requiredString(value, "signature", 200);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:+@-]{0,199}$/u.test(signature)) {
      throw new PlatformDocumentValidationWorkerError("scanner_response_invalid", true);
    }
    return { status: "infected", signature, scannerVersion };
  }
  return { status: "clean", scannerVersion };
}

function parseAttestationResult(
  value: unknown,
  expected: {
    organizationId: string;
    documentVersionId: string;
    integrityStatus: "verified" | "failed";
    malwareStatus: "clean" | "infected" | "error";
    evidenceRef: string;
  },
): void {
  if (
    !isRecord(value) ||
    value.organization_id !== expected.organizationId ||
    value.document_version_id !== expected.documentVersionId ||
    value.integrity_status !== expected.integrityStatus ||
    value.malware_status !== expected.malwareStatus ||
    value.validation_source !== PLATFORM_DOCUMENT_VALIDATION_SOURCE ||
    value.evidence_ref !== expected.evidenceRef ||
    value.scanner_proof !== false
  ) {
    throw new PlatformDocumentValidationWorkerError("attestation_response_invalid", true);
  }
}

function parseFinishResult(
  value: unknown,
  expected: {
    workItemId: string;
    attemptId: string;
    outcome: "succeeded" | "retryable_error" | "terminal_error";
  },
): "succeeded" | "retry_wait" | "dead_lettered" {
  if (
    !isRecord(value) ||
    value.work_item_id !== expected.workItemId ||
    value.attempt_id !== expected.attemptId ||
    value.outcome !== expected.outcome ||
    !["succeeded", "retry_wait", "dead_lettered"].includes(value.state as string)
  ) {
    throw new PlatformDocumentValidationWorkerError("finish_response_invalid", true);
  }
  return value.state as "succeeded" | "retry_wait" | "dead_lettered";
}

export function deterministicPlatformWorkerUuid(material: string): string {
  const bytes = createHash("sha256").update(material, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function shortSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function evidenceRef(
  claim: PlatformDocumentValidationClaim,
  code: string,
  scannerVersion?: string,
): string {
  const scanner = scannerVersion ? `:engine-${shortSha256(scannerVersion)}` : "";
  return `document-validation:v1:${claim.workItemId}:${claim.documentVersionId}:${code}${scanner}`;
}

function recoveryEvidenceRef(
  claim: PlatformDocumentValidationClaim,
  integrityStatus: "verified" | "failed",
  malwareStatus: "clean" | "infected" | "error",
): string {
  return `document-validation-recovery:v1:${claim.workItemId}:${claim.documentVersionId}:${integrityStatus}-${malwareStatus}`;
}

async function finish(
  dependencies: PlatformDocumentValidationWorkerDependencies,
  claim: PlatformDocumentValidationClaim,
  outcome: "succeeded" | "retryable_error" | "terminal_error",
  code: string,
  evidence: string,
  retryDelaySeconds: number,
): Promise<"succeeded" | "retry_wait" | "dead_lettered"> {
  const requestId = deterministicPlatformWorkerUuid(
    `bw8b:finish:${claim.attemptId}:${outcome}:${code}`,
  );
  const response = await dependencies.finishWork({
    workItemId: claim.workItemId,
    attemptId: claim.attemptId,
    outcome,
    errorCode: outcome === "succeeded" ? null : code,
    evidenceRef: evidence,
    retryDelaySeconds: outcome === "retryable_error" ? retryDelaySeconds : null,
    requestId,
  });
  return parseFinishResult(response, {
    workItemId: claim.workItemId,
    attemptId: claim.attemptId,
    outcome,
  });
}

async function attest(
  dependencies: PlatformDocumentValidationWorkerDependencies,
  claim: PlatformDocumentValidationClaim,
  integrityStatus: "verified" | "failed",
  malwareStatus: "clean" | "infected" | "error",
  evidence: string,
): Promise<void> {
  const requestId = deterministicPlatformWorkerUuid(
    `bw8b:attest:${claim.workItemId}:${claim.documentVersionId}:${integrityStatus}:${malwareStatus}`,
  );
  const response = await dependencies.attestValidation({
    organizationId: claim.organizationId,
    documentVersionId: claim.documentVersionId,
    integrityStatus,
    malwareStatus,
    validationSource: PLATFORM_DOCUMENT_VALIDATION_SOURCE,
    evidenceRef: evidence,
    requestId,
  });
  parseAttestationResult(response, {
    organizationId: claim.organizationId,
    documentVersionId: claim.documentVersionId,
    integrityStatus,
    malwareStatus,
    evidenceRef: evidence,
  });
}

async function retry(
  dependencies: PlatformDocumentValidationWorkerDependencies,
  claim: PlatformDocumentValidationClaim,
  code: string,
  retryDelaySeconds: number,
): Promise<PlatformDocumentValidationRunResult> {
  const state = await finish(
    dependencies,
    claim,
    "retryable_error",
    code,
    evidenceRef(claim, code),
    retryDelaySeconds,
  );
  return {
    status: state === "dead_lettered" ? "dead_lettered" : "retry_scheduled",
    workItemId: claim.workItemId,
    code,
  };
}

async function terminal(
  dependencies: PlatformDocumentValidationWorkerDependencies,
  claim: PlatformDocumentValidationClaim,
  code: string,
  integrityStatus: "verified" | "failed",
  malwareStatus: "infected" | "error",
  retryDelaySeconds: number,
  scannerVersion?: string,
): Promise<PlatformDocumentValidationRunResult> {
  const evidence = evidenceRef(claim, code, scannerVersion);
  try {
    await attest(
      dependencies,
      claim,
      integrityStatus,
      malwareStatus,
      evidence,
    );
  } catch {
    return retry(
      dependencies,
      claim,
      "validation_attestation_unavailable",
      retryDelaySeconds,
    );
  }
  await finish(
    dependencies,
    claim,
    "terminal_error",
    code,
    evidence,
    retryDelaySeconds,
  );
  return { status: "terminal", workItemId: claim.workItemId, code };
}

async function finishRecoveredValidation(
  dependencies: PlatformDocumentValidationWorkerDependencies,
  claim: PlatformDocumentValidationClaim,
  input: PlatformDocumentValidationInput,
  retryDelaySeconds: number,
): Promise<PlatformDocumentValidationRunResult> {
  const integrityStatus = input.finalIntegrityStatus;
  const malwareStatus = input.finalMalwareStatus;

  if (
    !input.validationAlreadyFinalized ||
    integrityStatus === null ||
    malwareStatus === null
  ) {
    throw new PlatformDocumentValidationWorkerError("validation_metadata_invalid", false);
  }

  const evidence = recoveryEvidenceRef(claim, integrityStatus, malwareStatus);

  if (integrityStatus === "verified" && malwareStatus === "clean") {
    await finish(
      dependencies,
      claim,
      "succeeded",
      "clean",
      evidence,
      retryDelaySeconds,
    );
    return { status: "succeeded", workItemId: claim.workItemId, code: "clean" };
  }

  if (integrityStatus === "verified" && malwareStatus === "infected") {
    await finish(
      dependencies,
      claim,
      "terminal_error",
      "document_infected",
      evidence,
      retryDelaySeconds,
    );
    return {
      status: "terminal",
      workItemId: claim.workItemId,
      code: "document_infected",
    };
  }

  await finish(
    dependencies,
    claim,
    "terminal_error",
    "validation_previously_failed",
    evidence,
    retryDelaySeconds,
  );
  return {
    status: "terminal",
    workItemId: claim.workItemId,
    code: "validation_previously_failed",
  };
}

function scanErrorCode(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof PlatformClamAvError) {
    if (error.code === "stream_limit_exceeded" || error.code === "payload_too_large") {
      return { code: "scanner_size_limit", retryable: false };
    }
    return { code: `scanner_${error.code}`, retryable: error.retryable };
  }
  if (error instanceof PlatformDocumentValidationWorkerError) {
    return { code: error.code, retryable: error.retryable };
  }
  return { code: "scanner_unavailable", retryable: true };
}

export async function runPlatformDocumentValidationOnce(
  dependencies: PlatformDocumentValidationWorkerDependencies,
  options: RunPlatformDocumentValidationOptions,
): Promise<PlatformDocumentValidationRunResult> {
  if (
    typeof options.workerRef !== "string" ||
    options.workerRef.length === 0 ||
    options.workerRef.length > 200 ||
    options.workerRef !== options.workerRef.trim() ||
    /[\0\r\n]/u.test(options.workerRef)
  ) {
    throw new PlatformDocumentValidationWorkerError("worker_configuration_invalid", false);
  }
  const visibilityTimeoutSeconds = boundedOption(
    options.visibilityTimeoutSeconds,
    180,
    30,
    3_600,
  );
  const retryDelaySeconds = boundedOption(
    options.retryDelaySeconds,
    30,
    1,
    86_400,
  );
  const maximumBytes = boundedOption(
    options.maximumBytes,
    PLATFORM_DOCUMENT_MAX_BYTES,
    1,
    PLATFORM_DOCUMENT_MAX_BYTES,
  );
  const claimRequestId = options.claimRequestId ?? randomUUID();
  if (!UUID_PATTERN.test(claimRequestId)) {
    throw new PlatformDocumentValidationWorkerError("worker_configuration_invalid", false);
  }

  const claim = parseDocumentValidationClaim(
    await dependencies.claimWork({
      visibilityTimeoutSeconds,
      workerRef: options.workerRef,
      requestId: claimRequestId,
    }),
  );
  if (!claim) return { status: "idle" };

  let input: PlatformDocumentValidationInput;
  try {
    input = parseDocumentValidationInput(
      await dependencies.resolveValidationInput({
        organizationId: claim.organizationId,
        documentVersionId: claim.documentVersionId,
        requestId: deterministicPlatformWorkerUuid(
          `bw8b:resolve:${claim.attemptId}:${claim.documentVersionId}`,
        ),
      }),
    );
  } catch (error) {
    if (
      error instanceof PlatformDocumentValidationWorkerError &&
      !error.retryable
    ) {
      return terminal(
        dependencies,
        claim,
        error.code,
        "failed",
        "error",
        retryDelaySeconds,
      );
    }
    return retry(dependencies, claim, "validation_input_unavailable", retryDelaySeconds);
  }

  if (
    input.organizationId !== claim.organizationId ||
    input.documentVersionId !== claim.documentVersionId ||
    input.expectedByteSize > maximumBytes
  ) {
    return terminal(
      dependencies,
      claim,
      "validation_metadata_mismatch",
      "failed",
      "error",
      retryDelaySeconds,
    );
  }

  if (input.validationAlreadyFinalized) {
    return finishRecoveredValidation(
      dependencies,
      claim,
      input,
      retryDelaySeconds,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = parseDownloadedDocumentBytes(
      await dependencies.downloadObject({
        bucketName: input.bucketName,
        objectPath: input.objectPath,
        maximumBytes,
      }),
      maximumBytes,
    );
  } catch (error) {
    if (
      error instanceof PlatformDocumentValidationWorkerError &&
      !error.retryable
    ) {
      return terminal(
        dependencies,
        claim,
        error.code,
        "failed",
        "error",
        retryDelaySeconds,
      );
    }
    return retry(dependencies, claim, "storage_download_unavailable", retryDelaySeconds);
  }

  if (bytes.byteLength !== input.expectedByteSize) {
    return terminal(
      dependencies,
      claim,
      "document_size_mismatch",
      "failed",
      "error",
      retryDelaySeconds,
    );
  }
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== input.expectedSha256) {
    return terminal(
      dependencies,
      claim,
      "document_sha256_mismatch",
      "failed",
      "error",
      retryDelaySeconds,
    );
  }
  if (sniffPlatformDocumentMimeType(bytes) !== input.expectedMimeType) {
    return terminal(
      dependencies,
      claim,
      "document_mime_mismatch",
      "failed",
      "error",
      retryDelaySeconds,
    );
  }

  let scan: PlatformDocumentWorkerScanResult;
  try {
    scan = parseDocumentWorkerScanResult(
      await dependencies.scanBytes(bytes, options.signal),
    );
  } catch (error) {
    const classified = scanErrorCode(error);
    if (classified.retryable) {
      return retry(dependencies, claim, classified.code, retryDelaySeconds);
    }
    return terminal(
      dependencies,
      claim,
      classified.code,
      "failed",
      "error",
      retryDelaySeconds,
    );
  }

  if (scan.status === "infected") {
    return terminal(
      dependencies,
      claim,
      "document_infected",
      "verified",
      "infected",
      retryDelaySeconds,
      scan.scannerVersion,
    );
  }

  const evidence = evidenceRef(claim, "clean", scan.scannerVersion);
  try {
    await attest(dependencies, claim, "verified", "clean", evidence);
  } catch {
    return retry(
      dependencies,
      claim,
      "validation_attestation_unavailable",
      retryDelaySeconds,
    );
  }
  await finish(
    dependencies,
    claim,
    "succeeded",
    "clean",
    evidence,
    retryDelaySeconds,
  );
  return { status: "succeeded", workItemId: claim.workItemId, code: "clean" };
}
