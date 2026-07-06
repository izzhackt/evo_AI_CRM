import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { integrationsAdminClient } from '@/lib/integrations/admin-client';
import {
  deleteIntegrationSetting,
  getIntegrationSecrets,
  getIntegrationSetting,
  secretBooleans,
  upsertIntegrationSecrets,
  upsertIntegrationSetting,
} from '@/lib/integrations/settings';
import { DEFAULT_WAHA_SESSION_NAME } from '@/lib/waha/config';
import { getWahaSessionStatus } from '@/lib/waha/client';
import { updateWahaSessionStatus } from '@/lib/waha/webhook';

function textField(body: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'string') return value.trim();
  }
  return '';
}

function publicWahaConfig(body: Record<string, unknown>) {
  return {
    baseUrl: textField(body, 'base_url', 'baseUrl'),
    sessionName:
      textField(body, 'session_name', 'sessionName') || DEFAULT_WAHA_SESSION_NAME,
  };
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const admin = integrationsAdminClient();
    const setting = await getIntegrationSetting(admin, ctx.accountId, 'waha');

    if (!setting) {
      return NextResponse.json({
        provider: 'waha',
        configured: false,
        connected: false,
        reason: 'no_config',
        public_config: {
          sessionName: DEFAULT_WAHA_SESSION_NAME,
        },
        has_secrets: {},
      });
    }

    let secrets: Record<string, string>;
    try {
      secrets = await getIntegrationSecrets(admin, setting.id);
    } catch {
      return NextResponse.json({
        provider: 'waha',
        configured: false,
        connected: false,
        reason: 'secret_decrypt_failed',
        public_config: setting.publicConfig,
        has_secrets: {},
        message:
          'Stored WAHA secrets cannot be decrypted with the current ENCRYPTION_KEY.',
      });
    }

    const baseUrl =
      typeof setting.publicConfig.baseUrl === 'string'
        ? setting.publicConfig.baseUrl
        : '';
    const sessionName =
      typeof setting.publicConfig.sessionName === 'string'
        ? setting.publicConfig.sessionName
        : DEFAULT_WAHA_SESSION_NAME;
    const apiKey = secrets.api_key ?? '';
    const configured = Boolean(baseUrl && sessionName && apiKey);

    if (!configured) {
      return NextResponse.json({
        provider: 'waha',
        configured: false,
        connected: false,
        reason: 'missing_config',
        public_config: setting.publicConfig,
        has_secrets: secretBooleans(secrets),
      });
    }

    try {
      const session = await getWahaSessionStatus({
        baseUrl,
        sessionName,
        apiKey,
      });
      await updateWahaSessionStatus(admin, setting.id, {
        sessionName,
        status: session.status,
      });
      return NextResponse.json({
        provider: 'waha',
        configured: true,
        connected: session.ready,
        public_config: setting.publicConfig,
        has_secrets: secretBooleans(secrets),
        session_status: session.status,
      });
    } catch (err) {
      return NextResponse.json({
        provider: 'waha',
        configured: true,
        connected: false,
        reason: 'waha_provider_error',
        public_config: setting.publicConfig,
        has_secrets: secretBooleans(secrets),
        message:
          err instanceof Error ? err.message : 'WAHA status check failed',
      });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json()) as Record<string, unknown>;
    const config = publicWahaConfig(body);
    const apiKey = textField(body, 'api_key', 'apiKey');
    const webhookHmacSecret = textField(
      body,
      'webhook_hmac_secret',
      'webhookHmacSecret',
    );

    const admin = integrationsAdminClient();
    const existingSetting = await getIntegrationSetting(
      admin,
      ctx.accountId,
      'waha',
    );
    const existingSecrets = existingSetting
      ? await getIntegrationSecrets(admin, existingSetting.id)
      : {};

    const missingFields: string[] = [];
    if (!config.baseUrl) missingFields.push('baseUrl');
    if (!config.sessionName) missingFields.push('sessionName');
    if (!apiKey && !existingSecrets.api_key) missingFields.push('apiKey');
    if (!webhookHmacSecret && !existingSecrets.webhook_hmac_secret) {
      missingFields.push('webhookHmacSecret');
    }
    if (missingFields.length > 0) {
      return NextResponse.json(
        {
          error: 'waha_not_configured',
          missing_fields: missingFields,
        },
        { status: 400 },
      );
    }

    const settingId = await upsertIntegrationSetting(admin, {
      accountId: ctx.accountId,
      provider: 'waha',
      publicConfig: config,
      status: 'configured',
      userId: ctx.userId,
    });
    await upsertIntegrationSecrets(admin, {
      settingId,
      secrets: {
        api_key: apiKey,
        webhook_hmac_secret: webhookHmacSecret,
      },
      userId: ctx.userId,
    });

    return NextResponse.json({
      success: true,
      provider: 'waha',
      public_config: config,
      has_secrets: {
        api_key: Boolean(apiKey || existingSecrets.api_key),
        webhook_hmac_secret: Boolean(
          webhookHmacSecret || existingSecrets.webhook_hmac_secret,
        ),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole('admin');
    await deleteIntegrationSetting(
      integrationsAdminClient(),
      ctx.accountId,
      'waha',
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
