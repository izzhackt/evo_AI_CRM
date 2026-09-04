import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createPlatformCompanyFileDownloadHandler,
  createPlatformCompanyFileUploadHandler,
} from "../src/lib/server/platform-company-file-storage-route-handlers.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const RESERVATION_ID = "44444444-4444-4444-8444-444444444444";
const FINALIZATION_ID = "55555555-5555-4555-8555-555555555555";
const GRANT_ID = "66666666-6666-4666-8666-666666666666";
const CONSUMPTION_ID = "77777777-7777-4777-8777-777777777777";
const REQUEST_IDS = [
  "88888888-8888-4888-8888-888888888881",
  "88888888-8888-4888-8888-888888888882",
  "88888888-8888-4888-8888-888888888883",
];
const OBJECT_NAME = `ab/${"c".repeat(62)}`;
const AT = "2026-09-04T10:00:00+00:00";
const BYTES = new TextEncoder().encode("%PDF-1.7\ncompany file proof");
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

function sequence(values) {
  let index = 0;
  return () => values[index++] ?? values.at(-1);
}

function reservation(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    company_file_id: FILE_ID,
    company_file_version_id: VERSION_ID,
    version_no: "1",
    upload_reservation_id: RESERVATION_ID,
    bucket_id: "platform-company-files",
    object_name: OBJECT_NAME,
    expires_at: AT,
    declared_mime_type: "application/pdf",
    byte_size: BYTES.byteLength,
    sha256_hex: SHA256,
    storage_object_present: false,
    file_version_published: false,
    ...overrides,
  };
}

function finalization(overrides = {}) {
  return {
    organization_id: ORGANIZATION_ID,
    company_file_id: FILE_ID,
    company_file_version_id: VERSION_ID,
    version_no: "1",
    upload_finalization_id: FINALIZATION_ID,
    bucket_id: "platform-company-files",
    object_name: OBJECT_NAME,
    finalized_at: AT,
    file_version: "2",
    current_version_id: VERSION_ID,
    ...overrides,
  };
}

function uploadRequest({ bytes = BYTES, type = "application/pdf", name = "proof.pdf" } = {}) {
  const form = new FormData();
  form.set("file", new File([bytes], name, { type }));
  form.set("expected_file_version", "1");
  form.set("request_id", REQUEST_IDS[0]);
  return new Request("http://app.test/upload", { method: "POST", body: form });
}

function uploadDependencies({
  authorization = { status: "authorized", actor: ACTOR },
  reservationValue = reservation(),
  finalizationValue = finalization(),
  reservationError = null,
  finalizationError = null,
  uploadError = null,
} = {}) {
  const calls = [];
  const userClient = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, args) {
          calls.push(["user-rpc", name, args]);
          return { data: reservationValue, error: reservationError };
        },
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "platform-company-files");
        return {
          async upload(objectName, bytes, options) {
            calls.push(["upload", objectName, bytes, options]);
            return { data: uploadError ? null : { path: objectName }, error: uploadError };
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
          return { data: finalizationValue, error: finalizationError };
        },
      };
    },
  };
  return {
    calls,
    dependencies: {
      async authorize(capability) {
        calls.push(["authorize", capability]);
        return authorization;
      },
      async createUserClient() { return userClient; },
      createServiceClient() { return serviceClient; },
      supabaseOrigin() { return "http://127.0.0.1:54321"; },
      requestId: sequence(REQUEST_IDS),
    },
  };
}

