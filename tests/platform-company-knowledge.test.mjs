import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  listPlatformCompanyKnowledgeFiles,
  listPlatformCompanyKnowledgeFolders,
  PlatformCompanyKnowledgeRepositoryError,
} from "../src/lib/platform-company-knowledge.ts";
import {
  createPlatformCompanyKnowledgeDownloadHandler,
  createPlatformCompanyKnowledgeUploadHandler,
} from "../src/lib/server/platform-company-knowledge-storage-route-handlers.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const FOLDER = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";
const RESERVATION = "55555555-5555-4555-8555-555555555555";
const GRANT = "66666666-6666-4666-8666-666666666666";
const REQUEST = "77777777-7777-4777-8777-777777777777";
const OBJECT = `ab/${"c".repeat(62)}`;
const AT = "2099-09-04T12:00:00.000Z";
const BYTES = new TextEncoder().encode("%PDF-1.7\ncompany knowledge proof");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const ACTOR = Object.freeze({
  authUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  membershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  organizationId: ORG,
  displayName: "Admissions",
  email: "admissions@example.test",
  platformRole: "admissions",
  authorityRole: "admissions",
  presentationRole: "admissions",
  platformAccessVersion: 1,
  platformBundleId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  platformBundleVersion: 1,
});

function rpcClient(responses, calls = []) {
  return {
    schema(schema) {
      assert.equal(schema, "platform");
      return {
        async rpc(name, args, options) {
          calls.push({ name, args, options });
          return responses[name];
        },
      };
    },
  };
}

test("company knowledge repository strictly normalizes canonical folder and file lists", async () => {
  const calls = [];
  const client = rpcClient({
    list_company_knowledge_folders: { data: [{
      organization_id: ORG, folder_id: FOLDER, parent_folder_id: null,
      name: "Договоры", version: 1, created_at: AT, updated_at: AT,
    }], error: null },
    list_company_knowledge_files: { data: [{
      organization_id: ORG, file_id: FILE, folder_id: FOLDER,
      name: "Партнерство.pdf", version: 2, current_file_version_id: VERSION,
      current_version_no: 1, content_type: "application/pdf", byte_size: BYTES.byteLength,
      sha256_hex: SHA, created_at: AT, updated_at: AT, current_version_created_at: AT,
    }], error: null },
  }, calls);
  const folders = await listPlatformCompanyKnowledgeFolders(ACTOR, { client });
  const files = await listPlatformCompanyKnowledgeFiles(ACTOR, { client });
  assert.deepEqual(folders[0], {
    organizationId: ORG, folderId: FOLDER, parentFolderId: null,
    name: "Договоры", version: 1, createdAt: AT, updatedAt: AT,
  });
  assert.equal(files[0].fileId, FILE);
  assert.equal(files[0].currentFileVersionId, VERSION);
  assert.equal(files[0].sha256Hex, SHA);
  assert.deepEqual(calls.map(({ name, args, options }) => ({ name, args, options })), [
    { name: "list_company_knowledge_folders", args: {}, options: { get: true } },
    { name: "list_company_knowledge_files", args: {}, options: { get: true } },
  ]);
});

test("company knowledge repository fails closed on role, organization and response drift", async () => {
  await assert.rejects(
    listPlatformCompanyKnowledgeFolders({ ...ACTOR, platformRole: "sales", authorityRole: "sales" }, {
      client: rpcClient({ list_company_knowledge_folders: { data: [], error: null } }),
    }),
    PlatformCompanyKnowledgeRepositoryError,
  );
  await assert.rejects(
    listPlatformCompanyKnowledgeFolders(ACTOR, { client: rpcClient({
      list_company_knowledge_folders: { data: [{
        organization_id: "99999999-9999-4999-8999-999999999999",
        folder_id: FOLDER, parent_folder_id: null, name: "x", version: 1,
        created_at: AT, updated_at: AT,
      }], error: null },
    }) }),
    PlatformCompanyKnowledgeRepositoryError,
  );
});

function uploadReservation(overrides = {}) {
  return {
    organization_id: ORG, reservation_id: RESERVATION, file_id: FILE,
    folder_id: FOLDER, file_name: "proof.pdf", expected_version: null,
    bucket_id: "platform-knowledge-files", object_name: OBJECT,
    content_type: "application/pdf", byte_size: BYTES.byteLength,
    sha256_hex: SHA, expires_at: AT, created_at: AT, ...overrides,
  };
}
function finalization(overrides = {}) {
  return {
    organization_id: ORG, reservation_id: RESERVATION, file_id: FILE,
    folder_id: FOLDER, file_name: "proof.pdf", version: 1,
    file_version_id: VERSION, file_version_no: 1,
    bucket_id: "platform-knowledge-files", object_name: OBJECT,
    content_type: "application/pdf", byte_size: BYTES.byteLength,
    sha256_hex: SHA, finalized_at: AT, ...overrides,
  };
}
function uploadRequest(bytes = BYTES, type = "application/pdf") {
  const form = new FormData();
  form.set("file", new File([bytes], "proof.pdf", { type }));
  form.set("folder_id", FOLDER);
  form.set("file_id", "");
  form.set("expected_version", "");
  form.set("request_id", REQUEST);
  return new Request("http://localhost/api/v3/knowledge/files", { method: "POST", body: form });
}

