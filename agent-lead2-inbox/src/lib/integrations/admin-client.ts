import type { SupabaseClient } from '@supabase/supabase-js';

import {
  SupabaseAdminConfigurationError,
  supabaseAdminClient,
} from '@/lib/supabase/admin-client';

export class IntegrationsAdminConfigurationError extends SupabaseAdminConfigurationError {}

export function integrationsAdminClient(): SupabaseClient {
  try {
    return supabaseAdminClient();
  } catch (error) {
    if (error instanceof SupabaseAdminConfigurationError) {
      throw new IntegrationsAdminConfigurationError(error.missingFields);
    }
    throw error;
  }
}
