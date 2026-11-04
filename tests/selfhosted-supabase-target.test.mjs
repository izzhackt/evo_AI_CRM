import assert from "node:assert/strict";
import test from "node:test";

import { readAccess } from "../scripts/catalog/import-catalog-costs.mjs";
import { readTarget } from "../scripts/catalog/upload-geography-photos.mjs";
import {
  jwtRefAcceptable,
  matchSupabaseTarget,
  SELFHOSTED_SUPABASE_ORIGIN,
} from "../scripts/lib/evo-supabase-target.mjs";
import { loadEnvironment as loadWahaBindingEnvironment } from "../scripts/maintenance/waha-runtime-binding.mjs";
import { loadEnvironment as loadWahaHistoryEnvironment } from "../scripts/import/waha-history-import.mjs";
import {
  loadPlatformObservabilityConfig,
  PlatformObservabilityConfigurationError,
} from "../src/lib/server/platform-observability-config.ts";
import { uploadSupabaseStorageObjectWithTus } from "../src/lib/server/platform-storage-resumable-upload.ts";

// docs/adr/0037-use-only-self-hosted-supabase.md: every place accepts exactly
// https://supabase.evoadmissions.com and nothing near it. A cloud project address (the former
// `https://<ref>.supabase.co`) is refused everywhere: there is no cloud fallback (#1271).

const CLOUD_REF = "abcdefghijklmnopqrst";
const CLOUD = `https://${CLOUD_REF}.supabase.co`;
const SELF = SELFHOSTED_SUPABASE_ORIGIN;
const NEIGHBOURS = [
  `${SELF}.attacker.invalid`, "http://supabase.evoadmissions.com", `${SELF}:8443`, "https://evoadmissions.com",
  "https://x.supabase.evoadmissions.com", `https://user@supabase.evoadmissions.com`, "https://SUPABASE.evoadmissions.com.",
  `${SELF}/rest/v1`, `${SELF}?x=1`, `${SELF}#x`, "https://supabase.evoadmissions.co", "https://supabase.evoadmissions.com@evil.test",
];
const KEY = "sb_secret_abcdefghijklmnopqrstuvwxyz0123456789";
const ORGANIZATION = "11111111-1111-4111-8111-111111111111";

test("the exact self-hosted origin is a fixed constant", () => {
  assert.equal(SELF, "https://supabase.evoadmissions.com");
});

test("matchSupabaseTarget accepts exactly the self-hosted origin and nothing else", () => {
  assert.deepEqual(matchSupabaseTarget(SELF), { kind: "selfhosted", origin: SELF });
  assert.deepEqual(matchSupabaseTarget(`${SELF}/`), { kind: "selfhosted", origin: SELF });
  for (const value of [undefined, null, 42, "", CLOUD, `${CLOUD}/`, "https://other.supabase.co", ...NEIGHBOURS]) {
    assert.equal(matchSupabaseTarget(value), null, String(value));
  }
});

test("the JWT ref claim must be absent: a key that carries any ref (for example a cloud key) is refused", () => {
  assert.equal(jwtRefAcceptable(undefined), true);
  assert.equal(jwtRefAcceptable(CLOUD_REF), false, "a cloud key is not sent to the self-hosted stack");
  assert.equal(jwtRefAcceptable("anything"), false);
});

test("WAHA runtime binding and WAHA history import accept the self-hosted origin exactly", () => {
  const environment = (url) => ({
    NEXT_PUBLIC_SUPABASE_URL: url,
    EVO_PLATFORM_SUPABASE_SECRET_KEY: KEY,
    EVO_PLATFORM_ORGANIZATION_ID: ORGANIZATION,
  });
  for (const load of [loadWahaBindingEnvironment, loadWahaHistoryEnvironment]) {
    assert.equal(load(environment(SELF)).supabaseOrigin, SELF);
    for (const url of [CLOUD, ...NEIGHBOURS, `${SELF}/`]) {
      assert.throws(() => load(environment(url)), (error) => error.code === "invalid_environment", url);
    }
  }
});

