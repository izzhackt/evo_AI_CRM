import "server-only";

const BATCH_SIZE = 96;

type EmbeddingOptions = Readonly<{
  model: "gemini-embedding-2";
  dimensions: 1_536;
  taskType: "RETRIEVAL_DOCUMENT";
}>;

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
}>) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 30_000;
  return async function embed(texts: readonly string[], options: EmbeddingOptions): Promise<readonly (readonly number[])[]> {
    const output: (readonly number[])[] = [];
    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const batch = texts.slice(start, start + BATCH_SIZE);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:batchEmbedContents`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": input.apiKey },
            signal: controller.signal,
            body: JSON.stringify({
              requests: batch.map((text) => ({
                model: `models/${options.model}`,
                content: { parts: [{ text }] },
                taskType: options.taskType,
                outputDimensionality: options.dimensions,
              })),
            }),
          },
        );
        if (!response.ok) throw new Error("Gemini embeddings request rejected");
        output.push(...parseEmbeddings(await response.json() as unknown, batch.length, options.dimensions));
      } finally {
        clearTimeout(timeout);
      }
    }
    return Object.freeze(output);
  };
}
