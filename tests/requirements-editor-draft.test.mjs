import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { initialRequirementsDraft, draftProblems, buildRequirementsPayload, rebaseRequirementsDraft,
  newRequirementsDraftItem, sourceCanUseItem, requirementChanges, requirementsRebaseConflicts, requirementsDraftMatchesPayload } from '../src/components/v3/profile/requirements-editor-draft.ts';

// Pure form/protocol cases. Not QA records, backend execution or UI acceptance.
const corpus = JSON.parse(readFileSync(new URL('./fixtures/application-requirements-v2.json', import.meta.url), 'utf8'));
function context() {
  const requirements = structuredClone(corpus.cases.find(vector => vector.name === 'starter_missing_files').value);
  return {
    protocolVersion: 1, studentCaseId: requirements.studentCaseId, applicationId: requirements.applicationId,
    applicationVersion: '1', admissionsVersion: '0', contextHash: 'a'.repeat(64), canSave: true, saveBlockReason: null,
    binding: { institutionId: 'b3e10000-0000-4000-8000-000000000050', publicationId: 'b3e10000-0000-4000-8000-000000000051', publicationVersion: 1,
      programId: 'test-program', intakeId: 'b3e10000-0000-4000-8000-000000000052', institutionName: 'Protocol institution', programTitle: 'Protocol program', intakeLabel: 'Protocol intake', selectedAt: requirements.initializedAt, deadlineStateAtSelection: 'needs_confirmation' },
    requirements,
    legacyApplication: { documentsApplicability: null, documentsSource: null, documentsCheckedOn: null, documentSlotIds: [], documentExceptionSlotIds: [], documentsExceptionReason: null, documentsExceptionEvidence: null },
    candidates: requirements.items.map(item => ({ documentSlotId: item.documentSlotId, slotVersion: '1', intentKind: 'custom', sourceRequirement: null,
      rawLabel: item.label, rawGroupLabel: item.groupLabel, label: item.label, groupLabel: item.groupLabel, instructions: null,
      slotStatus: 'required', currentVersionId: null, currentVersionNo: null, filename: null, reviewDecision: null, reviewReason: null, reviewedAt: null,
      technicalAvailability: 'unavailable', unavailableReasons: ['file_missing'], links: [] })),
    sources: requirements.items.map(item => ({ sourceKey: `prior:${item.requirementItemId}`, kind: 'prior', documentSlotId: item.documentSlotId, materialState: 'selectable',
      required: item.required, label: item.label, groupLabel: item.groupLabel, instructions: item.instructions, legacyException: false, mustRetain: false,
      reference: { revisionId: requirements.revisionId, revisionVersion: requirements.revisionVersion, requirementItemId: item.requirementItemId,
        requirementKey: item.requirementKey, origin: requirements.origin, compatibilityKey: item.compatibilityKey, typedStarterEligible: true } })),
  };
}

test('initial form keeps immutable item keys and existing explicit material, but needs confirmation reason', () => {
  const base = context(), draft = initialRequirementsDraft(base);
  assert.deepEqual(draft.items.map(item => item.requirementKey), base.requirements.items.map(item => item.requirementKey));
  assert.equal(draft.items[0].material.documentSlotId, base.requirements.items[0].documentSlotId);
  assert.equal(buildRequirementsPayload(base, draft), null);
  draft.changeReason = 'Protocol-only explicit confirmation';
  assert.ok(buildRequirementsPayload(base, draft));
});

test('two prior requirements cannot silently merge through one included decision', () => {
  const base = context(), draft = initialRequirementsDraft(base);
  draft.changeReason = 'Protocol-only confirmation';
  const removed = draft.items.pop();
  const decision = draft.sourceDecisions.find(decision => decision.requirementKey === removed.requirementKey);
  decision.requirementKey = draft.items[0].requirementKey;
  assert.equal(sourceCanUseItem(base.sources[1], draft.items[0], base), false);
  assert.equal(buildRequirementsPayload(base, draft), null);
  decision.disposition = 'excluded'; decision.requirementKey = null; decision.reason = 'Protocol-only explicit removal reason';
  assert.ok(buildRequirementsPayload(base, draft));
});