test("catalog scripts accept the self-hosted origin exactly and keep the local target; the cloud address is refused", () => {
  assert.deepEqual(readTarget({ NEXT_PUBLIC_SUPABASE_URL: SELF }), { origin: SELF, kind: "supabase-selfhosted" });
  assert.deepEqual(readTarget({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }), { origin: "http://127.0.0.1:54321", kind: "local-stack" });
  const service = { EVO_PLATFORM_SUPABASE_SECRET_KEY: KEY, EVO_CATALOG_ACTOR_MEMBERSHIP_ID: ORGANIZATION };
  const access = readAccess({ ...service, NEXT_PUBLIC_SUPABASE_URL: SELF }, "service");
  assert.equal(access.origin, SELF);
  assert.equal(access.target, "supabase-selfhosted");
  for (const url of [CLOUD, ...NEIGHBOURS]) {
    assert.throws(() => readTarget({ NEXT_PUBLIC_SUPABASE_URL: url }), (error) => /supabase_url/u.test(error.code), url);
    assert.throws(() => readAccess({ ...service, NEXT_PUBLIC_SUPABASE_URL: url }, "service"), (error) => /supabase_url/u.test(error.code), url);
  }
});

test("observability accepts the self-hosted origin in production and no neighbour of it", () => {
  const environment = (url) => ({
    NODE_ENV: "production",
    EVO_PLATFORM_P7B_OBSERVABILITY_ENABLED: "1",
    EVO_PLATFORM_P7B_OBSERVABILITY_SECRET: "x".repeat(32),
    NEXT_PUBLIC_SUPABASE_URL: url,
    EVO_PLATFORM_SUPABASE_SECRET_KEY: "sb_secret_p7b_local_1234567890",
  });
  assert.equal(loadPlatformObservabilityConfig(environment(SELF)).supabaseUrl, SELF);
  assert.equal(loadPlatformObservabilityConfig(environment(`${SELF}/`)).supabaseUrl, SELF);
  for (const url of [CLOUD, ...NEIGHBOURS]) {
    assert.throws(
      () => loadPlatformObservabilityConfig(environment(url)),
      (error) => error instanceof PlatformObservabilityConfigurationError && error.code === "unsafe_supabase_url",
      url,
    );
  }
});

test("resumable uploads go to /storage/v1/upload/resumable of the self-hosted origin", async () => {
  const now = Date.parse("2026-10-20T00:00:00.000Z");
  const target = { bucketId: "platform-private-documents", objectName: "ab/object", expiresAt: "2026-10-20T01:00:00.000Z" };
  async function run(supabaseUrl, base) {
    const calls = [];
    const fetch = async (input, init) => {
      calls.push(`${init.method} ${String(input)}`);
      if (init.method === "POST") return new Response(null, { status: 201, headers: { Location: `${base}/upload-1` } });
      if (init.method === "PATCH") return new Response(null, { status: 204, headers: { "Upload-Offset": "3" } });
      return new Response(null, { status: 500 });
    };
    const ok = await uploadSupabaseStorageObjectWithTus(new Uint8Array([1, 2, 3]), target, "application/pdf", {
      backendConfig: () => ({ supabaseUrl, supabaseSecretKey: KEY }), fetch, now: () => now,
    });
    return { ok, calls };
  }
  const selfBase = `${SELF}/storage/v1/upload/resumable`;
  assert.deepEqual(await run(SELF, selfBase), { ok: true, calls: [`POST ${selfBase}`, `PATCH ${selfBase}/upload-1`] });
  // an upload URL on another origin is still refused (the origin check of the helper is unchanged)
  const foreign = await run(SELF, "https://evil.example/storage/v1/upload/resumable");
  assert.equal(foreign.ok, false);
  assert.equal(foreign.calls.length, 1);
});
