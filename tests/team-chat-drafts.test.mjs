import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeTeamChatDraft, newTeamChatDraft, teamChatDraftInput, teamChatDraftPrefix } from '../src/lib/team-chat-drafts.ts';
const requestId = '10000000-0000-4000-8000-000000000001';
const first = '10000000-0000-4000-8000-000000000002';
const second = '10000000-0000-4000-8000-000000000003';
const scope = 'org:member';
const legacyKey = `${teamChatDraftPrefix(scope, 'general', 1)}${first}`;
const currentKey = `${teamChatDraftPrefix(scope, 'general', 2)}post`;
const base = { body: 'Сохранённый текст', mentions: [], requestId };

test('old unsubmitted replies retain their V1 root and request ID', () => {
  const recovered = decodeTeamChatDraft(JSON.stringify(base), legacyKey, scope, 'general');
  assert.equal(recovered.target.kind, 'post-v1');
  assert.equal(recovered.target.parentMessageId, first);
  assert.equal(recovered.requestId, requestId);
  assert.equal(JSON.parse(teamChatDraftInput(recovered)).operation, 'post');
  assert.equal(decodeTeamChatDraft(JSON.stringify(base), legacyKey, 'other:member', 'general'), null);
  assert.equal(decodeTeamChatDraft(JSON.stringify(base), legacyKey, scope, 'sales'), null);
});

test('frozen V1 payload is returned byte-for-byte without conversion', () => {
  const retryInput = `{ "operation": "post", "body": "Сохранённый текст", "parentMessageId": "${first}", "mentionedMembershipIds": [] }`;
  const recovered = decodeTeamChatDraft(JSON.stringify({ ...base, retryInput }), legacyKey, scope, 'general');
  assert.equal(teamChatDraftInput(recovered), retryInput);
  assert.equal(recovered.requestId, requestId);
});

test('a frozen composer cannot be coerced into delete, read, another target, or changed text', () => {
  for (const input of [
    { operation: 'delete', messageId: first, expectedVersion: '4' },
    { operation: 'read', messageId: first },
    { operation: 'post', body: base.body, parentMessageId: second, mentionedMembershipIds: [] },
    { operation: 'post', body: 'Другой текст', parentMessageId: first, mentionedMembershipIds: [] },
  ]) assert.equal(decodeTeamChatDraft(JSON.stringify({ ...base, retryInput: JSON.stringify(input) }), legacyKey, scope, 'general'), null);
});

test('V2 direct quote survives recovery, but a changed frozen target is rejected', () => {
  const draft = { ...newTeamChatDraft(requestId), ...base, target: { kind: 'post-v2', quoteMessageId: second } };
  const retryInput = teamChatDraftInput(draft);
  assert.equal(JSON.parse(retryInput).quoteMessageId, second);
  assert.equal(decodeTeamChatDraft(JSON.stringify({ ...draft, retryInput }), currentKey, scope, 'general').target.quoteMessageId, second);
  assert.equal(decodeTeamChatDraft(JSON.stringify({ ...draft, target: { kind: 'post-v2', quoteMessageId: first }, retryInput }), currentKey, scope, 'general'), null);
});

test('legacy edit needs an explicit current-version resume, while its frozen version is immutable', () => {
  const editKey = `${teamChatDraftPrefix(scope, 'general', 1)}edit:${first}`;
  const recovered = decodeTeamChatDraft(JSON.stringify(base), editKey, scope, 'general');
  assert.equal(recovered.target.expectedVersion, null);
  assert.equal(teamChatDraftInput(recovered), null);
  const retryInput = JSON.stringify({ operation: 'edit', messageId: first, expectedVersion: '9007199254740993', body: base.body, mentionedMembershipIds: [] });
  const frozen = decodeTeamChatDraft(JSON.stringify({ ...base, retryInput }), editKey, scope, 'general');
  assert.equal(frozen.target.expectedVersion, '9007199254740993');
  assert.equal(teamChatDraftInput(frozen), retryInput);
  const resumed = { ...recovered, target: { ...recovered.target, expectedVersion: '9007199254740994' } };
  assert.equal(decodeTeamChatDraft(JSON.stringify(resumed), editKey, scope, 'general').target.expectedVersion, '9007199254740994');
});

test('drafts retain overlong text for repair but do not submit it', () => {
  const draft = { ...newTeamChatDraft(requestId), body: '😀'.repeat(8001) };
  const recovered = decodeTeamChatDraft(JSON.stringify(draft), currentKey, scope, 'general');
  assert.equal(recovered.body, draft.body);
  assert.equal(teamChatDraftInput(recovered), null);
  assert.ok(teamChatDraftInput({ ...recovered, body: '😀'.repeat(8000) }));
});
