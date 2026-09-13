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
  /** Non-public transport distinction: unknown enqueue must retain its request. */
  readonly uncertain: boolean;
  constructor(code: DocumentRecognitionRequestErrorCode = "unavailable", uncertain = false) {
    super("Document recognition is unavailable");
    this.name = "PlatformDocumentRecognitionError";
    this.code = code;
    this.uncertain = uncertain;
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

type RecognitionRpcName = "enqueue_document_recognition" | "staff_document_recognition_job" | "staff_document_recognition_jobs";
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
    if (response.error !== null) {
      const code = rpcErrorCode(response.error);
      const denied = typeof response.error === "object" && response.error !== null && "code" in response.error
        && response.error.code === "42501";
      throw new PlatformDocumentRecognitionError(code, code === "unavailable" && !denied);
    }
    return normalizeDocumentRecognitionReceipt(response.data);
  } catch (error) {
    if (error instanceof PlatformDocumentRecognitionError) throw error;
    throw new PlatformDocumentRecognitionError("unavailable", true);
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

export type DocumentRecognitionHistory = Readonly<{
  jobs: readonly DocumentRecognitionJob[];
  next_cursor: string | null;
}>;

/** Exact opaque SQL keyset cursor: microsecond UTC timestamp and lowercase ID. */
export function isDocumentRecognitionCursor(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) return false;
  const date = new Date(value.slice(0, 27));
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10);
}

/** Cold reopening and pagination are session reads, never a retry command. */
export async function getPlatformDocumentRecognitionHistory(
  actor: RecognitionActor,
  studentCaseId: string,
  sourceVersionId: string,
  cursor: string | null = null,
  dependencies: PlatformDocumentRecognitionDependencies = session,
): Promise<DocumentRecognitionHistory> {
  return readHistory(actor, studentCaseId, uuid(sourceVersionId), cursor, dependencies);
}

/** Explicit case history also retains replaced-source jobs and cleanup outcomes. */
export async function getPlatformDocumentRecognitionCaseHistory(
  actor: RecognitionActor,
  studentCaseId: string,
  cursor: string | null = null,
  dependencies: PlatformDocumentRecognitionDependencies = session,
): Promise<DocumentRecognitionHistory> {
  return readHistory(actor, studentCaseId, null, cursor, dependencies);
}

async function readHistory(actor: RecognitionActor, studentCaseId: string, sourceId: string | null,
  cursor: string | null, dependencies: PlatformDocumentRecognitionDependencies): Promise<DocumentRecognitionHistory> {
  try {
    organizationFor(actor, false);
    const caseId = uuid(studentCaseId);
    if (cursor !== null && !isDocumentRecognitionCursor(cursor)) throw new PlatformDocumentRecognitionError("invalid_request");
    const client = await dependencies.createSessionClient();
    // JSON preserves SQL NULL; GET query arguments stringify it as "null".
    // This remains the same STABLE, current-session read, never an enqueue.
    const response = await client.schema("platform").rpc("staff_document_recognition_jobs", {
      p_student_case_id: caseId, p_source_version_id: sourceId, p_cursor: cursor,
    });
    if (response.error !== null) throw new PlatformDocumentRecognitionError(rpcErrorCode(response.error));
    const data = response.data;
    if (!data || typeof data !== "object" || Array.isArray(data)
      || Object.keys(data).sort().join(",") !== "jobs,next_cursor") throw new PlatformDocumentRecognitionError();
    const page = data as Record<string, unknown>;
    if (!Array.isArray(page.jobs) || page.jobs.length > 10
      || (page.next_cursor !== null && !isDocumentRecognitionCursor(page.next_cursor))) throw new PlatformDocumentRecognitionError();
    const jobs = page.jobs.map(normalizeDocumentRecognitionJob);
    if ((sourceId !== null && jobs.some(job => job.source_version_id !== sourceId)) || new Set(jobs.map(job => job.job_id)).size !== jobs.length
      || (page.next_cursor !== null && (jobs.length !== 10 || page.next_cursor === cursor
        || page.next_cursor.slice(28) !== jobs.at(-1)?.job_id))) throw new PlatformDocumentRecognitionError();
    return Object.freeze({ jobs: Object.freeze(jobs), next_cursor: page.next_cursor });
  } catch (error) {
    if (error instanceof PlatformDocumentRecognitionError) throw error;
    throw new PlatformDocumentRecognitionError();
  }
}
