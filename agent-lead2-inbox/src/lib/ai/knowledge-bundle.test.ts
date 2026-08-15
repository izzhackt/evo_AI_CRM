import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { validateBundleBytes } from './knowledge-bundle';

const account = '11111111-1111-4111-8111-111111111111';

function canonical(value: unknown): Buffer {
  const stable = (input: unknown): string =>
    Array.isArray(input)
      ? `[${input.map(stable).join(',')}]`
      : input && typeof input === 'object'
        ? `{${Object.entries(input as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
            .join(',')}}`
        : JSON.stringify(input);
  return Buffer.from(`${stable(value)}\n`, 'utf8');
}

function sha(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function fixture() {
  const content = '# Китай\n\nАктуальная информация.';
  const bundle = canonical({
    version: 1,
    account_id: account,
    audience: 'client',
    vault_kind: 'evo_client_knowledge',
    marker_sha256: 'a'.repeat(64),
    documents: [
      {
        source_path: 'Страны/Китай.md',
        source_sha256: sha(Buffer.from(content)),
        title: 'Китай',
        content,
      },
    ],
  });
  const manifest = canonical({
    version: 1,
    account_id: account,
    audience: 'client',
    bundle_file: 'evo-knowledge-client.json',
    bundle_sha256: sha(bundle),
  });
  return { bundle, manifest };
}

describe('knowledge bundle validation', () => {
  it('accepts an exact account/audience/hash-bound bundle', () => {
    const { bundle, manifest } = fixture();
    expect(
      validateBundleBytes(
        bundle,
        manifest,
        account,
        'client',
        'evo-knowledge-client.json'
      ).bundle.documents
    ).toHaveLength(1);
  });

  it('fails closed on changed bytes and unsafe paths', () => {
    const { bundle, manifest } = fixture();
    expect(() =>
      validateBundleBytes(
        Buffer.concat([bundle, Buffer.from(' ')]),
        manifest,
        account,
        'client',
        'evo-knowledge-client.json'
      )
    ).toThrow();
    const parsed = JSON.parse(bundle.toString());
    parsed.documents[0].source_path = '../Секреты.md';
    const changed = canonical(parsed);
    const changedManifest = canonical({
      ...JSON.parse(manifest.toString()),
      bundle_sha256: sha(changed),
    });
    expect(() =>
      validateBundleBytes(
        changed,
        changedManifest,
        account,
        'client',
        'evo-knowledge-client.json'
      )
    ).toThrow(/source_path/);
  });

  it('rejects PII for both audiences', () => {
    for (const [audience, content] of [
      ['client', 'Пишите test@example.com'],
      ['internal', 'Телефон +996 555 123 456'],
    ] as const) {
      const raw = {
        version: 1,
        account_id: account,
        audience,
        vault_kind:
          audience === 'client'
            ? 'evo_client_knowledge'
            : 'evo_internal_knowledge',
        marker_sha256: 'a'.repeat(64),
        documents: [
          {
            source_path: 'Контакт.md',
            source_sha256: sha(Buffer.from(content)),
            title: 'Контакт',
            content,
          },
        ],
      };
      const bundle = canonical(raw);
      const manifest = canonical({
        version: 1,
        account_id: account,
        audience,
        bundle_file: `evo-knowledge-${audience}.json`,
        bundle_sha256: sha(bundle),
      });
      expect(() =>
        validateBundleBytes(
          bundle,
          manifest,
          account,
          audience,
          `evo-knowledge-${audience}.json`
        )
      ).toThrow(/email или телефон/);
    }
  });
});
