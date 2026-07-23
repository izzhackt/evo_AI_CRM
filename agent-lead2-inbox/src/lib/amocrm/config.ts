import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getIntegrationSecrets,
  getIntegrationSetting,
} from '@/lib/integrations/settings';
import {
  AmoCrmConfigurationError,
  type AmoCrmConfig,
} from './client';

export interface AmoCrmRuntimeConfig {
  settingId: string;
  config: AmoCrmConfig;
  publicConfig: Record<string, unknown>;
}

function stringConfig(
  value: Record<string, unknown>,
  key: string,
): string {
  const raw = value[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

function optionalNumberConfig(
  value: Record<string, unknown>,
  key: string,
): string | number | null {
  const raw = value[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
}

export async function loadAmoCrmRuntimeConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<AmoCrmRuntimeConfig> {
  const setting = await getIntegrationSetting(db, accountId, 'amocrm');
  if (!setting) {
    throw new AmoCrmConfigurationError(['baseUrl', 'accessToken']);
  }

  const secrets = await getIntegrationSecrets(db, setting.id);
  const baseUrl = stringConfig(setting.publicConfig, 'baseUrl');
  const accessToken = secrets.access_token ?? '';
  const missingFields: string[] = [];
  if (!baseUrl) missingFields.push('baseUrl');
  if (!accessToken) missingFields.push('accessToken');
  if (missingFields.length > 0) {
    throw new AmoCrmConfigurationError(missingFields);
  }

  return {
    settingId: setting.id,
    config: {
      baseUrl,
      accessToken,
      pipelineId: optionalNumberConfig(setting.publicConfig, 'pipelineId'),
      statusId: optionalNumberConfig(setting.publicConfig, 'statusId'),
      responsibleUserId: optionalNumberConfig(
        setting.publicConfig,
        'responsibleUserId',
      ),
    },
    publicConfig: setting.publicConfig,
  };
}
