import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

/*
 * Серверное действие редактора географии и стоимости (план 7.5): организация
 * из сессии, право и Admin-подтверждение до RPC, строгий вход, проверка
 * квитанции, сброс тега индекса студента только после подтверждённой записи.
 * Supabase, сессия и next/cache подменены; RPC 283 проверяет SQL-набор
 * supabase/tests/platform_catalog_geography_costs.sql.
 */
const root = new URL("../src/lib/", import.meta.url);
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const organizationId = "59948000-0000-4000-8000-000000000001";
const harness = { actor: null, calls: [], revalidated: [], tags: [], response: null, fail: false };
globalThis.__geographyActionHarness = harness;
registerHooks({ resolve(specifier, context, next) {
  if (!context.parentURL?.endsWith("/catalog-geography-actions.ts")) return next(specifier, context);
  if (specifier === "./platform-guards") return { shortCircuit: true, url: moduleUrl("export async function requirePlatformStaffActor(){return globalThis.__geographyActionHarness.actor;}") };
  if (specifier === "next/cache") return { shortCircuit: true, url: moduleUrl("export function revalidatePath(...args){globalThis.__geographyActionHarness.revalidated.push(args);} export function revalidateTag(...args){globalThis.__geographyActionHarness.tags.push(args);}") };
  if (specifier === "./supabase/server") return { shortCircuit: true, url: moduleUrl("export async function createSupabaseServerClient(){return {schema(schema){return {async rpc(name,args){const h=globalThis.__geographyActionHarness;h.calls.push({schema,name,args});if(h.fail)throw new Error('private provider error');return h.response;}}}};}") };
  if (specifier === "./server/action-form-fields") return { shortCircuit: true, url: new URL("server/action-form-fields.ts", root).href };
  return next(specifier, context);
} });
const { mutateCatalogGeographyAction } = await import("../src/lib/catalog-geography-actions.ts");

const requestId = "59948000-0000-4000-8000-000000000801";
const costId = "59948000-0000-4000-8000-000000000802";
const institutionId = "59948000-0000-4000-8000-000000000803";
const previous = { status: "idle", requestId: "", operation: null };
function reset(role = "admin") {
  harness.actor = { systemRole: role, permissionKeys: role === "admin" ? [] : ["catalog.read"], assignments: [], presentationRole: null, organizationId };
  harness.calls = []; harness.revalidated = []; harness.tags = []; harness.fail = false;
  harness.response = { data: { requestId, costId, version: 4, status: "published" }, error: null };
}
function form(operation, payload, extra = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ operation, request_id: requestId, payload: JSON.stringify(payload), ...extra })) data.set(key, value);
  return data;
}
const publish = { costId, status: "published", baseVersion: 3 };

test("publish binds the session organization, calls only the cost RPC and expires the student index tag", async () => {
  reset();
  const outcome = await mutateCatalogGeographyAction(previous, form("cost_publish", publish));
  assert.deepEqual(outcome, { status: "saved", requestId, operation: "cost_publish" });
  assert.equal(harness.calls.length, 1);
  assert.deepEqual(harness.calls[0], { schema: "platform", name: "staff_catalog_cost_publish_v1", args: { p_cost_id: costId, p_status: "published", p_base_version: 3, p_organization_id: organizationId, p_request_id: requestId } });
  assert.deepEqual(harness.tags, [["portal-student-university-index", { expire: 0 }]]);
  assert.deepEqual(harness.revalidated, [["/v3/universities", "layout"], ["/portal/universities", "layout"]]);
});

