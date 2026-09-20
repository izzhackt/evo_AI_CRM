import "server-only";

type StorageResult<T> = { data: T | null; error: unknown };
const RETRY_DELAYS = [500, 1_000, 2_000] as const;
const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);

function details(error: unknown): Record<string, unknown> {
  return error !== null && typeof error === "object" ? error as Record<string, unknown> : {};
}
function status(error: unknown): number | null {
  const value = details(error);
  const http = Number(value.status);
  // An explicit authorization or missing-object response is always terminal.
  if ([401, 403, 404].includes(http)) return http;
  const code = Number(value.statusCode);
  return Number.isInteger(code) && code >= 400 && code <= 599 ? code
    : Number.isInteger(http) && http >= 400 && http <= 599 ? http : null;
}
function networkFailure(error: unknown, depth = 0): boolean {
  if (depth > 3) return false;
  const value = details(error);
  return NETWORK_CODES.has(String(value.code)) || value.name === "TimeoutError"
    || Boolean(value.originalError && networkFailure(value.originalError, depth + 1))
    || Boolean(value.cause && networkFailure(value.cause, depth + 1));
}
export function knowledgeStorageRetryDelay(error: unknown, attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= RETRY_DELAYS.length) return null;
  const code = status(error);
  const retryable = code !== null ? code === 408 || code === 429 || code >= 500 : networkFailure(error);
  return retryable ? RETRY_DELAYS[attempt] : null;
}
export function knowledgeStorageConflict(error: unknown): boolean {
  if ([401, 403, 404].includes(Number(details(error).status))) return false;
  return status(error) === 409 || ["Duplicate", "ResourceAlreadyExists", "KeyAlreadyExists"].includes(String(details(error).statusCode));
}

/** Only use for reads or immutable uploads at the same path with upsert:false. */
export async function knowledgeStorageRequest<T>(operation: "read" | "write", run: () => PromiseLike<StorageResult<T>>): Promise<StorageResult<T>> {
  for (let attempt = 0; ; attempt++) {
    let result: StorageResult<T>;
    try { result = await run(); }
    catch (error) { result = { data: null, error }; }
    if (!result.error) return result;
    const delay = knowledgeStorageRetryDelay(result.error, attempt);
    if (delay === null) return result;
    // No object paths, provider messages, credentials or source content in logs.
    console.warn("knowledge_storage_retry", { operation, status: status(result.error), attempt: attempt + 1 });
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
