import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  IntegrationsAdminConfigurationError,
  integrationsAdminClient,
} from '@/lib/integrations/admin-client'
import { getAiConfigSummary } from '@/lib/ai/admin-store'
import {
  getIntegrationSecrets,
  getIntegrationSetting,
} from '@/lib/integrations/settings'
import {
  buildProductionPreflight,
  type AiReadinessState,
  type IntegrationReadinessState,
} from '@/lib/readiness/preflight'
import { DEFAULT_WAHA_SESSION_NAME } from '@/lib/waha/config'

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function loadWahaState(
  accountId: string,
): Promise<IntegrationReadinessState> {
  const admin = integrationsAdminClient()
  const setting = await getIntegrationSetting(admin, accountId, 'waha')
  if (!setting) {
    return {
      configured: false,
      connected: false,
      missingFields: ['baseUrl', 'apiKey', 'webhookHmacSecret'],
    }
  }

  let secrets: Record<string, string>
  try {
    secrets = await getIntegrationSecrets(admin, setting.id)
  } catch {
    return {
      configured: false,
      connected: false,
      status: setting.status,
      missingFields: ['ENCRYPTION_KEY'],
      message:
        'Stored WAHA secrets cannot be decrypted with the current ENCRYPTION_KEY.',
    }
  }

  const baseUrl = textValue(setting.publicConfig.baseUrl)
  const sessionName =
    textValue(setting.publicConfig.sessionName) || DEFAULT_WAHA_SESSION_NAME
  const missingFields: string[] = []
  if (!baseUrl) missingFields.push('baseUrl')
  if (!sessionName) missingFields.push('sessionName')
  if (!secrets.api_key) missingFields.push('apiKey')
  if (!secrets.webhook_hmac_secret) missingFields.push('webhookHmacSecret')

  return {
    configured: missingFields.length === 0,
    connected: missingFields.length === 0 && setting.status === 'configured',
    status: setting.status,
    missingFields,
  }
}

async function loadAmoCrmState(
  accountId: string,
): Promise<IntegrationReadinessState> {
  const admin = integrationsAdminClient()
  const syncCounts = await loadAmoCrmSyncCounts(admin, accountId)
  const setting = await getIntegrationSetting(admin, accountId, 'amocrm')
  if (!setting) {
    return {
      configured: false,
      missingFields: ['baseUrl', 'accessToken'],
      ...syncCounts,
    }
  }

  let secrets: Record<string, string>
  try {
    secrets = await getIntegrationSecrets(admin, setting.id)
  } catch {
    return {
      configured: false,
      status: setting.status,
      missingFields: ['ENCRYPTION_KEY'],
      message:
        'Stored amoCRM secrets cannot be decrypted with the current ENCRYPTION_KEY.',
      ...syncCounts,
    }
  }

  const missingFields: string[] = []
  if (!textValue(setting.publicConfig.baseUrl)) missingFields.push('baseUrl')
  if (!secrets.access_token) missingFields.push('accessToken')

  return {
    configured: missingFields.length === 0,
    status: setting.status,
    missingFields,
    ...syncCounts,
  }
}

async function loadAmoCrmSyncCounts(
  admin: ReturnType<typeof integrationsAdminClient>,
  accountId: string,
) {
  const { data, error } = await admin
    .from('conversations')
    .select('crm_sync_status')
    .eq('account_id', accountId)
    .in('crm_sync_status', ['pending', 'not_configured', 'blocked'])

  if (error) {
    return {
      pendingSyncCount: 1,
      notConfiguredSyncCount: 0,
      blockedSyncCount: 0,
      message: 'Failed to load amoCRM sync backlog.',
    }
  }

  const rows = (data ?? []) as Array<{ crm_sync_status?: unknown }>
  return {
    pendingSyncCount: rows.filter((row) => row.crm_sync_status === 'pending').length,
    notConfiguredSyncCount: rows.filter(
      (row) => row.crm_sync_status === 'not_configured',
    ).length,
    blockedSyncCount: rows.filter((row) => row.crm_sync_status === 'blocked').length,
  }
}

async function loadAiState(accountId: string): Promise<AiReadinessState> {
  try {
    const data = await getAiConfigSummary(accountId)
    if (!data) return { configured: false, active: false, hasKey: false }

    return {
      configured: true,
      active: data.is_active === true,
      hasKey: Boolean(data.api_key),
      provider: typeof data.provider === 'string' ? data.provider : null,
    }
  } catch {
    return {
      configured: false,
      active: false,
      hasKey: false,
      message: 'Failed to load AI assistant configuration.',
    }
  }
}

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    let waha: IntegrationReadinessState
    let amocrm: IntegrationReadinessState

    try {
      ;[waha, amocrm] = await Promise.all([
        loadWahaState(ctx.accountId),
        loadAmoCrmState(ctx.accountId),
      ])
    } catch (err) {
      if (err instanceof IntegrationsAdminConfigurationError) {
        waha = {
          configured: false,
          connected: false,
          missingFields: err.missingFields,
          message: err.message,
        }
        amocrm = {
          configured: false,
          missingFields: err.missingFields,
          message: err.message,
        }
      } else {
        throw err
      }
    }

    const ai = await loadAiState(ctx.accountId)
    const result = buildProductionPreflight({
      env: process.env,
      waha,
      amocrm,
      ai,
    })

    return NextResponse.json(result, { status: result.ready ? 200 : 503 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
