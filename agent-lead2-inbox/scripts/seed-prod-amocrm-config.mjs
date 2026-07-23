#!/usr/bin/env node

import crypto from 'node:crypto';

const GCM_IV_LENGTH = 12;

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /your-/i,
  /replace-me/i,
  /example/i,
  /paste-/i,
  /your-project\.supabase\.co/i,
];

function value(name) {
  return (process.env[name] ?? '').trim();
}

function isMissing(name) {
  const raw = value(name);
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(raw));
}

function requireEnv(name) {
  if (isMissing(name)) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value(name);
}

function requireEncryptionKey() {
  const key = requireEnv('ENCRYPTION_KEY');
  if (!/^[a-f0-9]{64}$/i.test(key)) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters');
  }
  return Buffer.from(key, 'hex');
}

function optionalPositiveInteger(name) {
  const raw = value(name);
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a positive integer when provided`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer when provided`);
  }
  return parsed;
}

function normalizeBaseUrl(input) {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function encrypt(secret, key) {
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(secret, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
}

function supabaseHeaders(serviceRoleKey, prefer) {
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function supabaseRequest({
  supabaseUrl,
  serviceRoleKey,
  path,
  method = 'GET',
  body,
  prefer,
}) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: supabaseHeaders(serviceRoleKey, prefer),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Supabase REST ${method} ${path} failed with ${response.status}: ${text}`
    );
  }

  if (response.status === 204) return null;
  return response.json();
}

async function selectAccount({ supabaseUrl, serviceRoleKey }) {
  const explicitAccountId = value('EVO_INBOX_ACCOUNT_ID');
  const filter = explicitAccountId
    ? `&id=eq.${encodeURIComponent(explicitAccountId)}`
    : '';
  const rows = await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    path: `/rest/v1/accounts?select=id,name,owner_user_id${filter}`,
  });

  if (explicitAccountId && rows.length !== 1) {
    throw new Error(
      `EVO_INBOX_ACCOUNT_ID did not match exactly one account: ${explicitAccountId}`
    );
  }

  if (!explicitAccountId && rows.length !== 1) {
    throw new Error(
      `Set EVO_INBOX_ACCOUNT_ID; found ${rows.length} accounts and will not guess`
    );
  }

  return rows[0];
}

async function validateAmoCrmToken({ baseUrl, accessToken }) {
  const response = await fetch(`${baseUrl}/api/v4/account`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { body: text.slice(0, 240) };
    }
  }

  if (!response.ok) {
    throw new Error(
      `amoCRM account validation failed with ${response.status}: ${text.slice(
        0,
        240
      )}`
    );
  }

  return {
    id: payload?.id ?? null,
    name: payload?.name ?? null,
    subdomain: payload?.subdomain ?? null,
  };
}

function amocrmPublicConfig(baseUrl) {
  const config = { baseUrl };
  const pipelineId = optionalPositiveInteger('EVO_INBOX_AMOCRM_PIPELINE_ID');
  const statusId = optionalPositiveInteger('EVO_INBOX_AMOCRM_STATUS_ID');
  const responsibleUserId = optionalPositiveInteger(
    'EVO_INBOX_AMOCRM_RESPONSIBLE_USER_ID'
  );
  if (pipelineId !== undefined) config.pipelineId = pipelineId;
  if (statusId !== undefined) config.statusId = statusId;
  if (responsibleUserId !== undefined) {
    config.responsibleUserId = responsibleUserId;
  }
  return config;
}

async function upsertAmoCrmSetting({
  supabaseUrl,
  serviceRoleKey,
  account,
  publicConfig,
}) {
  const createdBy = value('EVO_INBOX_CONFIG_USER_ID') || account.owner_user_id;
  const payload = {
    account_id: account.id,
    provider: 'amocrm',
    status: 'configured',
    public_config: publicConfig,
    last_checked_at: new Date().toISOString(),
    last_error: null,
  };
  if (createdBy) payload.created_by = createdBy;

  const rows = await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    path: '/rest/v1/integration_settings?on_conflict=account_id,provider',
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: [payload],
  });

  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(
      'amoCRM integration_settings upsert did not return one row'
    );
  }

  return rows[0];
}

async function upsertSecrets({
  supabaseUrl,
  serviceRoleKey,
  settingId,
  encryptedAccessToken,
  updatedBy,
}) {
  const rows = [
    {
      setting_id: settingId,
      secret_name: 'access_token',
      encrypted_value: encryptedAccessToken,
    },
  ];

  if (updatedBy) {
    for (const row of rows) row.updated_by = updatedBy;
  }

  const result = await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    path: '/rest/v1/integration_secrets?on_conflict=setting_id,secret_name',
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: rows,
  });

  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('amoCRM integration_secrets upsert did not return one row');
  }

  return result.map((row) => row.secret_name).sort();
}

function postgrestIn(values) {
  return `(${values.map((value) => `"${String(value).replace(/"/g, '\\"')}"`).join(',')})`;
}

async function resetAmoCrmSyncAfterConfigChange({
  supabaseUrl,
  serviceRoleKey,
  accountId,
}) {
  const rows = await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    path:
      `/rest/v1/conversations?select=id&account_id=eq.${encodeURIComponent(
        accountId
      )}` + '&crm_sync_status=in.(not_configured,blocked)',
  });

  const conversationIds = (rows ?? [])
    .map((row) => (typeof row.id === 'string' ? row.id : null))
    .filter(Boolean);

  if (conversationIds.length === 0) {
    return { conversations: 0, messages: 0 };
  }

  const timestamp = new Date().toISOString();
  await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    path:
      `/rest/v1/conversations?account_id=eq.${encodeURIComponent(accountId)}` +
      `&id=in.${postgrestIn(conversationIds)}`,
    method: 'PATCH',
    prefer: 'return=minimal',
    body: {
      crm_sync_status: 'pending',
      crm_sync_error: null,
      updated_at: timestamp,
    },
  });

  await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    path:
      `/rest/v1/messages?conversation_id=in.${postgrestIn(conversationIds)}` +
      '&crm_sync_status=in.(not_configured,blocked)',
    method: 'PATCH',
    prefer: 'return=minimal',
    body: {
      crm_sync_status: 'pending',
      crm_sync_error: null,
    },
  });

  return {
    conversations: conversationIds.length,
    messages: 'filtered',
  };
}

async function main() {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey = requireEncryptionKey();
  const baseUrl = normalizeBaseUrl(requireEnv('EVO_INBOX_AMOCRM_BASE_URL'));
  const accessToken = requireEnv('EVO_INBOX_AMOCRM_ACCESS_TOKEN');

  const validation = await validateAmoCrmToken({ baseUrl, accessToken });
  const account = await selectAccount({ supabaseUrl, serviceRoleKey });
  const setting = await upsertAmoCrmSetting({
    supabaseUrl,
    serviceRoleKey,
    account,
    publicConfig: amocrmPublicConfig(baseUrl),
  });
  const updatedBy = value('EVO_INBOX_CONFIG_USER_ID') || account.owner_user_id;
  const secretNames = await upsertSecrets({
    supabaseUrl,
    serviceRoleKey,
    settingId: setting.id,
    encryptedAccessToken: encrypt(accessToken, encryptionKey),
    updatedBy,
  });
  const reset = await resetAmoCrmSyncAfterConfigChange({
    supabaseUrl,
    serviceRoleKey,
    accountId: account.id,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        validation: {
          account_id: validation.id,
          account_name: validation.name,
          subdomain: validation.subdomain,
          live_provider_call: true,
        },
        setting: {
          id: setting.id,
          account_id: setting.account_id,
          provider: setting.provider,
          status: setting.status,
          public_config: setting.public_config,
        },
        secret_names: secretNames,
        reset_crm_sync: reset,
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`seed-prod-amocrm-config failed: ${error.message}\n`);
  process.exitCode = 1;
});
