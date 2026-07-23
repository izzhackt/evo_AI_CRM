import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let adminClient: SupabaseClient | null = null;

export class IntegrationsAdminConfigurationError extends Error {
  readonly code = 'supabase_not_configured';
  readonly status = 503;
  readonly missingFields: string[];

  constructor(missingFields: string[]) {
    super(`Supabase service configuration is missing: ${missingFields.join(', ')}`);
    this.name = 'IntegrationsAdminConfigurationError';
    this.missingFields = missingFields;
  }
}

export function integrationsAdminClient(): SupabaseClient {
  if (!adminClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const missingFields: string[] = [];
    if (!supabaseUrl) {
      missingFields.push('NEXT_PUBLIC_SUPABASE_URL');
    }
    if (!serviceRoleKey) {
      missingFields.push('SUPABASE_SERVICE_ROLE_KEY');
    }
    if (!supabaseUrl || !serviceRoleKey) {
      throw new IntegrationsAdminConfigurationError(missingFields);
    }

    adminClient = createClient(supabaseUrl, serviceRoleKey);
  }
  return adminClient;
}
