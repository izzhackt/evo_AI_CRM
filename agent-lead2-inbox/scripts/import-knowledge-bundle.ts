import { importKnowledgeBundle } from '../src/lib/ai/knowledge-bundle';
import { supabaseAdminClient } from '../src/lib/supabase/admin-client';

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Обязательный аргумент: ${name}`);
  return value;
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

process.stdout.write(`${JSON.stringify(result)}\n`);
