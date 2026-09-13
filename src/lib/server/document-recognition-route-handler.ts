import "server-only";

import type { PlatformActorResult } from "../platform-auth.ts";
import { isStaffPreview } from "../platform-access.ts";
import { normalizeDocumentRecognitionRequest, type DocumentRecognitionRequestErrorCode } from "../document-recognition.ts";
import {
  enqueuePlatformDocumentRecognition, getPlatformDocumentRecognitionJob,
  getPlatformDocumentRecognitionHistory, getPlatformDocumentRecognitionCaseHistory, isDocumentRecognitionCursor,
  PlatformDocumentRecognitionError,
} from "../platform-document-recognition.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const STATUS: Record<DocumentRecognitionRequestErrorCode, number> = {
  invalid_request: 400, unavailable: 403, profile_changed: 409, request_conflict: 409,
  equivalent_job_active: 409, document_not_eligible: 422, profile_not_started: 422,
  budget_exhausted: 429, provider_not_configured: 503,
};
type Context = Readonly<{ params: Promise<{ studentCaseId: string }> }>;
export type DocumentRecognitionRouteDependencies = Readonly<{
  loadActor(): Promise<PlatformActorResult>;
  enqueue: typeof enqueuePlatformDocumentRecognition;
  readJob: typeof getPlatformDocumentRecognitionJob;
  readHistory: typeof getPlatformDocumentRecognitionHistory;
  readCaseHistory: typeof getPlatformDocumentRecognitionCaseHistory;
}>;
const DEFAULTS: DocumentRecognitionRouteDependencies = {
  loadActor: async () => (await import("../platform-auth.ts")).resolvePlatformActor(),
  enqueue: enqueuePlatformDocumentRecognition,
  readJob: getPlatformDocumentRecognitionJob,
  readHistory: getPlatformDocumentRecognitionHistory,
  readCaseHistory: getPlatformDocumentRecognitionCaseHistory,
};
function json(value: unknown, status = 200): Response { return Response.json(value, { status, headers: HEADERS }); }
function failure(code: DocumentRecognitionRequestErrorCode, status = STATUS[code]): Response { return json({ error: code }, status); }

/** Matches the existing audit/profile export trusted Origin/Host/protocol rule. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const host = request.headers.get("host")?.trim();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.trim();
    return origin === parsed.origin && !!host && !host.includes(",") && !/\s/u.test(host)
      && parsed.host === host.toLowerCase()
      && (forwardedProto === undefined || /^(?:http|https)$/u.test(forwardedProto))
      && parsed.protocol === (forwardedProto ? `${forwardedProto}:` : new URL(request.url).protocol);
  } catch { return false; }
}

async function readCommand(request: Request) {
  const declared = request.headers.get("content-length");
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")
    || (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 1024)) || !request.body) {
    throw new PlatformDocumentRecognitionError("invalid_request");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 5000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) throw new Error("Body deadline");
      if (done) break;
      length += value.byteLength;
      if (length > 1024) { await reader.cancel(); throw new Error("Body limit"); }
      chunks.push(value);
    }
    return normalizeDocumentRecognitionRequest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))));
  } catch { throw new PlatformDocumentRecognitionError("invalid_request"); }
  finally { clearTimeout(timeout); reader.releaseLock(); }
}

export function createDocumentRecognitionHandlers(dependencies: DocumentRecognitionRouteDependencies = DEFAULTS) {
  async function handle(request: Request, context: Context): Promise<Response> {
    try {
      if (request.method !== "GET" && request.method !== "POST") return documentRecognitionMethodNotAllowed();
      const { studentCaseId } = await context.params;
      if (!UUID.test(studentCaseId)) return failure("invalid_request");
      const query = new URL(request.url).searchParams;
      if (request.method === "POST" && !sameOrigin(request)) return failure("unavailable");
      if (request.method === "POST" && query.size !== 0) return failure("invalid_request");
      const jobId = query.get("job_id");
      const sourceId = query.get("source_version_id");
      const cursor = query.get("cursor");
      const scope = query.get("scope");
      if (request.method === "GET" && (
        (jobId !== null ? !UUID.test(jobId) || query.size !== 1
          : (scope === "case" ? sourceId !== null : scope !== null || sourceId === null || !UUID.test(sourceId))
            || query.size !== (cursor === null ? 1 : 2)
            || (cursor !== null && !isDocumentRecognitionCursor(cursor)))
        || [...query.keys()].some(key => !["job_id", "source_version_id", "cursor", "scope"].includes(key))
      )) return failure("invalid_request");
      const authority = await dependencies.loadActor();
      if (authority.status === "anonymous") return failure("unavailable", 401);
      if (authority.status !== "authenticated" || !["admin", "staff"].includes(authority.actor.systemRole)) return failure("unavailable");
      if (request.method === "POST") {
        if (isStaffPreview(authority.actor)) return failure("unavailable");
        const command = await readCommand(request);
        return json(await dependencies.enqueue(authority.actor, studentCaseId, command), 202);
      }
      return json(jobId !== null
        ? await dependencies.readJob(authority.actor, studentCaseId, jobId)
        : scope === "case" ? await dependencies.readCaseHistory(authority.actor, studentCaseId, cursor)
          : await dependencies.readHistory(authority.actor, studentCaseId, sourceId!, cursor));
    } catch (error) {
      return error instanceof PlatformDocumentRecognitionError
        ? failure(error.code, error.uncertain ? 503 : STATUS[error.code]) : failure("unavailable", 503);
    }
  }
  return { GET: handle, POST: handle };
}

export function documentRecognitionMethodNotAllowed(): Response {
  return Response.json({ error: "invalid_request" }, { status: 405, headers: { ...HEADERS, allow: "GET, POST" } });
}
