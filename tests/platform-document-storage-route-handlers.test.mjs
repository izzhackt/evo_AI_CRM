import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createPlatformDocumentDownloadHandler,
  createPlatformDocumentUploadHandler,
} from "../src/lib/server/platform-document-storage-route-handlers.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const SLOT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const RESERVATION_ID = "55555555-5555-4555-8555-555555555555";
const GRANT_ID = "66666666-6666-4666-8666-666666666666";
const CONSUMPTION_ID = "77777777-7777-4777-8777-777777777777";
const ACCESS_EVENT_ID = "88888888-8888-4888-8888-888888888888";
const REQUEST_IDS = [
  "99999999-9999-4999-8999-999999999991",
  "99999999-9999-4999-8999-999999999992",
  "99999999-9999-4999-8999-999999999993",
];
const OBJECT_NAME = `ab/${"c".repeat(62)}`;
const AT = "2026-09-02T08:00:00+00:00";
const BYTES = new TextEncoder().encode("%PDF-1.7\nreal private storage proof");
const SHA256 = createHash("sha256").update(BYTES).digest("hex");

const ACTOR = Object.freeze({
  authUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  membershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  organizationId: ORGANIZATION_ID,
  displayName: "Admissions",
  email: "admissions@example.test",
  platformRole: "admissions",
  authorityRole: "admissions",
  presentationRole: "admissions",
  platformAccessVersion: 1,
  platformBundleId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  platformBundleVersion: 1,
});

function reservation(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    student_case_id: CASE_ID,
    document_slot_id: SLOT_ID,
    document_version_id: VERSION_ID,
    upload_reservation_id: RESERVATION_ID,
    bucket_id: "platform-documents",
    object_name: OBJECT_NAME,
    expires_at: AT,
    declared_mime_type: "application/pdf",
    byte_size: BYTES.byteLength,
    sha256_hex: SHA256,
    storage_object_present: false,
    document_slot_published: false,
    ...overrides,
  };
}

function finalization(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    student_case_id: CASE_ID,
    document_slot_id: SLOT_ID,
    document_version_id: VERSION_ID,
    upload_reservation_id: RESERVATION_ID,
    bucket_id: "platform-documents",
    object_name: OBJECT_NAME,
    object_created_at: AT,
    finalized_at: AT,
    published_slot_status: "submitted",
    published_version_no: 1,
    document_slot_published: true,
    ...overrides,
  };
}

function attestation(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    document_version_id: VERSION_ID,
    document_slot_id: SLOT_ID,
    student_case_id: CASE_ID,
    integrity_status: "verified",
    malware_status: "clean",
    validation_source: "evo-v2-basic-file-validation-no-scanner",
    evidence_ref: `sha256:${SHA256}`,
    validation_updated_at: AT,
    scanner_proof: false,
    ...overrides,
  };
}

function grant(overrides = {}) {
  return {
    document_download_grant_id: GRANT_ID,
    expires_at: AT,
    signed_url: null,
    storage_api_service_sign_required: true,
    ...overrides,
  };
}

function consumption(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    student_case_id: CASE_ID,
    document_slot_id: SLOT_ID,
    document_version_id: VERSION_ID,
    document_download_grant_id: GRANT_ID,
    document_download_consumption_id: CONSUMPTION_ID,
    document_access_event_id: ACCESS_EVENT_ID,
    bucket_id: "platform-documents",
    object_name: OBJECT_NAME,
    max_signed_url_expires_in_seconds: 60,
    grant_expires_at: AT,
    signed_url: null,
    storage_api_service_sign_required: true,
    ...overrides,
  };
}

function sequence(values) {
  let index = 0;
  return () => values[index++] ?? values.at(-1);
}

function uploadRequest({ mimeType = "application/pdf", extra = false } = {}) {
  const form = new FormData();
  form.set("request_id", REQUEST_IDS[0]);
  form.set("file", new Blob([BYTES], { type: mimeType }), "proof.pdf");
  if (extra) form.set("case_id", CASE_ID);
  return new Request("http://app.test/api/v2/document-slots/x/versions", {
    method: "POST",
    body: form,
  });
}