test("staff without catalog publication, Admin role preview and a forged confirmation stop before any RPC", async () => {
  for (const setup of [() => reset("staff"), () => { reset(); harness.actor.presentationRole = "sales"; }]) {
    setup();
    assert.equal((await mutateCatalogGeographyAction(previous, form("cost_publish", publish))).status, "forbidden");
    assert.equal(harness.calls.length, 0);
  }
  // A non-system role holding catalog.import.manage may edit, but never confirm agency rows.
  reset("staff"); harness.actor.permissionKeys = ["catalog.read", "catalog.import.manage"];
  assert.equal((await mutateCatalogGeographyAction(previous, form("cost_confirm", { costId, baseVersion: 3, reason: "Решение владельца" }))).status, "forbidden");
  assert.equal(harness.calls.length, 0);
  harness.response = { data: { requestId, costId, version: 4, status: "published" }, error: null };
  assert.equal((await mutateCatalogGeographyAction(previous, form("cost_publish", publish))).status, "saved");
  assert.equal(harness.calls[0].name, "staff_catalog_cost_publish_v1");
});

test("unknown operation, extra field, organization in payload or loose input are invalid without RPC", async () => {
  const cases = [
    form("cost_delete", publish),
    form("cost_publish", publish, { organization_id: organizationId }),
    form("cost_publish", { ...publish, organizationId }),
    form("cost_publish", { ...publish, status: "live" }),
    form("cost_publish", { ...publish, baseVersion: 0 }),
    form("institution_city_set", { institutionId, cityKey: "Hang Zhou" }),
    form("fx_rate_set", { currency: "USD", asOf: "2026-10-01", unitsPerUsd: 1, sourceName: "x", sourceUrl: null }),
    form("cost_publish", publish, { request_id: "not-a-uuid" }),
  ];
  for (const data of cases) {
    reset();
    assert.equal((await mutateCatalogGeographyAction(previous, data)).status, "invalid");
    assert.equal(harness.calls.length, 0);
  }
  reset(); const broken = form("cost_publish", publish); broken.set("payload", "{broken");
  assert.equal((await mutateCatalogGeographyAction(previous, broken)).status, "invalid");
});

test("database refusals map to words and never revalidate; a mismatched receipt is unconfirmed", async () => {
  for (const [code, status] of [["42501", "forbidden"], ["40001", "stale"], ["23505", "request_conflict"], ["23514", "rejected"], ["22023", "invalid"], ["XX000", "unavailable"]]) {
    reset(); harness.response = { data: null, error: { code, message: "private detail" } };
    assert.equal((await mutateCatalogGeographyAction(previous, form("cost_publish", publish))).status, status, code);
    assert.equal(harness.tags.length, 0);
  }
  for (const data of [{ requestId: costId, costId, version: 4, status: "published" }, { requestId, costId, version: 4, status: "retired" }, { requestId, costId, version: 4, status: "published", extra: 1 }]) {
    reset(); harness.response = { data, error: null };
    assert.equal((await mutateCatalogGeographyAction(previous, form("cost_publish", publish))).status, "unavailable");
    assert.equal(harness.tags.length, 0);
  }
  reset(); harness.fail = true;
  assert.equal((await mutateCatalogGeographyAction(previous, form("cost_publish", publish))).status, "unavailable");
});

test("city link and FX rate reach their RPCs with exact arguments", async () => {
  reset(); harness.response = { data: { requestId, institutionId, cityKey: null }, error: null };
  assert.equal((await mutateCatalogGeographyAction(previous, form("institution_city_set", { institutionId, cityKey: null }))).status, "saved");
  assert.deepEqual(harness.calls[0].args, { p_institution_id: institutionId, p_city_key: null, p_organization_id: organizationId, p_request_id: requestId });
  reset(); harness.response = { data: { requestId, currency: "AED", asOf: "2026-10-01", unitsPerUsd: 3.6725 }, error: null };
  const rate = { currency: "AED", asOf: "2026-10-01", unitsPerUsd: 3.6725, sourceName: "Central Bank of the UAE", sourceUrl: "https://www.centralbank.ae/en/" };
  assert.equal((await mutateCatalogGeographyAction(previous, form("fx_rate_set", rate))).status, "saved");
  assert.equal(harness.calls[0].name, "staff_catalog_fx_rate_set_v1");
  assert.equal(harness.calls[0].args.p_actor_membership_id, null);
  assert.equal(harness.calls[0].args.p_units_per_usd, 3.6725);
});
