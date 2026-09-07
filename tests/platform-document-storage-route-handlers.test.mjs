import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createPlatformDocumentDownloadHandler,
  createPlatformDocumentUploadHandler,
  createStudentDocumentAuthorizationFactory,
  createStudentPortalDocumentDownloadHandler,
  createStudentPortalDocumentUploadHandler,
  selectPrivateDocumentUploadTransport,
} from "../src/lib/server/platform-document-storage-route-handlers.ts";
import { ClamdScanError } from "../src/lib/server/clamd-malware-scanner.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const SLOT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const RESERVATION_ID = "55555555-5555-4555-8555-555555555555";
const FINALIZATION_ID = "55555555-5555-4555-8555-555555555556";
const STORAGE_BINDING_ID = "55555555-5555-4555-8555-555555555557";
const GRANT_ID = "66666666-6666-4666-8666-666666666666";
const CONSUMPTION_ID = "77777777-7777-4777-8777-777777777777";
const ACCESS_EVENT_ID = "88888888-8888-4888-8888-888888888888";
const SCAN_ATTESTATION_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const ADMISSION_ID = "aaaaaaaa-2222-4222-8222-222222222222";
const REQUEST_IDS = [
  "99999999-9999-4999-8999-999999999991",
  "99999999-9999-4999-8999-999999999992",
  "99999999-9999-4999-8999-999999999993",
];
const OBJECT_NAME = `ab/${"c".repeat(62)}`;
const AT = "2026-09-02T08:00:00+00:00";
const BYTES = new TextEncoder().encode("%PDF-1.7\nreal private storage proof");
const SHA256 = createHash("sha256").update(BYTES).digest("hex");
const SCAN_PROOF = Object.freeze({
  engine: "ClamAV",
  engineVersion: "1.5.4",
  signatureVersion: "27890",
  protocol: "clamd-zinstream-v1",
  scannedAt: "2026-09-02T08:00:00.000Z",
  sha256Hex: SHA256,
});
const STORED_SCAN_PROOF = Object.freeze({
  ...SCAN_PROOF,
  engineVersion: "1.5.5",
  signatureVersion: "27891",
  scannedAt: "2026-09-02T08:00:01.000Z",
});

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
    ingress_scan_proof: true,
    ingress_scan_result: "clean",
    ingress_scanner_engine: SCAN_PROOF.engine,
    ingress_scanner_engine_version: SCAN_PROOF.engineVersion,
    ingress_scanner_signature_version: SCAN_PROOF.signatureVersion,
    ingress_scanner_protocol: SCAN_PROOF.protocol,
    ingress_scanned_at: SCAN_PROOF.scannedAt,
    storage_object_present: false,
    document_slot_published: false,
    ...overrides,
  };
}

function withoutReservationField(field) {
  const value = reservation();
  delete value[field];
  return value;
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
    integrity_status: "verified",
    malware_status: "clean",
    validation_source: "clamav-clamd-zinstream",
    evidence_ref: `sha256:${SHA256}`,
    validation_updated_at: AT,
    malware_scan_attestation_id: SCAN_ATTESTATION_ID,
    storage_binding_id: STORAGE_BINDING_ID,
    upload_finalization_id: FINALIZATION_ID,
    scanner_engine: STORED_SCAN_PROOF.engine,
    scanner_engine_version: STORED_SCAN_PROOF.engineVersion,
    scanner_signature_version: STORED_SCAN_PROOF.signatureVersion,
    scanner_protocol: STORED_SCAN_PROOF.protocol,
    scanned_sha256_hex: SHA256,
    scanned_at: STORED_SCAN_PROOF.scannedAt,
    scanner_proof: true,
    finalization_request_id: REQUEST_IDS[1],
    scan_proof_request_id: REQUEST_IDS[2],
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

function uploadRequest({
  mimeType = "application/pdf",
  extra = false,
  browserRequestId = true,
  idempotencyKey = REQUEST_IDS[0],
  bytes = BYTES,
} = {}) {
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: mimeType }), "proof.pdf");
  if (extra) form.set("case_id", CASE_ID);
  if (browserRequestId) form.set("request_id", REQUEST_IDS[0]);
  return new Request("http://app.test/api/v2/document-slots/x/versions", {
    method: "POST",
    body: form,
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  });
}

