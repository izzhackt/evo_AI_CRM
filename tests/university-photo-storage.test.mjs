import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyUniversityPhotoMigration,
  checkUniversityPhotoMigration,
  libraryEntryProblems,
  licenseAllowsRedistribution,
  planUniversityPhotoMigration,
  readUniversityPhotoLibrary,
  runUniversityPhotoMigrationCli,
  REDISTRIBUTABLE_LICENSES,
  UNIVERSITY_PHOTO_BUCKET,
  UNIVERSITY_PHOTO_MANIFEST_SCHEMA,
  UNIVERSITY_PHOTO_PROJECT,
  universityPhotoPublicUrl,
} from "../scripts/portal/migrate-university-photos.mjs";
import {
  resolveUniversityPhotoUrl,
  universityPhotoUrl,
  UNIVERSITY_PHOTO_PUBLIC_BASE_URL,
} from "../src/lib/university-photo-url.ts";

// PORT-9d (docs/PLAN_CHANGES.md): managed-хранение фото вузов. Манифест
// закоммичен после реального --check; migrated=true появляется только после
// --apply координатора, поэтому до него поведение сайта не меняется вовсе.

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const library = readUniversityPhotoLibrary();
const manifest = JSON.parse(
  readFileSync(new URL("../scripts/portal/university-photos-manifest.json", import.meta.url), "utf8"),
);

const FIXTURE_PHOTOS = Object.freeze({ alpha: { path: "https://example.org/photos/alpha.jpg" } });
const migratedEntry = { status: "verified", migrated: true, objectPath: "alpha.jpg" };

test("URL helper prefers managed storage only for verified migrated manifest entries", () => {
  const base = UNIVERSITY_PHOTO_PUBLIC_BASE_URL;
  assert.equal(
    resolveUniversityPhotoUrl("alpha", FIXTURE_PHOTOS, { alpha: migratedEntry }, base),
    `${base}/alpha.jpg`,
  );
  for (const entry of [
    { ...migratedEntry, migrated: false },
    { ...migratedEntry, status: "failed" },
    { ...migratedEntry, status: "ineligible" },
    { ...migratedEntry, objectPath: null },
    { ...migratedEntry, objectPath: "" },
  ]) {
    assert.equal(resolveUniversityPhotoUrl("alpha", FIXTURE_PHOTOS, { alpha: entry }, base), FIXTURE_PHOTOS.alpha.path);
  }
  // Ключ без записи манифеста и вовсе неизвестный ключ.
  assert.equal(resolveUniversityPhotoUrl("alpha", FIXTURE_PHOTOS, {}, base), FIXTURE_PHOTOS.alpha.path);
  assert.equal(resolveUniversityPhotoUrl("missing", FIXTURE_PHOTOS, { alpha: migratedEntry }, base), null);
  assert.equal(resolveUniversityPhotoUrl(null, FIXTURE_PHOTOS, { alpha: migratedEntry }, base), null);
  // Прототипные имена не читаются как записи.
  assert.equal(resolveUniversityPhotoUrl("toString", FIXTURE_PHOTOS, { alpha: migratedEntry }, base), null);
  // Сегменты objectPath кодируются по одному.
  assert.equal(
    resolveUniversityPhotoUrl("alpha", FIXTURE_PHOTOS, { alpha: { ...migratedEntry, objectPath: "a b/ц.jpg" } }, base),
    `${base}/a%20b/%D1%86.jpg`,
  );
});

test("committed manifest keeps the site on hotlinks until the coordinator flips migrated", () => {
  assert.equal(
    UNIVERSITY_PHOTO_PUBLIC_BASE_URL,
    `https://${UNIVERSITY_PHOTO_PROJECT}.supabase.co/storage/v1/object/public/${UNIVERSITY_PHOTO_BUCKET.id}`,
  );
  assert.equal(universityPhotoPublicUrl("x.jpg"), `${UNIVERSITY_PHOTO_PUBLIC_BASE_URL}/x.jpg`);
  for (const [key, record] of Object.entries(library)) {
    const resolved = universityPhotoUrl(key);
    const entry = manifest.entries[key];
    assert.equal(
      resolved,
      entry.migrated === true ? `${UNIVERSITY_PHOTO_PUBLIC_BASE_URL}/${entry.objectPath}` : record.path,
      key,
    );
  }
  assert.equal(universityPhotoUrl(null), null);
  assert.equal(universityPhotoUrl("no-such-university-key"), null);
});

