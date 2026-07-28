import type { SupabaseClient } from '@supabase/supabase-js'

import { supabaseAdminClient } from '@/lib/supabase/admin-client'

export function supabaseAdmin(): SupabaseClient {
  return supabaseAdminClient()
}
