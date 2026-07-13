import { NextResponse } from 'next/server';

import { resetAmoCrmSyncAfterConfigChange } from '@/lib/amocrm/sync';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { createAmoCrmClient } from '@/lib/amocrm/client';
import { integrationsAdminClient } from '@/lib/integrations/admin-client';
import {
  deleteIntegrationSetting,
  getIntegrationSecrets,
  getIntegrationSetting,
  secretBooleans,
  upsertIntegrationSecrets,
  upsertIntegrationSetting,
} from '@/lib/integrations/settings';

function textField(body: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'string') return value.trim();
  }
  return '';
}

function optionalId(body: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const admin = integrationsAdminClient();
    const setting = await getIntegrationSetting(admin, ctx.accountId, 'amocrm');

    if (!setting) {
      return NextResponse.json({
        provider: 'amocrm',
        configured: false,
        reason: 'no_config',
        public_config: {},
        has_secrets: {},
      });
    }

    let secrets: Record<string, string>;
    try {
      secrets = await getIntegrationSecrets(admin, setting.id);
    } catch {
      return NextResponse.json({
        provider: 'amocrm',
        configured: false,
        reason: 'secret_decrypt_failed',
        public_config: setting.publicConfig,
        has_secrets: {},
        message:
          'Stored amoCRM secrets cannot be decrypted with the current ENCRYPTION_KEY.',
      });
    }

    const configured = Boolean(setting.publicConfig.baseUrl && secrets.access_token);
    return NextResponse.json({
      provider: 'amocrm',
      configured,
      public_config: setting.publicConfig,
      has_secrets: secretBooleans(secrets),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json()) as Record<string, unknown>;
    const baseUrl = textField(body, 'base_url', 'baseUrl');
    const accessToken = textField(body, 'access_token', 'accessToken');
    const publicConfig = {
      baseUrl,
      pipelineId: optionalId(body, 'pipeline_id', 'pipelineId'),
      statusId: optionalId(body, 'status_id', 'statusId'),
      responsibleUserId: optionalId(
        body,
        'responsible_user_id',
        'responsibleUserId',
      ),
    };

    const admin = integrationsAdminClient();
    const existingSetting = await getIntegrationSetting(
      admin,
      ctx.accountId,
      'amocrm',
    );
    const existingSecrets = existingSetting
      ? await getIntegrationSecrets(admin, existingSetting.id)
      : {};

    const missingFields: string[] = [];
    if (!baseUrl) missingFields.push('baseUrl');
    if (!accessToken && !existingSecrets.access_token) {
      missingFields.push('accessToken');
    }
    if (missingFields.length > 0) {
      return NextResponse.json(
        {
          error: 'amocrm_not_configured',
          missing_fields: missingFields,
        },
        { status: 400 },
      );
    }

    createAmoCrmClient({
      baseUrl,
      accessToken: accessToken || existingSecrets.access_token || '',
    });

    const settingId = await upsertIntegrationSetting(admin, {
      accountId: ctx.accountId,
      provider: 'amocrm',
      publicConfig,
      status: 'configured',
      userId: ctx.userId,
    });
    await upsertIntegrationSecrets(admin, {
      settingId,
      secrets: {
        access_token: accessToken,
        refresh_token: textField(body, 'refresh_token', 'refreshToken'),
        client_id: textField(body, 'client_id', 'clientId'),
        client_secret: textField(body, 'client_secret', 'clientSecret'),
      },
      userId: ctx.userId,
    });
    await resetAmoCrmSyncAfterConfigChange(admin, ctx.accountId);

    return NextResponse.json({
      success: true,
      provider: 'amocrm',
      public_config: publicConfig,
      has_secrets: {
        access_token: Boolean(accessToken || existingSecrets.access_token),
        refresh_token: Boolean(
          textField(body, 'refresh_token', 'refreshToken') ||
            existingSecrets.refresh_token,
        ),
        client_id: Boolean(
          textField(body, 'client_id', 'clientId') || existingSecrets.client_id,
        ),
        client_secret: Boolean(
          textField(body, 'client_secret', 'clientSecret') ||
            existingSecrets.client_secret,
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
      'amocrm',
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
