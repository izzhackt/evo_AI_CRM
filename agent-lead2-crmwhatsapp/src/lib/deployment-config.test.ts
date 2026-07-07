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
    const edgeCompose = read('deploy/docker-compose.edge.yml');
    const edgeCaddy = read('deploy/Caddyfile.evo-edge');

    expect(compose).toContain('expose:');
    expect(compose).not.toMatch(/\n\s+ports:/);
    expect(compose).toContain('evo-inbox-app');
    expect(compose).toContain('evo_public_web');
    expect(compose).not.toContain('acadis_acadis_web');
    expect(caddy).toContain('inbox.evoadmissions.com');
    expect(caddy).toContain('reverse_proxy evo-inbox-app:3000');
    expect(edgeCompose).toContain('name: evo-edge');
    expect(edgeCompose).toContain('container_name: evo-edge-caddy');
    expect(edgeCompose).toContain('evo_public_web');
    expect(edgeCaddy).toContain('inbox.evoadmissions.com');
    expect(edgeCaddy).toContain('reverse_proxy evo-inbox-app:3000');
    expect(edgeCaddy).toContain('crm.evoadmissions.com');
    expect(edgeCaddy).not.toContain('acadis');
  });

  it('runs WAHA as a separate private companion service', () => {
    const compose = read('deploy/docker-compose.inbox.prod.yml');
    const env = read('deploy/env.production.example');
    const wahaEnv = read('deploy/env.waha.example');

    expect(compose).toContain('container_name: evo-inbox-waha');
    expect(compose).toContain('evo_inbox_private');
    expect(env).toContain('EVO_INBOX_WAHA_BASE_URL=http://evo-inbox-waha:3000');
    expect(wahaEnv).toContain('WAHA_API_KEY=sha512:');
    expect(wahaEnv).toContain('WAHA_API_KEY_EXCLUDE_PATH=ping');
    expect(`${compose}\n${env}\n${wahaEnv}`).not.toContain('evo-crm-waha');
    expect(`${compose}\n${env}\n${wahaEnv}`).not.toContain('crm_primary');
  });

  it('keeps the root EVO CRM compose default off Acadis networking', () => {
    const rootCompose = read('../docker-compose.prod.yml');

    expect(rootCompose).toContain('name: ${EVO_CADDY_NETWORK:-evo_public_web}');
    expect(rootCompose).not.toContain('acadis_acadis_web');
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
      'evo-inbox-waha',
    ]) {
      expect(`${env}\n${runbook}`).toContain(needle);
    }
  });
});
