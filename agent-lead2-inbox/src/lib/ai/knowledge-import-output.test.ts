import { describe, expect, it } from 'vitest';

import type { ImportResult } from './knowledge-bundle';
import { safeImportResult } from './knowledge-import-output';

describe('knowledge importer safe output', () => {
  it('retains only the closed operational result and removes account identity', () => {
    const privateAccountId = 'ded673d6-0556-4c5f-8814-838f5faba8cf';
    const output = safeImportResult({
      version: 1,
      account_id: privateAccountId,
      audience: 'client',
      bundle_sha256:
        'c20acf2a3ecdf321d9120ca97e1389b5883ef9cfd5d97dc5b1d2235c56a05c23',
      documents_upserted: 11,
      documents_deleted: 0,
      chunks_replaced: 42,
    } satisfies ImportResult);

    expect(output).toEqual({
      status: 'knowledge_import_verified',
      version: 1,
      audience: 'client',
      bundle_sha256:
        'c20acf2a3ecdf321d9120ca97e1389b5883ef9cfd5d97dc5b1d2235c56a05c23',
      documents_upserted: 11,
      documents_deleted: 0,
      chunks_replaced: 42,
    });
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain('account_id');
    expect(serialized).not.toContain(privateAccountId);
    expect(serialized).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
    );
  });
});
