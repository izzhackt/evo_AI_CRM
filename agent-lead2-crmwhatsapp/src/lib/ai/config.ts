import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig, AiProvider, EmbeddingsProvider } from './types'

interface AiConfigRow {
  provider: AiProvider
  model: string
  api_key: string
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  embeddings_provider: EmbeddingsProvider | null
  embeddings_api_key: string | null
}

const CONFIG_COLUMNS =
  'provider, model, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, embeddings_provider, embeddings_api_key'

const EMBEDDINGS_COLUMNS =
  'provider, api_key, embeddings_provider, embeddings_api_key'

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean } = {}
): Promise<AiConfig | null> {
  const { requireActive = true } = opts
  const { data, error } = await db
    .from('ai_configs')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as AiConfigRow
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // rather than letting decrypt() throw on null.
  if (!row.api_key) return null

  const apiKey = decrypt(row.api_key)
  const embeddingsConfig = resolveEmbeddingsFromRow(row, apiKey, accountId)

  return {
    provider: row.provider,
    model: row.model,
    apiKey,
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 1,
    embeddingsProvider: embeddingsConfig.provider,
    embeddingsApiKey: embeddingsConfig.key,
  }
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ provider, key, corrupt }`: `key` is null when the selected
 * provider is keyword-only, no usable key exists, or decryption failed.
 * `corrupt` distinguishes broken ciphertext from intentionally
 * keyword-only/no-key states.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string
): Promise<{ provider: EmbeddingsProvider; key: string | null; corrupt: boolean }> {
  return loadEmbeddingsConfig(db, accountId)
}

export async function loadEmbeddingsConfig(
  db: SupabaseClient,
  accountId: string
): Promise<{ provider: EmbeddingsProvider; key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select(EMBEDDINGS_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data) {
    return { provider: 'keyword', key: null, corrupt: false }
  }

  const row = data as Pick<
    AiConfigRow,
    'provider' | 'api_key' | 'embeddings_provider' | 'embeddings_api_key'
  >
  const embeddingsProvider = normalizeEmbeddingsProvider(row.embeddings_provider)
  if (embeddingsProvider === 'keyword') {
    return { provider: 'keyword', key: null, corrupt: false }
  }

  if (row.embeddings_api_key) {
    try {
      return {
        provider: embeddingsProvider,
        key: decrypt(row.embeddings_api_key),
        corrupt: false,
      }
    } catch {
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`
      )
      return { provider: embeddingsProvider, key: null, corrupt: true }
    }
  }

  if (row.provider === embeddingsProvider && row.api_key) {
    try {
      return {
        provider: embeddingsProvider,
        key: decrypt(row.api_key),
        corrupt: false,
      }
    } catch {
      console.error(
        `[ai config] primary ${embeddingsProvider} key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`
      )
      return { provider: embeddingsProvider, key: null, corrupt: true }
    }
  }

  return { provider: embeddingsProvider, key: null, corrupt: false }
}

function resolveEmbeddingsFromRow(
  row: Pick<
    AiConfigRow,
    'provider' | 'api_key' | 'embeddings_provider' | 'embeddings_api_key'
  >,
  primaryApiKey: string,
  accountId: string,
): { provider: EmbeddingsProvider; key: string | null } {
  const provider = normalizeEmbeddingsProvider(row.embeddings_provider)
  if (provider === 'keyword') return { provider, key: null }

  if (row.embeddings_api_key) {
    try {
      return { provider, key: decrypt(row.embeddings_api_key) }
    } catch {
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`
      )
      return { provider, key: null }
    }
  }

  if (row.provider === provider) return { provider, key: primaryApiKey }
  return { provider, key: null }
}

function normalizeEmbeddingsProvider(
  value: EmbeddingsProvider | null | undefined,
): EmbeddingsProvider {
  if (value === 'gemini' || value === 'openai') return value
  return 'keyword'
}

export function isEmbeddingsProvider(value: unknown): value is EmbeddingsProvider {
  return value === 'keyword' || value === 'gemini' || value === 'openai'
}
