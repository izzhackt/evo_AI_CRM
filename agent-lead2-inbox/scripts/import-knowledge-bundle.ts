import { importKnowledgeBundle } from '../src/lib/ai/knowledge-bundle';
import { safeImportResult } from '../src/lib/ai/knowledge-import-output';
import { supabaseAdminClient } from '../src/lib/supabase/admin-client';

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Обязательный аргумент: ${name}`);
  return value;
}

async function main(): Promise<void> {
  if (process.argv.length === 3 && process.argv[2] === '--verify-runtime') {
    process.stdout.write(
      `${JSON.stringify({ status: 'knowledge_import_runtime_verified', version: 1 })}\n`
    );
    return;
  }

  const audience = arg('--audience');
  if (audience !== 'client' && audience !== 'internal')
    throw new Error('--audience должен быть client или internal');

  const result = await importKnowledgeBundle(
    supabaseAdminClient(),
    arg('--bundle'),
    arg('--manifest'),
    arg('--account-id'),
    audience
  );

  process.stdout.write(`${JSON.stringify(safeImportResult(result))}\n`);
}

await main();
