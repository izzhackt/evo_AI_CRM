import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EMBEDDING_DIMENSIONS, embedTexts, toVectorLiteral } from './embeddings'
import { AiError } from './types'

function okEmbeddings(count: number, shuffle = false): Response {
  const rows = Array.from({ length: count }, (_, i) => ({
    embedding: [i, i + 0.5],
    index: i,
  }))
  if (shuffle) rows.reverse()
  return { ok: true, status: 200, json: async () => ({ data: rows }) } as unknown as Response
}

function okGeminiEmbedding(values = [0.1, 0.2]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ embedding: { values } }),
  } as unknown as Response
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

describe('toVectorLiteral', () => {
  it('formats a pgvector literal', () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]')
  })
})

describe('embedTexts', () => {
  it('returns [] and makes no request for empty input', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await embedTexts({ provider: 'openai', apiKey: 'sk-x' }, [])).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('embeds a single batch and sends the key', async () => {
    const fetchMock = vi.fn(async (_url: string, opts: { body: string }) => {
      const n = JSON.parse(opts.body).input.length
      return okEmbeddings(n)
    })
    vi.stubGlobal('fetch', fetchMock)

    const out = await embedTexts({ provider: 'openai', apiKey: 'sk-x' }, ['a', 'b', 'c'])
    expect(out).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.openai.com')
    expect(
      (opts as unknown as { headers: Record<string, string> }).headers.Authorization,
    ).toBe('Bearer sk-x')
  })

  it('splits large inputs into multiple batches', async () => {
    const fetchMock = vi.fn(async (_url: string, opts: { body: string }) => {
      const n = JSON.parse(opts.body).input.length
      return okEmbeddings(n)
    })
    vi.stubGlobal('fetch', fetchMock)

    const inputs = Array.from({ length: 100 }, (_, i) => `t${i}`)
    const out = await embedTexts({ provider: 'openai', apiKey: 'sk-x' }, inputs)
    expect(out).toHaveLength(100)
    expect(fetchMock).toHaveBeenCalledTimes(2) // 96 + 4
  })

  it('reorders by index when the provider returns them shuffled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts: { body: string }) => {
        const n = JSON.parse(opts.body).input.length
        return okEmbeddings(n, true)
      }),
    )
    const out = await embedTexts({ provider: 'openai', apiKey: 'sk-x' }, ['a', 'b', 'c'])
    expect(out[0]).toEqual([0, 0.5]) // index 0 first despite shuffle
    expect(out[2]).toEqual([2, 2.5])
  })

  it('maps a 401 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'bad key' } }),
      } as unknown as Response),
    )
    await expect(
      embedTexts({ provider: 'openai', apiKey: 'sk-x' }, ['a']),
    ).rejects.toMatchObject({
      code: 'invalid_key',
    })
  })

  it('throws when the provider omits result indices', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [0.1] }, { embedding: [0.2] }] }),
      } as unknown as Response),
    )
    await expect(
      embedTexts({ provider: 'openai', apiKey: 'sk-x' }, ['a', 'b']),
    ).rejects.toBeInstanceOf(AiError)
  })

  it('throws on a malformed response (count mismatch)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as unknown as Response),
    )
    await expect(
      embedTexts({ provider: 'openai', apiKey: 'sk-x' }, ['a', 'b']),
    ).rejects.toBeInstanceOf(AiError)
  })

  it('calls Gemini embedContent with a 1536-dim retrieval query prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okGeminiEmbedding([0.3, 0.4]))
    vi.stubGlobal('fetch', fetchMock)

    const out = await embedTexts(
      { provider: 'gemini', apiKey: 'AIza-test' },
      ['Салам, Германияга окууга кантип тапшырсам болот?'],
      'query',
    )

    expect(out).toEqual([[0.3, 0.4]])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('generativelanguage.googleapis.com')
    expect(url).toContain('/models/gemini-embedding-2:embedContent')
    expect((opts as { headers: Record<string, string> }).headers['x-goog-api-key']).toBe(
      'AIza-test',
    )
    const body = JSON.parse((opts as { body: string }).body)
    expect(body.output_dimensionality).toBe(EMBEDDING_DIMENSIONS)
    expect(body.content.parts[0].text).toContain('task: search result | query:')
    expect(body.content.parts[0].text).toContain('Германияга окууга')
  })

  it('calls Gemini embedContent with the document retrieval structure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okGeminiEmbedding([0.5, 0.6]))
    vi.stubGlobal('fetch', fetchMock)

    await embedTexts(
      { provider: 'gemini', apiKey: 'AIza-test' },
      ['Германия: консультация, документы, дедлайны.'],
      'document',
    )

    const [, opts] = fetchMock.mock.calls[0]
    const body = JSON.parse((opts as { body: string }).body)
    expect(body.content.parts[0].text).toBe(
      'title: none | text: Германия: консультация, документы, дедлайны.',
    )
  })

  it('throws when Gemini omits the embedding vector', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ embedding: {} }),
      } as unknown as Response),
    )

    await expect(
      embedTexts({ provider: 'gemini', apiKey: 'AIza-test' }, ['q'], 'query'),
    ).rejects.toMatchObject({ code: 'embeddings_malformed' })
  })
})
