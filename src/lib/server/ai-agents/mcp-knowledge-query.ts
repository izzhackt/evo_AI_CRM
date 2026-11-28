import "server-only";

import { createPlatformKnowledgeGeminiEmbedder } from "../platform-knowledge-embeddings.ts";

/*
 * Вектор вопроса для `search_knowledge` (миграция 384). Тот же клиент, модель и размерность, что у векторов фрагментов
 * базы знаний (`platform-knowledge-embeddings.ts`): ключ `EVO_PLATFORM_GEMINI_API_KEY` из окружения приложения.
 * Ключа нет — функция не создаётся, поиск остаётся полнотекстовым. Ключ нигде не пишется.
 */

export const KNOWLEDGE_QUERY_EMBEDDING_DIMENSIONS = 1_536;
export const KNOWLEDGE_QUERY_EMBEDDING_TIMEOUT_MS = 3_000;

export type KnowledgeQueryEmbedder = (text: string) => Promise<readonly number[] | null>;

/** null — ключа в окружении нет. Одна попытка без повторов: поиск не должен ждать провайдера дольше срока. */
export function createKnowledgeQueryEmbedder(
  environment: Readonly<Record<string, string | undefined>>,
  fetchImpl?: typeof fetch,
): KnowledgeQueryEmbedder | null {
  const apiKey = environment.EVO_PLATFORM_GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const embed = createPlatformKnowledgeGeminiEmbedder({
    apiKey,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
    timeoutMs: KNOWLEDGE_QUERY_EMBEDDING_TIMEOUT_MS,
    retryDelaysMs: [0],
  });
  return async (text) => {
    const vectors = await embed([`task: search result | query: ${text}`], {
      model: "gemini-embedding-2",
      dimensions: KNOWLEDGE_QUERY_EMBEDDING_DIMENSIONS,
    });
    return vectors[0] ?? null;
  };
}
