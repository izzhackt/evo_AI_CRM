import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

// Source safety regressions only. These checks do not claim PostgreSQL object
// resolution, actual command execution, concurrency, Auth, or UI acceptance.
const directory = new URL('../supabase/migrations/', import.meta.url);
const migration = prefix => readFileSync(new URL(readdirSync(directory).find(name => name.startsWith(prefix)), directory), 'utf8');
const sql = migration('232_');
const prior = migration('228_');
const body = (source, name) => {
  const start = source.search(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name.replaceAll('.', '\\.')}\\(`));
  assert.ok(start >= 0, name);
  const begin = source.indexOf('AS $$', start) + 5;
  assert.ok(begin > start, name);
  return source.slice(begin, source.indexOf('$$;', begin));
};
const before = (source, left, right) => {
  assert.ok(source.indexOf(left) >= 0, left);
  assert.ok(source.indexOf(right) > source.indexOf(left), `${left} before ${right}`);
};
const functionNames = [...sql.matchAll(/^CREATE FUNCTION ((?:platform|platform_private)\.\w+)\(/gm)].map(x => x[1]);

test('only the three package resources are added; canonical and legacy material writers stay untouched', () => {
  assert.deepEqual([...sql.matchAll(/^CREATE TABLE (\S+)/gm)].map(x => x[1]), [
    'platform_private.application_package_submissions', 'platform_private.application_package_items', 'platform_private.application_package_reviews',
  ]);
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE) platform\.(?:document_slots|document_versions|document_reviews|university_applications|document_slot_case_links)\b/i);
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM) storage\./i);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /block_append_only_mutation/);
  assert.match(sql, /BEFORE TRUNCATE/);
  for (const relation of ['catalog_preparation_bindings', 'application_requirement_revisions', 'application_document_submissions', 'document_versions']) assert.ok(sql.includes(`REFERENCES ${relation === 'document_versions' ? 'platform' : 'platform_private'}.${relation}`), relation);
});

test('new functions have a fixed definer search path, revoked default ACL and explicit ordinary Auth grants only', () => {
  assert.equal(new Set(functionNames).size, functionNames.length);
  for (const name of functionNames) {
    const declaration = sql.slice(sql.indexOf(`CREATE FUNCTION ${name}(`), sql.indexOf('AS $$', sql.indexOf(`CREATE FUNCTION ${name}(`)));
    assert.match(declaration, /SECURITY DEFINER SET search_path=''/);
    assert.ok(sql.includes(`ALTER FUNCTION ${name}(`), name);
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${name.replaceAll('.', '\\.')}\\([^;]*\\) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;`));
    assert.equal(sql.includes(`GRANT EXECUTE ON FUNCTION ${name}(`), name.startsWith('platform.'));
  }
  assert.equal(functionNames.filter(x => x.startsWith('platform.')).length, 9);
  assert.doesNotMatch(sql, /GRANT[^;]*TO (?:PUBLIC|anon|service_role)/);
});

