import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let adminClient: SupabaseClient | null = null

export class SupabaseAdminConfigurationError extends Error {
  readonly code = 'supabase_not_configured'
  readonly status = 503
  readonly missingFields: string[]

  constructor(missingFields: string[]) {
    super(`Supabase service configuration is missing: ${missingFields.join(', ')}`)
    this.name = 'SupabaseAdminConfigurationError'
    this.missingFields = missingFields
  }
}

export function supabaseAdminClient(): SupabaseClient {
  if (!adminClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const missingFields: string[] = []

    if (!supabaseUrl) missingFields.push('NEXT_PUBLIC_SUPABASE_URL')
    if (!serviceRoleKey) missingFields.push('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      throw new SupabaseAdminConfigurationError(missingFields)
    }

    adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  }

  return adminClient
}