test("committed manifest schema is complete, honest and attribution-preserving", () => {
  assert.equal(manifest.schema, UNIVERSITY_PHOTO_MANIFEST_SCHEMA);
  assert.equal(manifest.projectRef, UNIVERSITY_PHOTO_PROJECT);
  assert.equal(manifest.bucket, UNIVERSITY_PHOTO_BUCKET.id);
  assert.equal(manifest.source, "src/lib/university-photo-library.json");
  assert.ok(!Number.isNaN(Date.parse(manifest.generatedAt)));
  assert.deepEqual(Object.keys(manifest.entries).sort(), Object.keys(library).sort());
  const counted = { verified: 0, ineligible: 0, failed: 0, migrated: 0 };
  for (const [key, entry] of Object.entries(manifest.entries)) {
    const record = library[key];
    assert.deepEqual(
      Object.keys(entry).sort(),
      ["attribution", "bytes", "contentType", "finalUrl", "license", "licenseUrl", "migrated",
        "objectPath", "pageUrl", "reason", "sha256", "sourceUrl", "status"],
      key,
    );
    // Атрибуция CC переживает миграцию байт-в-байт: манифест дублирует библиотеку.
    assert.equal(entry.sourceUrl, record.path, key);
    assert.equal(entry.pageUrl, record.sourceUrl, key);
    assert.equal(entry.license, record.license, key);
    assert.equal(entry.licenseUrl, record.licenseUrl, key);
    assert.equal(entry.attribution, record.author, key);
    assert.ok(["verified", "ineligible", "failed"].includes(entry.status), key);
    counted[entry.status] += 1;
    if (entry.migrated === true) counted.migrated += 1;
    assert.equal(typeof entry.migrated, "boolean", key);
    if (entry.migrated) assert.equal(entry.status, "verified", key);
    if (entry.status === "verified") {
      assert.match(entry.sha256, /^[0-9a-f]{64}$/u, key);
      assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes >= 1024 && entry.bytes <= UNIVERSITY_PHOTO_BUCKET.file_size_limit, key);
      assert.ok(UNIVERSITY_PHOTO_BUCKET.allowed_mime_types.includes(entry.contentType), key);
      assert.match(entry.objectPath, /^[a-z0-9][a-z0-9-]*\.(?:avif|gif|jpg|png|webp)$/u, key);
      assert.ok(entry.objectPath.startsWith(`${key}.`), key);
      assert.ok(licenseAllowsRedistribution(entry.license), key);
    } else {
      assert.equal(entry.sha256, null, key);
      assert.equal(entry.bytes, null, key);
      assert.equal(entry.contentType, null, key);
      assert.equal(entry.objectPath, null, key);
      assert.equal(entry.migrated, false, key);
      assert.equal(typeof entry.reason, "string", key);
      assert.ok(entry.reason.length > 0, key);
    }
    if (entry.status === "ineligible") {
      assert.equal(entry.reason, "license_not_redistributable", key);
      assert.equal(licenseAllowsRedistribution(entry.license), false, key);
    }
  }
  assert.deepEqual(manifest.totals, { entries: Object.keys(library).length, ...counted });
});

