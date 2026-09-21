// Behavioral client-command tests with real codecs/persistence and synthetic action ports.
// No browser, Auth, RPC, database, Storage, or business acceptance is exercised.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as pending from "../src/lib/portal/application-packages-pending.ts";
import * as codec from "../src/lib/portal/application-packages.ts";
import * as documents from "../src/lib/portal/application-documents.ts";
import { getPortalStrings } from "../src/lib/portal/i18n.ts";
import { packageStrings } from "../src/components/portal/applicationPackages/strings.ts";
import * as wording from "../src/lib/v3/wording.ts";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/application-packages-v1.json", import.meta.url), "utf8"));
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const compiled = compile("../src/components/portal/applicationPackages/commands.ts");
const id = n => `c3a10000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const copy = value => JSON.parse(JSON.stringify(value));
function harness(t, { response, failWrite = false, failRemove = false, busy = false, noLocks = false } = {}) {
  const data = new Map(), calls = [], locks = [];
  const storage = { get length() { return data.size; }, key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null, setItem(key, value) { if (failWrite) throw Error("storage denied"); data.set(key, value); },
    removeItem(key) { if (failRemove) throw Error("storage denied"); data.delete(key); } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage, dispatchEvent() {} } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: noLocks ? undefined : { async request(key, options, callback) { locks.push({ key, options }); return callback(busy ? null : {}); } } } });
  t.after(() => { for (const [name, descriptor] of [["window", originalWindow], ["navigator", originalNavigator]]) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const names = ["submitStudentApplicationPackageAction", "submitStaffApplicationPackageAction", "reviewApplicationPackageAction", "recoverStudentApplicationPackageAction", "recoverStaffApplicationPackageAction"];
  const actions = Object.fromEntries(names.map(name => [name, async (...args) => {
    calls.push({ name, args });
    const intent = args.at(-1), operation = "packageId" in intent ? "review" : "submit", target = operation === "review" ? intent.packageId : intent.requirementsRevisionId;
    assert.equal(documents.applicationDocumentCanonical(pending.readApplicationPackagePending(args[0], operation, target).intent), documents.applicationDocumentCanonical(intent), "exact frozen intent is persisted before dispatch");
    if (response) return response(name, args);
    return name.startsWith("recover") ? { ok: true, recovery: fixture.recoveryCommitted } : { ok: true, receipt: operation === "review" ? fixture.reviewReceipt : fixture.submitReceipt };
  }]));
  const exports = {};
  runInNewContext(compiled, { exports, require(name) {
    if (name.endsWith("application-packages-pending")) return pending;
    if (name.endsWith("application-packages-actions")) return actions;
    if (name.endsWith("application-documents")) return documents;
    if (name.endsWith("application-packages")) return codec;
    throw Error(`Unexpected dependency: ${name}`);
  } });
  return { ...exports, data, storage, calls, locks };
}
const persisted = () => pending.listApplicationPackagePending(fixture.scope);

test("Student and staff submission persist before dispatch and clear only correlated receipt", async t => {
  const h = harness(t);
  for (const audience of ["student", "staff"]) {
    const result = await h.packageCommand(fixture.scope, audience, fixture.submitIntent);
    assert.equal(result.kind, "committed"); assert.equal(result.cleared, true); assert.equal(persisted().length, 0);
    assert.equal(h.calls.at(-1).name, audience === "student" ? "submitStudentApplicationPackageAction" : "submitStaffApplicationPackageAction");
  }
  assert.equal(h.locks[0].key, h.locks[1].key);
});
test("review is a separate explicit command with frozen evidence", async t => {
  const h = harness(t); const result = await h.packageCommand(fixture.scope, "staff", fixture.reviewIntent);
  assert.equal(result.kind, "committed"); assert.equal(h.calls[0].name, "reviewApplicationPackageAction"); assert.equal(persisted().length, 0);
});
test("unknown command blocks replacement across revisions and operation types", async t => {
  const h = harness(t, { response: () => ({ ok: false, reason: "unavailable", resolution: "retain" }) });
  assert.equal((await h.packageCommand(fixture.scope, "student", fixture.submitIntent)).kind, "error");
  const before = [...h.data.values()];
  for (const intent of [{ ...fixture.submitIntent, requirementsRevisionId: id(901), requestId: id(902) }, fixture.reviewIntent]) {
    assert.equal((await h.packageCommand(fixture.scope, "staff", intent)).kind, "pending");
  }
  assert.equal(h.calls.length, 1); assert.deepEqual([...h.data.values()], before);
});
test("retry reuses exact request and selection; another owner cannot clear it", async t => {
  let retry = false;
  const h = harness(t, { response: () => retry ? { ok: true, receipt: fixture.submitReceipt } : { ok: false, reason: "unavailable", resolution: "retain" } });
  await h.packageCommand(fixture.scope, "student", fixture.submitIntent);
  const foreign = { ...fixture.scope, membershipId: id(903) };
  assert.equal(pending.clearApplicationPackagePending(foreign, "submit", fixture.submitIntent.requirementsRevisionId, fixture.submitIntent, fixture.recoveryCommitted), false);
  assert.equal(persisted().length, 1); retry = true;
  const result = await h.packageCommand(fixture.scope, "student", copy(fixture.submitIntent));
  assert.equal(result.kind, "committed"); assert.equal(result.cleared, true);
  assert.equal(documents.applicationDocumentCanonical(h.calls[0].args), documents.applicationDocumentCanonical(h.calls[1].args));
});
test("wrong request or target proof cannot clear or report confirmation", async t => {
  let recovery = fixture.recoveryAbsent;
  const h = harness(t, { response: () => ({ ok: true, recovery }) });
  for (const field of ["requestId", "studentCaseId", "applicationId"]) {
    recovery = { ...fixture.recoveryAbsent, [field]: id(904) };
    const result = await h.packageCommand(fixture.scope, "student", fixture.submitIntent, true);
    assert.equal(result.kind, "error"); assert.equal(persisted().length, 1);
  }
  recovery = fixture.recoveryAbsent;
  const result = await h.packageCommand(fixture.scope, "student", fixture.submitIntent, true);
  assert.equal(result.kind, "not_written"); assert.equal(result.cleared, true); assert.equal(persisted().length, 0);
});
test("invalid committed receipt retains command and does not announce success", async t => {
  const h = harness(t, { response: () => ({ ok: true, receipt: { ...fixture.submitReceipt, requestId: id(905) } }) });
  assert.equal((await h.packageCommand(fixture.scope, "student", fixture.submitIntent)).kind, "error"); assert.equal(persisted().length, 1);
});
test("transport throw retains command and is not misreported as storage failure", async t => {
  const h = harness(t, { response: () => { throw Error("request interrupted"); } });
  assert.equal((await h.packageCommand(fixture.scope, "student", fixture.submitIntent)).kind, "error"); assert.equal(persisted().length, 1);
});
test("missing locks or denied persistence prevents dispatch", async t => {
  for (const options of [{ noLocks: true }, { failWrite: true }, { busy: true }]) {
    const h = harness(t, options); const result = await h.packageCommand(fixture.scope, "student", fixture.submitIntent);
    assert.equal(result.kind, options.busy ? "busy" : "storage_unavailable"); assert.equal(h.calls.length, 0);
  }
});
test("malformed pending is retained and blocks a new mutation", async t => {
  const h = harness(t); const key = pending.applicationPackagePendingKey(fixture.scope, "submit", fixture.submitIntent.requirementsRevisionId);
  h.data.set(key, "{broken");
  assert.equal((await h.packageCommand(fixture.scope, "student", fixture.submitIntent)).kind, "pending"); assert.equal(h.calls.length, 0); assert.equal(h.data.get(key), "{broken");
});
test("confirmed receipt remains confirmed if local cleanup fails", async t => {
  const h = harness(t, { failRemove: true }); const result = await h.packageCommand(fixture.scope, "student", fixture.submitIntent);
  assert.equal(result.kind, "committed"); assert.equal(result.cleared, false); assert.equal(persisted().length, 1);
});
test("RU and KY package notification targets remain distinct from individual documents", () => {
  const presentation = {};
  runInNewContext(compile("../src/components/portal/admission/presentation.ts"), { exports: presentation, require(name) { assert.equal(name, "@/lib/v3/wording"); return wording; } });
  const labels = [];
  for (const locale of ["ru", "ky"]) {
    const strings = getPortalStrings("admission", locale);
    const target = presentation.portalNotificationTarget({ notificationId: id(906), category: "document", eventCode: "application_package_review" }, strings);
    assert.equal(target.href, `/portal/package-notifications/${id(906)}`); assert.equal(target.label, strings.targetProgramPackage); labels.push(target.label);
    assert.equal(presentation.portalNotificationTarget({ notificationId: id(907), category: "document", eventCode: "application_document_review" }, strings).href, `/portal/document-notifications/${id(907)}`);
    assert.equal(Object.values(packageStrings(locale)).every(value => typeof value === "string" && value.trim()), true);
  }
  assert.notEqual(labels[0], labels[1]);
});
