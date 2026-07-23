import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import type { IntegrationProvider, IntegrationSetting } from '@/types';

export type IntegrationSecretName =
  | 'api_key'
  | 'webhook_hmac_secret'
  | 'access_token'
  | 'refresh_token'
  | 'client_id'
  | 'client_secret';

export interface RuntimeIntegrationSetting {
  id: string;
  publicConfig: Record<string, unknown>;
  status: string;
}

function toPublicConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

export async function getIntegrationSetting(
  db: SupabaseClient,
  accountId: string,
  provider: IntegrationProvider,
): Promise<RuntimeIntegrationSetting | null> {
  const { data, error } = await db
    .from('integration_settings')
    .select('id, status, public_config')
    .eq('account_id', accountId)
    .eq('provider', provider)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load ${provider} integration setting`);
  }
  if (!data) return null;

  const row = data as Pick<IntegrationSetting, 'id' | 'status' | 'public_config'>;
  return {
    id: row.id,
    status: row.status,
    publicConfig: toPublicConfig(row.public_config),
  };
}

export async function getIntegrationSecrets(
  db: SupabaseClient,
  settingId: string,
): Promise<Record<string, string>> {
  const { data, error } = await db
    .from('integration_secrets')
    .select('secret_name, encrypted_value')
    .eq('setting_id', settingId);

  if (error) {
    throw new Error('Failed to load integration secrets');
  }

  const secrets: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{
    secret_name: string;
    encrypted_value: string;
  }>) {
    secrets[row.secret_name] = decrypt(row.encrypted_value);
  }
  return secrets;
}

export async function upsertIntegrationSetting(
  db: SupabaseClient,
  input: {
    accountId: string;
    provider: IntegrationProvider;
    publicConfig: Record<string, unknown>;
    status: 'not_configured' | 'configured' | 'blocked';
    lastError?: string | null;
    userId: string;
  },
): Promise<string> {
  const { data, error } = await db
    .from('integration_settings')
    .upsert(
      {
        account_id: input.accountId,
        provider: input.provider,
        public_config: input.publicConfig,
        status: input.status,
        last_error: input.lastError ?? null,
        created_by: input.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,provider' },
    )
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to save ${input.provider} integration setting`);
  }
  return String(data.id);
}

export async function upsertIntegrationSecrets(
  db: SupabaseClient,
  input: {
    settingId: string;
    secrets: Partial<Record<IntegrationSecretName, string | null | undefined>>;
    userId: string;
  },
): Promise<void> {
  const rows = Object.entries(input.secrets)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .map(([secret_name, value]) => ({
      setting_id: input.settingId,
      secret_name,
      encrypted_value: encrypt(value as string),
      updated_by: input.userId,
      updated_at: new Date().toISOString(),
    }));

  if (rows.length === 0) return;

  const { error } = await db
    .from('integration_secrets')
    .upsert(rows, { onConflict: 'setting_id,secret_name' });

  if (error) {
    throw new Error('Failed to save integration secrets');
  }
}

export async function deleteIntegrationSetting(
  db: SupabaseClient,
  accountId: string,
  provider: IntegrationProvider,
): Promise<void> {
  const { error } = await db
    .from('integration_settings')
    .delete()
    .eq('account_id', accountId)
    .eq('provider', provider);

  if (error) {
    throw new Error(`Failed to delete ${provider} integration setting`);
  }
}

export function secretBooleans(
  secrets: Record<string, string>,
): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(secrets).map(([name, value]) => [name, value.length > 0]),
  );
}
