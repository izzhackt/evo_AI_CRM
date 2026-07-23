#!/usr/bin/env node

import crypto from 'node:crypto';

const DEFAULT_SESSION_NAME = 'evo-inbox';
const GCM_IV_LENGTH = 12;

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /your-/i,
  /replace-me/i,
  /example/i,
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

async function upsertWahaSetting({
  supabaseUrl,
  serviceRoleKey,
  account,
  baseUrl,
  sessionName,
}) {
  const createdBy = value('EVO_INBOX_CONFIG_USER_ID') || account.owner_user_id;
  const payload = {
    account_id: account.id,
    provider: 'waha',
    status: 'configured',
    public_config: { baseUrl, sessionName },
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
    throw new Error('WAHA integration_settings upsert did not return one row');
  }

  return rows[0];
}

async function upsertSecrets({
  supabaseUrl,
  serviceRoleKey,
  settingId,
  encryptedApiKey,
  encryptedWebhookHmac,
  updatedBy,
}) {
  const rows = [
    {
      setting_id: settingId,
      secret_name: 'api_key',
      encrypted_value: encryptedApiKey,
    },
    {
      setting_id: settingId,
      secret_name: 'webhook_hmac_secret',
      encrypted_value: encryptedWebhookHmac,
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

  if (!Array.isArray(result) || result.length !== 2) {
    throw new Error('WAHA integration_secrets upsert did not return two rows');
  }

  return result.map((row) => row.secret_name).sort();
}

async function main() {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey = requireEncryptionKey();
  const baseUrl = requireEnv('EVO_INBOX_WAHA_BASE_URL').replace(/\/$/, '');
  const sessionName =
    value('EVO_INBOX_WAHA_SESSION_NAME') || DEFAULT_SESSION_NAME;
  const apiKey = requireEnv('EVO_INBOX_WAHA_API_KEY');
  const webhookHmac = requireEnv('EVO_INBOX_WAHA_WEBHOOK_HMAC');

  const account = await selectAccount({ supabaseUrl, serviceRoleKey });
  const setting = await upsertWahaSetting({
    supabaseUrl,
    serviceRoleKey,
    account,
    baseUrl,
    sessionName,
  });
  const updatedBy = value('EVO_INBOX_CONFIG_USER_ID') || account.owner_user_id;
  const secretNames = await upsertSecrets({
    supabaseUrl,
    serviceRoleKey,
    settingId: setting.id,
    encryptedApiKey: encrypt(apiKey, encryptionKey),
    encryptedWebhookHmac: encrypt(webhookHmac, encryptionKey),
    updatedBy,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        setting: {
          id: setting.id,
          account_id: setting.account_id,
          provider: setting.provider,
          status: setting.status,
          public_config: setting.public_config,
        },
        secret_names: secretNames,
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`seed-prod-waha-config failed: ${error.message}\n`);
  process.exitCode = 1;
});