test("offline plan validates metadata and splits records by exact license allowlist", () => {
  const plan = planUniversityPhotoMigration(library);
  assert.equal(plan.totals.entries, Object.keys(library).length);
  assert.deepEqual(plan.invalid, []);
  assert.equal(plan.totals.eligible + plan.totals.ineligible, plan.totals.entries);
  for (const key of plan.eligible) assert.ok(REDISTRIBUTABLE_LICENSES.includes(library[key].license), key);
  for (const { license } of plan.ineligible) assert.equal(REDISTRIBUTABLE_LICENSES.includes(license), false);

  assert.deepEqual(libraryEntryProblems("ok-key", { path: "https://a.example/x.jpg", author: "A", title: "T",
    caption: "C", sourceUrl: "https://a.example/", license: "CC0", licenseUrl: "https://a.example/l" }), []);
  assert.deepEqual(libraryEntryProblems("Bad_Key", null), ["key_format", "entry_shape"]);
  assert.ok(libraryEntryProblems("k", { path: "http://a.example/x.jpg", author: "A", title: "T",
    caption: "C", sourceUrl: "https://a.example/", license: "CC0", licenseUrl: "https://a.example/l" }).includes("path_not_https"));
  assert.ok(libraryEntryProblems("k", { path: "https://a.example/x.jpg", author: " ", title: "T",
    caption: "C", sourceUrl: "https://a.example/", license: "CC0", licenseUrl: "https://a.example/l" }).includes("author_missing"));
});

const CHECK_LIBRARY = Object.freeze({
  ok: { path: "https://photos.example/ok.jpg", author: "Author O", title: "Ok", caption: "Ok photo",
    sourceUrl: "https://pages.example/ok", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" },
  gone: { path: "https://photos.example/gone.jpg", author: "Author G", title: "Gone", caption: "Gone photo",
    sourceUrl: "https://pages.example/gone", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" },
  official: { path: "https://uni.example/hero.jpg", author: "Uni — официальный сайт", title: "Hero", caption: "Hero photo",
    sourceUrl: "https://uni.example/", license: "Official-source embedding; no reuse license stated", licenseUrl: "https://uni.example/" },
});
const OK_BYTES = Buffer.alloc(2048, 7);
const imageResponse = bytes => new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg" } });

test("check is read-only, records failures honestly and never drops entries", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, method: init?.method ?? "GET" });
    if (url === CHECK_LIBRARY.ok.path) return imageResponse(OK_BYTES);
    if (url === CHECK_LIBRARY.gone.path) return new Response("missing", { status: 404 });
    throw new Error(`unexpected url: ${url}`);
  };
  const result = await checkUniversityPhotoMigration({ library: CHECK_LIBRARY, fetchImpl, concurrency: 1 });
  assert.equal(result.exitCode, 0);
  assert.ok(requests.every(request => request.method === "GET"));
  assert.deepEqual(requests.map(request => request.url).sort(), [CHECK_LIBRARY.gone.path, CHECK_LIBRARY.ok.path]);
  assert.deepEqual(Object.keys(result.manifest.entries), ["gone", "official", "ok"]);
  const ok = result.manifest.entries.ok;
  assert.equal(ok.status, "verified");
  assert.equal(ok.sha256, sha256(OK_BYTES));
  assert.equal(ok.bytes, OK_BYTES.byteLength);
  assert.equal(ok.objectPath, "ok.jpg");
  assert.equal(ok.migrated, false);
  assert.equal(ok.attribution, "Author O");
  assert.equal(result.manifest.entries.gone.status, "failed");
  assert.equal(result.manifest.entries.gone.reason, "http_404");
  assert.equal(result.manifest.entries.official.status, "ineligible");
  assert.deepEqual(result.report.failed, [{ key: "gone", reason: "http_404" }]);
  assert.deepEqual(result.manifest.totals, { entries: 3, verified: 1, ineligible: 1, failed: 1, migrated: 0 });
});

