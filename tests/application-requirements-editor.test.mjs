import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as codec from "../src/lib/portal/application-requirements-editor.ts";
import { parseApplicationRequirementsTarget } from "../src/lib/portal/application-requirements.ts";
import { editorPendingKey, readEditorPending, sendEditorPending } from "../src/lib/portal/application-requirements-editor-pending.ts";

// Synthetic protocol/control-flow vectors only. No DB, Auth, browser, or UI acceptance.
const corpus = JSON.parse(readFileSync(new URL("./fixtures/application-requirements-v2.json", import.meta.url), "utf8"));
const starter = corpus.cases.find(c => c.name === "starter_missing_files").value;
const id = n => `b3e20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const target = { studentCaseId: starter.studentCaseId, applicationId: starter.applicationId };
const scope = { organizationId: id(90), membershipId: id(91), ...target };
const clone = value => structuredClone(value);
const parseContext = value => codec.parseApplicationRequirementsEditorContext(value, target.studentCaseId, target.applicationId);
function context() {
  const requirements = clone(starter);
  const candidates = requirements.items.map((i, index) => ({
    documentSlotId: i.documentSlotId, slotVersion: "3", intentKind: "custom", sourceRequirement: null,
    rawLabel: i.label, rawGroupLabel: i.groupLabel, label: i.label, groupLabel: i.groupLabel, instructions: null,
    slotStatus: "required", currentVersionId: null, currentVersionNo: null, filename: null, reviewDecision: null, reviewReason: null, reviewedAt: null,
    technicalAvailability: "unavailable", unavailableReasons: ["file_missing"],
    links: [{ linkId: id(40 + index), targetKind: "university_application", targetId: target.applicationId }],
  }));
  const sources = requirements.items.map(i => ({
    sourceKey: `prior:${i.requirementItemId}`, kind: "prior", documentSlotId: i.documentSlotId, materialState: "selectable", required: i.required,
    label: i.label, groupLabel: i.groupLabel, instructions: i.instructions, legacyException: false, mustRetain: false,
    reference: { revisionId: requirements.revisionId, revisionVersion: "1", requirementItemId: i.requirementItemId, requirementKey: i.requirementKey,
      origin: "evo_starter", compatibilityKey: i.compatibilityKey, typedStarterEligible: true },
  }));
  for (const c of candidates) sources.push({
    sourceKey: `link:${c.documentSlotId}`, kind: "link", documentSlotId: c.documentSlotId, materialState: "selectable", required: null,
    label: c.label, groupLabel: c.groupLabel, instructions: null, reference: { linkId: c.links[0].linkId }, legacyException: false, mustRetain: false,
  });
  const c = candidates[0];
  sources.push({ sourceKey: `application:${c.documentSlotId}`, kind: "application", documentSlotId: c.documentSlotId, materialState: "selectable", required: true,
    label: c.label, groupLabel: c.groupLabel, instructions: null, reference: { applicationVersion: "5" }, legacyException: true, mustRetain: true });
  const country = { ...clone(c), documentSlotId: id(30), intentKind: "baseline", sourceRequirement: { requirementId: id(50), requirementKey: "country.transcript", checklistVersion: "7" }, rawLabel: null, rawGroupLabel: null, instructions: "Legacy country instruction", links: [] };
  candidates.push(country);
  sources.push({ sourceKey: `country:${id(50)}`, kind: "country", documentSlotId: country.documentSlotId, materialState: "selectable", required: null,
    label: country.label, groupLabel: country.groupLabel, instructions: country.instructions, legacyException: false, mustRetain: false,
    reference: { manifestId: id(60), manifestVersion: "7", manifestStatus: "retired", requirementId: id(50), requirementKey: "country.transcript", requirementStatus: "retired" } });
  return { protocolVersion: 1, ...target, applicationVersion: "5", admissionsVersion: "0",
    binding: { institutionId: id(70), publicationId: id(71), publicationVersion: 2, programId: "test-program", intakeId: id(72), institutionName: "Protocol institution", programTitle: "Protocol program", intakeLabel: "Protocol intake", selectedAt: "2026-09-21T10:20:30Z", deadlineStateAtSelection: "needs_confirmation" },
    requirements, legacyApplication: { documentsApplicability: "required", documentsSource: "Recorded source", documentsCheckedOn: "2026-09-21", documentSlotIds: [c.documentSlotId], documentExceptionSlotIds: [c.documentSlotId], documentsExceptionReason: "Recorded exception", documentsExceptionEvidence: "Recorded evidence" },
    sources: sources.sort((a, b) => a.sourceKey < b.sourceKey ? -1 : 1), candidates: candidates.sort((a, b) => a.documentSlotId < b.documentSlotId ? -1 : 1), canSave: true, saveBlockReason: null, contextHash: "a".repeat(64),
  };
}
function intent() {
  const c = context();
  return { ...target, requestId: id(80), payload: { expectedContextHash: c.contextHash, expectedApplicationVersion: "5", expectedRevisionId: starter.revisionId, expectedRevisionVersion: "1", changeReason: "Explicit protocol confirmation",
    items: starter.items.map(i => ({ requirementKey: i.requirementKey, required: true, label: i.label, groupLabel: i.groupLabel, instructions: i.instructions, deadline: null,
      material: { kind: "existing", documentSlotId: i.documentSlotId, expectedSlotVersion: "3", expectedCurrentVersionId: null, expectedCurrentVersionNo: null },
      provenance: { kind: "typed_starter", sourceKey: `prior:${i.requirementItemId}`, basis: "Explicit retained typed material" } })),
    sourceDecisions: c.sources.map(s => ({ sourceKey: s.sourceKey, disposition: s.kind === "country" ? "excluded" : "included", requirementKey: s.kind === "country" ? null : starter.items.find(i => i.documentSlotId === s.documentSlotId).requirementKey, reason: s.kind === "country" ? "Country source reviewed separately" : null })),
  } };
}
function receipt(i = intent()) {
  return { protocolVersion: 1, requestId: i.requestId, studentCaseId: i.studentCaseId, applicationId: i.applicationId, revisionId: id(81), revisionVersion: String(BigInt(i.payload.expectedRevisionVersion ?? "0") + 1n), previousRevisionId: i.payload.expectedRevisionId,
    savedAt: "2026-09-21T11:00:00Z", items: i.payload.items.map((item, index) => ({ requirementItemId: id(100 + index), requirementKey: item.requirementKey, documentSlotId: item.material.kind === "existing" ? item.material.documentSlotId : id(200 + index), position: index + 1 })) };
}
test("226 context accepts complete distinct origins, retired-bound sources, exceptions and empty candidates", () => {
  const c = context(); assert.deepEqual(parseContext(c), c);
  assert.equal(parseContext(c).sources.filter(s => s.documentSlotId === starter.items[0].documentSlotId).length, 3);
});
test("226 legacy display preserves long text; payload still enforces v2 item bounds", () => {
  const c = context(), s = c.sources.find(s => s.kind === "country"), candidate = c.candidates.find(c => c.documentSlotId === s.documentSlotId);
  s.label = candidate.label = "界".repeat(800); assert.ok(parseContext(c));
  s.reference.requirementKey = candidate.sourceRequirement.requirementKey = `country.${"x".repeat(150)}`; assert.ok(parseContext(c));
  const i = intent(); i.payload.items[0].label = s.label; assert.equal(codec.parseApplicationRequirementsEditorIntent(i), null);
  i.payload.items[0].label = "😀".repeat(500); assert.ok(codec.parseApplicationRequirementsEditorIntent(i));
  i.payload.items[0].label += "😀"; assert.equal(codec.parseApplicationRequirementsEditorIntent(i), null);
});
const contextMutations = {
  "extra private field": c => { c.storageKey = "not-permitted"; },
  "mixed nested case": c => { c.requirements.studentCaseId = id(999); },
  "unsafe publication number": c => { c.binding.publicationVersion = Number.MAX_SAFE_INTEGER; },
  "boolean version": c => { c.applicationVersion = true; },
  "BIGINT overflow": c => { c.admissionsVersion = "9223372036854775808"; },
  "duplicate candidate": c => { c.candidates.push(c.candidates[0]); },
  "unsorted candidates": c => { c.candidates.reverse(); },
  "duplicate source": c => { c.sources.push(c.sources[0]); },
  "missing prior": c => { c.sources = c.sources.filter(s => s.sourceKey !== `prior:${starter.items[0].requirementItemId}`); },
  "prior definition mismatch": c => { c.sources.find(s => s.kind === "prior").required = false; },
  "wrong application version": c => { c.sources.find(s => s.kind === "application").reference.applicationVersion = "4"; },
  "missing mandatory flag": c => { c.sources.find(s => s.kind === "application").mustRetain = false; },
  "exception outside selection": c => { c.legacyApplication.documentExceptionSlotIds = [id(999)]; },
  "source omitted despite present link": c => { c.sources = c.sources.filter(s => s.sourceKey !== `link:${starter.items[0].documentSlotId}`); },
  "wrong link target": c => { c.candidates[0].links[0].targetId = id(999); },
  "wrong bound country source": c => { c.sources.find(s => s.kind === "country").reference.requirementId = id(999); },
  "removed candidate still selectable": c => { c.sources.find(s => s.kind === "country").materialState = "removed"; },
  "missing current file pair": c => { c.candidates[0].currentVersionId = id(33); },
  "mixed candidate and v2 snapshots": c => { c.candidates[0].slotStatus = "approved"; },
  "unsafe filename scalar": c => { c.candidates[0].filename = "\ud800"; },
  "review without file": c => { Object.assign(c.candidates[0], { reviewDecision: "approved", reviewedAt: "2026-09-21T11:00:00Z" }); },
  "available without file": c => { Object.assign(c.candidates[0], { technicalAvailability: "available", unavailableReasons: [] }); },
  "structural candidate reason": c => { c.candidates[0].unavailableReasons = ["slot_removed"]; },
  "permission contradiction": c => { c.saveBlockReason = "permission_required"; },
};
for (const [name, mutate] of Object.entries(contextMutations)) test(`226 rejects ${name}`, () => { const c = context(); mutate(c); assert.equal(parseContext(c), null); });
test("226 unavailable actual-file candidate keeps version-scoped review separate", () => {
  const c = context(), candidate = c.candidates[0];
  Object.assign(candidate, { currentVersionId: id(33), currentVersionNo: "2", filename: "protocol.pdf", slotStatus: "approved", reviewDecision: "approved", reviewedAt: "2026-09-21T11:00:00Z", unavailableReasons: ["integrity_failed", "malware_pending"] });
  Object.assign(c.requirements.items[0], { currentVersionId: candidate.currentVersionId, currentVersionNo: candidate.currentVersionNo, slotStatus: candidate.slotStatus, reviewDecision: candidate.reviewDecision, reviewedAt: candidate.reviewedAt, unavailableReasons: clone(candidate.unavailableReasons) });
  assert.ok(parseContext(c)); candidate.unavailableReasons.push("malware_infected"); assert.equal(parseContext(c), null);
});
test("226 removed material stays in every source origin while v2 file/review remain masked", () => {
  const c = context(), slotId = starter.items[0].documentSlotId;
  c.candidates = c.candidates.filter(candidate => candidate.documentSlotId !== slotId);
  for (const source of c.sources) if (source.documentSlotId === slotId) source.materialState = "removed";
  Object.assign(c.requirements.items[0], { slotStatus: null, unavailableReasons: ["slot_removed"] });
  Object.assign(c.requirements, { state: "needs_configuration", configurationReasons: ["material_association_unavailable"] });
  assert.ok(parseContext(c)); assert.equal(parseContext(c).sources.filter(s => s.documentSlotId === slotId).length, 3);
  c.requirements.items[0].slotStatus = "required"; assert.equal(parseContext(c), null);
});
test("226 payload/intent/RPC/receipt correlate exact order and existing material", () => {
  const i = intent(); assert.deepEqual(codec.parseApplicationRequirementsEditorIntent(i), i);
  assert.deepEqual(codec.applicationRequirementsEditorRpcArgs(i), { p_student_case_id: i.studentCaseId, p_application_id: i.applicationId, p_request_id: i.requestId, p_payload: i.payload });
  assert.deepEqual(codec.parseApplicationRequirementsEditorReceipt(receipt(i), i), receipt(i));
  for (const mutate of [r => r.items.reverse(), r => { r.items[0].documentSlotId = id(999); }, r => { r.requestId = id(999); }, r => { r.revisionVersion = "3"; }, r => { r.currentVersionId = null; }]) {
    const r = receipt(i); mutate(r); assert.equal(codec.parseApplicationRequirementsEditorReceipt(r, i), null);
  }
});
const payloadMutations = {
  "empty full": p => { p.items = []; }, "duplicate key": p => { p.items[1].requirementKey = p.items[0].requirementKey; },
  "duplicate material": p => { p.items[1].material.documentSlotId = p.items[0].material.documentSlotId; },
  "unpaired revision": p => { p.expectedRevisionId = null; }, "noncanonical UUID": p => { p.items[0].material.documentSlotId = p.items[0].material.documentSlotId.toUpperCase(); },
  "unknown union field": p => { p.items[0].material.label = "extra"; }, "invalid deadline": p => { p.items[0].deadline = { date: "2026-02-29", time: null, timezone: null, sourceUrl: null, verifiedOn: "2026-09-21" }; },
  "missing timezone": p => { p.items[0].deadline = { date: "2028-02-29", time: "09:00", timezone: null, sourceUrl: null, verifiedOn: "2026-09-21" }; },
  "excluded without reason": p => { p.sourceDecisions.find(d => d.disposition === "excluded").reason = null; },
  "duplicate source decision": p => { p.sourceDecisions.push(p.sourceDecisions[0]); }, "dangling included target": p => { p.sourceDecisions[0].requirementKey = "r.missing"; },
  "wrong provenance kind": p => { p.items[0].provenance.kind = "country_manifest"; }, "unincluded provenance": p => { p.items[0].provenance.sourceKey = `prior:${id(999)}`; },
  "blank change basis": p => { p.changeReason = "\u00a0"; }, "lone surrogate": p => { p.items[0].instructions = "\ud800"; },
};
for (const [name, mutate] of Object.entries(payloadMutations)) test(`226 payload rejects ${name}`, () => { const p = intent().payload; mutate(p); assert.equal(codec.parseApplicationRequirementsEditorPayload(p), null); });
test("226 new material, optional-only revision and first adoption use explicit null prior", () => {
  const i = intent(); i.payload.expectedRevisionId = i.payload.expectedRevisionVersion = null; i.payload.sourceDecisions = [];
  i.payload.items = [{ ...i.payload.items[0], requirementKey: `r.${id(900)}`, required: false, material: { kind: "new", label: "Custom", groupLabel: "Documents" }, provenance: { kind: "staff_entry", sourceKey: null, basis: "Staff checked this explicit requirement" } }];
  assert.ok(codec.parseApplicationRequirementsEditorIntent(i)); assert.ok(codec.parseApplicationRequirementsEditorReceipt(receipt(i), i));
});
test("226 new slot labels obey existing108 control-character checks without trimming metadata", () => {
  const p = intent().payload;
  p.items = [{ ...p.items[0], material: { kind: "new", label: "  Custom  ", groupLabel: "  Documents  " }, provenance: { kind: "staff_entry", sourceKey: null, basis: "Explicit basis" } }];
  p.sourceDecisions = [];
  assert.equal(codec.parseApplicationRequirementsEditorPayload(p).items[0].material.label, "  Custom  ");
  for (const field of ["label", "groupLabel"]) for (const control of ["\n", "\t", "\u0000", "\u007f", "\u0085"]) {
    const invalid = clone(p); invalid.items[0].material[field] += control; assert.equal(codec.parseApplicationRequirementsEditorPayload(invalid), null);
  }
});
test("226 payload byte limit is UTF-8 and rejects oversized decisions", () => {
  const p = intent().payload;
  p.sourceDecisions = Array.from({ length: 2000 }, (_, index) => ({ sourceKey: `country:${id(1000 + index)}`, disposition: "excluded", requirementKey: null, reason: "界".repeat(2000) }));
  p.items = [{ ...p.items[0], provenance: { kind: "staff_entry", sourceKey: null, basis: "Explicit basis" } }];
  assert.equal(codec.parseApplicationRequirementsEditorPayload(p), null);
});
test("226 exact1MiB boundary includes PostgreSQL JSONB separator spaces", () => {
  const p = intent().payload;
  p.items = [{ ...p.items[0], material: { kind: "new", label: "Q", groupLabel: "G" }, provenance: { kind: "staff_entry", sourceKey: null, basis: "B" } }];
  p.sourceDecisions = Array.from({ length: 500 }, (_, index) => ({ sourceKey: `country:${id(1000 + index)}`, disposition: "excluded", requirementKey: null, reason: "x".repeat(1800) }));
  // Independent count for this fixed shape: top 7 keys (13 spaces), one item
  // 8 keys (15), material/provenance 3 keys each (5+5), decisions499 separators
  // plus500 objects with4 keys each (7 spaces). No escaped-string punctuation counted.
  const separatorSpaces = 13 + 15 + 5 + 5 + 499 + 500 * 7;
  const remaining = 1024 * 1024 - Buffer.byteLength(JSON.stringify(p)) - separatorSpaces;
  const each = Math.floor(remaining / 500), extra = remaining % 500;
  for (let index = 0; index < 500; index++) p.sourceDecisions[index].reason += "x".repeat(each + (index < extra ? 1 : 0));
  assert.ok(p.sourceDecisions.every(d => d.reason.length <= 2000));
  assert.equal(Buffer.byteLength(JSON.stringify(p)) + separatorSpaces, 1024 * 1024);
  assert.ok(codec.parseApplicationRequirementsEditorPayload(p));
  p.sourceDecisions[0].reason = `界${p.sourceDecisions[0].reason.slice(3)}`;
  assert.ok(codec.parseApplicationRequirementsEditorPayload(p), "same UTF-8 bytes, fewer Unicode scalars");
  p.sourceDecisions[0].reason += "x";
  assert.ok(Buffer.byteLength(JSON.stringify(p)) < 1024 * 1024, "compact JSON would wrongly accept this intent");
  assert.equal(codec.parseApplicationRequirementsEditorPayload(p), null);
});
test("226 rejects PostgreSQL-unrepresentable NUL before retaining any intent", async () => {
  const mutations = [
    p => { p.changeReason += "\u0000"; }, p => { p.items[0].label += "\u0000"; }, p => { p.items[0].groupLabel += "\u0000"; },
    p => { p.items[0].instructions += "\u0000"; }, p => { p.items[0].provenance.basis += "\u0000"; },
    p => { p.sourceDecisions.find(d => d.disposition === "excluded").reason += "\u0000"; },
  ];
  for (const mutate of mutations) {
    const i = intent(), p = ports(); mutate(i.payload); let calls = 0;
    assert.equal(codec.parseApplicationRequirementsEditorIntent(i), null);
    assert.equal((await sendEditorPending(scope, i, async () => { calls++; }, p.env)).reason, "invalid");
    assert.equal(calls, 0); assert.equal(p.data.size, 0);
  }
});
test("226 failure classifier requires exact message and SQLSTATE", () => {
  assert.equal(codec.applicationRequirementsEditorFailure({ code: "PT409", message: "application_requirements_stale_context" }), "stale_context");
  for (const e of [{ code: "42501", message: "application_requirements_stale_context" }, { code: "PT409", message: "application_requirements_stale_context private details" }, { code: "55000", message: "application_requirements_invariant_conflict" }, { message: "toString" }]) assert.equal(codec.applicationRequirementsEditorFailure(e), "unavailable");
});

function ports() {
  const data = new Map(), held = new Set(); let notifications = 0;
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const locks = { async request(key, options, callback) { assert.equal(options.ifAvailable, true); assert.equal(options.mode, "exclusive"); if (held.has(key)) return callback(null); held.add(key); try { return await callback({ name: key }); } finally { held.delete(key); } } };
  return { data, env: { storage, locks, notify: () => notifications++ }, get notifications() { return notifications; } };
}
test("226 pending persists before RPC, retries exact unknown intent after reload, and compare-clears receipt", async () => {
  const p = ports(), i = intent(); let sent;
  const first = await sendEditorPending(scope, i, async value => { sent = clone(value); assert.deepEqual(readEditorPending(scope, p.env.storage).intent, value); throw new Error("lost response"); }, p.env);
  assert.equal(first.reason, "unavailable"); assert.deepEqual(readEditorPending(scope, p.env.storage).intent, i);
  i.payload.items[0].label = "Later unsent edit";
  const done = await sendEditorPending(scope, null, async value => { assert.deepEqual(value, sent); return { ok: true, receipt: receipt(value) }; }, p.env);
  assert.equal(done.ok, true); assert.deepEqual(readEditorPending(scope, p.env.storage), { intent: null, blocked: false }); assert.ok(p.notifications >= 2);
});
test("226 unknown pending survives revoked actor, conflict, invalid/malformed replies and forged resolution", async () => {
  const p = ports();
  await sendEditorPending(scope, intent(), async () => ({ ok: false, reason: "unavailable", resolution: "retain" }), p.env);
  for (const response of ["bad", { ok: true, receipt: {} }, { ok: false, reason: "forbidden", resolution: "not_written" }, { ok: false, reason: "request_conflict", resolution: "not_written" }, { ok: false, reason: "invalid", resolution: "retain" }]) {
    await sendEditorPending(scope, null, async () => response, p.env); assert.ok(readEditorPending(scope, p.env.storage).intent);
  }
  const result = await sendEditorPending(scope, null, async () => ({ ok: false, reason: "stale_context", resolution: "not_written" }), p.env);
  assert.equal(result.resolution, "not_written"); assert.equal(readEditorPending(scope, p.env.storage).intent, null);
});
test("226 shared lock serializes tabs and retained unknown blocks a different proposal", async () => {
  const p = ports(); let release, calls = 0;
  const hold = new Promise(resolve => { release = resolve; });
  const first = sendEditorPending(scope, intent(), async () => { calls++; await hold; return { ok: false, reason: "unavailable", resolution: "retain" }; }, p.env);
  const second = await sendEditorPending(scope, intent(), async () => { calls++; }, p.env);
  assert.equal(second.reason, "busy"); release(); await first;
  const changed = intent(); changed.payload.items.reverse();
  const conflict = await sendEditorPending(scope, changed, async () => { calls++; }, p.env);
  assert.equal(conflict.reason, "pending_conflict"); assert.equal(calls, 1);
});
test("226 namespace isolates accounts and corrupt/wrong-owner envelopes fail closed", async () => {
  const p = ports(); await sendEditorPending(scope, intent(), async () => ({ ok: false, reason: "unavailable", resolution: "retain" }), p.env);
  const other = { ...scope, membershipId: id(999) }; assert.equal(readEditorPending(other, p.env.storage).intent, null);
  p.data.set(editorPendingKey(other), p.data.get(editorPendingKey(scope))); assert.equal(readEditorPending(other, p.env.storage).blocked, true);
  let calls = 0; assert.equal((await sendEditorPending(other, null, async () => { calls++; }, p.env)).reason, "storage_unavailable"); assert.equal(calls, 0);
});
test("226 unavailable persistence/locks never send; known receipt survives clear failure", async () => {
  for (const env of [{ storage: ports().env.storage, locks: {} }, { ...ports().env, storage: { getItem() { throw new Error("disabled"); } } }, { ...ports().env, storage: { getItem: () => null, setItem: () => {} } }]) {
    let calls = 0; const result = await sendEditorPending(scope, intent(), async () => { calls++; }, env); assert.equal(result.ok, false); assert.equal(calls, 0);
  }
  const p = ports(); p.env.storage.removeItem = () => { throw new Error("clear failed"); };
  const result = await sendEditorPending(scope, intent(), async value => ({ ok: true, receipt: receipt(value) }), p.env);
  assert.equal(result.ok, true); assert.ok(readEditorPending(scope, p.env.storage).intent);
});
test("226 receipt cannot clear a newer stored intent", async () => {
  const p = ports(); const result = await sendEditorPending(scope, intent(), async value => {
    const stored = JSON.parse(p.data.get(editorPendingKey(scope))); stored.intent.requestId = id(999); p.data.set(editorPendingKey(scope), JSON.stringify(stored));
    return { ok: true, receipt: receipt(value) };
  }, p.env);
  assert.equal(result.ok, true); assert.equal(readEditorPending(scope, p.env.storage).intent.requestId, id(999));
});
test("226 captures proposal and owner before delayed lock acquisition", async () => {
  const p = ports(), original = intent(), mutable = clone(original), owner = { ...scope }; let acquire;
  const waiting = new Promise(resolve => { acquire = resolve; });
  p.env.locks.request = async (_key, _options, callback) => { await waiting; return callback({}); };
  const pending = sendEditorPending(owner, mutable, async value => { assert.deepEqual(value, original); return { ok: false, reason: "unavailable", resolution: "retain" }; }, p.env);
  mutable.payload.items[0].label = "Changed before callback"; owner.membershipId = id(999); acquire(); await pending;
  assert.deepEqual(readEditorPending(scope, p.env.storage).intent, original);
});

// Execute the actual server-action control flow with explicitly synthetic ports.
// This verifies receipt handling/owner guards, not an Auth or Postgres integration.
const actionSource = readFileSync(new URL("../src/lib/v3/staff-requirements-editor-actions.ts", import.meta.url), "utf8");
function actions({ actor = { organizationId: scope.organizationId, membershipId: scope.membershipId }, response, refresh = () => {}, permission = true } = {}) {
  let calls = 0; const exported = {};
  const output = ts.transpileModule(actionSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  runInNewContext(output, { exports: exported, require(name) {
    if (name === "next/cache") return { revalidatePath: refresh };
    if (name.endsWith("platform-access")) return { isStaffPreview: () => false, staffHasPermission: () => permission };
    if (name.endsWith("platform-guards")) return { requirePlatformStaffActor: async () => actor };
    if (name.endsWith("supabase/server")) return { createSupabaseServerClient: async () => ({ schema: schema => { assert.equal(schema, "platform"); return { rpc: async () => { calls++; return response; } }; } }) };
    if (name.endsWith("application-requirements.ts")) return { parseApplicationRequirementsTarget };
    if (name.endsWith("application-requirements-editor.ts")) return codec;
    throw new Error(`Unexpected test import ${name}`);
  } });
  return { api: exported, get calls() { return calls; } };
}
test("226 both actions reject switched owner before ordinary RPC", async () => {
  const a = actions({ actor: { organizationId: scope.organizationId, membershipId: id(999) } });
  assert.equal((await a.api.readStaffRequirementsEditorAction(scope, target)).status, "forbidden");
  assert.equal((await a.api.saveStaffRequirementsEditorAction(scope, intent())).reason, "forbidden"); assert.equal(a.calls, 0);
});
test("226 action keeps a valid save receipt if every revalidation throws", async () => {
  let refreshes = 0; const a = actions({ response: { data: receipt(), error: null }, refresh() { refreshes++; throw new Error("refresh unavailable"); } });
  const result = await a.api.saveStaffRequirementsEditorAction(scope, intent()); assert.equal(result.ok, true); assert.deepEqual(result.receipt, receipt()); assert.equal(refreshes, 3);
});
test("226 action distinguishes after-replay no-write failure from unknown/malformed receipt", async () => {
  for (const [error, resolution] of [[{ code: "PT409", message: "application_requirements_stale_context" }, "not_written"], [{ code: "42501", message: "application_requirements_unavailable" }, "retain"], [{ code: "22023", message: "application_requirements_request_conflict" }, "retain"]]) {
    const a = actions({ response: { error, data: null } }); assert.equal((await a.api.saveStaffRequirementsEditorAction(scope, intent())).resolution, resolution);
  }
  const a = actions({ response: { data: {}, error: null } }); assert.equal((await a.api.saveStaffRequirementsEditorAction(scope, intent())).resolution, "retain");
});
