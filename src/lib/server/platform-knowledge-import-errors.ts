import "server-only";

export const PLATFORM_KNOWLEDGE_IMPORT_REASON_CODES = Object.freeze([
  "provider_rate_limited",
  "provider_rejected",
  "bundle_invalid",
  "manifest_mismatch",
  "account_binding_failed",
  "rpc_rejected",
  "transport_failed",
] as const);

export type PlatformKnowledgeImportReasonCode =
  (typeof PLATFORM_KNOWLEDGE_IMPORT_REASON_CODES)[number];

const REASON_CODES = new Set<string>(PLATFORM_KNOWLEDGE_IMPORT_REASON_CODES);

export class PlatformKnowledgeImportError extends Error {
  readonly reasonCode: PlatformKnowledgeImportReasonCode;

  constructor(reasonCode: PlatformKnowledgeImportReasonCode, message: string) {
    super(message);
    this.name = "PlatformKnowledgeImportError";
    this.reasonCode = reasonCode;
  }
}

export function isPlatformKnowledgeImportReasonCode(
  value: unknown,
): value is PlatformKnowledgeImportReasonCode {
  return typeof value === "string" && REASON_CODES.has(value);
}

export function platformKnowledgeImportError(
  reasonCode: PlatformKnowledgeImportReasonCode,
  message: string,
): PlatformKnowledgeImportError {
  return new PlatformKnowledgeImportError(reasonCode, message);
}

export function platformKnowledgeImportReason(
  error: unknown,
  fallback: PlatformKnowledgeImportReasonCode,
): PlatformKnowledgeImportReasonCode {
  return error instanceof PlatformKnowledgeImportError ? error.reasonCode : fallback;
}