test('the complete deterministic child request set precedes inherited organization locks', () => {
  const inheritedLock = body(prior, 'platform_private.application_document_lock');
  before(inheritedLock, 'lock_p2h_request', 'FROM platform.organizations');
  before(inheritedLock, 'FROM platform.organizations', 'FROM platform.student_cases');
  before(inheritedLock, 'FROM platform.student_cases', 'FROM platform.university_applications');
  const prelock = body(sql, 'platform_private.application_package_prelock');
  assert.match(prelock, /requests:=ARRAY\[p_request\]/);
  assert.match(prelock, /SELECT DISTINCT x FROM unnest\(requests\) x ORDER BY x/);
  assert.doesNotMatch(prelock, /FROM platform\.organizations|FOR UPDATE/);
  for (const operation of ['submit', 'review']) {
    const command = body(sql, `platform.application_package_${operation}_v1`);
    before(command, 'application_package_prelock', 'application_document_lock');
    const tag = `application-package:${operation}:`;
    assert.ok(prelock.includes(tag) && command.includes(tag));
    assert.match(command, /public\.uuid_generate_v5\(request,'application-package:(?:submit|review):'/);
  }
});

test('all selected material and review-source rows are prelocked before any228 child command', () => {
  for (const operation of ['submit', 'review']) {
    const command = body(sql, `platform.application_package_${operation}_v1`);
    before(command, 'FROM platform.document_slots s', 'FROM platform.document_versions v');
    before(command, 'FROM platform.document_versions v', 'FROM platform_private.application_document_submissions s');
    const child = operation === 'submit' ? 'child:=platform.submit_application_document_v1' : 'child:=platform.review_application_document_submission_v1';
    before(command, 'FROM platform_private.application_document_submissions s', child);
    for (const alias of ['s', 'v']) assert.ok(command.includes(`ORDER BY ${alias}.id FOR UPDATE`));
  }
  const review = body(sql, 'platform.application_package_review_v1');
  assert.match(review, /s\.id=ANY\(source_ids\)/);
  before(review, 'application_package_reuse_proof', 'child:=platform.review_application_document_submission_v1');
  const inheritedNotification = body(prior, 'platform_private.publish_application_document_review_notification');
  assert.doesNotMatch(inheritedNotification, /lock_p2h_request|pg_advisory/);
});

test('ordered exact intents are authoritative; matching composition also proves equality and creates an alias audit', () => {
  const replay = body(sql, 'platform_private.application_package_replay');
  assert.match(replay, /event\.after_state->'intent' IS DISTINCT FROM p_intent/);
  assert.doesNotMatch(replay, /@>/);
  const submit = body(sql, 'platform.application_package_submit_v1');
  assert.match(submit, /latest\.composition_sha256=sha AND latest\.composition=composition/);
  const alias = submit.slice(submit.indexOf('IF latest.id IS NOT NULL'), submit.indexOf('next_version:='));
  assert.match(alias, /application_document_audit/);
  assert.doesNotMatch(alias, /INSERT INTO/);
  assert.match(submit, /actorMembershipId/);
});

test('authorized exact replay precedes current-revision checks; recovery neither replays mutations nor fabricates success', () => {
  const submit = body(sql, 'platform.application_package_submit_v1');
  before(submit, 'application_package_actor', 'application_package_replay');
  before(submit, 'IF receipt IS NOT NULL THEN RETURN receipt', "application_package_stale_requirements");
  const recovery = body(sql, 'platform.application_package_recover_v1');
  before(recovery, 'application_document_lock', 'application_package_replay');
  before(recovery, 'application_package_actor', 'application_package_replay');
  assert.doesNotMatch(recovery, /INSERT INTO|UPDATE\s+platform|application_package_submit_v1|application_package_review_v1/);
  assert.match(recovery, /CASE WHEN receipt IS NULL THEN 'not_written' ELSE 'committed' END/);
  for (const identity of ["'requestId',request", "'studentCaseId',case_id", "'applicationId',application"]) assert.ok(recovery.includes(identity));
});

test('starter and excluded optional mapping problems do not acquire an invented confirmed-only gate', () => {
  const existingDefinition = body(migration('226_'), 'platform_private.application_requirements_v2_view');
  assert.match(existingDefinition, /WHEN cardinality\(configuration\)>0 THEN 'needs_configuration'/);
  const readiness = body(sql, 'platform.application_package_readiness_v1');
  assert.match(readiness, /WHERE revision_id=revision AND required ORDER BY position/);
  assert.match(readiness, /IF revision IS NULL/);
  assert.doesNotMatch(readiness, /configurationState|configurationReasons|requirements->>'state'|staff_confirmed/);
  assert.match(readiness, /application_document_selection/);
  assert.match(readiness, /technicalAvailability/);
  assert.match(readiness, /submission IS NULL AND previous IS DISTINCT FROM/);
});

test('current228 permissions and scope are reused without curator-assignment or Student-review shortcuts', () => {
  const actor = body(sql, 'platform_private.application_package_actor');
  assert.match(actor, /application_document_actor\(p_case,p_permission\)/);
  assert.match(actor, /b\.organization_id=a\.organization_id AND b\.student_case_id=p_case AND b\.application_id=p_application/);
  const priorActor = body(prior, 'platform_private.application_document_actor');
  assert.match(priorActor, /IF p_permission='document.review' THEN RAISE EXCEPTION/);
  const queue = body(sql, 'platform.application_package_queue_v1');
  assert.match(queue, /staff_can_access_for_actor/);
  assert.doesNotMatch(queue, /curator|assigned_to|SET\s+.*membership/);
});

test('cross-revision approval proves every material/definition edge and cannot override a current negative', () => {
  const proof = body(sql, 'platform_private.application_package_reuse_proof');
  for (const token of ['current_submission.student_case_id', 'source_submission.application_id', 'current_submission.document_slot_id', 'source_submission.document_version_id', 'revision.previous_revision_id', 'previous_revision.revision_version>=revision.revision_version', 'requirements_editor_definition(item) IS DISTINCT FROM platform_private.requirements_editor_definition(previous)', 'current_material IS DISTINCT FROM previous_material', "current_review.decision<>'approved'", 'source_review.id IS DISTINCT FROM p_source_review']) assert.ok(proof.includes(token), token);
  assert.doesNotMatch(proof, /application_document_lineage\(/);
  const review = body(sql, 'platform.application_package_review_v1');
  assert.match(review, /reuse IS NOT NULL AND current_review.id IS NULL/);
  assert.match(review, /platform\.review_application_document_submission_v1\(item\.submission_id,NULL,'approved',NULL/);
  assert.match(review, /'reusedFromSubmissionId',reuse->'sourceSubmissionId'/);
});

test('package review stores fixed proof while detail separately projects changing review/availability warnings', () => {
  assert.match(body(prior, 'platform_private.application_document_submission_summary'), /ORDER BY r\.reviewed_at DESC,r\.id DESC/);
  const review = body(sql, 'platform.application_package_review_v1');
  before(review, 'application_package_document_review_changed', 'child:=platform.review_application_document_submission_v1');
  assert.match(review, /'review',platform_private\.application_package_document_review\(current_review\.id\)/);
  assert.match(review, /'documentReviews',evidence/);
  assert.doesNotMatch(body(sql, 'platform_private.application_package_review_summary'), /application_document_submission_summary/);
  const detail = body(sql, 'platform.application_package_detail_v1');
  assert.match(detail, /'reason','review_changed'/);
  assert.match(detail, /'reason','file_unavailable'/);
  assert.match(detail, /'currentReview',submission->'review'/);
});

test('notification extension applies exactly to effective153+228 and retains every old feed/read branch', () => {
  const changes228 = [...prior.slice(prior.indexOf('DO $notification$'), prior.indexOf('END $notification$')).matchAll(/body:=pg_temp\.b3f_replace\(body,\$old\$([\s\S]*?)\$old\$,\$new\$([\s\S]*?)\$new\$\);/g)];
  const changes232 = [...sql.slice(sql.indexOf('DO $notifications$'), sql.indexOf('END $notifications$')).matchAll(/body:=pg_temp\.b3g_replace\(original,\$old\$([\s\S]*?)\$old\$,\$new\$([\s\S]*?)\$new\$\);/g)];
  assert.equal(changes228.length, 2); assert.equal(changes232.length, 2);
  ['platform.student_portal_notifications_v2', 'platform.mark_own_student_portal_notification_read_v2'].forEach((name, index) => {
    const original = body(migration('153_'), name);
    const [, a, b] = changes228[index];
    assert.equal(original.split(a).length - 1, 1);
    const effective = original.replace(a, b);
    const [, oldText, newText] = changes232[index];
    assert.equal(effective.split(oldText).length - 1, 1);
    assert.ok(newText.includes(oldText));
    assert.ok(effective.replace(oldText, newText).includes('own_application_package_notifications'));
  });
  const owner = body(sql, 'platform_private.own_application_package_notifications');
  for (const token of ['n.recipient_membership_id=a.membership_id', 'r.request_id=e.request_id', 'r.reviewer_membership_id=e.actor_membership_id', 'c.student_membership_id=a.membership_id']) assert.ok(owner.includes(token));
});

test('audit actions obey the actual041 restricted grammar and receipts survive unchanged ordinary228 evidence', () => {
  const table = migration('041_');
  const expression = table.match(/action TEXT NOT NULL CHECK \(action ~ '([^']+)'\)/)?.[1];
  assert.ok(expression);
  const grammar = new RegExp(expression);
  const actions = [...sql.matchAll(/'((?:application\.package)\.[a-z_]+)'/g)].map(x => x[1]);
  assert.ok(actions.length >= 2);
  for (const action of actions) assert.match(action, grammar);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION platform\.(?:submit_application_document|review_application_document)/);
});