function uploadDependencies({
  authorization = { status: "authorized", actor: ACTOR },
  admissionResult = (args) => ({
    admission_id: ADMISSION_ID,
    organization_id: args.p_organization_id,
    student_case_id: CASE_ID,
    document_slot_id: args.p_document_slot_id,
    request_id: args.p_request_id,
    attempt_no: 1,
    admitted_at: AT,
    lease_expires_at: "2026-09-02T08:15:00+00:00",
    request_retry: false,
    scan_allowed: true,
    terminal_replay: false,
    document_version_id: null,
    version_no: null,
    original_filename: null,
    declared_mime_type: null,
    byte_size: null,
  }),
  admissionError = null,
  claimResult = (args) => ({
    admission_id: args.p_admission_id,
    organization_id: args.p_organization_id,
    request_id: args.p_request_id,
    scan_claimed_at: AT,
    claim_checked_at: AT,
    scan_lease_expires_at: "2026-09-02T08:15:00+00:00",
    scan_claim_replay: false,
    scan_allowed: true,
  }),
  claimError = null,
  completionResult = (args) => ({
    admission_id: args.p_admission_id,
    organization_id: args.p_organization_id,
    request_id: args.p_request_id,
    released_at: AT,
    release_outcome: args.p_outcome,
  }),
  completionError = null,
  preflightResult = {
    organization_id: ORGANIZATION_ID,
    student_case_id: CASE_ID,
    document_slot_id: SLOT_ID,
    request_id: REQUEST_IDS[0],
    upload_allowed: true,
    reservation_replay: false,
  },
  preflightError = null,
  reserveResult = reservation(),
  reserveError = null,
  uploadError = null,
  downloadError = null,
  storedBytes = null,
  storedMimeType = null,
  finalizeResult = finalization(),
  finalizeError = null,
  scanOutcomes = null,
  scanResult = SCAN_PROOF,
  scanError = null,
  fetchImpl = null,
  now = () => Date.parse("2026-09-02T07:59:00.000Z"),
  scheduleTimeout = null,
  clearScheduledTimeout = null,
} = {}) {
  const calls = [];
  let scanCallIndex = 0;
  let persistedBytes = storedBytes;
  let persistedMimeType = storedMimeType;
  const userClient = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, args) {
          calls.push(["user-rpc", name, args]);
          if (name === "admit_student_document_upload_scan") {
            return {
              data: typeof admissionResult === "function"
                ? admissionResult(args)
                : admissionResult,
              error: admissionError,
            };
          }
          if (name === "preflight_document_upload") {
            return { data: preflightResult, error: preflightError };
          }
          throw new Error(`Unexpected user RPC: ${name}`);
        },
      };
    },
  };
  const serviceClient = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, args) {
          calls.push(["service-rpc", name, args]);
          if (name === "complete_student_document_upload_scan_admission") {
            return {
              data: typeof completionResult === "function"
                ? completionResult(args)
                : completionResult,
              error: completionError,
            };
          }
          if (name === "claim_student_document_upload_scan") {
            return {
              data: typeof claimResult === "function"
                ? claimResult(args)
                : claimResult,
              error: claimError,
            };
          }
          if (name === "reserve_document_upload_after_ingress_scan") {
            return { data: reserveResult, error: reserveError };
          }
          if (name === "finalize_document_upload_with_scan") {
            return { data: finalizeResult, error: finalizeError };
          }
          throw new Error(`Unexpected service RPC: ${name}`);
        },
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "platform-documents");
        return {
          async upload(path, bytes, options) {
            calls.push(["service-upload", path, bytes, options]);
            if (!uploadError && persistedBytes === null) {
              persistedBytes = new Uint8Array(bytes);
              persistedMimeType = options.contentType;
            }
            return { data: uploadError ? null : { path }, error: uploadError };
          },
          async download(path) {
            calls.push(["service-download", path]);
            return {
              data: downloadError
                ? null
                : new Blob([persistedBytes ?? BYTES], {
                  type: persistedMimeType ?? "application/pdf",
                }),
              error: downloadError,
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
        calls.push(["create-user-client"]);
        return userClient;
      },
      createServiceClient() {
        calls.push(["create-service-client"]);
        return serviceClient;
      },
      async scanFile(bytes) {
        calls.push(["scan", bytes]);
        const outcome = scanOutcomes?.[scanCallIndex++];
        if (outcome) {
          if (outcome.error) throw outcome.error;
          return outcome.result;
        }
        if (scanError) throw scanError;
        return scanResult;
      },
      supabaseOrigin() {
        return "http://127.0.0.1:54321";
      },
      backendConfig() {
        return {
          supabaseUrl: "http://127.0.0.1:54321",
          supabaseSecretKey: "sb_secret_1234567890123456",
        };
      },
      async fetch(input, init) {
        calls.push(["tus-fetch", input.toString(), init]);
        if (!fetchImpl) throw new Error("Unexpected TUS request");
        return fetchImpl(input, init);
      },
      now,
      ...(scheduleTimeout ? { scheduleTimeout } : {}),
      ...(clearScheduledTimeout ? { clearScheduledTimeout } : {}),
      requestId: sequence(REQUEST_IDS),
    },
  };
}

