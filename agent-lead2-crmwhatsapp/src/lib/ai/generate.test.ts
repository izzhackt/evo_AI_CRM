import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateReply, parseGeneration } from './generate'
import { AiError, type AiConfig } from './types'

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    embeddingsApiKey: null,
    ...overrides,
  }
}

function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
  } as unknown as Response
}

function errResponse(status: number, json: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => json,
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('parseGeneration', () => {
  it('returns text with no handoff', () => {
    expect(parseGeneration('Hello there')).toEqual({
      text: 'Hello there',
      handoff: false,
    })
  })

  it('detects + strips the handoff sentinel', () => {
    expect(parseGeneration('[[HANDOFF]]')).toEqual({ text: '', handoff: true })
    expect(parseGeneration('Let me get a human [[HANDOFF]]')).toEqual({
      text: 'Let me get a human',
      handoff: true,
    })
  })
})

describe('generateReply — OpenAI', () => {
  it('calls the chat completions endpoint and returns the reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Sure — happy to help!' } }],
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res).toEqual({ text: 'Sure — happy to help!', handoff: false })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.openai.com')
    expect(opts.headers.Authorization).toBe('Bearer sk-test')
  })

  it('maps a 401 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          errResponse(401, { error: { message: 'Incorrect API key' } })
        )
    )

    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      })
    ).rejects.toMatchObject({ code: 'invalid_key', status: 401 })
  })

  it('throws on an empty completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          okResponse({ choices: [{ message: { content: '' } }] })
        )
    )
    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      })
    ).rejects.toBeInstanceOf(AiError)
  })
})

describe('generateReply — Anthropic', () => {
  it('calls the messages endpoint with the version header and parses text blocks', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse({ content: [{ type: 'text', text: 'Hi there!' }] })
      )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'anthropic', apiKey: 'sk-ant-x' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(res).toEqual({ text: 'Hi there!', handoff: false })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.anthropic.com')
    expect(opts.headers['x-api-key']).toBe('sk-ant-x')
    expect(opts.headers['anthropic-version']).toBeTruthy()
  })

  it('detects handoff in the model output', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          okResponse({ content: [{ type: 'text', text: '[[HANDOFF]]' }] })
        )
    )
    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'I want to speak to a person' }],
    })
    expect(res.handoff).toBe(true)
    expect(res.text).toBe('')
  })

  it('drops a leading assistant turn so the payload starts on the customer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse({ content: [{ type: 'text', text: 'ok' }] })
      )
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [
        { role: 'assistant', content: 'Welcome!' },
        { role: 'user', content: 'Hi' },
      ],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages).toHaveLength(1)
  })
})

describe('generateReply — Gemini', () => {
  it('calls the Interactions API and returns output_text', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ output_text: 'Sure, I can help.' }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        apiKey: 'AIza-test',
      }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res).toEqual({ text: 'Sure, I can help.', handoff: false })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain(
      'generativelanguage.googleapis.com/v1beta/interactions'
    )
    expect(opts.headers['x-goog-api-key']).toBe('AIza-test')
    const body = JSON.parse(opts.body)
    expect(body).toMatchObject({
      model: 'gemini-3.5-flash',
      store: false,
      system_instruction: 'sys',
      generation_config: { max_output_tokens: expect.any(Number) },
    })
    expect(body.input).not.toContain('sys')
    expect(body.input).toContain('Customer: Hi')
  })

  it('parses model_output steps when output_text is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          steps: [
            { type: 'thought', content: [{ type: 'text', text: 'thinking' }] },
            {
              type: 'model_output',
              content: [{ type: 'text', text: '[[HANDOFF]]' }],
            },
          ],
        })
      )
    )

    const res = await generateReply({
      config: config({ provider: 'gemini' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Can I speak to a person?' }],
    })

    expect(res).toEqual({ text: '', handoff: true })
  })

  it('ignores non-model_output text when output_text is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          steps: [
            { type: 'model_output', content: [{ type: 'text', text: 'Final' }] },
            { type: 'thought', content: [{ type: 'text', text: 'Do not expose' }] },
          ],
        })
      )
    )

    const res = await generateReply({
      config: config({ provider: 'gemini' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res.text).toBe('Final')
  })

  it('maps a 403 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          errResponse(403, { error: { message: 'API key not valid' } })
        )
    )

    await expect(
      generateReply({
        config: config({ provider: 'gemini' }),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      })
    ).rejects.toMatchObject({
      code: 'invalid_key',
      status: 401,
    } satisfies Partial<AiError>)
  })
})
