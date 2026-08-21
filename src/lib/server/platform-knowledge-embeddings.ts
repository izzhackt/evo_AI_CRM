import "server-only";

import {
  platformKnowledgeImportError,
  type PlatformKnowledgeImportError,
} from "./platform-knowledge-import-errors.ts";

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
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw platformKnowledgeImportError("provider_rejected", "Invalid Gemini embeddings response");
  const embeddings = (value as { embeddings?: unknown }).embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== expected) throw platformKnowledgeImportError("provider_rejected", "Invalid Gemini embeddings response");
  return embeddings.map((embedding) => {
    if (typeof embedding !== "object" || embedding === null || Array.isArray(embedding)) throw platformKnowledgeImportError("provider_rejected", "Invalid Gemini embedding");
    const values = (embedding as { values?: unknown }).values;
    if (!Array.isArray(values) || values.length !== dimensions || values.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
      throw platformKnowledgeImportError("provider_rejected", "Invalid Gemini embedding");
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
          let response: Response;
          try {
            response = await fetchImpl(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:batchEmbedContents`,
            {
              method: "POST",
              headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
              signal: controller.signal,
              body,
            },
            );
          } catch {
            throw platformKnowledgeImportError("transport_failed", "Gemini embeddings transport failed");
          }
          if (response.status === 429) {
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) throw platformKnowledgeImportError("transport_failed", "Gemini retry response timed out");
            try {
              await receiveRetryableResponse(response, remainingMs);
            } catch {
              throw platformKnowledgeImportError("transport_failed", "Gemini retry response was not fully received");
            }
            if (attempt + 1 < RETRY_DELAYS_MS.length) continue;
            throw platformKnowledgeImportError("provider_rate_limited", "Gemini embeddings rate limited");
          }
          if (!response.ok) throw platformKnowledgeImportError("provider_rejected", "Gemini embeddings request rejected");
          let rawResponse: string;
          try {
            rawResponse = await response.text();
          } catch {
            throw platformKnowledgeImportError("transport_failed", "Gemini embeddings response transport failed");
          }
          let payload: unknown;
          try {
            payload = JSON.parse(rawResponse) as unknown;
          } catch {
            throw platformKnowledgeImportError("provider_rejected", "Invalid Gemini embeddings response");
          }
          output.push(...parseEmbeddings(payload, batch.length, options.dimensions));
          break;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            throw platformKnowledgeImportError("transport_failed", "Gemini embeddings request timed out");
          }
          throw error as PlatformKnowledgeImportError;
        } finally {
          clearTimeout(timeout);
        }
      }
    }
    return Object.freeze(output);
  };
}
