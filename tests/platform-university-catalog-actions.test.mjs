import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
const { getURLFromRedirectError } = require("next/dist/client/components/redirect.js");
const root = new URL("../src/lib/", import.meta.url);
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const harness = { actor: { authorityRole: "admin", presentationRole: "admin", organizationId: "59948000-0000-4000-8000-000000000001" }, calls: [], revalidated: [], response: null, fail: false };
globalThis.__universityActionHarness = harness;
registerHooks({ resolve(specifier, context, next) {
  if (!context.parentURL?.endsWith("/platform-university-catalog-actions.ts")) return next(specifier, context);
  if (specifier === "./platform-guards") return { shortCircuit: true, url: moduleUrl("export async function requirePlatformStaffActor(){return globalThis.__universityActionHarness.actor;}") };
  if (specifier === "next/cache") return { shortCircuit: true, url: moduleUrl("export function revalidatePath(...args){globalThis.__universityActionHarness.revalidated.push(args);}") };
  // Match Next's server build alias; execute its real redirect control flow.
  if (specifier === "next/navigation") return next("next/dist/client/components/navigation.react-server.js", context);
  if (specifier === "./supabase/server") return { shortCircuit: true, url: moduleUrl("export async function createSupabaseServerClient(){return {schema(schema){return {async rpc(name,args){const h=globalThis.__universityActionHarness;h.calls.push({schema,name,args});if(h.fail)throw new Error('private provider error');return h.response;}}}};}") };
  if (["./platform-university-catalog", "./server/action-form-fields"].includes(specifier)) return { shortCircuit: true, url: new URL(`${specifier.slice(2)}.ts`, root).href };
  return next(specifier, context);
} });
const { mutateUniversityCatalogAction } = await import("../src/lib/platform-university-catalog-actions.ts");
const catalog = await import("../src/lib/platform-university-catalog.ts");
const requestId = "59948000-0000-4000-8000-000000000801", draftId = "59948000-0000-4000-8000-000000000802", institutionId = "59948000-0000-4000-8000-000000000803";
const previous = { status: "idle", requestId, draftId: null, institutionId: null };
const content = JSON.parse(readFileSync(new URL("../src/lib/server/university-catalog-reviewed-malaysia.json", import.meta.url), "utf8")).find((entry) => entry.key === "apu").content;
function reset() { harness.actor.authorityRole = "admin"; harness.actor.presentationRole = "admin"; harness.calls = []; harness.revalidated = []; harness.fail = false; harness.response = { data: { requestId, draftId, institutionId: null, status: "saved" }, error: null }; }
function form(overrides = {}) { const data = new FormData(); for (const [key, value] of Object.entries({ operation: "stage", request_id: requestId, institution_id: "", base_version: "0", content: JSON.stringify(content), reason: "Source reviewed", draft_id: "", confirmed: "", ...overrides })) data.set(key, value); return data; }
test("real action binds organization to actor and invokes only reviewed stage RPC", async () => {
  reset(); const outcome = await mutateUniversityCatalogAction(previous, form());
  assert.equal(outcome.status, "saved"); assert.equal(outcome.draftId, draftId);
  assert.equal(harness.calls.length, 1); assert.equal(harness.calls[0].schema, "platform"); assert.equal(harness.calls[0].name, "stage_university_catalog_publication");
  assert.equal(harness.calls[0].args.p_organization_id, harness.actor.organizationId); assert.deepEqual(harness.calls[0].args.p_content, content);
  assert.deepEqual(harness.revalidated, [["/v3/universities"], ["/v3/universities/manage"], ["/portal/universities"]]);
});
test("non-Admin and Admin role preview cannot mutate even when form is forged", async () => {
  for (const [authority, presentation] of [["sales", "admin"], ["admissions", "admissions"], ["finance", "finance"], ["admin", "sales"]]) {
    reset(); harness.actor.authorityRole = authority; harness.actor.presentationRole = presentation;
    assert.equal((await mutateUniversityCatalogAction(previous, form())).status, "forbidden"); assert.equal(harness.calls.length, 0);
  }
});
test("duplicate, extra authority, malformed JSON and unreviewed publication fail before RPC", async () => {
  for (const fields of [{ organization_id: institutionId }, { content: "{broken" }, { base_version: "1.5" }, { institution_id: "bad" }, { operation: "publish", draft_id: draftId }, { operation: "stage", content: JSON.stringify({ ...content, internal: "private" }) }]) {
    reset(); assert.equal((await mutateUniversityCatalogAction(previous, form(fields))).status, "invalid"); assert.equal(harness.calls.length, 0);
  }
  reset(); const data = form(); data.append("request_id", requestId); assert.equal((await mutateUniversityCatalogAction(previous, data)).status, "invalid"); assert.equal(harness.calls.length, 0);
});
const review = () => form({ operation: "publish", draft_id: draftId, institution_id: "", base_version: "", content: "", reason: "", confirmed: "yes" });
test("published receipt leaves the pending-only draft route for its exact published card", async () => {
  reset(); harness.response.data = { requestId, draftId, institutionId, status: "published" };
  await assert.rejects(mutateUniversityCatalogAction(previous, review()), (error) => {
    assert.equal(getURLFromRedirectError(error), `/v3/universities/${institutionId}`);
    return true;
  });
  assert.equal(harness.revalidated.some(([path]) => path === "/v3/universities/manage"), false);
  assert.equal(harness.calls[0].name, "review_university_catalog_publication"); assert.equal(harness.calls[0].args.p_draft_id, draftId); assert.equal(harness.calls[0].args.p_decision, "publish");
  for (const patch of [{ requestId: institutionId }, { draftId: institutionId }, { institutionId: null }, { status: "saved" }, { private: "leak" }]) {
    reset(); harness.response.data = { requestId, draftId, institutionId, status: "published", ...patch };
    assert.equal((await mutateUniversityCatalogAction(previous, review())).status, "unavailable"); assert.equal(harness.revalidated.length, 0);
  }
});
test("rejected receipt leaves the pending-only draft route and old links retain recovery", async () => {
  reset(); harness.response.data = { requestId, draftId, institutionId: null, status: "rejected" };
  const data = review(); data.set("operation", "reject");
  await assert.rejects(mutateUniversityCatalogAction(previous, data), (error) => {
    assert.equal(getURLFromRedirectError(error), "/v3/universities/manage");
    return true;
  });
  assert.equal(harness.revalidated.some(([path]) => path === "/v3/universities/manage"), false);
  const page = readFileSync(new URL("../src/app/(v3)/v3/universities/manage/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(!draft\) return <PartShell/u);
  assert.doesNotMatch(page, /drafts\[0\] \?\? notFound/u);
});

// Exercise the real form action closure with hook storage, without a browser or
// database. Next's navigation and the server action remain real implementations.
function reviewFormAction(serverAction = mutateUniversityCatalogAction) {
  const source = readFileSync(new URL("../src/components/v3/universities/UniversityEditor.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const componentModule = { exports: {} };
  runInNewContext(compiled, { module: componentModule, exports: componentModule.exports, require(specifier) {
    if (specifier === "react") return { useRef: (current) => ({ current }), useState: (value) => [value, () => {}], useActionState: (action, initial) => [initial, action, false] };
    if (specifier === "next/link") return () => null;
    if (specifier === "next/navigation") return require("next/dist/client/components/unstable-rethrow.browser.js");
    if (specifier === "@/lib/platform-university-catalog-actions") return { mutateUniversityCatalogAction: serverAction };
    if (specifier === "@/lib/platform-university-catalog") return catalog;
    return require(specifier);
  } });
  return componentModule.exports.UniversityReviewForm({ draftId, requestId }).props.action;
}

test("the review form propagates real Next navigation instead of reporting an uncertain save", async () => {
  for (const [decision, id, destination] of [["publish", institutionId, `/v3/universities/${institutionId}`], ["reject", null, "/v3/universities/manage"]]) {
    reset(); harness.response.data = { requestId, draftId, institutionId: id, status: decision === "publish" ? "published" : "rejected" };
    const data = review(); data.set("operation", decision);
    await assert.rejects(reviewFormAction()(previous, data), (error) => {
      assert.equal(getURLFromRedirectError(error), destination);
      return true;
    });
  }
});

test("exact reviewed-request replay follows the same validated destination", async () => {
  for (const [decision, id, destination] of [["publish", institutionId, `/v3/universities/${institutionId}`], ["reject", null, "/v3/universities/manage"]]) {
    reset(); harness.response.data = { requestId, draftId, institutionId: id, status: decision === "publish" ? "published" : "rejected" };
    const data = review(); data.set("operation", decision);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(mutateUniversityCatalogAction(previous, data), (error) => getURLFromRedirectError(error) === destination);
    }
    assert.equal(harness.calls.length, 2);
    assert.deepEqual(harness.calls[1], harness.calls[0]);
    assert.equal(harness.calls[1].args.p_request_id, requestId);
  }
});

test("ordinary client transport failure keeps the exact review intent for retry", async () => {
  reset(); let failTransport = true;
  const submit = reviewFormAction(async (state, data) => {
    if (failTransport) throw new Error("PRIVATE transport error");
    return mutateUniversityCatalogAction(state, data);
  });
  const uncertain = await submit(previous, review());
  assert.equal(uncertain.status, "unavailable");
  assert.equal(uncertain.requestId, requestId);
  assert.equal(JSON.stringify(uncertain).includes("PRIVATE"), false);
  assert.equal(harness.calls.length, 0);
  failTransport = false; harness.response.data = { requestId, draftId, institutionId, status: "published" };
  const changedIntent = review(); changedIntent.set("operation", "reject"); changedIntent.set("request_id", institutionId);
  await assert.rejects(submit(uncertain, changedIntent), (error) => getURLFromRedirectError(error) === `/v3/universities/${institutionId}`);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].args.p_request_id, requestId);
  assert.equal(harness.calls[0].args.p_decision, "publish");
  assert.equal(harness.calls[0].args.p_draft_id, draftId);
});

test("stale, denied, changed-replay and uncertain errors stay explicit without secret reflection", async () => {
  for (const operation of ["stage", "publish", "reject"]) {
    for (const [code, status] of [["40001", "stale"], ["23505", "request_conflict"], ["42501", "forbidden"], ["22023", "invalid"], ["XX000", "unavailable"]]) {
      reset(); harness.response = { data: null, error: { code, message: "PRIVATE provider text" } };
      const data = operation === "stage" ? form() : review(); data.set("operation", operation);
      const outcome = await mutateUniversityCatalogAction(previous, data); assert.equal(outcome.status, status); assert.equal(outcome.requestId, requestId); assert.equal(JSON.stringify(outcome).includes("PRIVATE"), false); assert.equal(harness.revalidated.length, 0);
    }
  }
  reset(); harness.fail = true; assert.equal((await mutateUniversityCatalogAction(previous, form())).status, "unavailable");
});
