import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getIntegrationSecrets,
  getIntegrationSetting,
} from '@/lib/integrations/settings';
import { WahaConfigurationError, type WahaConfig } from './client';

export const DEFAULT_WAHA_SESSION_NAME = 'evo-inbox';

export interface WahaRuntimeConfig {
  settingId: string;
  config: WahaConfig;
  webhookHmacSecret: string;
  publicConfig: Record<string, unknown>;
}

function stringConfig(
  value: Record<string, unknown>,
  key: string,
): string {
  const raw = value[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

export async function loadWahaRuntimeConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<WahaRuntimeConfig> {
  const setting = await getIntegrationSetting(db, accountId, 'waha');
  if (!setting) {
    throw new WahaConfigurationError([
      'baseUrl',
      'sessionName',
      'apiKey',
      'webhookHmacSecret',
    ]);
  }

  const secrets = await getIntegrationSecrets(db, setting.id);
  const baseUrl = stringConfig(setting.publicConfig, 'baseUrl');
  const sessionName =
    stringConfig(setting.publicConfig, 'sessionName') || DEFAULT_WAHA_SESSION_NAME;
  const apiKey = secrets.api_key ?? '';
  const webhookHmacSecret = secrets.webhook_hmac_secret ?? '';
  const missingFields: string[] = [];
  if (!baseUrl) missingFields.push('baseUrl');
  if (!sessionName) missingFields.push('sessionName');
  if (!apiKey) missingFields.push('apiKey');
  if (!webhookHmacSecret) missingFields.push('webhookHmacSecret');
  if (missingFields.length > 0) {
    throw new WahaConfigurationError(missingFields);
  }

  return {
    settingId: setting.id,
    config: { baseUrl, sessionName, apiKey },
    webhookHmacSecret,
    publicConfig: setting.publicConfig,
  };
}

export async function findWahaWebhookCandidates(
  db: SupabaseClient,
  sessionName: string,
): Promise<Array<{ settingId: string; webhookHmacSecret: string }>> {
  const { data, error } = await db
    .from('integration_settings')
    .select('id, public_config')
    .eq('provider', 'waha');

  if (error) {
    throw new Error('Failed to load WAHA webhook settings');
  }

  const matches: Array<{ settingId: string; webhookHmacSecret: string }> = [];
  for (const row of (data ?? []) as Array<{
    id: string;
    public_config: Record<string, unknown> | null;
  }>) {
    const publicConfig = row.public_config ?? {};
    const configuredSession =
      typeof publicConfig.sessionName === 'string'
        ? publicConfig.sessionName
        : DEFAULT_WAHA_SESSION_NAME;
    if (configuredSession !== sessionName) continue;

    const secrets = await getIntegrationSecrets(db, row.id);
    if (secrets.webhook_hmac_secret) {
      matches.push({
        settingId: row.id,
        webhookHmacSecret: secrets.webhook_hmac_secret,
      });
    }
  }

  return matches;
}
