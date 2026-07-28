import { supabaseAdminClient } from '@/lib/supabase/admin-client'

export const API_KEY_PUBLIC_COLUMNS =
  'id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at'

export async function listAccountApiKeys(accountId: string) {
  return supabaseAdminClient()
    .from('api_keys')
    .select(API_KEY_PUBLIC_COLUMNS)
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
}

export async function createAccountApiKey(input: {
  accountId: string
  userId: string
  name: string
  keyPrefix: string
  keyHash: string
  scopes: string[]
  expiresAt: string | null
}) {
  return supabaseAdminClient()
    .from('api_keys')
    .insert({
      account_id: input.accountId,
      created_by: input.userId,
      name: input.name,
      key_prefix: input.keyPrefix,
      key_hash: input.keyHash,
      scopes: input.scopes,
      expires_at: input.expiresAt,
    })
    .select(API_KEY_PUBLIC_COLUMNS)
    .single()
}

export async function revokeAccountApiKey(accountId: string, id: string) {
  return supabaseAdminClient()
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('account_id', accountId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle()
}
