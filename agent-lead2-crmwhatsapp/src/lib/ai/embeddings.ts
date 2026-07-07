import { AiError } from './types'
import type { EmbeddingsProvider } from './types'
import { aiRequestTimeoutMs } from './defaults'
import { providerHttpError, toNetworkError } from './providers/shared'

// ============================================================
// Embeddings (OpenAI + Gemini).
//
// Used for the knowledge base's optional semantic-search path. Keyword
// mode never calls this module; Gemini/OpenAI modes embed each chunk at
// ingest and embed the query at retrieval. Both providers are pinned to
// 1536 dimensions to match migration 030's `vector(1536)` column.
// ============================================================

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'
const GEMINI_EMBEDDINGS_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models'

export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-2'
export const EMBEDDING_DIMENSIONS = 1536

// OpenAI accepts an array input; keep batches modest so a big re-index
// stays under request-size limits and partial failures are cheap.
const BATCH_SIZE = 96

type SemanticEmbeddingsProvider = Exclude<EmbeddingsProvider, 'keyword'>
export type EmbeddingPurpose = 'document' | 'query' | 'validation'

export interface EmbeddingRequestConfig {
  provider: SemanticEmbeddingsProvider
  apiKey: string
}

interface EmbeddingResponse {
  data?: { embedding?: number[]; index?: number }[]
}

interface GeminiEmbeddingResponse {
  embedding?: { values?: number[] }
}

/** Format a vector for a pgvector column / RPC param: `[0.1,0.2,...]`.
 *  PostgREST casts this text literal to `vector`; a raw JS array does
 *  not cast reliably. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/**
 * Embed a list of strings, preserving input order. Batched; throws
 * `AiError` on provider/network failure so callers can decide whether
 * to degrade (retrieval) or surface (ingest).
 */
export async function embedTexts(
  config: EmbeddingRequestConfig,
  inputs: string[],
  purpose: EmbeddingPurpose = 'document',
): Promise<number[][]> {
  if (inputs.length === 0) return []
  if (config.provider === 'gemini') {
    return embedGeminiTexts(config.apiKey, inputs, purpose)
  }
  if (config.provider === 'openai') {
    return embedOpenAiTexts(config.apiKey, inputs)
  }
  throw new AiError(`Unsupported embeddings provider: ${config.provider}`, {
    code: 'unsupported_embeddings_provider',
    status: 400,
  })
}

async function embedOpenAiTexts(
  apiKey: string,
  inputs: string[],
): Promise<number[][]> {
  const timeoutMs = aiRequestTimeoutMs()
  const out: number[][] = []

  for (let start = 0; start < inputs.length; start += BATCH_SIZE) {
    const batch = inputs.slice(start, start + BATCH_SIZE)

    let res: Response
    try {
      res = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw toNetworkError(err)
    }

    if (!res.ok) {
      throw await providerHttpError('OpenAI embeddings', res)
    }

    const data = (await res.json().catch(() => null)) as EmbeddingResponse | null
    const rows = data?.data
    if (!rows || rows.length !== batch.length) {
      throw new AiError('Embeddings response was malformed.', {
        code: 'embeddings_malformed',
      })
    }

    // Sort by index so order matches the input batch regardless of how
    // the provider returns them. Require a real numeric index — defaulting
    // a missing one to 0 would silently misalign chunks with their
    // vectors (chunk N gets chunk M's embedding), so fail loud instead.
    if (rows.some((r) => typeof r.index !== 'number')) {
      throw new AiError('Embeddings response was missing result indices.', {
        code: 'embeddings_malformed',
      })
    }
    const ordered = [...rows].sort((a, b) => a.index! - b.index!)
    for (const r of ordered) {
      if (!Array.isArray(r.embedding)) {
        throw new AiError('Embeddings response missing a vector.', {
          code: 'embeddings_malformed',
        })
      }
      out.push(r.embedding)
    }
  }

  return out
}

async function embedGeminiTexts(
  apiKey: string,
  inputs: string[],
  purpose: EmbeddingPurpose,
): Promise<number[][]> {
  const timeoutMs = aiRequestTimeoutMs()
  const out: number[][] = []

  for (const input of inputs) {
    let res: Response
    try {
      res = await fetch(geminiEmbeddingUrl(GEMINI_EMBEDDING_MODEL), {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: {
            parts: [{ text: formatGeminiEmbeddingInput(input, purpose) }],
          },
          // REST docs use snake_case for direct JSON requests.
          output_dimensionality: EMBEDDING_DIMENSIONS,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw toNetworkError(err)
    }

    if (!res.ok) {
      throw await providerHttpError('Gemini embeddings', res)
    }

    const data = (await res.json().catch(() => null)) as
      | GeminiEmbeddingResponse
      | null
    const embedding = data?.embedding?.values
    if (!Array.isArray(embedding)) {
      throw new AiError('Embeddings response missing a vector.', {
        code: 'embeddings_malformed',
      })
    }
    out.push(embedding)
  }

  return out
}

function geminiEmbeddingUrl(model: string): string {
  const modelId = model.replace(/^models\//, '')
  return `${GEMINI_EMBEDDINGS_BASE_URL}/${encodeURIComponent(modelId)}:embedContent`
}

function formatGeminiEmbeddingInput(
  input: string,
  purpose: EmbeddingPurpose,
): string {
  const text = input.trim()
  if (purpose === 'document') return `title: none | text: ${text}`
  return `task: search result | query: ${text}`
}