function uploadDependencies({
  authorization = { status: "authorized", actor: ACTOR },
  reserveResult = reservation(),
  reserveError = null,
  uploadError = null,
  finalizeResult = finalization(),
  finalizeError = null,
  attestationResult = attestation(),
  attestationError = null,
} = {}) {
  const calls = [];
  const userClient = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, args) {
          calls.push(["user-rpc", name, args]);
          return { data: reserveResult, error: reserveError };
        },
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "platform-documents");
        return {
          async upload(path, bytes, options) {
            calls.push(["upload", path, bytes, options]);
            return { data: uploadError ? null : { path }, error: uploadError };
          },
        };
      },
    },
  };
  const serviceClient = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, args) {
          calls.push(["service-rpc", name, args]);
          return name === "finalize_document_upload"
            ? { data: finalizeResult, error: finalizeError }
            : { data: attestationResult, error: attestationError };
        },
      };
    },
  };
  return {
    calls,
    dependencies: {
      async authorize() {
        return authorization;
      },
      async createUserClient() {
        calls.push(["create-user-client"]);
        return userClient;
      },
      createServiceClient() {
        calls.push(["create-service-client"]);
        return serviceClient;
      },
      supabaseOrigin() {
        return "http://127.0.0.1:54321";
      },
      requestId: sequence(REQUEST_IDS.slice(1)),
    },
  };
}

test("authenticated Admissions upload reserves through RLS, writes once, then finalizes with the service client", async () => {
  const { calls, dependencies } = uploadDependencies();
  const handler = createPlatformDocumentUploadHandler(dependencies);
  const response = await handler(uploadRequest(), {
    params: Promise.resolve({ documentSlotId: SLOT_ID }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    document: {
      studentCaseId: CASE_ID,
      documentSlotId: SLOT_ID,
      documentVersionId: VERSION_ID,
      versionNumber: 1,
      originalFilename: "proof.pdf",
      declaredMimeType: "application/pdf",
      byteSize: BYTES.byteLength,
      sha256Hex: SHA256,
    },
  });
  assert.equal(calls.filter(([kind]) => kind === "upload").length, 1);
  assert.equal(calls.find(([kind]) => kind === "upload")[1], OBJECT_NAME);
  assert.equal(calls.find(([kind]) => kind === "upload")[3].upsert, false);
  assert.deepEqual(calls.find(([kind]) => kind === "user-rpc").slice(1), [
    "reserve_document_upload",
    {
      p_organization_id: ORGANIZATION_ID,
      p_document_slot_id: SLOT_ID,
      p_original_filename: "proof.pdf",
      p_declared_mime_type: "application/pdf",
      p_byte_size: BYTES.byteLength,
      p_sha256_hex: SHA256,
      p_request_id: REQUEST_IDS[0],
    },
  ]);
  assert.deepEqual(
    calls.filter(([kind]) => kind === "service-rpc").map(([, name]) => name),
    ["finalize_document_upload", "attest_document_validation"],
  );
});

test("an ambiguous prior Storage write is finalized without overwrite", async () => {
  const { calls, dependencies } = uploadDependencies({
    reserveResult: reservation({ storage_object_present: true }),
  });
  const response = await createPlatformDocumentUploadHandler(dependencies)(
    uploadRequest(),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );
  assert.equal(response.status, 201);
  assert.equal(calls.some(([kind]) => kind === "upload"), false);
  assert.deepEqual(
    calls.filter(([kind]) => kind === "service-rpc").map(([, name]) => name),
    ["finalize_document_upload", "attest_document_validation"],
  );
});

test("upload fails clearly and never finalizes when Storage does not confirm the object", async () => {
  const { calls, dependencies } = uploadDependencies({
    uploadError: { message: "unconfirmed" },
  });
  const response = await createPlatformDocumentUploadHandler(dependencies)(
    uploadRequest(),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "storage_upload_unconfirmed" });
  assert.equal(calls.some(([kind]) => kind === "service-rpc"), false);
});

test("forbidden, malformed and unexpected upload inputs stop before Supabase", async () => {
  const forbidden = uploadDependencies({
    authorization: { status: "forbidden", actor: null },
  });
  let response = await createPlatformDocumentUploadHandler(
    forbidden.dependencies,
  )(uploadRequest(), { params: Promise.resolve({ documentSlotId: SLOT_ID }) });
  assert.equal(response.status, 403);
  assert.equal(forbidden.calls.length, 0);

  const invalid = uploadDependencies();
  response = await createPlatformDocumentUploadHandler(invalid.dependencies)(
    uploadRequest({ extra: true }),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );
  assert.equal(response.status, 400);
  assert.equal(invalid.calls.length, 0);

  response = await createPlatformDocumentUploadHandler(invalid.dependencies)(
    uploadRequest({ mimeType: "text/plain" }),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );
  assert.equal(response.status, 400);
  assert.equal(invalid.calls.length, 0);
});