test("re-check preserves migrated only while sha256 and objectPath are unchanged", async () => {
  const fetchImpl = async url => (url === CHECK_LIBRARY.ok.path ? imageResponse(OK_BYTES) : new Response("x", { status: 404 }));
  const previousSame = { schema: UNIVERSITY_PHOTO_MANIFEST_SCHEMA,
    entries: { ok: { migrated: true, sha256: sha256(OK_BYTES), objectPath: "ok.jpg" } } };
  const kept = await checkUniversityPhotoMigration({ library: { ok: CHECK_LIBRARY.ok }, fetchImpl, previous: previousSame });
  assert.equal(kept.manifest.entries.ok.migrated, true);
  const previousDrifted = { schema: UNIVERSITY_PHOTO_MANIFEST_SCHEMA,
    entries: { ok: { migrated: true, sha256: "0".repeat(64), objectPath: "ok.jpg" } } };
  const drifted = await checkUniversityPhotoMigration({ library: { ok: CHECK_LIBRARY.ok }, fetchImpl, previous: previousDrifted });
  assert.equal(drifted.manifest.entries.ok.migrated, false);
  assert.equal(drifted.manifest.entries.ok.reason, "source_drifted_since_migration");
});

const APPLY_MANIFEST = Object.freeze({ schema: UNIVERSITY_PHOTO_MANIFEST_SCHEMA, generatedAt: "2026-09-20T00:00:00.000Z",
  projectRef: UNIVERSITY_PHOTO_PROJECT, bucket: UNIVERSITY_PHOTO_BUCKET.id, source: "src/lib/university-photo-library.json",
  totals: { entries: 1, verified: 1, ineligible: 0, failed: 0, migrated: 0 },
  entries: { ok: { sourceUrl: CHECK_LIBRARY.ok.path, finalUrl: null, pageUrl: CHECK_LIBRARY.ok.sourceUrl,
    license: CHECK_LIBRARY.ok.license, licenseUrl: CHECK_LIBRARY.ok.licenseUrl, attribution: CHECK_LIBRARY.ok.author,
    sha256: sha256(OK_BYTES), bytes: OK_BYTES.byteLength, contentType: "image/jpeg", objectPath: "ok.jpg",
    status: "verified", reason: null, migrated: false } } });
const transportKey = "sb_secret_synthetic_transport_only_123";
const applyEnvironment = Object.freeze({ NEXT_PUBLIC_SUPABASE_URL: `https://${UNIVERSITY_PHOTO_PROJECT}.supabase.co`,
  EVO_PLATFORM_SUPABASE_SECRET_KEY: transportKey });

test("apply refuses to start without environment credentials and before any network", async () => {
  for (const environment of [{}, { NEXT_PUBLIC_SUPABASE_URL: applyEnvironment.NEXT_PUBLIC_SUPABASE_URL }]) {
    const result = await applyUniversityPhotoMigration({ environment, manifest: APPLY_MANIFEST,
      fetchImpl() { assert.fail("apply without credentials must not reach the network"); } });
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.status, "configuration_invalid");
    assert.equal(result.report.mutationAttempted, false);
    assert.equal(result.manifest, null);
  }
  const foreign = await applyUniversityPhotoMigration({ manifest: APPLY_MANIFEST,
    environment: { ...applyEnvironment, NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" },
    fetchImpl() { assert.fail("foreign project must not reach the network"); } });
  assert.equal(foreign.report.status, "project_mismatch");
  const missingManifest = await applyUniversityPhotoMigration({ environment: applyEnvironment, manifest: null,
    fetchImpl() { assert.fail("apply without manifest must not reach the network"); } });
  assert.equal(missingManifest.exitCode, 1);
  assert.equal(missingManifest.report.status, "manifest_missing_run_check_first");
});