test("authorized company upload reserves, uploads without overwrite and finalizes", async () => {
  const { calls, dependencies } = uploadDependencies();
  const response = await createPlatformCompanyFileUploadHandler(dependencies)(
    uploadRequest(),
    { params: Promise.resolve({ companyFileId: FILE_ID }) },
  );
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    companyFile: {
      companyFileId: FILE_ID,
      companyFileVersionId: VERSION_ID,
      versionNumber: "1",
      fileVersion: "2",
      originalFilename: "proof.pdf",
      declaredMimeType: "application/pdf",
      byteSize: BYTES.byteLength,
      sha256Hex: SHA256,
    },
  });
  assert.deepEqual(calls[0], ["authorize", "documents.write"]);
  assert.deepEqual(calls.find(([kind]) => kind === "user-rpc").slice(1), [
    "reserve_company_file_upload",
    {
      p_organization_id: ORGANIZATION_ID,
      p_company_file_id: FILE_ID,
      p_expected_file_version: "1",
      p_original_filename: "proof.pdf",
      p_declared_mime_type: "application/pdf",
      p_byte_size: BYTES.byteLength,
      p_sha256_hex: SHA256,
      p_request_id: REQUEST_IDS[0],
    },
  ]);
  assert.equal(calls.find(([kind]) => kind === "upload")[3].upsert, false);
  assert.equal(
    calls.find(([kind]) => kind === "service-rpc")[1],
    "finalize_company_file_upload",
  );
});

test("company upload authorizes before parsing and rejects spoofed signatures", async () => {
  let result = uploadDependencies({ authorization: { status: "forbidden", actor: null } });
  let response = await createPlatformCompanyFileUploadHandler(result.dependencies)(
    new Request("http://app.test/upload", { method: "POST" }),
    { params: Promise.resolve({ companyFileId: FILE_ID }) },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(result.calls, [["authorize", "documents.write"]]);

  result = uploadDependencies();
  response = await createPlatformCompanyFileUploadHandler(result.dependencies)(
    uploadRequest({ bytes: new TextEncoder().encode("not a pdf") }),
    { params: Promise.resolve({ companyFileId: FILE_ID }) },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "file_signature_mismatch" });
  assert.equal(result.calls.some(([kind]) => kind === "user-rpc"), false);
});

test("company upload supports bounded office formats and rejects extension mismatch", async () => {
  const zipBytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  let result = uploadDependencies({
    reservationValue: reservation({
      declared_mime_type:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      byte_size: zipBytes.byteLength,
      sha256_hex: createHash("sha256").update(zipBytes).digest("hex"),
    }),
  });
  let response = await createPlatformCompanyFileUploadHandler(result.dependencies)(
    uploadRequest({
      bytes: zipBytes,
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      name: "rules.docx",
    }),
    { params: Promise.resolve({ companyFileId: FILE_ID }) },
  );
  assert.equal(response.status, 201);

  result = uploadDependencies();
  response = await createPlatformCompanyFileUploadHandler(result.dependencies)(
    uploadRequest({ name: "proof.txt" }),
    { params: Promise.resolve({ companyFileId: FILE_ID }) },
  );
  assert.equal(response.status, 400);
  assert.equal(result.calls.some(([kind]) => kind === "user-rpc"), false);
});

test("company upload fails closed when reservation or finalization is unverified", async () => {
  let result = uploadDependencies({
    reservationValue: reservation({ company_file_id: VERSION_ID }),
  });
  let response = await createPlatformCompanyFileUploadHandler(result.dependencies)(
    uploadRequest(),
    { params: Promise.resolve({ companyFileId: FILE_ID }) },
  );
  assert.equal(response.status, 503);
  assert.equal(result.calls.some(([kind]) => kind === "upload"), false);

  result = uploadDependencies({ finalizationError: { code: "XX000" } });
  response = await createPlatformCompanyFileUploadHandler(result.dependencies)(
    uploadRequest(),
    { params: Promise.resolve({ companyFileId: FILE_ID }) },
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "storage_finalization_unconfirmed" });
});