test('legacy mustRetain cannot be excluded with a generic reason and source must match slot', () => {
  const base = context(), draft = initialRequirementsDraft(base);
  const source = { ...base.sources[0], sourceKey: `application:${base.candidates[0].documentSlotId}`, kind: 'application',
    reference: { applicationVersion: '1' }, mustRetain: true, legacyException: true };
  base.sources.push(source);
  draft.sourceDecisions.push({ sourceKey: source.sourceKey, disposition: 'excluded', requirementKey: null, reason: 'Does not waive legacy gate' });
  assert.ok(draftProblems(base, draft).some(problem => problem.target === `source-${source.sourceKey}`));
  assert.equal(sourceCanUseItem(source, draft.items[1], base), false);
  assert.equal(sourceCanUseItem(source, draft.items[0], base), true);
});

test('downgrading requiredness requires its own source reason', () => {
  const base = context(), draft = initialRequirementsDraft(base);
  draft.changeReason = 'Protocol-only overall change'; draft.items[0].required = false;
  assert.equal(buildRequirementsPayload(base, draft), null);
  draft.sourceDecisions[0].reason = 'Protocol-only item-specific reason';
  assert.ok(buildRequirementsPayload(base, draft));
});

test('rebase preserves user text and order but makes changed and new sources unresolved', () => {
  const base = context(), draft = initialRequirementsDraft(base), fresh = structuredClone(base);
  draft.items[0].instructions = 'User text must survive'; draft.items.reverse(); draft.changeReason = 'User reason';
  fresh.contextHash = 'b'.repeat(64); fresh.candidates[0].slotVersion = '2';
  fresh.sources[0].instructions = 'Concurrent instruction';
  fresh.sources.push({ ...fresh.sources[0], kind: 'link', sourceKey: `link:${fresh.candidates[0].documentSlotId}`, required: null,
    reference: { linkId: 'b3e10000-0000-4000-8000-000000000060' } });
  const rebased = rebaseRequirementsDraft(base, fresh, draft);
  assert.equal(rebased.items[1].instructions, 'User text must survive');
  assert.equal(rebased.items[1].material.expectedSlotVersion, '2');
  assert.equal(rebased.changeReason, 'User reason');
  assert.equal(rebased.sourceDecisions[0].disposition, null);
  assert.equal(rebased.sourceDecisions[2].disposition, null);
  assert.equal(draft.items[1].material.expectedSlotVersion, '1', 'never mutate the retained base/draft');
});

test('reordering changes positions while preserving keys and removal stays visible in review', () => {
  const base = context(), draft = initialRequirementsDraft(base);
  draft.items.reverse();
  assert.equal(requirementChanges(base, draft).filter(line => line.includes('порядок')).length, 2);
  const removed = draft.items.pop();
  assert.ok(requirementChanges(base, draft).includes(`Убрано: ${removed.label}`));
});

test('duplicate material and invalid deadline fail before submission', () => {
  const base = context(), draft = initialRequirementsDraft(base); draft.changeReason = 'Protocol-only confirmation';
  draft.items[1].material = structuredClone(draft.items[0].material);
  assert.equal(buildRequirementsPayload(base, draft), null);
  draft.items[1].material = initialRequirementsDraft(base).items[1].material;
  draft.items[0].deadline = { date: '2026-02-30', time: null, timezone: null, sourceUrl: null, verifiedOn: '2026-02-01' };
  assert.equal(buildRequirementsPayload(base, draft), null);
});


