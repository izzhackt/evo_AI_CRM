import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { AiDraftAuditError, recordAiDraftAudit } from './draft-audit';

function makeDb(result: { data: { id: string } | null; error: unknown }) {
  const single = vi.fn(async () => result);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));

  return {
    db: { from } as unknown as SupabaseClient,
    from,
    insert,
  };
}

describe('recordAiDraftAudit', () => {
  it('stores operator, provider, content, and exact knowledge chunk ids', async () => {
    const { db, from, insert } = makeDb({
      data: { id: 'draft-1' },
      error: null,
    });

    await expect(
      recordAiDraftAudit(db, {
        accountId: 'acct-1',
        conversationId: 'conv-1',
        createdBy: 'user-1',
        provider: 'gemini',
        model: 'gemini-test',
        contentText: 'Audited draft',
        knowledgeChunkIds: ['chunk-1', 'chunk-2'],
      })
    ).resolves.toBe('draft-1');

    expect(from).toHaveBeenCalledWith('ai_drafts');
    expect(insert).toHaveBeenCalledWith({
      account_id: 'acct-1',
      conversation_id: 'conv-1',
      created_by: 'user-1',
      provider: 'gemini',
      model: 'gemini-test',
      content_text: 'Audited draft',
      knowledge_chunk_ids: ['chunk-1', 'chunk-2'],
      knowledge_item_count: 2,
    });
  });

  it('fails closed when the immutable audit row cannot be saved', async () => {
    const { db } = makeDb({
      data: null,
      error: { message: 'insert failed' },
    });

    await expect(
      recordAiDraftAudit(db, {
        accountId: 'acct-1',
        conversationId: 'conv-1',
        createdBy: 'user-1',
        provider: 'gemini',
        model: 'gemini-test',
        contentText: 'Do not expose this draft',
        knowledgeChunkIds: [],
      })
    ).rejects.toBeInstanceOf(AiDraftAuditError);
  });
});