function downloadDependencies({ signedUrl, grantError = null, consumeError = null } = {}) {
  const calls = [];
  const userClient = {
    schema() {
      return {
        async rpc(name, args) {
          calls.push(["user-rpc", name, args]);
          return {
            data: {
              company_file_download_grant_id: GRANT_ID,
              expires_at: AT,
              signed_url: null,
              storage_api_service_sign_required: true,
            },
            error: grantError,
          };
        },
      };
    },
  };
  const serviceClient = {
    schema() {
      return {
        async rpc(name, args) {
          calls.push(["service-rpc", name, args]);
          return {
            data: {
              company_file_download_consumption_id: CONSUMPTION_ID,
              company_file_version_id: VERSION_ID,
              bucket_id: "platform-company-files",
              object_name: OBJECT_NAME,
              signing_expires_in_seconds: 60,
              signing_expires_at: AT,
              consumed_at: AT,
            },
            error: consumeError,
          };
        },
      };
    },
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(objectName, seconds, options) {
            calls.push(["sign", bucket, objectName, seconds, options]);
            return {
              data: {
                signedUrl: signedUrl ??
                  `http://127.0.0.1:54321/storage/v1/object/sign/platform-company-files/${OBJECT_NAME}?token=x`,
              },
              error: null,
            };
          },
        };
      },
    },
  };
  return {
    calls,
    dependencies: {
      async authorize(capability) {
        calls.push(["authorize", capability]);
        return { status: "authorized", actor: ACTOR };
      },
      async createUserClient() { return userClient; },
      createServiceClient() { return serviceClient; },
      supabaseOrigin() { return "http://127.0.0.1:54321"; },
      requestId: sequence(REQUEST_IDS),
    },
  };
}

test("company download consumes one grant and emits only a short private signed URL", async () => {
  const { calls, dependencies } = downloadDependencies();
  const response = await createPlatformCompanyFileDownloadHandler(dependencies)(
    new Request("http://app.test/download"),
    { params: Promise.resolve({ versionId: VERSION_ID }) },
  );
  assert.equal(response.status, 307);
  assert.match(
    response.headers.get("location"),
    /^http:\/\/127\.0\.0\.1:54321\/storage\/v1\/object\/sign\/platform-company-files\//,
  );
  assert.deepEqual(calls.map(([kind, name]) => [kind, name]), [
    ["authorize", "documents.read"],
    ["user-rpc", "grant_company_file_download"],
    ["service-rpc", "consume_company_file_download_grant"],
    ["sign", "platform-company-files"],
  ]);
  assert.deepEqual(calls.at(-1).slice(3), [60, { download: true }]);
  assert.deepEqual(calls[2][2], {
    p_organization_id: ORGANIZATION_ID,
    p_company_file_download_grant_id: GRANT_ID,
    p_request_id: REQUEST_IDS[1],
  });
});

test("company download rejects foreign signed URLs and grant failures", async () => {
  let result = downloadDependencies({
    signedUrl: `https://evil.example/storage/v1/object/sign/platform-company-files/${OBJECT_NAME}?token=x`,
  });
  let response = await createPlatformCompanyFileDownloadHandler(result.dependencies)(
    new Request("http://app.test/download"),
    { params: Promise.resolve({ versionId: VERSION_ID }) },
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("location"), null);

  result = downloadDependencies({ consumeError: { code: "42501" } });
  response = await createPlatformCompanyFileDownloadHandler(result.dependencies)(
    new Request("http://app.test/download"),
    { params: Promise.resolve({ versionId: VERSION_ID }) },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "download_grant_invalid" });
  assert.equal(result.calls.some(([kind]) => kind === "sign"), false);
});

test("company file API routes expose only the canonical Node handlers", () => {
  const uploadRoute = readFileSync(
    new URL(
      "../src/app/api/v3/company-files/[companyFileId]/versions/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const downloadRoute = readFileSync(
    new URL(
      "../src/app/api/v3/company-file-versions/[versionId]/download/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(uploadRoute, /POST = createPlatformCompanyFileUploadHandler\(\)/);
  assert.match(downloadRoute, /GET = createPlatformCompanyFileDownloadHandler\(\)/);
  for (const route of [uploadRoute, downloadRoute]) {
    assert.match(route, /runtime = "nodejs"/);
    assert.match(route, /dynamic = "force-dynamic"/);
    assert.doesNotMatch(route, /platform-document-storage|localStorage|fallback/i);
  }
});