test("upload reserves metadata, writes fixed private bucket and finalizes exact bytes", async () => {
  const calls = [];
  const user = rpcClient({
    reserve_company_knowledge_file_upload: { data: uploadReservation(), error: null },
  }, calls);
  const service = {
    ...rpcClient({
      finalize_company_knowledge_file_upload: { data: finalization(), error: null },
    }, calls),
    storage: {
      from(bucket) {
        assert.equal(bucket, "platform-knowledge-files");
        return { async upload(path, bytes, options) {
          assert.equal(path, OBJECT);
          assert.equal(createHash("sha256").update(bytes).digest("hex"), SHA);
          assert.deepEqual(options, {
            contentType: "application/pdf",
            cacheControl: "0",
            upsert: false,
            metadata: { sha256: SHA },
          });
          return { data: { path }, error: null };
        } };
      },
    },
  };
  const response = await createPlatformCompanyKnowledgeUploadHandler({
    authorize: async (capability) => {
      assert.equal(capability, "documents.write");
      return { status: "authorized", actor: ACTOR };
    },
    createUserClient: async () => user,
    createServiceClient: () => service,
    supabaseOrigin: () => "http://localhost:54321",
    randomUuid: () => FILE,
  })(uploadRequest());
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.file.fileId, FILE);
  assert.equal(body.file.fileVersionId, VERSION);
  assert.equal(body.file.sha256Hex, SHA);
  assert.deepEqual(calls.map(({ name, args }) => ({ name, args })), [
    { name: "reserve_company_knowledge_file_upload", args: {
      p_folder_id: FOLDER, p_file_id: FILE, p_file_name: "proof.pdf",
      p_content_type: "application/pdf", p_byte_size: BYTES.byteLength,
      p_sha256: SHA, p_request_id: REQUEST, p_expected_version: null,
    } },
    { name: "finalize_company_knowledge_file_upload", args: { p_reservation_id: RESERVATION } },
  ]);
});

test("upload rejects signature mismatch before creating any Supabase client", async () => {
  let created = false;
  const response = await createPlatformCompanyKnowledgeUploadHandler({
    authorize: async () => ({ status: "authorized", actor: ACTOR }),
    createUserClient: async () => { created = true; throw new Error("must not run"); },
    createServiceClient: () => { throw new Error("must not run"); },
    supabaseOrigin: () => "http://localhost:54321",
    randomUuid: () => FILE,
  })(uploadRequest(new TextEncoder().encode("not a PDF")));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "file_signature_mismatch" });
  assert.equal(created, false);
});

function grant(overrides = {}) {
  return {
    organization_id: ORG, grant_id: GRANT, file_id: FILE, file_version_id: VERSION,
    bucket_id: "platform-knowledge-files", object_name: OBJECT, file_name: "proof.pdf",
    content_type: "application/pdf", byte_size: BYTES.byteLength, sha256_hex: SHA,
    expires_at: AT, created_at: "2026-09-04T12:00:00.000Z", ...overrides,
  };
}

test("download consumes one grant and signs only the exact private object for at most 60 seconds", async () => {
  const consumedGrant = Object.fromEntries(
    Object.entries(grant()).filter(([key]) => key !== "created_at"),
  );
  const user = rpcClient({
    grant_company_knowledge_file_download: { data: grant(), error: null },
  });
  const service = {
    ...rpcClient({
      consume_company_knowledge_file_download_grant: {
        data: { ...consumedGrant, consumed_at: "2026-09-04T12:00:01.000Z" }, error: null,
      },
    }),
    storage: { from(bucket) {
      assert.equal(bucket, "platform-knowledge-files");
      return { async createSignedUrl(path, lifetime, options) {
        assert.equal(path, OBJECT);
        assert.ok(lifetime >= 1 && lifetime <= 60);
        assert.deepEqual(options, { download: "proof.pdf" });
        return {
          data: { signedUrl: `http://localhost:54321/storage/v1/object/sign/platform-knowledge-files/${OBJECT}?token=secret` },
          error: null,
        };
      } };
    } },
  };
  const response = await createPlatformCompanyKnowledgeDownloadHandler({
    authorize: async (capability) => {
      assert.equal(capability, "documents.read");
      return { status: "authorized", actor: ACTOR };
    },
    createUserClient: async () => user,
    createServiceClient: () => service,
    supabaseOrigin: () => "http://localhost:54321",
    randomUuid: () => REQUEST,
  })(new Request("http://localhost/download"), { params: Promise.resolve({ fileVersionId: VERSION }) });
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location"), /^http:\/\/localhost:54321\/storage\/v1\/object\/sign\/platform-knowledge-files\//);
});

test("action and route source lock the seven mutations, exact fields and no fallback path", () => {
  const actions = readFileSync(new URL("../src/lib/platform-company-knowledge-actions.ts", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../src/lib/server/platform-company-knowledge-storage-route-handlers.ts", import.meta.url), "utf8");
  for (const rpc of [
    "create_company_knowledge_folder", "rename_company_knowledge_folder",
    "move_company_knowledge_folder", "remove_company_knowledge_folder",
    "rename_company_knowledge_file", "move_company_knowledge_file", "remove_company_knowledge_file",
  ]) assert.match(actions, new RegExp(`rpc: "${rpc}"`));
  assert.match(actions, /revalidatePath\("\/v3\/knowledge"\)/);
  assert.match(routes, /reserve_company_knowledge_file_upload/);
  assert.match(routes, /finalize_company_knowledge_file_upload/);
  assert.match(routes, /consume_company_knowledge_file_download_grant/);
  assert.doesNotMatch(routes, /platform-documents|fallback|upsert:\s*true/);
});
