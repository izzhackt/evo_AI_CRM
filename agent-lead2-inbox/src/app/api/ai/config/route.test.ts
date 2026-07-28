import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiError } from '@/lib/ai/types'

const TEST_SUMMARY_CIPHERTEXT = ['summary', 'ciphertext'].join('-')
const TEST_STORED_CIPHERTEXT = ['stored', 'ciphertext'].join('-')
const TEST_STORED_PROVIDER_VALUE = ['stored', 'provider', 'value'].join('-')
const TEST_EMBEDDINGS_CIPHERTEXT = ['embeddings', 'ciphertext'].join('-')
const TEST_EMBEDDINGS_KEY = ['embeddings', 'fixture'].join('-')
const TEST_PROVIDER_KEY = ['provider', 'fixture'].join('-')

const h = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  validateAiCredentials: vi.fn(),
  embedTexts: vi.fn(),
  getAiConfigSummary: vi.fn(),
  getStoredAiConfig: vi.fn(),
  upsertAiConfig: vi.fn(),
  deleteAiConfig: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: h.getCurrentAccount,
  requireRole: h.requireRole,
  toErrorResponse: vi.fn((err: unknown) =>
    NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unauthorized' },
      { status: 500 },
    ),
  ),
}))

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { adminAction: {} },
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: vi.fn(() =>
    NextResponse.json({ error: 'rate_limited' }, { status: 429 }),
  ),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: h.encrypt,
  decrypt: h.decrypt,
}))

vi.mock('@/lib/ai/validate', () => ({
  validateAiCredentials: h.validateAiCredentials,
}))

vi.mock('@/lib/ai/embeddings', () => ({
  embedTexts: h.embedTexts,
}))

vi.mock('@/lib/ai/admin-store', () => ({
  getAiConfigSummary: h.getAiConfigSummary,
  getStoredAiConfig: h.getStoredAiConfig,
  upsertAiConfig: h.upsertAiConfig,
  deleteAiConfig: h.deleteAiConfig,
}))

import { DELETE, GET, POST } from './route'

function request(body: unknown): Request {
  return new Request('http://localhost/api/ai/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.checkRateLimit.mockReturnValue({ success: true })
  h.encrypt.mockImplementation((value: string) => `encrypted:${value}`)
  h.decrypt.mockReturnValue(TEST_STORED_PROVIDER_VALUE)
  h.validateAiCredentials.mockResolvedValue(undefined)
  h.embedTexts.mockResolvedValue(undefined)
  h.upsertAiConfig.mockResolvedValue({ error: null })
  h.deleteAiConfig.mockResolvedValue({ error: null })
})

describe('AI config route', () => {
  it('GET derives booleans from the admin store and never returns ciphertext', async () => {
    h.getCurrentAccount.mockResolvedValue({ accountId: 'acct-1' })
    h.getAiConfigSummary.mockResolvedValue({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      system_prompt: 'Help',
      is_active: true,
      auto_reply_enabled: true,
      auto_reply_max_per_conversation: 9,
      api_key: TEST_SUMMARY_CIPHERTEXT,
      embeddings_provider: 'openai',
      embeddings_api_key: TEST_EMBEDDINGS_CIPHERTEXT,
    })

    const response = await GET()

    expect(h.getAiConfigSummary).toHaveBeenCalledWith('acct-1')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      configured: true,
      has_key: true,
      has_embeddings_key: true,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      system_prompt: 'Help',
      is_active: true,
      embeddings_provider: 'openai',
      auto_reply_enabled: false,
      auto_reply_max_per_conversation: 1,
    })
  })

  it('POST reuses the stored ciphertext only through the admin store', async () => {
    h.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-1' })
    h.getStoredAiConfig.mockResolvedValue({
      id: 'cfg-1',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      system_prompt: null,
      is_active: true,
      auto_reply_enabled: false,
      auto_reply_max_per_conversation: 1,
      api_key: TEST_STORED_CIPHERTEXT,
      embeddings_provider: 'keyword',
      embeddings_api_key: null,
    })

    const response = await POST(
      request({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        system_prompt: 'Updated',
        is_active: true,
      }),
    )

    expect(response.status).toBe(200)
    expect(h.getStoredAiConfig).toHaveBeenCalledWith('acct-1')
    expect(h.decrypt).toHaveBeenCalledWith(TEST_STORED_CIPHERTEXT)
    expect(h.upsertAiConfig).toHaveBeenCalledWith(
      'acct-1',
      'user-1',
      'cfg-1',
      expect.objectContaining({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        system_prompt: 'Updated',
      }),
    )
  })

  it('POST validates embeddings override keys before storing them', async () => {
    h.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-1' })
    h.getStoredAiConfig.mockResolvedValue({
      id: 'cfg-1',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      system_prompt: null,
      is_active: true,
      auto_reply_enabled: false,
      auto_reply_max_per_conversation: 1,
      api_key: TEST_STORED_CIPHERTEXT,
      embeddings_provider: 'keyword',
      embeddings_api_key: null,
    })

    const response = await POST(
      request({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        embeddings_provider: 'openai',
        embeddings_api_key: TEST_EMBEDDINGS_KEY,
        is_active: true,
      }),
    )

    expect(response.status).toBe(200)
    expect(h.embedTexts).toHaveBeenCalledWith(
      { provider: 'openai', apiKey: TEST_EMBEDDINGS_KEY },
      ['ping'],
      'validation',
    )
    expect(h.upsertAiConfig).toHaveBeenCalledWith(
      'acct-1',
      'user-1',
      'cfg-1',
      expect.objectContaining({
        embeddings_provider: 'openai',
        embeddings_api_key: `encrypted:${TEST_EMBEDDINGS_KEY}`,
      }),
    )
  })

  it('POST returns typed provider validation failures before saving', async () => {
    h.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'user-1' })
    h.getStoredAiConfig.mockResolvedValue(null)
    h.validateAiCredentials.mockRejectedValue(
      new AiError('Gemini rejected the API key', {
        code: 'invalid_key',
        status: 401,
      }),
    )

    const response = await POST(
      request({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        api_key: TEST_PROVIDER_KEY,
        is_active: true,
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Gemini rejected the API key',
      code: 'invalid_key',
    })
    expect(h.upsertAiConfig).not.toHaveBeenCalled()
  })

  it('DELETE removes the config through the admin store after role resolution', async () => {
    h.requireRole.mockResolvedValue({ accountId: 'acct-1' })

    const response = await DELETE()

    expect(response.status).toBe(200)
    expect(h.deleteAiConfig).toHaveBeenCalledWith('acct-1')
    await expect(response.json()).resolves.toEqual({ success: true })
  })
})
