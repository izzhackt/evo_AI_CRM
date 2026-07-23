import { spawn } from 'node:child_process';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/seed-prod-amocrm-config.mjs');

type RequestRecord = {
  method: string;
  url: string;
  authorization?: string;
  body: unknown;
};

const servers: Array<{ close: () => Promise<void> }> = [];

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('error', reject);
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve(null);
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(text);
      }
    });
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
) {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      res.statusCode = 500;
      res.end(String(error?.message ?? error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('test server did not expose a port');
  }
  const control = {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  servers.push(control);
  return control;
}

function runScript(env: Record<string, string>) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(process.execPath, [script], {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
      child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
      child.on('close', (status) =>
        resolve({
          status,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        })
      );
    }
  );
}

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

describe('seed-prod-amocrm-config', () => {
  it('validates amoCRM and stores only encrypted secret material', async () => {
    const requests: RequestRecord[] = [];
    const accessToken = 'amo-live-token-secret';

    const amo = await listen(async (req, res) => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: req.headers.authorization,
        body: await readBody(req),
      });
      expect(req.method).toBe('GET');
      expect(req.url).toBe('/api/v4/account');
      expect(req.headers.authorization).toBe(`Bearer ${accessToken}`);
      json(res, 200, {
        id: 31741722,
        name: 'EVO Admissions',
        subdomain: 'evoadmissions',
      });
    });

    const supabase = await listen(async (req, res) => {
      const body = await readBody(req);
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: req.headers.authorization,
        body,
      });

      if (req.method === 'GET' && req.url?.startsWith('/rest/v1/accounts')) {
        return json(res, 200, [
          { id: 'account-1', name: 'EVO', owner_user_id: 'user-1' },
        ]);
      }

      if (
        req.method === 'POST' &&
        req.url?.startsWith('/rest/v1/integration_settings')
      ) {
        expect(body).toMatchObject([
          {
            account_id: 'account-1',
            provider: 'amocrm',
            status: 'configured',
            public_config: {
              baseUrl: amo.url,
              pipelineId: 123,
              statusId: 456,
              responsibleUserId: 789,
            },
          },
        ]);
        return json(res, 200, [{ id: 'setting-1', ...(body as object[])[0] }]);
      }

      if (
        req.method === 'POST' &&
        req.url?.startsWith('/rest/v1/integration_secrets')
      ) {
        expect(JSON.stringify(body)).not.toContain(accessToken);
        expect(body).toMatchObject([
          {
            setting_id: 'setting-1',
            secret_name: 'access_token',
            updated_by: 'user-1',
          },
        ]);
        return json(res, 200, [
          { secret_name: 'access_token', encrypted_value: 'ciphertext' },
        ]);
      }

      if (
        req.method === 'GET' &&
        req.url?.startsWith('/rest/v1/conversations')
      ) {
        return json(res, 200, [{ id: 'conversation-1' }]);
      }

      if (
        req.method === 'PATCH' &&
        req.url?.startsWith('/rest/v1/conversations')
      ) {
        expect(body).toMatchObject({
          crm_sync_status: 'pending',
          crm_sync_error: null,
        });
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.method === 'PATCH' && req.url?.startsWith('/rest/v1/messages')) {
        expect(body).toEqual({
          crm_sync_status: 'pending',
          crm_sync_error: null,
        });
        res.statusCode = 204;
        res.end();
        return;
      }

      json(res, 404, { error: `unexpected ${req.method} ${req.url}` });
    });

    const result = await runScript({
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      ENCRYPTION_KEY: 'a'.repeat(64),
      EVO_INBOX_AMOCRM_BASE_URL: amo.url,
      EVO_INBOX_AMOCRM_ACCESS_TOKEN: accessToken,
      EVO_INBOX_AMOCRM_PIPELINE_ID: '123',
      EVO_INBOX_AMOCRM_STATUS_ID: '456',
      EVO_INBOX_AMOCRM_RESPONSIBLE_USER_ID: '789',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain(accessToken);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      ok: true,
      validation: {
        account_id: 31741722,
        account_name: 'EVO Admissions',
        subdomain: 'evoadmissions',
        live_provider_call: true,
      },
      setting: {
        provider: 'amocrm',
        status: 'configured',
      },
      secret_names: ['access_token'],
      reset_crm_sync: {
        conversations: 1,
        messages: 'filtered',
      },
    });
    expect(
      requests.some((request) => request.url.includes('/api/v4/account'))
    ).toBe(true);
  });

  it('fails closed on placeholder token values', async () => {
    const result = await runScript({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      ENCRYPTION_KEY: 'a'.repeat(64),
      EVO_INBOX_AMOCRM_BASE_URL: 'https://evoadmissions.amocrm.ru',
      EVO_INBOX_AMOCRM_ACCESS_TOKEN: 'replace-me',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Missing required env: EVO_INBOX_AMOCRM_ACCESS_TOKEN'
    );
    expect(result.stderr).not.toContain('service-role-key');
  });
});
