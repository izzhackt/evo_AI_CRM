import "server-only";

const BATCH_SIZE = 96;
const RETRY_DELAYS_MS = Object.freeze([0, 1_000, 2_000, 4_000]);
const RETRY_RESPONSE_MAX_BYTES = 65_536;

type EmbeddingOptions = Readonly<{
  model: "gemini-embedding-2";
  dimensions: 1_536;
}>;

type Wait = (delayMs: number) => Promise<void>;

async function receiveRetryableResponse(response: Response, timeoutMs: number): Promise<void> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/u.test(contentLength) || Number(contentLength) > RETRY_RESPONSE_MAX_BYTES)) {
    throw new Error("Gemini retry response exceeded the byte limit");
  }
  if (response.body === null) return;

  const reader = response.body.getReader();
  let byteCount = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutFailure = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("Gemini retry response timed out")), timeoutMs);
  });
  const readToEnd = (async () => {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return;
      byteCount += chunk.value.byteLength;
      if (byteCount > RETRY_RESPONSE_MAX_BYTES) throw new Error("Gemini retry response exceeded the byte limit");
    }
  })();

  try {
    await Promise.race([readToEnd, timeoutFailure]);
  } catch {
    void reader.cancel().catch(() => undefined);
    throw new Error("Gemini retry response was not fully received");
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function parseEmbeddings(value: unknown, expected: number, dimensions: number): readonly (readonly number[])[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid Gemini embeddings response");
  const embeddings = (value as { embeddings?: unknown }).embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== expected) throw new Error("Invalid Gemini embeddings response");
  return embeddings.map((embedding) => {
    if (typeof embedding !== "object" || embedding === null || Array.isArray(embedding)) throw new Error("Invalid Gemini embedding");
    const values = (embedding as { values?: unknown }).values;
    if (!Array.isArray(values) || values.length !== dimensions || values.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
      throw new Error("Invalid Gemini embedding");
    }
    return Object.freeze(values as number[]);
  });
}

export function createPlatformKnowledgeGeminiEmbedder(input: Readonly<{
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  waitImpl?: Wait;
}>) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const waitImpl = input.waitImpl ?? (async (delayMs) => {
    if (delayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
  });
  return async function embed(texts: readonly string[], options: EmbeddingOptions): Promise<readonly (readonly number[])[]> {
    const output: (readonly number[])[] = [];
    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const batch = texts.slice(start, start + BATCH_SIZE);
      const body = JSON.stringify({
        requests: batch.map((text) => ({
          model: `models/${options.model}`,
          content: { parts: [{ text }] },
          outputDimensionality: options.dimensions,
        })),
      });
      for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
        const delayMs = RETRY_DELAYS_MS[attempt];
        await waitImpl(delayMs);
        const controller = new AbortController();
        const deadline = Date.now() + timeoutMs;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:batchEmbedContents`,
            {
              method: "POST",
              headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
              signal: controller.signal,
              body,
            },
          );
          if (response.status === 429) {
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) throw new Error("Gemini retry response timed out");
            await receiveRetryableResponse(response, remainingMs);
            if (attempt + 1 < RETRY_DELAYS_MS.length) continue;
          }
          if (!response.ok) throw new Error("Gemini embeddings request rejected");
          output.push(...parseEmbeddings(await response.json() as unknown, batch.length, options.dimensions));
          break;
        } finally {
          clearTimeout(timeout);
        }
      }
    }
    return Object.freeze(output);
  };
}
