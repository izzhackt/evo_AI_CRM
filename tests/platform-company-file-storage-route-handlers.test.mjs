import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import {
  createPlatformCompanyFileDownloadHandler,
  createPlatformCompanyFileUploadHandler,
} from "../src/lib/server/platform-company-file-storage-route-handlers.ts";
import { ClamdScanError } from "../src/lib/server/clamd-malware-scanner.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const RESERVATION_ID = "44444444-4444-4444-8444-444444444444";
const FINALIZATION_ID = "55555555-5555-4555-8555-555555555555";
const SCAN_ATTESTATION_ID = "55555555-aaaa-4555-8555-555555555555";
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
const SCAN_PROOF = Object.freeze({
  engine: "ClamAV",
  engineVersion: "1.5.4",
  signatureVersion: "27890",
  protocol: "clamd-zinstream-v1",
  scannedAt: "2026-09-04T10:00:00.000Z",
  sha256Hex: SHA256,
});

const OOXML_FAMILIES = Object.freeze({
  docx: Object.freeze({
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    mainPath: "word/document.xml",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    root: "w:document",
    namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  }),
  xlsx: Object.freeze({
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    mainPath: "xl/workbook.xml",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    root: "workbook",
    namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  }),
  pptx: Object.freeze({
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    mainPath: "ppt/presentation.xml",
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    root: "p:presentation",
    namespace: "http://schemas.openxmlformats.org/presentationml/2006/main",
  }),
});

function testCrc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function makeStandardZip(entries) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const contents = Buffer.from(entry.contents, "utf8");
    const method = entry.method ?? 8;
    const flags = (entry.flags ?? 0x0800) | (entry.dataDescriptor ? 0x0008 : 0);
    const compressed = method === 8 ? deflateRawSync(contents) : contents;
    const checksum = testCrc32(contents);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    if (!entry.dataDescriptor) {
      local.writeUInt32LE(checksum, 14);
      local.writeUInt32LE(compressed.byteLength, 18);
      local.writeUInt32LE(contents.byteLength, 22);
    }
    local.writeUInt16LE(name.byteLength, 26);
    const descriptor = entry.dataDescriptor ? Buffer.alloc(16) : Buffer.alloc(0);
    if (entry.dataDescriptor) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(checksum, 4);
      descriptor.writeUInt32LE(compressed.byteLength, 8);
      descriptor.writeUInt32LE(contents.byteLength, 12);
    }
    localRecords.push(local, name, compressed, descriptor);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.byteLength, 20);
    central.writeUInt32LE(contents.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(localOffset, 42);
    centralRecords.push(central, name);
    localOffset += local.byteLength + name.byteLength + compressed.byteLength + descriptor.byteLength;
  }

  const centralOffset = localOffset;
  const centralSize = centralRecords.reduce((sum, record) => sum + record.byteLength, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return new Uint8Array(Buffer.concat([...localRecords, ...centralRecords, eocd]));
}

function makeOoxml(familyName, extraEntries = [], { defaultMainContentType = false } = {}) {
  const family = OOXML_FAMILIES[familyName];
  const mainTypeDeclaration = defaultMainContentType
    ? `<Default Extension="xml" ContentType="${family.contentType}"/>`
    : `<Override ContentType="${family.contentType}" PartName="/${family.mainPath}"/>`;
  return makeStandardZip([
    {
      name: "[Content_Types].xml",
      contents:
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default ContentType="application/vnd.openxmlformats-package.relationships+xml" Extension="rels"/>${mainTypeDeclaration}</Types>`,
      method: 0,
    },
    {
      name: "_rels/.rels",
      contents:
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="${family.mainPath}" Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/></Relationships>`,
      dataDescriptor: true,
    },
    {
      name: family.mainPath,
      contents: `<?xml version="1.0"?><${family.root} xmlns${family.root.includes(":") ? `:${family.root.split(":")[0]}` : ""}="${family.namespace}"></${family.root}>`,
    },
    ...extraEntries,
  ]);
}

