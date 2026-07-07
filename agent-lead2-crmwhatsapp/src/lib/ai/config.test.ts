import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import { loadAiConfig, loadEmbeddingsConfig } from './config'

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  embeddings_provider: 'keyword',
  embeddings_api_key: null,
}

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.apiKey).toBe('plain:enc-key')
  })

  it('uses the main Gemini key for Gemini embeddings when no override key is set', async () => {
    const config = await loadAiConfig(
      dbReturning({
        ...ROW,
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        is_active: true,
        embeddings_provider: 'gemini',
      }),
      'acct',
    )

    expect(config).toMatchObject({
      provider: 'gemini',
      embeddingsProvider: 'gemini',
      embeddingsApiKey: 'plain:enc-key',
    })
  })

  it('keeps semantic retrieval disabled in keyword mode even when an old key exists', async () => {
    const config = await loadAiConfig(
      dbReturning({
        ...ROW,
        is_active: true,
        embeddings_provider: 'keyword',
        embeddings_api_key: 'enc-embeddings',
      }),
      'acct',
    )

    expect(config).toMatchObject({
      embeddingsProvider: 'keyword',
      embeddingsApiKey: null,
    })
  })

  it('loads a Gemini config row', async () => {
    const config = await loadAiConfig(
      dbReturning({
        ...ROW,
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        is_active: true,
      }),
      'acct'
    )

    expect(config).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
    })
    expect(config!.apiKey).toBe('plain:enc-key')
  })

  it('forces auto-reply off even if a stored row enables it', async () => {
    const config = await loadAiConfig(
      dbReturning({
        ...ROW,
        auto_reply_enabled: true,
        auto_reply_max_per_conversation: 20,
      }),
      'acct',
      { requireActive: false }
    )

    expect(config!.autoReplyEnabled).toBe(false)
    expect(config!.autoReplyMaxPerConversation).toBe(1)
  })

  it('returns null when there is no row', async () => {
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false })
    ).toBeNull()
  })
})

describe('loadEmbeddingsConfig', () => {
  it('loads Gemini embeddings from the primary Gemini key independent of active status', async () => {
    await expect(
      loadEmbeddingsConfig(
        dbReturning({
          ...ROW,
          provider: 'gemini',
          api_key: 'enc-gemini',
          embeddings_provider: 'gemini',
          embeddings_api_key: null,
        }),
        'acct',
      ),
    ).resolves.toEqual({
      provider: 'gemini',
      key: 'plain:enc-gemini',
      corrupt: false,
    })
  })

  it('loads OpenAI embeddings from the override key when the chat provider differs', async () => {
    await expect(
      loadEmbeddingsConfig(
        dbReturning({
          ...ROW,
          provider: 'gemini',
          api_key: 'enc-gemini',
          embeddings_provider: 'openai',
          embeddings_api_key: 'enc-openai-embed',
        }),
        'acct',
      ),
    ).resolves.toEqual({
      provider: 'openai',
      key: 'plain:enc-openai-embed',
      corrupt: false,
    })
  })

  it('returns a keyword config when no AI config row exists', async () => {
    await expect(loadEmbeddingsConfig(dbReturning(null), 'acct')).resolves.toEqual({
      provider: 'keyword',
      key: null,
      corrupt: false,
    })
  })
})
