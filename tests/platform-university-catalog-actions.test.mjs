import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
const root = new URL("../src/lib/", import.meta.url);
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const harness = { actor: { authorityRole: "admin", presentationRole: "admin", organizationId: "59948000-0000-4000-8000-000000000001" }, calls: [], revalidated: [], response: null, fail: false };
globalThis.__universityActionHarness = harness;
registerHooks({ resolve(specifier, context, next) {
  if (!context.parentURL?.endsWith("/platform-university-catalog-actions.ts")) return next(specifier, context);
  if (specifier === "./platform-guards") return { shortCircuit: true, url: moduleUrl("export async function requirePlatformStaffActor(){return globalThis.__universityActionHarness.actor;}") };
  if (specifier === "next/cache") return { shortCircuit: true, url: moduleUrl("export function revalidatePath(...args){globalThis.__universityActionHarness.revalidated.push(args);}") };
  if (specifier === "./supabase/server") return { shortCircuit: true, url: moduleUrl("export async function createSupabaseServerClient(){return {schema(schema){return {async rpc(name,args){const h=globalThis.__universityActionHarness;h.calls.push({schema,name,args});if(h.fail)throw new Error('private provider error');return h.response;}}}};}") };
  if (["./platform-university-catalog", "./server/action-form-fields"].includes(specifier)) return { shortCircuit: true, url: new URL(`${specifier.slice(2)}.ts`, root).href };
  return next(specifier, context);
} });
const { mutateUniversityCatalogAction } = await import("../src/lib/platform-university-catalog-actions.ts");
const requestId = "59948000-0000-4000-8000-000000000801", draftId = "59948000-0000-4000-8000-000000000802", institutionId = "59948000-0000-4000-8000-000000000803";
const previous = { status: "idle", requestId, draftId: null, institutionId: null };
const content = JSON.parse(readFileSync(new URL("../src/lib/server/university-catalog-reviewed-content.json", import.meta.url), "utf8"))[0].content;
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
test("explicit decision binds draft and validates complete receipt before revalidation", async () => {
  reset(); harness.response.data = { requestId, draftId, institutionId, status: "published" };
  assert.equal((await mutateUniversityCatalogAction(previous, review())).status, "published");
  assert.equal(harness.revalidated.some(([path]) => path === "/v3/universities/manage"), false);
  assert.equal(harness.calls[0].name, "review_university_catalog_publication"); assert.equal(harness.calls[0].args.p_draft_id, draftId); assert.equal(harness.calls[0].args.p_decision, "publish");
  for (const patch of [{ requestId: institutionId }, { draftId: institutionId }, { institutionId: null }, { status: "saved" }, { private: "leak" }]) {
    reset(); harness.response.data = { requestId, draftId, institutionId, status: "published", ...patch };
    assert.equal((await mutateUniversityCatalogAction(previous, review())).status, "unavailable"); assert.equal(harness.revalidated.length, 0);
  }
});
test("rejection preserves its receipt and reviewed draft links have a recovery screen", async () => {
  reset(); harness.response.data = { requestId, draftId, institutionId: null, status: "rejected" };
  const data = review(); data.set("operation", "reject");
  assert.equal((await mutateUniversityCatalogAction(previous, data)).status, "rejected");
  assert.equal(harness.revalidated.some(([path]) => path === "/v3/universities/manage"), false);
  const page = readFileSync(new URL("../src/app/(v3)/v3/universities/manage/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(!draft\) return <PartShell/u);
  assert.doesNotMatch(page, /drafts\[0\] \?\? notFound/u);
});

test("stale, denied, changed-replay and uncertain errors stay explicit without secret reflection", async () => {
  for (const [code, status] of [["40001", "stale"], ["23505", "request_conflict"], ["42501", "forbidden"], ["22023", "invalid"], ["XX000", "unavailable"]]) {
    reset(); harness.response = { data: null, error: { code, message: "PRIVATE provider text" } };
    const outcome = await mutateUniversityCatalogAction(previous, form()); assert.equal(outcome.status, status); assert.equal(outcome.requestId, requestId); assert.equal(JSON.stringify(outcome).includes("PRIVATE"), false); assert.equal(harness.revalidated.length, 0);
  }
  reset(); harness.fail = true; assert.equal((await mutateUniversityCatalogAction(previous, form())).status, "unavailable");
});
