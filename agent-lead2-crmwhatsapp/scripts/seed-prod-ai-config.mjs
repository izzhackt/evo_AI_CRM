#!/usr/bin/env node

import crypto from 'node:crypto';

const DEFAULT_PROVIDER = 'gemini';
const DEFAULT_MODEL = 'gemini-3.5-flash';
const GEMINI_GENERATE_CONTENT_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_VALIDATION_MAX_OUTPUT_TOKENS = 256;
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

function optionalBoolean(name, fallback) {
  const raw = value(name).toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`${name} must be true or false`);
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

async function validateGemini({ apiKey, model }) {
  const response = await fetch(geminiGenerateContentUrl(model), {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      store: false,
      systemInstruction: {
        parts: [{ text: 'You are a connectivity check.' }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Reply with exactly OK.' }],
        },
      ],
      generationConfig: geminiGenerationConfig(
        model,
        GEMINI_VALIDATION_MAX_OUTPUT_TOKENS
      ),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Gemini validation failed with ${response.status}: ${await errorDetail(response)}`
    );
  }

  const data = await response.json().catch(() => null);
  const text = extractGeminiText(data);
  if (!text) {
    throw new Error('Gemini validation returned no text output');
  }
}

function geminiGenerateContentUrl(model) {
  const modelId = model.replace(/^models\//, '');
  return `${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(modelId)}:generateContent`;
}

function geminiGenerationConfig(model, maxOutputTokens) {
  const config = { maxOutputTokens };
  if (supportsThinkingLevel(model)) {
    config.thinkingConfig = { thinkingLevel: 'MINIMAL' };
  }
  return config;
}

function supportsThinkingLevel(model) {
  const modelId = model.replace(/^models\//, '');
  return /^gemini-3(?:[.-]|$)/i.test(modelId);
}

async function errorDetail(response) {
  try {
    const body = await response.json();
    if (typeof body?.error === 'string') return body.error;
    if (typeof body?.error?.message === 'string') return body.error.message;
  } catch {
    // Fall through to status text.
  }
  return response.statusText || 'provider rejected the request';
}

function extractGeminiText(data) {
  if (!data || typeof data !== 'object') return '';

  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  for (const candidate of candidates) {
    const text = extractPartsText(candidate?.content?.parts);
    if (text) return text;
  }
  return '';
}

function extractPartsText(parts) {
  if (!Array.isArray(parts)) return '';

  return parts
    .map((part) => {
      if (part?.thought === true) return '';
      if (typeof part?.text === 'string') return part.text;
      return '';
    })
    .join('')
    .trim();
}

async function upsertAiConfig({
  supabaseUrl,
  serviceRoleKey,
  account,
  provider,
  model,
  encryptedApiKey,
  systemPrompt,
  isActive,
}) {
  const createdBy = value('EVO_INBOX_CONFIG_USER_ID') || account.owner_user_id;
  const payload = {
    account_id: account.id,
    provider,
    model,
    api_key: encryptedApiKey,
    system_prompt: systemPrompt,
    is_active: isActive,
    auto_reply_enabled: false,
    auto_reply_max_per_conversation: 1,
  };
  if (createdBy) payload.created_by = createdBy;

  const rows = await supabaseRequest({
    supabaseUrl,
    serviceRoleKey,
    path: '/rest/v1/ai_configs?on_conflict=account_id',
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: [payload],
  });

  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error('ai_configs upsert did not return one row');
  }

  return rows[0];
}

async function main() {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey = requireEncryptionKey();
  const provider = value('EVO_INBOX_AI_PROVIDER') || DEFAULT_PROVIDER;
  if (provider !== 'gemini') {
    throw new Error(
      'EVO_INBOX_AI_PROVIDER must be gemini for this seed command'
    );
  }
  const model = value('EVO_INBOX_AI_MODEL') || DEFAULT_MODEL;
  const apiKey = requireEnv('EVO_INBOX_GEMINI_API_KEY');
  const systemPrompt = value('EVO_INBOX_AI_SYSTEM_PROMPT') || null;
  const isActive = optionalBoolean('EVO_INBOX_AI_ACTIVE', true);

  const account = await selectAccount({ supabaseUrl, serviceRoleKey });
  await validateGemini({ apiKey, model });
  const config = await upsertAiConfig({
    supabaseUrl,
    serviceRoleKey,
    account,
    provider,
    model,
    encryptedApiKey: encrypt(apiKey, encryptionKey),
    systemPrompt,
    isActive,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        validation: {
          provider,
          model,
          live_provider_call: true,
        },
        ai_config: {
          id: config.id,
          account_id: config.account_id,
          provider: config.provider,
          model: config.model,
          is_active: config.is_active,
          auto_reply_enabled: config.auto_reply_enabled,
          auto_reply_max_per_conversation:
            config.auto_reply_max_per_conversation,
          has_api_key: Boolean(config.api_key),
        },
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`seed-prod-ai-config failed: ${error.message}\n`);
  process.exitCode = 1;
});
