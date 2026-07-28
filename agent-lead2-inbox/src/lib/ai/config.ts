import { getStoredAiConfig } from '@/lib/ai/admin-store'
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

export async function loadAiConfigForAccount(
  accountId: string,
  opts: { requireActive?: boolean } = {}
): Promise<AiConfig | null> {
  const { requireActive = true } = opts
  const row = await getStoredAiConfig(accountId)
  if (!row) return null
  if (requireActive && !row.is_active) return null
  if (!row.api_key) return null

  const apiKey = decrypt(row.api_key)
  const embeddingsConfig = resolveEmbeddingsFromRow(row, apiKey, accountId)

  return {
    provider: row.provider as AiProvider,
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

export async function loadEmbeddingsConfigForAccount(
  accountId: string
): Promise<{ provider: EmbeddingsProvider; key: string | null; corrupt: boolean }> {
  const row = await getStoredAiConfig(accountId)
  if (!row) return { provider: 'keyword', key: null, corrupt: false }

  const provider = normalizeEmbeddingsProvider(row.embeddings_provider)
  if (provider === 'keyword') {
    return { provider, key: null, corrupt: false }
  }

  if (row.embeddings_api_key) {
    try {
      return { provider, key: decrypt(row.embeddings_api_key), corrupt: false }
    } catch {
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`
      )
      return { provider, key: null, corrupt: true }
    }
  }

  if (row.api_key && row.provider === provider) {
    try {
      return { provider, key: decrypt(row.api_key), corrupt: false }
    } catch {
      console.error(
        `[ai config] primary ${provider} key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`
      )
      return { provider, key: null, corrupt: true }
    }
  }

  return { provider, key: null, corrupt: false }
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
