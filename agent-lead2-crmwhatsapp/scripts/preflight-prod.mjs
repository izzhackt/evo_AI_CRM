#!/usr/bin/env node

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /your-/i,
  /replace-me/i,
  /example\.amocrm\.com/i,
  /your-project\.supabase\.co/i,
];

function value(name) {
  return (process.env[name] ?? '').trim();
}

function missing(name) {
  const raw = value(name);
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(raw));
}

const checks = [];

function requireEnv(name, description) {
  const ok = !missing(name);
  checks.push({
    name,
    ok,
    description,
    message: ok ? 'present' : `missing ${name}`,
  });
}

function requireEnum(name, allowed, description, fallback) {
  const raw = value(name) || fallback;
  const ok = allowed.includes(raw);
  checks.push({
    name,
    ok,
    description,
    message: ok
      ? raw === value(name)
        ? `valid: ${raw}`
        : `default: ${raw}`
      : `${name} must be one of: ${allowed.join(', ')}`,
  });
}

function requireEncryptionKey() {
  const key = value('ENCRYPTION_KEY');
  const ok = /^[a-f0-9]{64}$/i.test(key);
  checks.push({
    name: 'ENCRYPTION_KEY',
    ok,
    description: '64 hex chars for encrypted integration and AI secrets',
    message: ok
      ? 'valid format'
      : 'missing ENCRYPTION_KEY or not a 64-character hex value',
  });
}

requireEnv('NEXT_PUBLIC_SUPABASE_URL', 'Supabase project URL');
requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Supabase anon/publishable key');
requireEnv('SUPABASE_SERVICE_ROLE_KEY', 'Supabase service-role key');
requireEncryptionKey();
requireEnv('NEXT_PUBLIC_SITE_URL', 'canonical app URL');
requireEnv('EVO_INBOX_DOMAIN', 'DNS hostname expected by Caddy');
requireEnv('EVO_CADDY_NETWORK', 'external Docker network shared with Caddy');
requireEnv('EVO_INBOX_WAHA_BASE_URL', 'private WAHA base URL on Docker network');
requireEnv('EVO_INBOX_WAHA_API_KEY', 'WAHA API key for proof setup');
requireEnv('EVO_INBOX_WAHA_WEBHOOK_HMAC', 'WAHA webhook HMAC secret');
requireEnv('EVO_INBOX_AMOCRM_BASE_URL', 'amoCRM account/domain URL');
requireEnv('EVO_INBOX_AMOCRM_ACCESS_TOKEN', 'amoCRM token for proof setup');
requireEnv(
  'EVO_INBOX_GEMINI_API_KEY',
  'Gemini API key for EVO Companion draft proof',
);
requireEnum(
  'EVO_INBOX_EMBEDDINGS_PROVIDER',
  ['keyword', 'gemini', 'openai'],
  'AI knowledge retrieval provider selection',
  'gemini',
);
requireEnv('EVO_INBOX_TEST_WHATSAPP_NUMBER', 'real WhatsApp number for proof');

const blockers = checks.filter((check) => !check.ok);
const payload = {
  ok: blockers.length === 0,
  checks,
  blockers: blockers.map((check) => ({
    name: check.name,
    message: check.message,
  })),
};

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  process.stdout.write('EVO Inbox production preflight\n');
  for (const check of checks) {
    const mark = check.ok ? 'PASS' : 'BLOCKED';
    process.stdout.write(`${mark} ${check.name}: ${check.message}\n`);
  }
}

if (!payload.ok) {
  process.exitCode = 1;
}