test('three-way rebase adopts untouched concurrent fields and new items', () => {
  const base = context(), fresh = structuredClone(base), draft = initialRequirementsDraft(base);
  draft.items[0].instructions = 'My changed instructions';
  fresh.requirements.items[0].label = 'Concurrent title';
  const extra = structuredClone(fresh.requirements.items[1]);
  extra.requirementKey = 'r.b3e10000-0000-4000-8000-000000000071';
  extra.requirementItemId = 'b3e10000-0000-4000-8000-000000000072';
  extra.documentSlotId = 'b3e10000-0000-4000-8000-000000000073'; extra.position = 3;
  fresh.requirements.items.push(extra);
  fresh.candidates.push({ ...fresh.candidates[1], documentSlotId: extra.documentSlotId });
  fresh.sources.push({ ...fresh.sources[1], sourceKey: `prior:${extra.requirementItemId}`, documentSlotId: extra.documentSlotId,
    reference: { ...fresh.sources[1].reference, requirementKey: extra.requirementKey, requirementItemId: extra.requirementItemId, typedStarterEligible: false } });
  const result = rebaseRequirementsDraft(base, fresh, draft);
  assert.equal(result.items[0].label, 'Concurrent title');
  assert.equal(result.items[0].instructions, 'My changed instructions');
  assert.equal(result.items.length, 3);
  assert.equal(result.sourceDecisions[2].disposition, null);
});

test('both actors changing a field requires explicit conflict choice', () => {
  const base = context(), fresh = structuredClone(base), draft = initialRequirementsDraft(base);
  draft.items[0].instructions = 'My instruction'; fresh.requirements.items[0].instructions = 'Their instruction';
  const conflicts = requirementsRebaseConflicts(base, fresh, draft);
  assert.equal(conflicts.length, 1);
  assert.throws(() => rebaseRequirementsDraft(base, fresh, draft), /Resolve/);
  assert.equal(rebaseRequirementsDraft(base, fresh, draft, { [conflicts[0].id]: 'local' }).items[0].instructions, 'My instruction');
  assert.equal(rebaseRequirementsDraft(base, fresh, draft, { [conflicts[0].id]: 'current' }).items[0].instructions, 'Their instruction');
});

test('retrying another tab payload cannot be treated as saving my unsent draft', () => {
  const base = context(), draft = initialRequirementsDraft(base); draft.changeReason = 'Protocol confirmation';
  const payload = buildRequirementsPayload(base, draft);
  assert.equal(requirementsDraftMatchesPayload(draft, payload), true);
  draft.items[0].instructions = 'Unsaved local edit';
  assert.equal(requirementsDraftMatchesPayload(draft, payload), false);
});


test('local added row keeps its selected anchor position through unrelated refresh', () => {
  const base = context(), fresh = structuredClone(base), draft = initialRequirementsDraft(base);
  const added = newRequirementsDraftItem('r.b3e10000-0000-4000-8000-000000000080');
  added.label = 'Inserted between existing rows'; draft.items.splice(1, 0, added);
  fresh.candidates[0].slotVersion = '2';
  const result = rebaseRequirementsDraft(base, fresh, draft);
  assert.deepEqual(result.items.map(item => item.requirementKey), draft.items.map(item => item.requirementKey));
});


test('explicit order choice survives a local insertion and concurrent reorder', () => {
  const base = context(), fresh = structuredClone(base), draft = initialRequirementsDraft(base);
  const added = newRequirementsDraftItem('r.b3e10000-0000-4000-8000-000000000081');
  draft.items.splice(1, 0, added); fresh.requirements.items.reverse();
  fresh.requirements.items.forEach((item, index) => { item.position = index + 1; });
  assert.ok(requirementsRebaseConflicts(base, fresh, draft).some(conflict => conflict.id === 'order'));
  assert.throws(() => rebaseRequirementsDraft(base, fresh, draft), /Resolve/);
  assert.deepEqual(rebaseRequirementsDraft(base, fresh, draft, { order: 'local' }).items.map(item => item.requirementKey), draft.items.map(item => item.requirementKey));
  const current = rebaseRequirementsDraft(base, fresh, draft, { order: 'current' });
  assert.deepEqual(current.items.filter(item => item.requirementKey !== added.requirementKey).map(item => item.requirementKey), fresh.requirements.items.map(item => item.requirementKey));
});
