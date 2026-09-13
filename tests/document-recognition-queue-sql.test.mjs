import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classifyNameStatus } from '../scripts/classify-pr-changes.mjs';

const sql = readFileSync(new URL('../supabase/migrations/162_platform_document_recognition_queue.sql', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../scripts/test-document-recognition-postgres.sh', import.meta.url), 'utf8');
const positive = readFileSync(new URL('../supabase/tests/document_recognition_queue_positive.sql', import.meta.url), 'utf8');

test('queue migration owns durable provider, result and cleanup commands without automatic generation retry', () => {
  for (const name of ['enqueue_document_recognition', 'staff_document_recognition_job', 'claim_document_recognition',
    'renew_document_recognition_lease', 'seal_document_recognition_preflight', 'begin_document_recognition_upload',
    'observe_document_recognition_file', 'record_document_recognition_token_count', 'begin_document_recognition_generation',
    'record_document_recognition_result', 'publish_document_recognition_proposals', 'finish_document_recognition',
    'claim_document_recognition_cleanup', 'begin_document_recognition_delete', 'record_document_recognition_cleanup']) {
    assert.match(sql, new RegExp(`CREATE FUNCTION platform\\.${name}\\(`), name);
  }
  assert.match(sql, /ordinal INTEGER NOT NULL DEFAULT 1 CHECK \(ordinal = 1\)/);
  assert.match(sql, /generate_started_at/);
  assert.match(sql, /generation_unknown/);
  assert.match(sql, /document_recognition_provider_files/);
  assert.doesNotMatch(sql, /INSERT INTO platform\.student_profile_field_reviews/);
  assert.doesNotMatch(sql, /UPDATE platform\.student_profile_fields/);
});

test('source, actor and result contracts remain paired with existing authority and registry', () => {
  for (const permission of ['case.read.full','profile.read.full','profile.manage','document.read.full','document.download','document.extract']) {
    assert.ok(sql.includes(`'${permission}'`), permission);
  }
  assert.match(sql, /student_document_has_scan_proof/);
  assert.match(sql, /staff_lock_memberships/);
  assert.match(sql, /staff_membership_identity/);
  assert.match(sql, /student_profile_field_registry/);
  assert.match(sql, /evo-document-recognition-request-v1/);
  assert.match(sql, /evo-document-recognition-enqueue-v1/);
  assert.doesNotMatch(sql, /INSERT INTO platform\.staff_role_assignments/);
});

test('bounded real SQL proof has isolated ownership, production-free resources and actual RPC workflow', () => {
  assert.match(runner, /--network none --memory 1g --cpus 1 --pids-limit 128/);
  assert.match(runner, /resolve-postgres-test-image\.sh/);
  assert.match(runner, /trap cleanup EXIT/);
  assert.match(runner, /docker rm --force --volumes "\$container_name"/);
  assert.match(runner, /ON_ERROR_STOP=1/);
  assert.match(positive, /platform\.bootstrap_organization_admin/);
  assert.match(positive, /platform\.reserve_document_upload_after_ingress_scan/);
  assert.match(positive, /platform\.finalize_document_upload_with_scan/);
  assert.match(positive, /platform\.enqueue_document_recognition/);
  assert.match(positive, /platform\.seal_document_recognition_preflight/);
  assert.match(positive, /ROLLBACK;/);
  assert.doesNotMatch(runner, /hermes|ssh |docker compose|supabase db push|curl/);
});

test('new proof script is already a known code path, without unknown-range relaxation', () => {
  const result = classifyNameStatus(Buffer.from('A\0scripts/test-document-recognition-postgres.sh\0'));
  assert.equal(result.unknown, false);
  assert.equal(result.code, true);
});
