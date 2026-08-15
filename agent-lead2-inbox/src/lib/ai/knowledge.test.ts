import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({ embedTexts: vi.fn() }))
vi.mock('./embeddings', () => ({
  embedTexts: h.embedTexts,
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}))

import {
  ingestDocument,
  retrieveKnowledge,
  retrieveKnowledgeWithEvidence,
} from './knowledge'

interface FakeState {
  semantic: { id: string; content: string }[]
  fts: { id: string; content: string }[]
  chunkCount: number
  rpcCalls: string[]
  rpcArgs: Record<string, unknown>[]
  inserted: Record<string, unknown>[] | null
  deletedFor: string | null
  sourcePaths: Record<string, string>
}

function makeDb() {
  const state: FakeState = {
    semantic: [],
    fts: [],
    chunkCount: 5, // account has a non-empty KB by default
    rpcCalls: [],
    rpcArgs: [],
    inserted: null,
    deletedFor: null,
    sourcePaths: {},
  }
  const db = {
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push(name)
      state.rpcArgs.push(args)
      if (name === 'match_ai_knowledge_semantic')
        return Promise.resolve({ data: state.semantic, error: null })
      if (name === 'match_ai_knowledge_fts')
        return Promise.resolve({ data: state.fts, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    from: () => ({
      // retrieveKnowledge's empty-KB count guard.
      select: () => ({
        eq: () => ({
          eq: () => ({
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve({ count: state.chunkCount, error: null }).then(
                resolve
              ),
            in: (_column: string, ids: string[]) =>
              Promise.resolve({
                data: ids.flatMap((id) =>
                  state.sourcePaths[id]
                    ? [
                        {
                          id,
                          ai_knowledge_documents: {
                            source_path: state.sourcePaths[id],
                          },
                        },
                      ]
                    : []
                ),
                error: null,
              }),
          }),
        }),
      }),
      delete: () => ({
        eq: (_col: string, val: string) => {
          state.deletedFor = val
          return Promise.resolve({ error: null })
        },
      }),
      insert: (rows: Record<string, unknown>[]) => {
        state.inserted = rows
        return Promise.resolve({ error: null })
      },
    }),
  }
  return { db: db as unknown as SupabaseClient, state }
}

beforeEach(() => {
  h.embedTexts.mockReset()
  h.embedTexts.mockImplementation(async (_config: unknown, inputs: string[]) =>
    inputs.map((_, i) => [i, i])
  )
})

describe('retrieveKnowledge', () => {
  it('returns [] for an empty query without touching the DB', async () => {
    const { db, state } = makeDb()
    expect(
      await retrieveKnowledge(
        db,
        'acct',
        'client',
        { embeddingsProvider: 'keyword', embeddingsApiKey: null },
        '  '
      )
    ).toEqual([])
    expect(state.rpcCalls).toEqual([])
  })

  it('short-circuits (no embed, no RPC) when the KB is empty', async () => {
    const { db, state } = makeDb()
    state.chunkCount = 0
    const out = await retrieveKnowledge(
      db,
      'acct',
      'client',
      { embeddingsProvider: 'gemini', embeddingsApiKey: 'AIza-x' },
      'q'
    )
    expect(out).toEqual([])
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(state.rpcCalls).toEqual([])
  })

  it('uses lexical FTS only when keyword provider is selected', async () => {
    const { db, state } = makeDb()
    state.fts = [{ id: 'f1', content: 'F1' }]
    const out = await retrieveKnowledge(
      db,
      'acct',
      'client',
      { embeddingsProvider: 'keyword', embeddingsApiKey: 'sk-unused' },
      'q'
    )
    expect(out).toEqual(['F1'])
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_fts'])
    expect(state.rpcArgs[0]).toEqual(
      expect.objectContaining({ p_account_id: 'acct', p_audience: 'client' })
    )
    expect(h.embedTexts).not.toHaveBeenCalled()
  })

  it('falls back to lexical FTS when a semantic provider has no key', async () => {
    const { db, state } = makeDb()
    state.fts = [{ id: 'f1', content: 'F1' }]
    const out = await retrieveKnowledge(
      db,
      'acct',
      'client',
      { embeddingsProvider: 'gemini', embeddingsApiKey: null },
      'q'
    )
    expect(out).toEqual(['F1'])
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_fts'])
    expect(h.embedTexts).not.toHaveBeenCalled()
  })

  it('uses semantic search when Gemini embeddings are configured', async () => {
    const { db, state } = makeDb()
    state.semantic = [
      { id: 's1', content: 'S1' },
      { id: 's2', content: 'S2' },
      { id: 's3', content: 'S3' },
    ]
    const out = await retrieveKnowledge(
      db,
      'acct',
      'client',
      { embeddingsProvider: 'gemini', embeddingsApiKey: 'AIza-x' },
      'q',
      3
    )
    expect(out).toEqual(['S1', 'S2', 'S3'])
    expect(h.embedTexts).toHaveBeenCalledWith(
      { provider: 'gemini', apiKey: 'AIza-x' },
      ['q'],
      'query'
    )
    // Enough semantic hits → no FTS top-up.
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_semantic'])
  })

  it('retrieves Russian/Kyrgyz WhatsApp wording through semantic search', async () => {
    const { db, state } = makeDb()
    state.semantic = [
      {
        id: 'kg-ru-germany',
        content:
          'Германия боюнча консультация: документы, дедлайны, языковой курс жана виза планы.',
      },
    ]

    const out = await retrieveKnowledge(
      db,
      'acct',
      'client',
      { embeddingsProvider: 'gemini', embeddingsApiKey: 'AIza-x' },
      'Салам, Германияга окууга кантип тапшырсам болот?',
      1
    )

    expect(out).toEqual([
      'Германия боюнча консультация: документы, дедлайны, языковой курс жана виза планы.',
    ])
    expect(h.embedTexts).toHaveBeenCalledWith(
      { provider: 'gemini', apiKey: 'AIza-x' },
      ['Салам, Германияга окууга кантип тапшырсам болот?'],
      'query'
    )
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_semantic'])
  })

  it('tops up with FTS and dedupes when semantic is short', async () => {
    const { db, state } = makeDb()
    state.semantic = [
      { id: 's1', content: 'S1' },
      { id: 's2', content: 'S2' },
    ]
    state.fts = [
      { id: 's2', content: 'S2-dup' }, // dedup by id
      { id: 'f1', content: 'F1' },
    ]
    const out = await retrieveKnowledge(
      db,
      'acct',
      'client',
      { embeddingsProvider: 'openai', embeddingsApiKey: 'sk-x' },
      'q',
      3
    )
    expect(out).toEqual(['S1', 'S2', 'F1'])
    expect(state.rpcCalls).toEqual([
      'match_ai_knowledge_semantic',
      'match_ai_knowledge_fts',
    ])
  })

  it('returns the exact chunk ids used as immutable draft evidence', async () => {
    const { db, state } = makeDb()
    state.fts = [
      { id: 'chunk-1', content: 'Italy admissions evidence' },
      { id: 'chunk-2', content: 'Scholarship evidence' },
    ]
    state.sourcePaths = {
      'chunk-1': 'Страны/Италия.md',
      'chunk-2': 'Услуги/Стипендии.md',
    }

    await expect(
      retrieveKnowledgeWithEvidence(
        db,
        'acct',
        'client',
        { embeddingsProvider: 'keyword', embeddingsApiKey: null },
        'Italy scholarship'
      )
    ).resolves.toEqual({
      excerpts: ['Italy admissions evidence', 'Scholarship evidence'],
      chunkIds: ['chunk-1', 'chunk-2'],
      sources: [
        { chunk_id: 'chunk-1', source_path: 'Страны/Италия.md' },
        { chunk_id: 'chunk-2', source_path: 'Услуги/Стипендии.md' },
      ],
    })
  })

  it('excludes an unbound manual chunk from excerpts and audit identities', async () => {
    const { db, state } = makeDb()
    state.fts = [
      { id: 'managed', content: 'Проверенный управляемый источник' },
      { id: 'manual', content: 'Старая ручная заметка без provenance' },
    ]
    state.sourcePaths = { managed: 'Процессы/Проверенный процесс.md' }

    await expect(
      retrieveKnowledgeWithEvidence(
        db,
        'acct',
        'internal',
        { embeddingsProvider: 'keyword', embeddingsApiKey: null },
        'Процесс',
      ),
    ).resolves.toEqual({
      excerpts: ['Проверенный управляемый источник'],
      chunkIds: ['managed'],
      sources: [
        { chunk_id: 'managed', source_path: 'Процессы/Проверенный процесс.md' },
      ],
    })
  })
})

describe('ingestDocument', () => {
  it('embeds chunks when a key is present', async () => {
    const { db, state } = makeDb()
    await ingestDocument(
      db,
      'acct',
      'client',
      { embeddingsProvider: 'openai', embeddingsApiKey: 'sk-x' },
      'doc-1',
      'hello world'
    )
    expect(h.embedTexts).toHaveBeenCalledWith(
      { provider: 'openai', apiKey: 'sk-x' },
      ['hello world'],
      'document'
    )
    expect(state.deletedFor).toBe('doc-1')
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted![0].embedding).toBe('[0,0]') // literal from mocked embed
    expect(state.inserted![0].account_id).toBe('acct')
    expect(state.inserted![0].audience).toBe('client')
  })

  it('stores chunks without embeddings when there is no key', async () => {
    const { db, state } = makeDb()
    await ingestDocument(
      db,
      'acct',
      'client',
      { embeddingsProvider: 'keyword', embeddingsApiKey: null },
      'doc-1',
      'hello world'
    )
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(state.inserted![0].embedding).toBeNull()
  })

  it('deletes existing chunks and inserts nothing for empty content', async () => {
    const { db, state } = makeDb()
    await ingestDocument(
      db,
      'acct',
      'client',
      { embeddingsProvider: 'openai', embeddingsApiKey: 'sk-x' },
      'doc-1',
      '   '
    )
    expect(state.deletedFor).toBe('doc-1')
    expect(state.inserted).toBeNull()
    expect(h.embedTexts).not.toHaveBeenCalled()
  })

  it('still stores lexical chunks when embedding fails, then rethrows', async () => {
    const { db, state } = makeDb()
    h.embedTexts.mockRejectedValueOnce(new Error('rate limited'))
    await expect(
      ingestDocument(
        db,
        'acct',
        'client',
        { embeddingsProvider: 'gemini', embeddingsApiKey: 'AIza-x' },
        'doc-1',
        'hello world'
      )
    ).rejects.toThrow('rate limited')
    // Chunks were inserted (lexical search works) despite the embed failure…
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted![0].embedding).toBeNull()
  })
})
