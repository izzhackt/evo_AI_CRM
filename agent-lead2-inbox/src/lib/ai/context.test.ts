import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildConversationContext } from './context'

/** Minimal fake matching the query chain in buildConversationContext:
 *  from().select().eq().eq().in().order().limit() → { data, error }. */
function fakeDb(rows: unknown[]): SupabaseClient {
  let filteredRows = rows
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    in: (_column: string, values: string[]) => {
      if (
        filteredRows.some(
          (row) => !!row && typeof row === 'object' && 'status' in row,
        )
      ) {
        filteredRows = filteredRows.filter(
          (row) =>
            !!row &&
            typeof row === 'object' &&
            'status' in row &&
            values.includes(String((row as { status: unknown }).status)),
        )
      }
      return chain
    },
    order: () => chain,
    limit: () => Promise.resolve({ data: filteredRows, error: null }),
  }
  return chain as unknown as SupabaseClient
}

describe('buildConversationContext', () => {
  it('maps sender_type to role and returns chronological order', async () => {
    // DB returns newest-first (created_at DESC); the fn reverses it.
    const rows = [
      { sender_type: 'customer', content_text: 'third' },
      { sender_type: 'agent', content_text: 'second' },
      { sender_type: 'customer', content_text: 'first' },
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
  })

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'bot', content_text: 'auto reply' }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }])
  })

  it('drops empty / whitespace-only messages', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: '   ' },
        { sender_type: 'customer', content_text: null },
        { sender_type: 'customer', content_text: 'real' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })

  it('excludes sending, failed, and ambiguous outbound rows', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'agent', content_text: 'uncertain', status: 'sending' },
        { sender_type: 'agent', content_text: 'rejected', status: 'failed' },
        {
          sender_type: 'customer',
          content_text: 'received',
          status: 'delivered',
        },
      ]),
      'conv-1',
    )

    expect(out).toEqual([{ role: 'user', content: 'received' }])
  })
})
