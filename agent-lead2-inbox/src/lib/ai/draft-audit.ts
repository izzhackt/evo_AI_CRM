import type { SupabaseClient } from '@supabase/supabase-js';

import type { AiProvider } from './types';

export interface AiDraftAuditInput {
  accountId: string;
  conversationId: string;
  createdBy: string;
  provider: AiProvider;
  model: string;
  contentText: string;
  knowledgeChunkIds: string[];
}

export class AiDraftAuditError extends Error {
  readonly code = 'ai_draft_audit_failed';

  constructor() {
    super(
      'The AI draft was generated but could not be saved for operator review.'
    );
    this.name = 'AiDraftAuditError';
  }
}

/**
 * Persist an immutable draft audit before exposing generated text to the UI.
 * The caller supplies a service-role client because authenticated users have
 * read-only access to `ai_drafts`; the route has already authorized and scoped
 * the account/conversation with the user's RLS-bound client.
 */
export async function recordAiDraftAudit(
  db: SupabaseClient,
  input: AiDraftAuditInput
): Promise<string> {
  const { data, error } = await db
    .from('ai_drafts')
    .insert({
      account_id: input.accountId,
      conversation_id: input.conversationId,
      created_by: input.createdBy,
      provider: input.provider,
      model: input.model,
      content_text: input.contentText,
      knowledge_chunk_ids: input.knowledgeChunkIds,
      knowledge_item_count: input.knowledgeChunkIds.length,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new AiDraftAuditError();
  }

  return String(data.id);
}
