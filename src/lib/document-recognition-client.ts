import {
  DOCUMENT_RECOGNITION_REQUEST_ERROR_CODES,
  normalizeDocumentRecognitionJob, normalizeDocumentRecognitionReceipt, normalizeDocumentRecognitionRequest,
  type DocumentRecognitionJob, type DocumentRecognitionRequest, type DocumentRecognitionRequestErrorCode,
} from "./document-recognition.ts";

export type RecognitionHistoryPage = Readonly<{ jobs: readonly DocumentRecognitionJob[]; next_cursor: string | null }>;
export class DocumentRecognitionClientError extends Error {
  readonly code: DocumentRecognitionRequestErrorCode;
  readonly uncertain: boolean;
  constructor(code: DocumentRecognitionRequestErrorCode = "unavailable", uncertain = false) {
    super("Document recognition request unavailable");
    this.code = code;
    this.uncertain = uncertain;
  }
}
function endpoint(caseId: string) { return `/api/v3/student-cases/${encodeURIComponent(caseId)}/document-recognition-jobs`; }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function cursor(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[0-9a-f-]{36}$/.test(value);
}
export function normalizeRecognitionHistoryPage(value: unknown, sourceId: string | null): RecognitionHistoryPage {
  if (!record(value) || Object.keys(value).sort().join(",") !== "jobs,next_cursor"
    || !Array.isArray(value.jobs) || value.jobs.length > 10
    || (value.next_cursor !== null && !cursor(value.next_cursor))) throw new DocumentRecognitionClientError();
  const jobs = value.jobs.map(normalizeDocumentRecognitionJob);
  if ((sourceId !== null && jobs.some(job => job.source_version_id !== sourceId)) || new Set(jobs.map(job => job.job_id)).size !== jobs.length
    || (value.next_cursor !== null && (jobs.length !== 10 || value.next_cursor.slice(28) !== jobs.at(-1)?.job_id))) {
    throw new DocumentRecognitionClientError();
  }
  return { jobs, next_cursor: value.next_cursor };
}
async function checkedJson(response: Response, mutation: boolean): Promise<unknown> {
  let data: unknown;
  try { data = await response.json(); } catch { throw new DocumentRecognitionClientError("unavailable", mutation); }
  if (!response.ok) {
    const code = record(data) && Object.keys(data).length === 1
      && DOCUMENT_RECOGNITION_REQUEST_ERROR_CODES.includes(data.error as DocumentRecognitionRequestErrorCode)
      ? data.error as DocumentRecognitionRequestErrorCode : "unavailable";
    throw new DocumentRecognitionClientError(code, mutation && code === "unavailable" && response.status >= 500);
  }
  return data;
}
export async function readRecognitionHistory(caseId: string, sourceId: string | null, before: string | null,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<RecognitionHistoryPage> {
  const query = new URLSearchParams(sourceId === null ? { scope: "case" } : { source_version_id: sourceId });
  if (before !== null) query.set("cursor", before);
  const response = await fetcher(`${endpoint(caseId)}?${query}`, { method: "GET", cache: "no-store", credentials: "same-origin", signal });
  return normalizeRecognitionHistoryPage(await checkedJson(response, false), sourceId);
}

/** One dispatch only. The caller retains this exact command on unknown outcome. */
export async function submitRecognitionRequest(caseId: string, request: DocumentRecognitionRequest,
  fetcher: typeof fetch = fetch) {
  const command = normalizeDocumentRecognitionRequest(request);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(endpoint(caseId), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(command), credentials: "same-origin", cache: "no-store", signal: controller.signal,
    });
    const data = await checkedJson(response, true);
    if (response.status !== 202) throw new DocumentRecognitionClientError("unavailable", true);
    return normalizeDocumentRecognitionReceipt(data);
  } catch (error) {
    if (error instanceof DocumentRecognitionClientError) throw error;
    throw new DocumentRecognitionClientError("unavailable", true);
  } finally { clearTimeout(timeout); }
}
