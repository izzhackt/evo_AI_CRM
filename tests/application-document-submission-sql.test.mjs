import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
const directory = new URL('../supabase/migrations/', import.meta.url);
const migration = prefix => readFileSync(new URL(readdirSync(directory).find(name => name.startsWith(prefix)), directory), 'utf8');
const source = migration('228_');
const functionBody = (sql, name) => {
  const start = sql.search(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name.replaceAll('.', '\\.')}\\(`));
  assert.ok(start >= 0, `function exists: ${name}`);
  const body = sql.indexOf('AS $$', start) + 5;
  assert.ok(body > start);
  return sql.slice(body, sql.indexOf('$$;', body));
};
const transformations = section => [...section.matchAll(/body:=pg_temp\.b3f_replace\(body,\$old\$([\s\S]*?)\$old\$,\$new\$([\s\S]*?)\$new\$(?:,(\d+))?\);/g)];
const apply = (body, section) => {
  const changes = transformations(section);
  assert.ok(changes.length);
  for (const [, oldText, newText, count = '1'] of changes) {
    assert.equal(body.split(oldText).length - 1, Number(count), `exact inherited source pattern: ${oldText.slice(0, 60)}`);
    body = body.replaceAll(oldText, newText);
  }
  return body;
};
test('contextual reserve retains inherited scanner/rate/version allocator while permitting approved replacement', () => {
  const before = functionBody(migration('116_'), 'platform.reserve_document_upload_after_ingress_scan');
  const section = source.slice(source.indexOf("source:='platform.reserve_document_upload_after_ingress_scan"), source.indexOf("source:='platform_private.finalize_document_upload_storage_step"));
  const after = apply(before, section);
  assert.match(before, /IF slot_row\.status = 'approved'/);
  assert.doesNotMatch(after, /IF slot_row\.status = 'approved'/);
  for (const retained of ['require_scanned_upload_actor', 'assert_clamd_scan_facts', 'recent_actor_reservation_count >= 60', 'recent_slot_reservation_count >= 12', 'COALESCE(MAX(version.version_no), 0) + 1']) assert.ok(after.includes(retained), retained);
  assert.match(after, /application_upload_context_id, id, request_id/);
  assert.match(after, /p_context_id, reservation_id, p_request_id/);
  assert.doesNotMatch(after, /UPDATE\s+platform\.document_slots/i);
});
test('contextual Storage seal has no global publication but preserves canonical object/finalization proof', () => {
  const before = functionBody(migration('055_'), 'platform.finalize_document_upload');
  const section = source.slice(source.indexOf("source:='platform_private.finalize_document_upload_storage_step"), source.indexOf("source:='private.claim_student_document_upload_scan"));
  const after = apply(before, section);
  assert.match(before, /UPDATE platform\.document_slots/);
  assert.doesNotMatch(after, /UPDATE\s+platform\.document_slots/i);
  assert.doesNotMatch(after, /'document_slot_published', TRUE|'published_slot_status', 'submitted'/);
  assert.equal((after.match(/'document_slot_published', FALSE/g) ?? []).length, 2);
  for (const retained of ['object_row.created_at < reservation.created_at', 'object_row.created_at > reservation.expires_at', 'INSERT INTO platform_private.document_upload_finalizations', 'FOR SHARE']) assert.ok(after.includes(retained), retained);
});
test('all directly created and cloned functions have an explicit revoked baseline', () => {
  const names = [...source.matchAll(/^CREATE FUNCTION ((?:platform|platform_private)\.\w+)\(/gm)].map(m => m[1]);
  names.push(...['reserve', 'storage', 'claim', 'complete'].map(x => `platform_private.application_document_${x}_step`));
  assert.equal(new Set(names).size, names.length);
  for (const name of names) {
    assert.ok(source.includes(`ALTER FUNCTION ${name}(`), name);
    assert.match(source, new RegExp(`REVOKE ALL ON FUNCTION ${name.replaceAll('.', '\\.')}\\([^;]*\\) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;`));
    if (name.startsWith('platform_private.')) assert.ok(!source.includes(`GRANT EXECUTE ON FUNCTION ${name}(`), name);
  }
  for (const name of ['claim_application_document_upload_scan_v1', 'complete_application_document_upload_scan_v1', 'reserve_application_document_upload_after_ingress_scan_v1', 'finalize_application_document_upload_with_scan_v1', 'consume_application_document_download_v1']) {
    assert.match(source, new RegExp(`GRANT EXECUTE ON FUNCTION platform\\.${name}\\([^;]*\\) TO service_role;`));
    assert.doesNotMatch(source, new RegExp(`GRANT EXECUTE ON FUNCTION platform\\.${name}\\([^;]*\\) TO authenticated;`));
  }
});
test('legacy authoritative entries are guarded before their original BEGIN body and public readers only', () => {
  const guards = source.slice(source.indexOf('DO $guards$'), source.indexOf('END $guards$'));
  for (const name of ['platform.admit_student_document_upload_scan(', 'platform.preflight_document_upload(', 'platform.record_document_version_metadata(', 'platform.reserve_document_upload(', 'platform.reserve_document_upload_after_ingress_scan(', 'private.claim_student_document_upload_scan(', 'private.complete_student_document_upload_scan_admission(', 'platform_private.finalize_document_upload_storage_step(', 'platform.finalize_document_upload_with_scan(']) assert.ok(guards.includes(name), name);
  for (const version of [1, 2]) for (const audience of ['student', 'staff']) assert.ok(guards.includes(`platform.${audience}_application_requirements_v${version}(`));
  assert.ok(!guards.includes('platform_private.application_requirements_v2_view('));
  assert.ok(!guards.includes('platform.staff_save_application_requirements_v1('));
  assert.match(guards, /placing E'\\nBEGIN'\|\|guard/);
});
test('notification augmentation preserves all existing 153 branches and read replay code', () => {
  const block = source.slice(source.indexOf('DO $notification$'), source.indexOf('END $notification$'));
  const originals = [functionBody(migration('153_'), 'platform.student_portal_notifications_v2'), functionBody(migration('153_'), 'platform.mark_own_student_portal_notification_read_v2')];
  const changes = transformations(block);
  assert.equal(changes.length, 2);
  changes.forEach(([, oldText, newText], index) => {
    assert.equal(originals[index].split(oldText).length - 1, 1);
    assert.ok(newText.includes(oldText), 'prior branches remain byte-identical');
  });
});

test('service metadata allocator shares reserved versions without changing manual publication', () => {
  const before = functionBody(migration('043_'), 'platform.record_document_version_metadata');
  const block = source.slice(source.indexOf('DO $allocator$'), source.indexOf('END $allocator$'));
  const after = apply(before, block);
  assert.doesNotMatch(after, /next_version_no := COALESCE\(slot_row.current_version_no/);
  assert.match(after, /COALESCE\(MAX\(version.version_no\), 0\) \+ 1/);
  for (const retained of ['FOR UPDATE', 'service_role', 'UPDATE platform.document_slots', "'document.version.record'"]) assert.ok(after.includes(retained), retained);
});

test('historical retries require an exact existing reservation while first allocation remains current-only', () => {
  for (const name of ['platform.claim_application_document_upload_scan_v1', 'platform.reserve_application_document_upload_after_ingress_scan_v1']) {
    const body = functionBody(source, name);
    assert.match(body, /application_document_service_context\([^;]*p_request_id,FALSE\)/);
    assert.match(body, /IF NOT EXISTS\(SELECT 1 FROM platform_private\.document_upload_reservations r[\s\S]*?r\.organization_id=p_organization_id AND r\.application_upload_context_id=c\.id AND r\.request_id=c\.request_id\) THEN\s+PERFORM platform_private\.application_document_item\([^;]*,TRUE\);\s+END IF;/);
    const gate = body.indexOf('IF NOT EXISTS(SELECT 1 FROM platform_private.document_upload_reservations');
    const primitive = body.indexOf(name.includes('claim_') ? 'result:=platform_private.application_document_claim_step' : 'result:=platform_private.application_document_reserve_step');
    assert.ok(gate > body.indexOf('application_document_service_context') && gate < primitive);
  }
  const admission = functionBody(source, 'platform.admit_application_document_upload_v1');
  const foundBranch = admission.slice(admission.indexOf('IF FOUND THEN'), admission.indexOf(' ELSE', admission.indexOf('IF FOUND THEN')));
  assert.ok(!foundBranch.includes('application_document_item('), 'authorized prior context replay does not require latest definition');
  assert.ok(admission.indexOf('application_document_item(') < admission.indexOf('INSERT INTO platform_private.application_document_upload_contexts'));
});

test('shared scan advisories follow organization rows across effective 128/155/156 and every contextual lease entry', () => {
  const before = (body, first, second) => {
    const left = body.indexOf(first); const right = body.indexOf(second);
    assert.ok(left >= 0 && right >= 0 && left < right, `${first} precedes ${second}`);
  };
  // 128 alone hides the organization row lock added to its dependency by 155.
  const effectiveDomainActor = functionBody(migration('155_'), 'platform_private.require_domain_actor');
  assert.match(effectiveDomainActor, /FROM platform\.organizations WHERE id=p_organization_id FOR UPDATE/);
  before(effectiveDomainActor, 'FROM platform.organizations', 'FROM platform.profiles');
  const legacyAdmission = functionBody(migration('128_'), 'platform.admit_student_document_upload_scan');
  before(legacyAdmission, 'platform_private.require_domain_actor(', 'evo:e5:student-scan-request:');
  before(legacyAdmission, 'evo:e5:student-scan-request:', 'evo:e5:student-scan-actor:');
  before(legacyAdmission, 'evo:e5:student-scan-actor:', 'evo:e5:student-scan-slot:');

  const ordinaryLock = functionBody(source, 'platform_private.application_document_lock');
  before(ordinaryLock, 'platform_private.lock_p2h_request(', 'FROM platform.organizations');
  assert.match(ordinaryLock, /FROM platform\.organizations WHERE id=a\.organization_id FOR UPDATE/);
  const admission = functionBody(source, 'platform.admit_application_document_upload_v1');
  before(admission, 'platform_private.application_document_lock(', 'evo:e5:student-scan-request:');
  before(admission, 'evo:e5:student-scan-request:', 'evo:e5:student-scan-actor:');
  before(admission, 'evo:e5:student-scan-actor:', 'evo:e5:student-scan-slot:');
  assert.ok(admission.lastIndexOf('platform_private.application_document_actor(') > admission.indexOf('evo:e5:student-scan-slot:'), 'fresh authority remains after admission locks');

  const effectiveScannedActor = functionBody(migration('156_'), 'platform_private.require_scanned_upload_actor');
  assert.match(effectiveScannedActor, /FROM platform\.organizations o WHERE o\.id=p_organization_id FOR UPDATE/);
  const serviceContext = functionBody(source, 'platform_private.application_document_service_context');
  before(serviceContext, 'platform_private.lock_p2h_request(', 'platform_private.require_scanned_upload_actor(');
  before(serviceContext, 'platform_private.require_scanned_upload_actor(', 'FROM platform.student_cases');
  for (const name of ['platform.claim_application_document_upload_scan_v1', 'platform.complete_application_document_upload_scan_v1']) {
    const body = functionBody(source, name);
    before(body, 'platform_private.application_document_service_context(', 'evo:e5:student-scan-request:');
  }
  const claim = functionBody(source, 'platform.claim_application_document_upload_scan_v1');
  before(claim, 'evo:e5:student-scan-request:', 'evo:e5:student-scan-global');
  before(claim, 'evo:e5:student-scan-global', 'evo:e5:student-scan-actor:');
  before(claim, 'evo:e5:student-scan-actor:', 'evo:e5:student-scan-slot:');
  // Legacy claim/release primitives never acquire an organization row after
  // their scan advisory; the contextual wrappers supply authority beforehand.
  for (const name of ['private.claim_student_document_upload_scan', 'private.complete_student_document_upload_scan_admission']) {
    const body = functionBody(migration('128_'), name);
    assert.doesNotMatch(body, /platform\.organizations|require_domain_actor|require_scanned_upload_actor/);
  }
});