test("apply creates the exact absent public bucket, uploads manifest-verified bytes and flips migrated", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push(`${method} ${url}`);
    if (url.endsWith(`/storage/v1/bucket/${UNIVERSITY_PHOTO_BUCKET.id}`)) {
      return calls.filter(call => call.startsWith("GET") && call.includes("/storage/v1/bucket/")).length === 1
        ? Response.json({ code: "NoSuchBucket" }, { status: 404 })
        : Response.json({ ...UNIVERSITY_PHOTO_BUCKET, allowed_mime_types: [...UNIVERSITY_PHOTO_BUCKET.allowed_mime_types] });
    }
    if (url.endsWith("/storage/v1/bucket") && method === "POST") {
      assert.deepEqual(JSON.parse(init.body), { ...UNIVERSITY_PHOTO_BUCKET, allowed_mime_types: [...UNIVERSITY_PHOTO_BUCKET.allowed_mime_types] });
      return Response.json({ name: UNIVERSITY_PHOTO_BUCKET.name }, { status: 200 });
    }
    if (url === CHECK_LIBRARY.ok.path) return imageResponse(OK_BYTES);
    if (method === "POST" && url.endsWith(`/storage/v1/object/${UNIVERSITY_PHOTO_BUCKET.id}/ok.jpg`)) {
      assert.equal(init.headers["x-upsert"], "false");
      assert.equal(init.headers["content-type"], "image/jpeg");
      assert.equal(sha256(Buffer.from(init.body)), sha256(OK_BYTES));
      return Response.json({ Key: "ok.jpg" }, { status: 200 });
    }
    if (url === universityPhotoPublicUrl("ok.jpg")) return imageResponse(OK_BYTES);
    throw new Error(`unexpected request: ${method} ${url}`);
  };
  const result = await applyUniversityPhotoMigration({ environment: applyEnvironment, manifest: APPLY_MANIFEST, fetchImpl });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.status, "applied");
  assert.equal(result.report.bucketStatus, "created_and_verified");
  assert.deepEqual(result.report.uploaded, ["ok"]);
  assert.deepEqual(result.report.failures, []);
  assert.equal(result.manifest.entries.ok.migrated, true);
  assert.equal(result.manifest.totals.migrated, 1);
  assert.equal(calls.filter(call => call.startsWith("POST")).length, 2);
  assert.equal(JSON.stringify(result).includes(transportKey), false);
});

test("apply records drifted sources as unmigratable instead of uploading them", async () => {
  const drifted = Buffer.alloc(4096, 9);
  const fetchImpl = async (url, init = {}) => {
    if (url.endsWith(`/storage/v1/bucket/${UNIVERSITY_PHOTO_BUCKET.id}`)) {
      return Response.json({ ...UNIVERSITY_PHOTO_BUCKET, allowed_mime_types: [...UNIVERSITY_PHOTO_BUCKET.allowed_mime_types] });
    }
    if (url === CHECK_LIBRARY.ok.path) return imageResponse(drifted);
    assert.fail(`unexpected request: ${init.method ?? "GET"} ${url}`);
  };
  const result = await applyUniversityPhotoMigration({ environment: applyEnvironment, manifest: APPLY_MANIFEST, fetchImpl });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.status, "applied_with_failures");
  assert.deepEqual(result.report.failures, [{ key: "ok", reason: "content_drifted" }]);
  assert.equal(result.manifest.entries.ok.status, "failed");
  assert.equal(result.manifest.entries.ok.migrated, false);
});

test("CLI: offline default plan, explicit modes only, no secret leakage", async () => {
  let written = "";
  const write = value => { written += value; };
  assert.equal(await runUniversityPhotoMigrationCli([], { write }), 0);
  const plan = JSON.parse(written);
  assert.equal(plan.schema, "evo-university-photos-plan/v1");
  assert.equal(plan.totals.entries, Object.keys(library).length);
  assert.equal(plan.totals.invalid, 0);

  written = "";
  assert.equal(await runUniversityPhotoMigrationCli(["--unknown"], { write }), 1);
  assert.match(written, /arguments_invalid/u);
  written = "";
  assert.equal(await runUniversityPhotoMigrationCli(["--apply", transportKey], { write }), 1);
  assert.equal(written.includes(transportKey), false);
  // --apply без env падает на конфигурации до сети и не переписывает манифест.
  written = "";
  let manifestWrites = 0;
  const exitCode = await runUniversityPhotoMigrationCli(["--apply"], { write, environment: {},
    manifest: APPLY_MANIFEST, writeManifest: () => { manifestWrites += 1; },
    fetchImpl() { assert.fail("no network without credentials"); } });
  assert.equal(exitCode, 1);
  assert.match(written, /configuration_invalid/u);
  assert.equal(manifestWrites, 0);
});
