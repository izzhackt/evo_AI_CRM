import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StoredAiConfigRow } from './admin-store'

// decrypt is identity in tests so we don't depend on real ciphertext.
const { decrypt, getStoredAiConfig } = vi.hoisted(() => ({
  decrypt: vi.fn((value: string) => `plain:${value}`),
  getStoredAiConfig: vi.fn(),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt,
}))

vi.mock('./admin-store', () => ({
  getStoredAiConfig,
}))

import { loadAiConfigForAccount, loadEmbeddingsConfigForAccount } from './config'

const ROW: StoredAiConfigRow = {
  id: 'cfg-1',
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

beforeEach(() => {
  getStoredAiConfig.mockReset()
  decrypt.mockReset()
  decrypt.mockImplementation((value: string) => `plain:${value}`)
})

describe('loadAiConfigForAccount requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    getStoredAiConfig.mockResolvedValue(ROW)
    expect(await loadAiConfigForAccount('acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    getStoredAiConfig.mockResolvedValue(ROW)
    const config = await loadAiConfigForAccount('acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.apiKey).toBe('plain:enc-key')
  })

  it('uses the main Gemini key for Gemini embeddings when no override key is set', async () => {
    getStoredAiConfig.mockResolvedValue({
      ...ROW,
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      is_active: true,
      embeddings_provider: 'gemini',
    })
    const config = await loadAiConfigForAccount('acct')

    expect(config).toMatchObject({
      provider: 'gemini',
      embeddingsProvider: 'gemini',
      embeddingsApiKey: 'plain:enc-key',
    })
  })

  it('keeps semantic retrieval disabled in keyword mode even when an old key exists', async () => {
    getStoredAiConfig.mockResolvedValue({
      ...ROW,
      is_active: true,
      embeddings_provider: 'keyword',
      embeddings_api_key: 'enc-embeddings',
    })
    const config = await loadAiConfigForAccount('acct')

    expect(config).toMatchObject({
      embeddingsProvider: 'keyword',
      embeddingsApiKey: null,
    })
  })

  it('loads a Gemini config row', async () => {
    getStoredAiConfig.mockResolvedValue({
      ...ROW,
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      is_active: true,
    })
    const config = await loadAiConfigForAccount('acct')

    expect(config).toMatchObject({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
    })
    expect(config!.apiKey).toBe('plain:enc-key')
  })

  it('forces auto-reply off even if a stored row enables it', async () => {
    getStoredAiConfig.mockResolvedValue({
      ...ROW,
      auto_reply_enabled: true,
      auto_reply_max_per_conversation: 20,
    })
    const config = await loadAiConfigForAccount('acct', { requireActive: false })

    expect(config!.autoReplyEnabled).toBe(false)
    expect(config!.autoReplyMaxPerConversation).toBe(1)
  })

  it('returns null when there is no row', async () => {
    getStoredAiConfig.mockResolvedValue(null)
    expect(await loadAiConfigForAccount('acct', { requireActive: false })).toBeNull()
  })
})

describe('loadEmbeddingsConfigForAccount', () => {
  it('loads Gemini embeddings from the primary Gemini key independent of active status', async () => {
    getStoredAiConfig.mockResolvedValue({
      ...ROW,
      provider: 'gemini',
      api_key: 'enc-gemini',
      embeddings_provider: 'gemini',
      embeddings_api_key: null,
    })
    await expect(loadEmbeddingsConfigForAccount('acct')).resolves.toEqual({
      provider: 'gemini',
      key: 'plain:enc-gemini',
      corrupt: false,
    })
  })

  it('loads OpenAI embeddings from the override key when the chat provider differs', async () => {
    getStoredAiConfig.mockResolvedValue({
      ...ROW,
      provider: 'gemini',
      api_key: 'enc-gemini',
      embeddings_provider: 'openai',
      embeddings_api_key: 'enc-openai-embed',
    })
    await expect(loadEmbeddingsConfigForAccount('acct')).resolves.toEqual({
      provider: 'openai',
      key: 'plain:enc-openai-embed',
      corrupt: false,
    })
  })

  it('marks corrupt primary provider ciphertext as corrupt instead of throwing', async () => {
    getStoredAiConfig.mockResolvedValue({
      ...ROW,
      provider: 'gemini',
      api_key: 'bad-primary',
      embeddings_provider: 'gemini',
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    decrypt.mockImplementation((value: string) => {
      if (value === 'bad-primary') throw new Error('decrypt failed')
      return `plain:${value}`
    })

    await expect(loadEmbeddingsConfigForAccount('acct')).resolves.toEqual({
      provider: 'gemini',
      key: null,
      corrupt: true,
    })
    expect(errorSpy).toHaveBeenCalledOnce()
    errorSpy.mockRestore()
  })

  it('returns a keyword config when no AI config row exists', async () => {
    getStoredAiConfig.mockResolvedValue(null)
    await expect(loadEmbeddingsConfigForAccount('acct')).resolves.toEqual({
      provider: 'keyword',
      key: null,
      corrupt: false,
    })
  })
})