test("upload aborts a streamed oversized body even when content-length lies", async () => {
  const oversizedChunk = new Uint8Array(9 * 1024 * 1024);
  let emittedChunks = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      emittedChunks += 1;
      controller.enqueue(oversizedChunk);
      if (emittedChunks === 4) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request(
    "http://app.test/api/v2/document-slots/x/versions",
    {
      method: "POST",
      headers: {
        "content-length": "1",
        "content-type": "multipart/form-data; boundary=bounded-proof",
      },
      body,
      duplex: "half",
    },
  );
  const oversized = uploadDependencies();

  const response = await createPlatformDocumentUploadHandler(
    oversized.dependencies,
  )(request, { params: Promise.resolve({ documentSlotId: SLOT_ID }) });

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "file_too_large" });
  assert.equal(cancelled, true);
  assert.equal(oversized.calls.length, 0);
});

function downloadDependencies({
  authorization = { status: "authorized", actor: ACTOR },
  grantResult = grant(),
  grantError = null,
  consumptionResult = consumption(),
  consumptionError = null,
  signedUrl = `http://127.0.0.1:54321/storage/v1/object/sign/platform-documents/${OBJECT_NAME}?token=short-lived`,
  signedError = null,
} = {}) {
  const calls = [];
  const userClient = {
    schema() {
      return {
        async rpc(name, args) {
          calls.push(["user-rpc", name, args]);
          return { data: grantResult, error: grantError };
        },
      };
    },
  };
  const serviceClient = {
    schema() {
      return {
        async rpc(name, args) {
          calls.push(["service-rpc", name, args]);
          return { data: consumptionResult, error: consumptionError };
        },
      };
    },
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(path, lifetime, options) {
            calls.push(["sign", bucket, path, lifetime, options]);
            return {
              data: signedError ? null : { signedUrl },
              error: signedError,
            };
          },
        };
      },
    },
  };
  return {
    calls,
    dependencies: {
      async authorize() {
        return authorization;
      },
      async createUserClient() {
        return userClient;
      },
      createServiceClient() {
        return serviceClient;
      },
      supabaseOrigin() {
        return "http://127.0.0.1:54321";
      },
      requestId: sequence(REQUEST_IDS),
    },
  };
}

test("authorized download consumes one grant and redirects only to a 60-second private signed URL", async () => {
  const { calls, dependencies } = downloadDependencies();
  const response = await createPlatformDocumentDownloadHandler(dependencies)(
    new Request("http://app.test/download"),
    { params: Promise.resolve({ versionId: VERSION_ID }) },
  );
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location"), /^http:\/\/127\.0\.0\.1:54321\/storage\/v1\/object\/sign\/platform-documents\//);
  assert.deepEqual(calls.map(([kind, name]) => [kind, name]), [
    ["user-rpc", "grant_document_download"],
    ["service-rpc", "consume_document_download_grant"],
    ["sign", "platform-documents"],
  ]);
  assert.equal(calls.at(-1)[3], 60);
  assert.deepEqual(calls.at(-1)[4], { download: true });
});

test("download rejects a foreign signed origin and never exposes it", async () => {
  const { dependencies } = downloadDependencies({
    signedUrl: `https://evil.example/storage/v1/object/sign/platform-documents/${OBJECT_NAME}?token=x`,
  });
  const response = await createPlatformDocumentDownloadHandler(dependencies)(
    new Request("http://app.test/download"),
    { params: Promise.resolve({ versionId: VERSION_ID }) },
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("location"), null);
});

test("download denial stops before service consumption and signing", async () => {
  const { calls, dependencies } = downloadDependencies({
    grantError: { message: "denied" },
  });
  const response = await createPlatformDocumentDownloadHandler(dependencies)(
    new Request("http://app.test/download"),
    { params: Promise.resolve({ versionId: VERSION_ID }) },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(calls.map(([kind]) => kind), ["user-rpc"]);
});

test("active document routes have no filesystem, Drizzle, public bucket or legacy fallback", () => {
  const source = [
    readFileSync(
      new URL(
        "../src/lib/server/platform-document-storage-route-handlers.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFileSync(
      new URL(
        "../src/app/api/v2/document-slots/[documentSlotId]/versions/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFileSync(
      new URL(
        "../src/app/api/v2/document-versions/[versionId]/download/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ].join("\n");
  assert.doesNotMatch(
    source,
    /EVO_PRIVATE_DOCUMENT_ROOT|private-document-(?:files|repository|multipart|route-handlers)|drizzle|public\s*bucket|fallback/i,
  );
  assert.match(source, /upsert:\s*false/);
  assert.match(source, /platform-documents/);
});
