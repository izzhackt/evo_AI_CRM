import "server-only";

import { isStaffPreview, staffHasPermission } from "./platform-access.ts";
import type { ActivePlatformActor, PlatformActor } from "./platform-auth.ts";
import {
  normalizeDocumentRecognitionRequest,
  normalizeDocumentRecognitionReceipt,
  normalizeDocumentRecognitionJob,
  type DocumentRecognitionReceipt,
  type DocumentRecognitionJob,
  type DocumentRecognitionRequestErrorCode,
} from "./document-recognition.ts";

export class PlatformDocumentRecognitionError extends Error {
  readonly code: DocumentRecognitionRequestErrorCode;
  constructor(code: DocumentRecognitionRequestErrorCode = "unavailable") {
    super("Document recognition is unavailable");
    this.name = "PlatformDocumentRecognitionError";
    this.code = code;
  }
}

function rpcErrorCode(error: unknown): DocumentRecognitionRequestErrorCode {
  if (!error || typeof error !== "object") return "unavailable";
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "22023" && (message === "invalid_request" || message === "document_not_eligible" || message === "profile_not_started")) return message;
  if (code === "40001" && message === "profile_changed") return message;
  if (code === "23505" && (message === "request_conflict" || message === "equivalent_job_active")) return message;
  if (code === "54000" && message === "budget_exhausted") return message;
  if (code === "55000" && message === "provider_not_configured") return message;
  return "unavailable";
}

type RecognitionRpcName = "enqueue_document_recognition" | "staff_document_recognition_job";
type RecognitionActor = PlatformActor & Partial<Pick<ActivePlatformActor, "presentationRole">>;
type RecognitionSessionClient = Readonly<{
  schema(name: "platform"): Readonly<{
    rpc(name: RecognitionRpcName, parameters: Record<string, string | number | null>, options?: { get: true }):
      PromiseLike<{ data: unknown; error: unknown }>;
  }>;
}>;
export type PlatformDocumentRecognitionDependencies = Readonly<{
  createSessionClient(): Promise<RecognitionSessionClient>;
}>;

const session: PlatformDocumentRecognitionDependencies = {
  async createSessionClient() {
    const { createSupabaseServerClient } = await import("./supabase/server.ts");
    return createSupabaseServerClient();
  },
};

function uuid(value: unknown, code: DocumentRecognitionRequestErrorCode = "invalid_request"): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new PlatformDocumentRecognitionError(code);
  }
  return value.toLowerCase();
}

function organizationFor(actor: RecognitionActor, enqueue: boolean): string {
  const organizationId = uuid(actor.organizationId, "unavailable");
  const permissions = enqueue
    ? ["case.read.full", "profile.read.full", "profile.manage", "document.read.full", "document.download", "document.extract"]
    : ["case.read.full", "profile.read.full", "document.read.full"];
  // Section preconditions only; the current-session SQL rechecks every scope.
  if (!["admin", "staff"].includes(actor.systemRole) || !Array.isArray(actor.permissionKeys)
    || !permissions.every(permission => staffHasPermission(actor, permission))
    || (enqueue && isStaffPreview({ systemRole: actor.systemRole, presentationRole: actor.presentationRole ?? null }))) {
    throw new PlatformDocumentRecognitionError();
  }
  return organizationId;
}

/** Current-session command only. SQL owns live authority, replay and reservation. */
export async function enqueuePlatformDocumentRecognition(
  actor: RecognitionActor,
  studentCaseId: string,
  input: unknown,
  dependencies: PlatformDocumentRecognitionDependencies = session,
): Promise<DocumentRecognitionReceipt> {
  try {
    const organizationId = organizationFor(actor, true);
    const caseId = uuid(studentCaseId);
    let request;
    try { request = normalizeDocumentRecognitionRequest(input); }
    catch { throw new PlatformDocumentRecognitionError("invalid_request"); }
    const client = await dependencies.createSessionClient();
    const response = await client.schema("platform").rpc("enqueue_document_recognition", {
      p_organization_id: organizationId,
      p_student_case_id: caseId,
      p_source_version_id: request.source_version_id,
      p_expected_profile_revision: request.expected_profile_revision,
      p_request_id: request.request_id,
      p_retry_of_job_id: request.retry_of_job_id,
    });
    if (response.error !== null) throw new PlatformDocumentRecognitionError(rpcErrorCode(response.error));
    return normalizeDocumentRecognitionReceipt(response.data);
  } catch (error) {
    if (error instanceof PlatformDocumentRecognitionError) throw error;
    throw new PlatformDocumentRecognitionError();
  }
}

/** A read never initializes a profile, enqueues work or contacts the provider. */
export async function getPlatformDocumentRecognitionJob(
  actor: RecognitionActor,
  studentCaseId: string,
  jobId: string,
  dependencies: PlatformDocumentRecognitionDependencies = session,
): Promise<DocumentRecognitionJob> {
  try {
    organizationFor(actor, false);
    const caseId = uuid(studentCaseId);
    const expectedJobId = uuid(jobId);
    const client = await dependencies.createSessionClient();
    const response = await client.schema("platform").rpc("staff_document_recognition_job", {
      p_student_case_id: caseId,
      p_job_id: expectedJobId,
    }, { get: true });
    if (response.error !== null) throw new PlatformDocumentRecognitionError();
    const job = normalizeDocumentRecognitionJob(response.data);
    if (job.job_id !== expectedJobId) throw new PlatformDocumentRecognitionError();
    return job;
  } catch (error) {
    if (error instanceof PlatformDocumentRecognitionError) throw error;
    throw new PlatformDocumentRecognitionError();
  }
}