function officeReservation(familyName, bytes) {
  return reservation({
    declared_mime_type: OOXML_FAMILIES[familyName].mime,
    byte_size: bytes.byteLength,
    sha256_hex: createHash("sha256").update(bytes).digest("hex"),
  });
}

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
    malware_scan_attestation_id: SCAN_ATTESTATION_ID,
    scanner_engine: SCAN_PROOF.engine,
    scanner_engine_version: SCAN_PROOF.engineVersion,
    scanner_signature_version: SCAN_PROOF.signatureVersion,
    scanner_protocol: SCAN_PROOF.protocol,
    scanned_sha256_hex: SHA256,
    scanned_at: AT,
    scanner_proof: true,
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
  preflightValue = {
    organization_id: ORGANIZATION_ID,
    company_file_id: FILE_ID,
    request_id: REQUEST_IDS[0],
    upload_allowed: true,
    reservation_replay: false,
  },
  preflightError = null,
  reservationValue = reservation(),
  finalizationValue = null,
  reservationError = null,
  finalizationError = null,
  uploadError = null,
  downloadError = null,
  storedBytes = null,
  storedMimeType = null,
  scanResult = null,
  scanError = null,
} = {}) {
  const calls = [];
  let persistedBytes = storedBytes;
  let persistedMimeType = storedMimeType;
  const userClient = {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, args) {
          calls.push(["user-rpc", name, args]);
          if (name === "preflight_company_file_upload") {
            return { data: preflightValue, error: preflightError };
          }
          return { data: reservationValue, error: reservationError };
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
          return {
            data: finalizationValue ?? finalization({
              scanned_sha256_hex: reservationValue.sha256_hex,
            }),
            error: finalizationError,
          };
        },
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "platform-company-files");
        return {
          async upload(objectName, bytes, options) {
            calls.push(["service-upload", objectName, bytes, options]);
            if (!uploadError && persistedBytes === null) {
              persistedBytes = new Uint8Array(bytes);
              persistedMimeType = options.contentType;
            }
            return { data: uploadError ? null : { path: objectName }, error: uploadError };
          },
          async download(objectName) {
            calls.push(["service-download", objectName]);
            return {
              data: downloadError
                ? null
                : new Blob([persistedBytes ?? BYTES], {
                  type: persistedMimeType ?? reservationValue.declared_mime_type,
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
      async authorize(capability) {
        calls.push(["authorize", capability]);
        return authorization;
      },
      async createUserClient() { return userClient; },
      createServiceClient() { return serviceClient; },
      async scanFile(bytes) {
        calls.push(["scan", bytes]);
        if (scanError) throw scanError;
        return scanResult ?? {
          ...SCAN_PROOF,
          sha256Hex: createHash("sha256").update(bytes).digest("hex"),
        };
      },
      supabaseOrigin() { return "http://127.0.0.1:54321"; },
      requestId: sequence(REQUEST_IDS),
    },
  };
}

test("authorized company upload service-writes, reads back and finalizes exact bytes", async () => {
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
  const preflightCall = calls.find(([, name]) => name === "preflight_company_file_upload");
  const reserveCall = calls.find(([, name]) => name === "reserve_company_file_upload");
  assert.ok(calls.indexOf(preflightCall) < calls.findIndex(([kind]) => kind === "scan"));
  assert.equal(calls.filter(([kind]) => kind === "scan").length, 2);
  assert.equal(calls.filter(([kind]) => kind === "service-download").length, 1);
  assert.deepEqual(preflightCall.slice(1), [
    "preflight_company_file_upload",
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
  assert.deepEqual(reserveCall.slice(1), [
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
  assert.equal(calls.find(([kind]) => kind === "service-upload")[3].upsert, false);
  assert.equal(
    calls.find(([kind]) => kind === "service-rpc")[1],
    "finalize_company_file_upload",
  );
  const finalizationArgs = calls.find(([kind]) => kind === "service-rpc")[2];
  const { p_request_id: finalizationRequestId, ...scanBoundArgs } = finalizationArgs;
  assert.match(finalizationRequestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    scanBoundArgs,
    {
      p_organization_id: ORGANIZATION_ID,
      p_upload_reservation_id: RESERVATION_ID,
      p_scanner_engine: "ClamAV",
      p_scanner_engine_version: "1.5.4",
      p_scanner_signature_version: "27890",
      p_scanner_protocol: "clamd-zinstream-v1",
      p_scanned_sha256_hex: SHA256,
      p_scanned_at: SCAN_PROOF.scannedAt,
    },
  );
});

test("company upload rejects malware and scanner failure before reservation", async () => {
  for (const item of [
    { error: new ClamdScanError("infected"), status: 422, code: "malware_detected" },
    { error: new ClamdScanError("timeout"), status: 503, code: "malware_scanner_unavailable" },
  ]) {
    const result = uploadDependencies({ scanError: item.error });
    const response = await createPlatformCompanyFileUploadHandler(result.dependencies)(
      uploadRequest(),
      { params: Promise.resolve({ companyFileId: FILE_ID }) },
    );
    assert.equal(response.status, item.status);
    assert.deepEqual(await response.json(), { error: item.code });
    assert.deepEqual(
      result.calls.filter(([kind]) => kind === "user-rpc").map(([, name]) => name),
      ["preflight_company_file_upload"],
    );
    assert.equal(result.calls.some(([, name]) => name === "reserve_company_file_upload"), false);
    assert.equal(result.calls.some(([kind]) => kind === "service-upload"), false);
  }

  const mismatch = uploadDependencies({
    scanResult: { ...SCAN_PROOF, sha256Hex: "0".repeat(64) },
  });
  const response = await createPlatformCompanyFileUploadHandler(mismatch.dependencies)(
    uploadRequest(),
    { params: Promise.resolve({ companyFileId: FILE_ID }) },
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "malware_scan_unconfirmed" });
  assert.deepEqual(
    mismatch.calls.filter(([kind]) => kind === "user-rpc").map(([, name]) => name),
    ["preflight_company_file_upload"],
  );
});

test("company upload rejects cross-tenant preflight before scanning or writes", async () => {
  const result = uploadDependencies({ preflightError: { code: "42501" } });
  const response = await createPlatformCompanyFileUploadHandler(result.dependencies)(
    uploadRequest(),
    { params: Promise.resolve({ companyFileId: FILE_ID }) },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "upload_not_authorized" });
  assert.deepEqual(
    result.calls.filter(([kind]) => kind === "user-rpc").map(([, name]) => name),
    ["preflight_company_file_upload"],
  );
  assert.equal(
    result.calls.some(([kind]) => kind === "scan" || kind === "service-upload"),
    false,
  );
});

test("same-size company stored-object substitution fails before finalization or proof", async () => {
  const substituted = new Uint8Array(BYTES);
  substituted[substituted.byteLength - 1] ^= 1;
  const result = uploadDependencies({
    reservationValue: reservation({ storage_object_present: true }),
    storedBytes: substituted,
  });
  const response = await createPlatformCompanyFileUploadHandler(result.dependencies)(
    uploadRequest(),
    { params: Promise.resolve({ companyFileId: FILE_ID }) },
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "storage_object_mismatch" });
  assert.equal(result.calls.some(([kind]) => kind === "service-upload"), false);
  assert.equal(result.calls.filter(([kind]) => kind === "scan").length, 1);
  assert.equal(result.calls.some(([kind]) => kind === "service-rpc"), false);
});

test("company lost-response replay accepts the durable original scan facts", async () => {
  const result = uploadDependencies({
    reservationValue: reservation({ storage_object_present: true }),
    finalizationValue: finalization({
      scanner_engine_version: "1.5.3",
      scanner_signature_version: "27889",
      scanned_at: "2026-09-01T07:00:00+00:00",
    }),
  });
  const response = await createPlatformCompanyFileUploadHandler(result.dependencies)(
    uploadRequest(),
    { params: Promise.resolve({ companyFileId: FILE_ID }) },
  );

  assert.equal(response.status, 201);
  assert.equal(result.calls.filter(([kind]) => kind === "scan").length, 2);
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

  result = uploadDependencies();
  response = await createPlatformCompanyFileUploadHandler(result.dependencies)(
    uploadRequest(),
    { params: Promise.resolve({ companyFileId: "not-a-uuid" }) },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_company_file" });
  assert.deepEqual(result.calls, [["authorize", "documents.write"]]);
});

test("company upload accepts bounded, structurally valid DOCX, XLSX and PPTX packages", async () => {
  for (const familyName of Object.keys(OOXML_FAMILIES)) {
    const bytes = makeOoxml(familyName);
    const family = OOXML_FAMILIES[familyName];
    const result = uploadDependencies({ reservationValue: officeReservation(familyName, bytes) });
    const response = await createPlatformCompanyFileUploadHandler(result.dependencies)(
      uploadRequest({ bytes, type: family.mime, name: `rules.${familyName}` }),
      { params: Promise.resolve({ companyFileId: FILE_ID }) },
    );
    assert.equal(response.status, 201, familyName);
  }
});

test("company upload accepts the ECMA minimal Default declaration for a DOCX main part", async () => {
  const bytes = makeOoxml("docx", [], { defaultMainContentType: true });
  const result = uploadDependencies({ reservationValue: officeReservation("docx", bytes) });
  const response = await createPlatformCompanyFileUploadHandler(result.dependencies)(
    uploadRequest({ bytes, type: OOXML_FAMILIES.docx.mime, name: "minimal.docx" }),
    { params: Promise.resolve({ companyFileId: FILE_ID }) },
  );
  assert.equal(response.status, 201);
});

test("company upload rejects arbitrary, wrong-family, malformed and unsafe OOXML ZIPs", async () => {
  const rejected = [
    {
      label: "arbitrary ZIP",
      familyName: "docx",
      bytes: makeStandardZip([{ name: "hello.txt", contents: "not OOXML" }]),
    },
    {
      label: "wrong OOXML family",
      familyName: "xlsx",
      bytes: makeOoxml("docx"),
    },
    {
      label: "truncated central directory",
      familyName: "pptx",
      bytes: makeOoxml("pptx").subarray(0, makeOoxml("pptx").byteLength - 1),
    },
    {
      label: "traversal entry",
      familyName: "docx",
      bytes: makeOoxml("docx", [{ name: "../escape.xml", contents: "<escape/>" }]),
    },
    {
      label: "encrypted entry",
      familyName: "docx",
      bytes: makeOoxml("docx", [{ name: "custom.xml", contents: "<x/>", flags: 0x0801 }]),
    },
  ];

  for (const item of rejected) {
    const family = OOXML_FAMILIES[item.familyName];
    const result = uploadDependencies({
      reservationValue: officeReservation(item.familyName, item.bytes),
    });
    const response = await createPlatformCompanyFileUploadHandler(result.dependencies)(
      uploadRequest({
        bytes: item.bytes,
        type: family.mime,
        name: `unsafe.${item.familyName}`,
      }),
      { params: Promise.resolve({ companyFileId: FILE_ID }) },
    );
    assert.equal(response.status, 400, item.label);
    assert.deepEqual(await response.json(), { error: "file_signature_mismatch" }, item.label);
    assert.equal(result.calls.some(([kind]) => kind === "user-rpc"), false, item.label);
  }
});

test("company upload rejects extension mismatch before reservation", async () => {
  const result = uploadDependencies();
  const response = await createPlatformCompanyFileUploadHandler(result.dependencies)(
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
  assert.equal(result.calls.some(([kind]) => kind === "service-upload"), false);

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
