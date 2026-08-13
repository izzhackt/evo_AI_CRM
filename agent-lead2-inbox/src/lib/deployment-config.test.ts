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
    expect(edgeCaddy).toContain('evo-inbox.72.62.119.112.sslip.io');
    expect(edgeCaddy).toContain('reverse_proxy evo-inbox-app:3000');
    expect(edgeCaddy).toContain('crm.evoadmissions.com');
    expect(edgeCaddy).not.toContain('acadis');
  });

  it('denies private observability at the edge and redacts credential headers', () => {
    const edgeCaddy = read('deploy/Caddyfile.evo-edge');

    expect(edgeCaddy).toMatch(
      /@private path[^\n]*\/api\/readiness[^\n]*\/metrics \/metrics\/\*/
    );
    expect(edgeCaddy).toContain('respond @private 404');
    for (const header of [
      'Cookie',
      'Authorization',
      'Proxy-Authorization',
      'X-Evo-Observability-Request-Id',
      'X-Evo-Observability-Timestamp',
      'X-Evo-Observability-Hmac-Algorithm',
      'X-Evo-Observability-Hmac',
      'X-Api-Key',
      'X-Hub-Signature-256',
      'X-Webhook-Hmac',
      'X-Webhook-Hmac-Algorithm',
      'X-Cron-Secret',
      'Idempotency-Key',
      'X-Evo-Agent-Admin-Key',
      'X-Evo-Agent-Signature',
      'X-Evo-Agent-Signature-Algorithm',
      'X-Evo-Worker-Hmac',
      'X-Evo-Worker-Hmac-Algorithm',
      'X-Evo-Autonomous-Reply-Hmac',
      'X-Evo-Autonomous-Reply-Hmac-Algorithm',
      'X-Evo-Portal-Overdue-Hmac',
      'X-Evo-Portal-Overdue-Hmac-Algorithm',
      'X-Evo-Gemini-Hmac',
      'X-Evo-Gemini-Hmac-Algorithm',
      'X-Evo-History-Hmac',
      'X-Evo-History-Hmac-Algorithm',
      'X-Evo-Media-Hmac',
      'X-Evo-Media-Hmac-Algorithm',
    ]) {
      expect(edgeCaddy).toContain(`request>headers>${header} delete`);
    }
  });

  it('keeps every Inbox service on bounded rotating logs', () => {
    const compose = read('deploy/docker-compose.inbox.prod.yml');

    expect(compose).toContain('logging: &bounded-logging');
    expect(compose).toContain('max-size: "10m"');
    expect(compose).toContain('max-file: "5"');
    expect(compose.match(/^    logging:/gm)).toHaveLength(2);
    expect(compose).toContain('logging: *bounded-logging');
  });

  it('runs WAHA as a separate private companion service', () => {
    const compose = read('deploy/docker-compose.inbox.prod.yml');
    const env = read('deploy/env.production.example');
    const wahaEnv = read('deploy/env.waha.example');

    expect(compose).toContain('container_name: evo-inbox-waha');
    expect(compose).toContain('evo_inbox_private');
    expect(compose).toContain(
      'EVO_INBOX_WAHA_BASE_URL: ${EVO_INBOX_WAHA_BASE_URL:-http://evo-inbox-waha:3000}'
    );
    expect(env).toContain('EVO_INBOX_WAHA_BASE_URL=http://evo-inbox-waha:3000');
    expect(wahaEnv).toContain('WAHA_API_KEY=sha512:');
    expect(wahaEnv).toContain('WAHA_API_KEY_EXCLUDE_PATH=ping');
    expect(`${compose}\n${env}\n${wahaEnv}`).not.toContain('evo-crm-waha');
    expect(`${compose}\n${env}\n${wahaEnv}`).not.toContain('crm_primary');
  });

  it('uses only unauthenticated ping for WAHA container liveness', () => {
    const inboxCompose = read('deploy/docker-compose.inbox.prod.yml');
    const rootCompose = read('../docker-compose.prod.yml');
    const inboxWahaEnv = read('deploy/env.waha.example');
    const rootWahaEnv = read('../deploy/env.waha.example');

    for (const compose of [inboxCompose, rootCompose]) {
      const wahaService = compose.slice(compose.indexOf('\n  waha:'));
      expect(wahaService).toMatch(
        /fetch\(''?http:\/\/127\.0\.0\.1:3000\/ping''?\)/
      );
      expect(wahaService).not.toMatch(
        /fetch\(''?http:\/\/127\.0\.0\.1:3000\/health''?\)/
      );
    }
    for (const env of [inboxWahaEnv, rootWahaEnv]) {
      expect(env).toContain('WAHA_API_KEY_EXCLUDE_PATH=ping');
      expect(env).not.toMatch(/WAHA_API_KEY_EXCLUDE_PATH=.*health/);
    }
  });

  it('keeps the root EVO CRM compose default off Acadis networking', () => {
    const rootCompose = read('../docker-compose.prod.yml');

    expect(rootCompose).toContain('name: ${EVO_CADDY_NETWORK:-evo_public_web}');
    expect(rootCompose).not.toContain('acadis_acadis_web');
  });

  it('documents the required proof/preflight credentials without values', () => {
    const env = read('deploy/env.production.example');
    const geminiEnv = read('deploy/env.gemini.example');
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
      'EVO_INBOX_GEMINI_API_KEY',
      'EVO_INBOX_TEST_WHATSAPP_NUMBER',
      'DNS/Caddy requirements',
      'evo-inbox-waha',
    ]) {
      expect(`${env}\n${geminiEnv}\n${runbook}`).toContain(needle);
    }

    expect(env).not.toContain('OPENAI_API_KEY');
    expect(env).not.toContain('ANTHROPIC_API_KEY');
  });

  it('keeps private observability disabled with an empty distinct secret example', () => {
    for (const path of [
      '.env.local.example',
      'deploy/env.production.example',
    ]) {
      const env = read(path);

      expect(env).toContain('EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED=0');
      expect(env).toMatch(/^EVO_INBOX_P7B_OBSERVABILITY_SECRET=$/m);
      expect(env).not.toContain('EVO_INBOX_P7B_OBSERVABILITY_SECRET=replace');
    }
  });
});
