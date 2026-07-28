import { supabaseAdminClient } from '@/lib/supabase/admin-client'
import type { AiProvider, EmbeddingsProvider } from '@/lib/ai/types'

export interface StoredAiConfigRow {
  id: string
  provider: AiProvider
  model: string
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  api_key: string
  embeddings_provider: EmbeddingsProvider | null
  embeddings_api_key: string | null
}

const FULL_COLUMNS =
  'id, provider, model, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, api_key, embeddings_provider, embeddings_api_key'

const SUMMARY_COLUMNS =
  'provider, model, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, api_key, embeddings_provider, embeddings_api_key'

export async function getStoredAiConfig(
  accountId: string,
): Promise<StoredAiConfigRow | null> {
  const { data, error } = await supabaseAdminClient()
    .from('ai_configs')
    .select(FULL_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) throw error
  return (data as StoredAiConfigRow | null) ?? null
}

export async function getAiConfigSummary(accountId: string) {
  const { data, error } = await supabaseAdminClient()
    .from('ai_configs')
    .select(SUMMARY_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) throw error
  return data as Omit<StoredAiConfigRow, 'id'> | null
}

export async function upsertAiConfig(
  accountId: string,
  userId: string,
  existingId: string | null,
  values: Record<string, unknown>,
) {
  const admin = supabaseAdminClient()

  if (existingId) {
    return admin
      .from('ai_configs')
      .update(values)
      .eq('id', existingId)
      .eq('account_id', accountId)
  }

  return admin.from('ai_configs').insert({
    account_id: accountId,
    created_by: userId,
    ...values,
  })
}

export async function deleteAiConfig(accountId: string) {
  return supabaseAdminClient()
    .from('ai_configs')
    .delete()
    .eq('account_id', accountId)
}