test("authenticated Admissions upload reserves through RLS, service-writes, reads back and finalizes exact bytes", async () => {
  const { calls, dependencies } = uploadDependencies({
    scanOutcomes: [
      { result: SCAN_PROOF },
      { result: STORED_SCAN_PROOF },
    ],
  });
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
  assert.equal(calls.filter(([kind]) => kind === "service-upload").length, 1);
  assert.equal(calls.filter(([kind]) => kind === "service-download").length, 1);
  assert.equal(calls.filter(([kind]) => kind === "scan").length, 2);
  const preflightCall = calls.find(([, name]) => name === "preflight_document_upload");
  const reserveCall = calls.find(([, name]) =>
    name === "reserve_document_upload_after_ingress_scan"
  );
  assert.ok(calls.indexOf(preflightCall) < calls.findIndex(([kind]) => kind === "scan"));
  assert.equal(calls.find(([kind]) => kind === "service-upload")[1], OBJECT_NAME);
  assert.equal(calls.find(([kind]) => kind === "service-upload")[3].upsert, false);
  assert.deepEqual(preflightCall.slice(1), [
    "preflight_document_upload",
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
  assert.deepEqual(reserveCall.slice(1), [
    "reserve_document_upload_after_ingress_scan",
    {
      p_organization_id: ORGANIZATION_ID,
      p_actor_auth_user_id: ACTOR.authUserId,
      p_document_slot_id: SLOT_ID,
      p_original_filename: "proof.pdf",
      p_declared_mime_type: "application/pdf",
      p_byte_size: BYTES.byteLength,
      p_sha256_hex: SHA256,
      p_scan_result: "clean",
      p_scanner_engine: "ClamAV",
      p_scanner_engine_version: SCAN_PROOF.engineVersion,
      p_scanner_signature_version: SCAN_PROOF.signatureVersion,
      p_scanner_protocol: "clamd-zinstream-v1",
      p_scanned_at: SCAN_PROOF.scannedAt,
      p_request_id: REQUEST_IDS[0],
    },
  ]);
  assert.deepEqual(
    calls.filter(([kind]) => kind === "service-rpc").map(([, name]) => name),
    [
      "reserve_document_upload_after_ingress_scan",
      "finalize_document_upload_with_scan",
    ],
  );
  const finalizationArgs = calls.find(([, name]) =>
    name === "finalize_document_upload_with_scan"
  )[2];
  const { p_request_id: finalizationRequestId, ...finalizationFacts } = finalizationArgs;
  assert.match(finalizationRequestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    finalizationFacts,
    {
      p_organization_id: ORGANIZATION_ID,
      p_upload_reservation_id: RESERVATION_ID,
      p_scanner_engine: "ClamAV",
      p_scanner_engine_version: STORED_SCAN_PROOF.engineVersion,
      p_scanner_signature_version: STORED_SCAN_PROOF.signatureVersion,
      p_scanner_protocol: "clamd-zinstream-v1",
      p_scanned_sha256_hex: SHA256,
      p_scanned_at: STORED_SCAN_PROOF.scannedAt,
    },
  );
});

test("reservation response requires exact durable ingress-scan evidence", async () => {
  const invalidReservations = [
    withoutReservationField("ingress_scan_proof"),
    reservation({ unexpected: true }),
    reservation({ ingress_scan_proof: false }),
    reservation({ ingress_scan_result: "infected" }),
    reservation({ ingress_scanner_engine: "other" }),
    reservation({ ingress_scanner_engine_version: "invalid version" }),
    reservation({ ingress_scanner_signature_version: "0" }),
    reservation({ ingress_scanner_protocol: "clamd-instream-v0" }),
    reservation({ ingress_scanned_at: "not-a-timestamp" }),
  ];

  for (const reserveResult of invalidReservations) {
    const { calls, dependencies } = uploadDependencies({ reserveResult });
    const response = await createPlatformDocumentUploadHandler(dependencies)(
      uploadRequest(),
      { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "storage_unavailable" });
    assert.equal(calls.some(([kind]) => kind === "service-upload"), false);
    assert.equal(
      calls.some(([, name]) => name === "finalize_document_upload_with_scan"),
      false,
    );
  }
});

test("malware and scanner failure stop before any reservation or Storage write", async () => {
  for (const item of [
    { error: new ClamdScanError("infected"), status: 422, code: "malware_detected" },
    { error: new ClamdScanError("timeout"), status: 503, code: "malware_scanner_unavailable" },
  ]) {
    const { calls, dependencies } = uploadDependencies({ scanError: item.error });
    const response = await createPlatformDocumentUploadHandler(dependencies)(
      uploadRequest(),
      { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
    );
    assert.equal(response.status, item.status);
    assert.deepEqual(await response.json(), { error: item.code });
    assert.deepEqual(
      calls.filter(([kind]) => kind === "user-rpc").map(([, name]) => name),
      ["preflight_document_upload"],
    );
    assert.equal(
      calls.some(([, name]) => name === "reserve_document_upload_after_ingress_scan"),
      false,
    );
    assert.equal(calls.some(([kind]) => kind === "service-upload"), false);
  }

  const mismatch = uploadDependencies({
    scanResult: { ...SCAN_PROOF, sha256Hex: "0".repeat(64) },
  });
  const response = await createPlatformDocumentUploadHandler(mismatch.dependencies)(
    uploadRequest(),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "malware_scan_unconfirmed" });
  assert.deepEqual(
    mismatch.calls.filter(([kind]) => kind === "user-rpc").map(([, name]) => name),
    ["preflight_document_upload"],
  );
});

test("stored student bytes fail closed when the second malware scan is unsafe", async () => {
  for (const item of [
    { error: new ClamdScanError("infected"), status: 422, code: "malware_detected" },
    { error: new ClamdScanError("timeout"), status: 503, code: "malware_scanner_unavailable" },
  ]) {
    const { calls, dependencies } = uploadDependencies({
      scanOutcomes: [
        { result: SCAN_PROOF },
        { error: item.error },
      ],
    });
    const response = await createPlatformDocumentUploadHandler(dependencies)(
      uploadRequest(),
      { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
    );

    assert.equal(response.status, item.status);
    assert.deepEqual(await response.json(), { error: item.code });
    assert.deepEqual(
      calls.filter(([kind]) => kind === "user-rpc").map(([, name]) => name),
      ["preflight_document_upload"],
    );
    assert.equal(calls.filter(([kind]) => kind === "service-upload").length, 1);
    assert.equal(calls.filter(([kind]) => kind === "service-download").length, 1);
    assert.equal(calls.filter(([kind]) => kind === "scan").length, 2);
    assert.equal(
      calls.some(([, name]) => name === "finalize_document_upload_with_scan"),
      false,
    );
  }
});

test("document upload rejects cross-tenant preflight before scanning or writes", async () => {
  const { calls, dependencies } = uploadDependencies({
    preflightError: { code: "42501" },
  });
  const response = await createPlatformDocumentUploadHandler(dependencies)(
    uploadRequest(),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "upload_not_authorized" });
  assert.deepEqual(
    calls.filter(([kind]) => kind === "user-rpc").map(([, name]) => name),
    ["preflight_document_upload"],
  );
  assert.equal(calls.some(([kind]) => kind === "scan" || kind === "service-upload"), false);
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
  assert.equal(calls.some(([kind]) => kind === "service-upload"), false);
  assert.equal(calls.filter(([kind]) => kind === "service-download").length, 1);
  assert.equal(calls.filter(([kind]) => kind === "scan").length, 2);
  assert.deepEqual(
    calls.filter(([kind]) => kind === "service-rpc").map(([, name]) => name),
    [
      "reserve_document_upload_after_ingress_scan",
      "finalize_document_upload_with_scan",
    ],
  );
});

test("same-size stored-object substitution fails before finalization or proof", async () => {
  const substituted = new Uint8Array(BYTES);
  substituted[substituted.byteLength - 1] ^= 1;
  const { calls, dependencies } = uploadDependencies({
    reserveResult: reservation({ storage_object_present: true }),
    storedBytes: substituted,
  });
  const response = await createPlatformDocumentUploadHandler(dependencies)(
    uploadRequest(),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "storage_object_mismatch" });
  assert.equal(calls.some(([kind]) => kind === "service-upload"), false);
  assert.equal(calls.filter(([kind]) => kind === "scan").length, 1);
  assert.equal(
    calls.some(([, name]) => name === "finalize_document_upload_with_scan"),
    false,
  );
});

test("lost-response replay accepts the durable original scan facts", async () => {
  const { calls, dependencies } = uploadDependencies({
    reserveResult: reservation({ storage_object_present: true }),
    finalizeResult: finalization({
      scanner_engine_version: "1.5.3",
      scanner_signature_version: "27889",
      scanned_at: "2026-09-01T07:00:00+00:00",
    }),
  });
  const response = await createPlatformDocumentUploadHandler(dependencies)(
    uploadRequest(),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );

  assert.equal(response.status, 201);
  assert.equal(calls.filter(([kind]) => kind === "scan").length, 2);
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
  assert.equal(
    calls.some(([, name]) => name === "finalize_document_upload_with_scan"),
    false,
  );
});

test("forbidden and malformed uploads fail before work while admitted Student attempts are counted", async () => {
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
    uploadRequest(),
    { params: Promise.resolve({ documentSlotId: "not-a-uuid" }) },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_document_slot" });
  assert.equal(invalid.calls.length, 0);

  response = await createPlatformDocumentUploadHandler(invalid.dependencies)(
    uploadRequest({ extra: true }),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );
  assert.equal(response.status, 400);
  assert.equal(invalid.calls.length, 0);

  response = await createStudentPortalDocumentUploadHandler(invalid.dependencies)(
    uploadRequest({ browserRequestId: false, idempotencyKey: null }),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_idempotency_key" });
  assert.equal(invalid.calls.length, 0);

  response = await createStudentPortalDocumentUploadHandler(invalid.dependencies)(
    uploadRequest({ browserRequestId: true }),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_upload" });
  assert.deepEqual(
    invalid.calls.map(([kind, name]) => name ? `${kind}:${name}` : kind),
    [
      "create-user-client",
      "user-rpc:admit_student_document_upload_scan",
      "create-service-client",
      "service-rpc:complete_student_document_upload_scan_admission",
    ],
  );
  invalid.calls.length = 0;

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

test("Student upload uses the same storage engine but returns only the browser-safe receipt", async () => {
  const { calls, dependencies } = uploadDependencies({
    scanOutcomes: [
      { result: SCAN_PROOF },
      { result: STORED_SCAN_PROOF },
    ],
  });
  const response = await createStudentPortalDocumentUploadHandler(dependencies)(
    uploadRequest({ browserRequestId: false }),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual(body, {
    document: {
      documentSlotId: SLOT_ID,
      documentVersionId: VERSION_ID,
      versionNumber: 1,
      originalFilename: "proof.pdf",
      declaredMimeType: "application/pdf",
      byteSize: BYTES.byteLength,
    },
  });
  assert.doesNotMatch(
    JSON.stringify(body),
    new RegExp(`${CASE_ID}|${SHA256}|${OBJECT_NAME}|platform-documents`, "u"),
  );
  const preflightRequestId = calls.find(([, name]) =>
    name === "preflight_document_upload")[2].p_request_id;
  const admissionRequestId = calls.find(([, name]) =>
    name === "admit_student_document_upload_scan")[2].p_request_id;
  const reservationRequestId = calls.find(([, name]) =>
    name === "reserve_document_upload_after_ingress_scan")[2].p_request_id;
  const finalizationRequestId = calls.find(([, name]) =>
    name === "finalize_document_upload_with_scan")[2].p_request_id;
  assert.equal(admissionRequestId, REQUEST_IDS[0]);
  assert.equal(preflightRequestId, admissionRequestId);
  assert.equal(reservationRequestId, preflightRequestId);
  assert.notEqual(finalizationRequestId, preflightRequestId);
  assert.equal(
    calls.find(([, name]) =>
      name === "complete_student_document_upload_scan_admission")[2].p_outcome,
    "completed",
  );
});

test("Student upload derives local body and scan deadlines from bounded DB TTLs despite clock skew", async () => {
  const { calls, dependencies } = uploadDependencies({
    admissionResult: (args) => ({
      admission_id: ADMISSION_ID,
      organization_id: args.p_organization_id,
      student_case_id: CASE_ID,
      document_slot_id: args.p_document_slot_id,
      request_id: args.p_request_id,
      attempt_no: 1,
      admitted_at: "2000-01-01T00:00:00+00:00",
      lease_expires_at: "2000-01-01T00:15:00+00:00",
      request_retry: false,
      scan_allowed: true,
      terminal_replay: false,
      document_version_id: null,
      version_no: null,
      original_filename: null,
      declared_mime_type: null,
      byte_size: null,
    }),
    claimResult: (args) => ({
      admission_id: args.p_admission_id,
      organization_id: args.p_organization_id,
      request_id: args.p_request_id,
      scan_claimed_at: "2099-01-01T00:00:00+00:00",
      claim_checked_at: "2099-01-01T00:00:00+00:00",
      scan_lease_expires_at: "2099-01-01T00:15:00+00:00",
      scan_claim_replay: false,
      scan_allowed: true,
    }),
    scanOutcomes: [
      { result: SCAN_PROOF },
      { result: STORED_SCAN_PROOF },
    ],
  });

  const response = await createStudentPortalDocumentUploadHandler(dependencies)(
    uploadRequest({ browserRequestId: false }),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );

  assert.equal(response.status, 201);
  assert.equal(
    calls.filter(([, name]) => name === "claim_student_document_upload_scan").length,
    1,
  );
  assert.equal(calls.filter(([kind]) => kind === "scan").length, 2);
});

test("Student scan-capacity denial happens after bounded body validation but before ClamAV", async () => {
  const { calls, dependencies } = uploadDependencies({
    claimError: { code: "PT409" },
  });

  const response = await createStudentPortalDocumentUploadHandler(dependencies)(
    uploadRequest({ browserRequestId: false }),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "upload_in_progress" });
  assert.equal(calls.some(([kind]) => kind === "scan"), false);
  assert.equal(
    calls.some(([, name]) =>
      name === "reserve_document_upload_after_ingress_scan"),
    false,
  );
  assert.equal(
    calls.find(([, name]) =>
      name === "complete_student_document_upload_scan_admission")[2].p_outcome,
    "rejected",
  );
});

test("Student upload will not start its first ClamAV scan inside the timeout safety window", async () => {
  const localStart = Date.parse("2026-09-02T07:59:00.000Z");
  let claimReturned = false;
  const { calls, dependencies } = uploadDependencies({
    now() {
      return claimReturned
        ? localStart + (15 * 60 * 1000) - 31_000
        : localStart;
    },
    claimResult: (args) => {
      claimReturned = true;
      return {
        admission_id: args.p_admission_id,
        organization_id: args.p_organization_id,
        request_id: args.p_request_id,
        scan_claimed_at: AT,
        claim_checked_at: AT,
        scan_lease_expires_at: "2026-09-02T08:15:00+00:00",
        scan_claim_replay: false,
        scan_allowed: true,
      };
    },
  });

  const response = await createStudentPortalDocumentUploadHandler(dependencies)(
    uploadRequest({ browserRequestId: false }),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "scan_claim_expired" });
  assert.equal(calls.some(([kind]) => kind === "scan"), false);
  assert.equal(
    calls.some(([, name]) =>
      name === "reserve_document_upload_after_ingress_scan"),
    false,
  );
});

test("replayed Student scan claim preserves only its DB-verified remaining lease", async () => {
  const { calls, dependencies } = uploadDependencies({
    claimResult: (args) => ({
      admission_id: args.p_admission_id,
      organization_id: args.p_organization_id,
      request_id: args.p_request_id,
      scan_claimed_at: "2026-09-02T08:00:00+00:00",
      claim_checked_at: "2026-09-02T08:14:45+00:00",
      scan_lease_expires_at: "2026-09-02T08:15:00+00:00",
      scan_claim_replay: true,
      scan_allowed: true,
    }),
  });

  const response = await createStudentPortalDocumentUploadHandler(dependencies)(
    uploadRequest({ browserRequestId: false }),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "scan_claim_expired" });
  assert.equal(calls.some(([kind]) => kind === "scan"), false);
  assert.equal(
    calls.some(([, name]) =>
      name === "reserve_document_upload_after_ingress_scan"),
    false,
  );
});

test("Student upload will not start its readback ClamAV scan inside the timeout safety window", async () => {
  const localStart = Date.parse("2026-09-02T07:59:00.000Z");
  let firstScanFinished = false;
  const firstOutcome = {
    get result() {
      firstScanFinished = true;
      return SCAN_PROOF;
    },
  };
  const { calls, dependencies } = uploadDependencies({
    now() {
      return firstScanFinished
        ? localStart + (15 * 60 * 1000) - 31_000
        : localStart;
    },
    scanOutcomes: [firstOutcome, { result: STORED_SCAN_PROOF }],
  });

  const response = await createStudentPortalDocumentUploadHandler(dependencies)(
    uploadRequest({ browserRequestId: false }),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "scan_claim_expired" });
  assert.equal(calls.filter(([kind]) => kind === "scan").length, 1);
  assert.equal(
    calls.some(([, name]) => name === "reserve_document_upload_after_ingress_scan"),
    true,
  );
  assert.equal(
    calls.some(([, name]) => name === "finalize_document_upload_with_scan"),
    false,
  );
});

test("Student upload rejects foreign admission before reading the request body", async () => {
  let bodyReaderRequested = false;
  const { calls, dependencies } = uploadDependencies({
    admissionError: { code: "42501" },
  });
  const request = {
    headers: new Headers({
      "content-type": "multipart/form-data; boundary=evo-test",
      "idempotency-key": REQUEST_IDS[0],
    }),
    body: {
      getReader() {
        bodyReaderRequested = true;
        throw new Error("foreign body must stay unread");
      },
    },
  };

  const response = await createStudentPortalDocumentUploadHandler(dependencies)(
    request,
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );
  assert.equal(response.status, 403);
  assert.equal(bodyReaderRequested, false);
  assert.deepEqual(
    calls.map(([kind, name]) => name ? `${kind}:${name}` : kind),
    ["create-user-client", "user-rpc:admit_student_document_upload_scan"],
  );
});

test("Student upload whose lease expires during body read never reaches preflight or ClamAV", async () => {
  let clockRead = 0;
  const localStart = Date.parse("2026-09-02T07:59:00.000Z");
  const { calls, dependencies } = uploadDependencies({
    now() {
      clockRead += 1;
      return clockRead <= 2
        ? localStart
        : localStart + (15 * 60 * 1000);
    },
  });

  const response = await createStudentPortalDocumentUploadHandler(dependencies)(
    uploadRequest({ browserRequestId: false }),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "scan_admission_expired" });
  assert.equal(calls.some(([kind]) => kind === "scan"), false);
  assert.equal(
    calls.some(([, name]) => name === "preflight_document_upload"),
    false,
  );
  assert.equal(
    calls.find(([, name]) =>
      name === "complete_student_document_upload_scan_admission")[2].p_outcome,
    "rejected",
  );
});

test("Student upload clears its lease timer when the request stream rejects", async () => {
  const timerHandle = Object.freeze({ kind: "fake-lease-timer" });
  const scheduled = [];
  const cleared = [];
  const { calls, dependencies } = uploadDependencies({
    scheduleTimeout(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return timerHandle;
    },
    clearScheduledTimeout(handle) {
      cleared.push(handle);
    },
  });
  const request = {
    headers: new Headers({
      "content-type": "multipart/form-data; boundary=evo-reject",
      "idempotency-key": REQUEST_IDS[0],
    }),
    body: {
      getReader() {
        return {
          read() {
            return Promise.reject(new Error("client disconnected"));
          },
          cancel() {
            return Promise.resolve();
          },
          releaseLock() {},
        };
      },
    },
  };

  const response = await createStudentPortalDocumentUploadHandler(dependencies)(
    request,
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_multipart" });
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 15 * 60 * 1000);
  assert.deepEqual(cleared, [timerHandle]);
  assert.equal(calls.some(([kind]) => kind === "scan"), false);
});

test("lost Student 201 replays the durable receipt without reading or scanning again", async () => {
  let admissionCall = 0;
  let replayBodyReaderRequested = false;
  const { calls, dependencies } = uploadDependencies({
    admissionResult(args) {
      admissionCall += 1;
      return {
        admission_id: ADMISSION_ID,
        organization_id: args.p_organization_id,
        student_case_id: CASE_ID,
        document_slot_id: args.p_document_slot_id,
        request_id: args.p_request_id,
        attempt_no: 1,
        admitted_at: AT,
        lease_expires_at: "2026-09-02T08:15:00+00:00",
        request_retry: admissionCall > 1,
        scan_allowed: admissionCall === 1,
        terminal_replay: admissionCall > 1,
        document_version_id: admissionCall > 1 ? VERSION_ID : null,
        version_no: admissionCall > 1 ? 1 : null,
        original_filename: admissionCall > 1 ? "proof.pdf" : null,
        declared_mime_type: admissionCall > 1 ? "application/pdf" : null,
        byte_size: admissionCall > 1 ? BYTES.byteLength : null,
      };
    },
    scanOutcomes: [
      { result: SCAN_PROOF },
      { result: STORED_SCAN_PROOF },
    ],
  });
  const handler = createStudentPortalDocumentUploadHandler(dependencies);
  const first = await handler(
    uploadRequest({ browserRequestId: false }),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );
  assert.equal(first.status, 201);
  const firstBody = await first.json();

  const replayRequest = {
    headers: new Headers({
      "content-type": "multipart/form-data; boundary=evo-replay",
      "idempotency-key": REQUEST_IDS[0],
    }),
    body: {
      getReader() {
        replayBodyReaderRequested = true;
        throw new Error("terminal replay body must stay unread");
      },
    },
  };
  const replay = await handler(replayRequest, {
    params: Promise.resolve({ documentSlotId: SLOT_ID }),
  });
  assert.equal(replay.status, 201);
  assert.deepEqual(await replay.json(), firstBody);
  assert.equal(replayBodyReaderRequested, false);
  assert.equal(
    calls.filter(([, name]) => name === "admit_student_document_upload_scan").length,
    2,
  );
  assert.equal(calls.filter(([kind]) => kind === "scan").length, 2);
  assert.equal(
    calls.filter(([, name]) => name === "preflight_document_upload").length,
    1,
  );
  assert.equal(
    calls.filter(([, name]) => name === "claim_student_document_upload_scan").length,
    1,
  );
  assert.equal(
    calls.filter(([, name]) =>
      name === "reserve_document_upload_after_ingress_scan").length,
    1,
  );
  assert.equal(
    calls.filter(([, name]) => name === "finalize_document_upload_with_scan").length,
    1,
  );
  assert.equal(
    calls.filter(([, name]) =>
      name === "complete_student_document_upload_scan_admission").length,
    1,
  );
});

test("Student download uses its own audit purpose and a no-store 302", async () => {
  const { calls, dependencies } = downloadDependencies();
  const response = await createStudentPortalDocumentDownloadHandler(dependencies)(
    new Request("http://app.test/api/portal/document-versions/x/download"),
    { params: Promise.resolve({ versionId: VERSION_ID }) },
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(
    response.headers.get("location"),
    /^http:\/\/127\.0\.0\.1:54321\/storage\/v1\/object\/sign\/platform-documents\//u,
  );
  assert.deepEqual(
    calls.find(([, name]) => name === "grant_student_portal_document_download").slice(1),
    [
      "grant_student_portal_document_download",
      {
        p_organization_id: ORGANIZATION_ID,
        p_document_version_id: VERSION_ID,
        p_request_id: REQUEST_IDS[0],
      },
    ],
  );
  assert.equal(
    calls.some(([, name]) =>
      name === "consume_student_portal_document_download_grant"),
    true,
  );
  assert.equal(calls.at(-1)[3], 60);
});

test("private document upload transport keeps the exact 6 MiB and 25 MiB boundaries", () => {
  const sixMiB = 6 * 1024 * 1024;
  const twentyFiveMiB = 25 * 1024 * 1024;

  assert.equal(selectPrivateDocumentUploadTransport(sixMiB), "standard");
  assert.equal(selectPrivateDocumentUploadTransport(sixMiB + 1), "resumable");
  assert.equal(selectPrivateDocumentUploadTransport(twentyFiveMiB), "resumable");
  assert.equal(selectPrivateDocumentUploadTransport(twentyFiveMiB + 1), null);
});

test("Student upload above 6 MiB uses TUS then the same readback, second scan and finalize proof", async () => {
  const bytes = new Uint8Array(6 * 1024 * 1024 + 1);
  bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ingressProof = Object.freeze({ ...SCAN_PROOF, sha256Hex: sha256 });
  const storedProof = Object.freeze({ ...STORED_SCAN_PROOF, sha256Hex: sha256 });
  let offset = 0;
  const { calls, dependencies } = uploadDependencies({
    preflightResult: {
      organization_id: ORGANIZATION_ID,
      student_case_id: CASE_ID,
      document_slot_id: SLOT_ID,
      request_id: REQUEST_IDS[0],
      upload_allowed: true,
      reservation_replay: false,
    },
    reserveResult: reservation({
      byte_size: bytes.byteLength,
      sha256_hex: sha256,
    }),
    finalizeResult: finalization({
      evidence_ref: `sha256:${sha256}`,
      scanned_sha256_hex: sha256,
    }),
    storedBytes: bytes,
    storedMimeType: "application/pdf",
    scanOutcomes: [
      { result: ingressProof },
      { result: storedProof },
    ],
    async fetchImpl(input, init) {
      if (init.method === "POST") {
        assert.equal(
          input.toString(),
          "http://127.0.0.1:54321/storage/v1/upload/resumable",
        );
        assert.equal(init.headers["Upload-Length"], String(bytes.byteLength));
        return new Response(null, {
          status: 201,
          headers: {
            location:
              "/storage/v1/upload/resumable/58012800-0000-4000-8000-000000000080",
          },
        });
      }
      assert.equal(init.method, "PATCH");
      assert.equal(Number(init.headers["Upload-Offset"]), offset);
      assert.ok(init.body instanceof Uint8Array);
      offset += init.body.byteLength;
      return new Response(null, {
        status: 204,
        headers: { "upload-offset": String(offset) },
      });
    },
  });

  const response = await createStudentPortalDocumentUploadHandler(dependencies)(
    uploadRequest({ browserRequestId: false, bytes }),
    { params: Promise.resolve({ documentSlotId: SLOT_ID }) },
  );

  assert.equal(response.status, 201);
  assert.equal((await response.json()).document.byteSize, bytes.byteLength);
  assert.equal(offset, bytes.byteLength);
  assert.equal(calls.filter(([kind]) => kind === "service-upload").length, 0);
  assert.equal(
    calls.filter(([kind, , init]) => kind === "tus-fetch" && init.method === "POST")
      .length,
    1,
  );
  const patches = calls.filter(([, , init]) => init?.method === "PATCH");
  assert.deepEqual(
    patches.map(([, , init]) => init.body.byteLength),
    [6 * 1024 * 1024, 1],
  );
  assert.equal(calls.filter(([kind]) => kind === "service-download").length, 1);
  assert.equal(calls.filter(([kind]) => kind === "scan").length, 2);
  assert.equal(
    calls.some(([, name]) => name === "finalize_document_upload_with_scan"),
    true,
  );
});

test("Student current-version authority is enforced in one database grant transaction", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/128_platform_student_document_download.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /CREATE FUNCTION platform\.grant_student_portal_document_download/u);
  assert.match(migration, /CREATE FUNCTION platform\.consume_student_portal_document_download_grant/u);
  assert.match(migration, /actor\.actor_role IS DISTINCT FROM 'student'/u);
  assert.match(migration, /slot\.current_version_id = version\.id/u);
  assert.match(migration, /version\.integrity_status = 'verified'/u);
  assert.match(migration, /version\.malware_status = 'clean'/u);
  assert.match(migration, /document_upload_finalizations/u);
  assert.match(migration, /private\.grant_document_download_pre_e5\(/u);
  assert.match(migration, /private\.consume_document_download_grant_pre_e5\(/u);
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO authenticated/u);
});

test("Student authorization returns only the minimal route actor and fails unavailable authority closed", async () => {
  const studentActor = {
    ...ACTOR,
    studentCaseId: CASE_ID,
    databaseRole: "student",
    caseState: "active",
    portalActivatedAt: AT,
  };
  const authorize = createStudentDocumentAuthorizationFactory(async () => ({
    status: "authenticated",
    actor: studentActor,
  }));
  assert.deepEqual(await authorize("write"), {
    status: "authorized",
    actor: {
      authUserId: ACTOR.authUserId,
      organizationId: ORGANIZATION_ID,
    },
  });

  const invalid = createStudentDocumentAuthorizationFactory(async () => ({
    status: "invalid",
    actor: null,
    reason: "student_authority_invalid",
  }));
  assert.deepEqual(await invalid("read"), {
    status: "anonymous",
    actor: null,
  });

  const unavailable = createStudentDocumentAuthorizationFactory(async () => ({
    status: "invalid",
    actor: null,
    reason: "student_authority_unavailable",
  }));
  assert.deepEqual(await unavailable("read"), {
    status: "unavailable",
    actor: null,
  });
});

test("Student handlers stop anonymous, revoked and unavailable authority before Supabase", async () => {
  const cases = [
    {
      result: { status: "anonymous", actor: null },
      expectedStatus: 401,
      expectedError: "authentication_required",
    },
    {
      result: {
        status: "invalid",
        actor: null,
        reason: "student_authority_invalid",
      },
      expectedStatus: 401,
      expectedError: "authentication_required",
    },
    {
      result: {
        status: "invalid",
        actor: null,
        reason: "student_authority_unavailable",
      },
      expectedStatus: 503,
      expectedError: "platform_unavailable",
    },
  ];

  for (const { result, expectedStatus, expectedError } of cases) {
    const authorize = createStudentDocumentAuthorizationFactory(async () => result);
    const upload = uploadDependencies();
    const uploadResponse = await createStudentPortalDocumentUploadHandler({
      ...upload.dependencies,
      authorize,
    })(uploadRequest({ browserRequestId: false }), {
      params: Promise.resolve({ documentSlotId: SLOT_ID }),
    });
    assert.equal(uploadResponse.status, expectedStatus);
    assert.deepEqual(await uploadResponse.json(), { error: expectedError });
    assert.equal(upload.calls.length, 0);

    const download = downloadDependencies();
    const downloadResponse = await createStudentPortalDocumentDownloadHandler({
      ...download.dependencies,
      authorize,
    })(new Request("http://app.test/download"), {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    assert.equal(downloadResponse.status, expectedStatus);
    assert.deepEqual(await downloadResponse.json(), { error: expectedError });
    assert.equal(download.calls.length, 0);
  }
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

test("download binds service consumption to the authorized org and requested version", async () => {
  for (const consumptionResult of [
    consumption({ organization_id: "00000000-0000-4000-8000-000000000099" }),
    consumption({ document_version_id: "00000000-0000-4000-8000-000000000098" }),
  ]) {
    const { calls, dependencies } = downloadDependencies({ consumptionResult });
    const response = await createPlatformDocumentDownloadHandler(dependencies)(
      new Request("http://app.test/download"),
      { params: Promise.resolve({ versionId: VERSION_ID }) },
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("location"), null);
    assert.equal(calls.some(([kind]) => kind === "sign"), false);
  }
});

test("download rejects same-origin signed URLs for a different object or with URL credentials/hash", async () => {
  const signedUrls = [
    "http://127.0.0.1:54321/storage/v1/object/sign/platform-documents/ff/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff?token=x",
    `http://user:pass@127.0.0.1:54321/storage/v1/object/sign/platform-documents/${OBJECT_NAME}?token=x`,
    `http://127.0.0.1:54321/storage/v1/object/sign/platform-documents/${OBJECT_NAME}?token=x#fragment`,
  ];
  for (const signedUrl of signedUrls) {
    const { dependencies } = downloadDependencies({ signedUrl });
    const response = await createPlatformDocumentDownloadHandler(dependencies)(
      new Request("http://app.test/download"),
      { params: Promise.resolve({ versionId: VERSION_ID }) },
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("location"), null);
  }
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
    readFileSync(
      new URL(
        "../src/app/api/portal/document-slots/[documentSlotId]/versions/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFileSync(
      new URL(
        "../src/app/api/portal/document-versions/[versionId]/download/route.ts",
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
  assert.match(source, /createStudentPortalDocumentUploadHandler/u);
  assert.match(source, /createStudentPortalDocumentDownloadHandler/u);
  assert.match(source, /student_document_download/u);
  assert.match(source, /"Cache-Control": "no-store"/u);
});
