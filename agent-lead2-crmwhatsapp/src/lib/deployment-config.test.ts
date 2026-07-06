import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function read(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('EVO Inbox production deployment config', () => {
  it('enables Next standalone output for the Docker image', () => {
    expect(read('next.config.ts')).toContain('output: "standalone"');
  });

  it('copies the standalone server plus static and public assets', () => {
    const dockerfile = read('Dockerfile');

    expect(dockerfile).toContain('/app/.next/standalone');
    expect(dockerfile).toContain('/app/.next/static ./.next/static');
    expect(dockerfile).toContain('/app/public ./public');
    expect(dockerfile).toContain('CMD ["node", "server.js"]');
  });

  it('keeps the app behind Caddy without public container ports', () => {
    const compose = read('deploy/docker-compose.inbox.prod.yml');
    const caddy = read('deploy/Caddyfile.inbox.evoadmissions.com');

    expect(compose).toContain('expose:');
    expect(compose).not.toMatch(/\n\s+ports:/);
    expect(compose).toContain('evo-inbox-app');
    expect(caddy).toContain('inbox.evoadmissions.com');
    expect(caddy).toContain('reverse_proxy evo-inbox-app:3000');
  });

  it('documents the required proof/preflight credentials without values', () => {
    const env = read('deploy/env.production.example');
    const runbook = read('docs/production-proof-checklist.md');

    for (const needle of [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'ENCRYPTION_KEY',
      'EVO_INBOX_WAHA_BASE_URL',
      'EVO_INBOX_WAHA_API_KEY',
      'EVO_INBOX_WAHA_WEBHOOK_HMAC',
      'EVO_INBOX_AMOCRM_BASE_URL',
      'EVO_INBOX_AMOCRM_ACCESS_TOKEN',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'EVO_INBOX_TEST_WHATSAPP_NUMBER',
      'DNS/Caddy requirements',
    ]) {
      expect(`${env}\n${runbook}`).toContain(needle);
    }
  });
});
