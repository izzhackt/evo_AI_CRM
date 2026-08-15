import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';

import { chunkText } from './chunk';
import { embedTexts } from './embeddings';
import { loadEmbeddingsConfigForAccount } from './config';

type Audience = 'client' | 'internal';

interface SourceDocument {
  source_path: string;
  source_sha256: string;
  title: string;
  content: string;
}

interface SourceBundle {
  version: 1;
  account_id: string;
  audience: Audience;
  vault_kind: string;
  marker_sha256: string;
  documents: SourceDocument[];
}

export interface ImportResult {
  version: 1;
  account_id: string;
  audience: Audience;
  bundle_sha256: string;
  documents_upserted: number;
  documents_deleted: number;
  chunks_replaced: number;
}

const SHA256 = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, i) => key === [...keys].sort()[i])
  );
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}: ожидался объект`);
  return value as Record<string, unknown>;
}

function parseJson(bytes: Buffer, label: string): unknown {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes))
    throw new Error(`${label}: невалидный UTF-8`);
  if (!text.endsWith('\n') || text.endsWith('\n\n'))
    throw new Error(`${label}: неверное canonical JSON окончание`);
  const parsed = JSON.parse(text) as unknown;
  if (!Buffer.from(`${stableStringify(parsed)}\n`, 'utf8').equals(bytes))
    throw new Error(`${label}: JSON не canonical`);
  return parsed;
}

function validateDocument(value: unknown): SourceDocument {
  const row = object(value, 'документ');
  if (!exactKeys(row, ['source_path', 'source_sha256', 'title', 'content']))
    throw new Error('документ: неверная схема');
  const { source_path, source_sha256, title, content } = row;
  if (
    [source_path, source_sha256, title, content].some(
      (field) => typeof field !== 'string'
    )
  )
    throw new Error('документ: поля должны быть строками');
  const path = source_path as string;
  if (
    !path ||
    path !== path.normalize('NFC') ||
    path.startsWith('/') ||
    path.includes('\\') ||
    !path.endsWith('.md') ||
    path
      .split('/')
      .some(
        (part) =>
          !part ||
          part.startsWith('.') ||
          part === '..' ||
          part === 'Сырой архив ЭВО' ||
          part === 'Секреты и доступы ЭВО'
      )
  )
    throw new Error('документ: небезопасный source_path');
  if (
    !SHA256.test(source_sha256 as string) ||
    sha256(Buffer.from(content as string, 'utf8')) !== source_sha256
  )
    throw new Error('документ: SHA-256 не совпадает');
  if (!(title as string).trim() || !(content as string).trim())
    throw new Error('документ: пустой title/content');
  if (
    containsEmail(`${title}\n${content}`) ||
    containsPhone(`${title}\n${content}`)
  )
    throw new Error('документ: обнаружены email или телефон');
  return row as unknown as SourceDocument;
}

export function validateBundleBytes(
  bundleBytes: Buffer,
  manifestBytes: Buffer,
  expectedAccountId: string,
  expectedAudience: Audience,
  expectedBundleFile: string
): { bundle: SourceBundle; bundleSha256: string } {
  if (!UUID.test(expectedAccountId)) throw new Error('Неверный account id');
  const bundleSha256 = sha256(bundleBytes);
  const manifest = object(parseJson(manifestBytes, 'manifest'), 'manifest');
  if (
    !exactKeys(manifest, [
      'version',
      'account_id',
      'audience',
      'bundle_file',
      'bundle_sha256',
    ]) ||
    manifest.version !== 1 ||
    manifest.account_id !== expectedAccountId ||
    manifest.audience !== expectedAudience ||
    manifest.bundle_file !== expectedBundleFile ||
    manifest.bundle_sha256 !== bundleSha256
  )
    throw new Error('Manifest не соответствует пакету');
  const raw = object(parseJson(bundleBytes, 'bundle'), 'bundle');
  const expectedVaultKind =
    expectedAudience === 'client'
      ? 'evo_client_knowledge'
      : 'evo_internal_knowledge';
  if (
    !exactKeys(raw, [
      'version',
      'account_id',
      'audience',
      'vault_kind',
      'marker_sha256',
      'documents',
    ]) ||
    raw.version !== 1 ||
    raw.account_id !== expectedAccountId ||
    raw.audience !== expectedAudience ||
    raw.vault_kind !== expectedVaultKind ||
    !SHA256.test(String(raw.marker_sha256)) ||
    !Array.isArray(raw.documents) ||
    raw.documents.length === 0
  )
    throw new Error('Bundle имеет неверную схему');
  const documents = raw.documents.map(validateDocument);
  if (
    new Set(documents.map((item) => item.source_path)).size !== documents.length
  )
    throw new Error('Bundle содержит дубли source_path');
  return {
    bundle: { ...(raw as unknown as SourceBundle), documents },
    bundleSha256,
  };
}

export async function importKnowledgeBundle(
  db: SupabaseClient,
  bundlePath: string,
  manifestPath: string,
  accountId: string,
  audience: Audience
): Promise<ImportResult> {
  const [bundleBytes, manifestBytes] = await Promise.all([
    readFile(bundlePath),
    readFile(manifestPath),
  ]);
  const { bundle, bundleSha256 } = validateBundleBytes(
    bundleBytes,
    manifestBytes,
    accountId,
    audience,
    basename(bundlePath)
  );
  const config = await loadEmbeddingsConfigForAccount(accountId);
  if (config.corrupt || config.provider === 'keyword' || !config.key)
    throw new Error(
      'Для атомарного импорта нужен исправный Gemini/OpenAI embeddings key; fallback запрещён'
    );

  const materialized = [];
  for (const document of bundle.documents) {
    const contents = chunkText(document.content);
    if (contents.length === 0)
      throw new Error(`Документ без chunks: ${document.source_path}`);
    const embeddings = await embedTexts(
      { provider: config.provider, apiKey: config.key },
      contents,
      'document'
    );
    materialized.push({
      ...document,
      chunks: contents.map((content, chunk_index) => ({
        chunk_index,
        content,
        content_sha256: sha256(Buffer.from(content, 'utf8')),
        embedding: embeddings[chunk_index],
      })),
    });
  }

  const { data, error } = await db.rpc('sync_ai_knowledge_bundle', {
    p_account_id: accountId,
    p_audience: audience,
    p_bundle_sha256: bundleSha256,
    p_payload: { version: 1, documents: materialized },
  });
  if (error) throw new Error(`Атомарный sync отклонён: ${error.message}`);
  return validateImportResult(data, accountId, audience, bundleSha256);
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function containsEmail(value: string): boolean {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value);
}

function containsPhone(value: string): boolean {
  for (const match of value.matchAll(/(?<!\w)(?:\+?\d[\s().-]*){8,}(?!\w)/g)) {
    const candidate = match[0];
    const digits = candidate.replace(/\D/g, '').length;
    if (candidate.trimStart().startsWith('+') || digits >= 10) return true;
  }
  return false;
}

function validateImportResult(
  value: unknown,
  accountId: string,
  audience: Audience,
  bundleSha256: string
): ImportResult {
  const result = object(value, 'результат sync');
  if (
    !exactKeys(result, [
      'version',
      'account_id',
      'audience',
      'bundle_sha256',
      'documents_upserted',
      'documents_deleted',
      'chunks_replaced',
    ]) ||
    result.version !== 1 ||
    result.account_id !== accountId ||
    result.audience !== audience ||
    result.bundle_sha256 !== bundleSha256
  )
    throw new Error('Результат sync не соответствует запросу');
  for (const field of [
    'documents_upserted',
    'documents_deleted',
    'chunks_replaced',
  ]) {
    if (!Number.isInteger(result[field]) || (result[field] as number) < 0)
      throw new Error('Результат sync содержит неверные счётчики');
  }
  return result as unknown as ImportResult;
}
