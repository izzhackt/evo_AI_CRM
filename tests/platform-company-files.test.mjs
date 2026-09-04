import assert from "node:assert/strict";
import test from "node:test";

import {
  getPlatformCompanyFileWorkspace,
  normalizePlatformCompanyFileWorkspace,
  normalizePlatformCompanyFileWorkspaceRow,
  PlatformCompanyFilesRepositoryError,
} from "../src/lib/platform-company-files.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const FOLDER_ID = "22222222-2222-4222-8222-222222222222";
const CHILD_FOLDER_ID = "33333333-3333-4333-8333-333333333333";
const FILE_ID = "44444444-4444-4444-8444-444444444444";
const FILE_VERSION_ID = "55555555-5555-4555-8555-555555555555";
const AT = "2026-09-04T10:00:00+00:00";

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

function row(overrides = {}) {
  return {
    item_kind: "folder",
    item_id: FOLDER_ID,
    parent_folder_id: null,
    display_name: "Регламенты",
    entity_version: "1",
    archived_at: null,
    current_version_id: null,
    current_version_no: null,
    original_filename: null,
    declared_mime_type: null,
    byte_size: null,
    sha256_hex: null,
    finalized_at: null,
    updated_at: AT,
    ...overrides,
  };
}

test("company-file rows normalize lossless versions and optional empty file metadata", () => {
  assert.deepEqual(normalizePlatformCompanyFileWorkspaceRow(row()), {
    kind: "folder",
    folderId: FOLDER_ID,
    parentFolderId: null,
    name: "Регламенты",
    version: "1",
    archivedAt: null,
    updatedAt: AT,
  });
  assert.deepEqual(normalizePlatformCompanyFileWorkspaceRow(row({
    item_kind: "file",
    item_id: FILE_ID,
    parent_folder_id: FOLDER_ID,
    display_name: "Шаблон договора",
    entity_version: "2",
  })), {
    kind: "file",
    companyFileId: FILE_ID,
    folderId: FOLDER_ID,
    displayName: "Шаблон договора",
    version: "2",
    archivedAt: null,
    currentVersion: null,
    downloadReady: false,
    updatedAt: AT,
  });
});

test("company-file rows require complete finalized current-version metadata", () => {
  const normalized = normalizePlatformCompanyFileWorkspaceRow(row({
    item_kind: "file",
    item_id: FILE_ID,
    display_name: "Презентация.pptx",
    entity_version: "3",
    current_version_id: FILE_VERSION_ID,
    current_version_no: "1",
    original_filename: "presentation.pptx",
    declared_mime_type:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    byte_size: 4096,
    sha256_hex: "a".repeat(64),
    finalized_at: AT,
  }));
  assert.equal(normalized.kind, "file");
  assert.equal(normalized.downloadReady, true);
  assert.equal(normalized.currentVersion.versionNumber, "1");
  assert.equal(normalized.currentVersion.byteSize, 4096);

  assert.throws(
    () => normalizePlatformCompanyFileWorkspaceRow(row({
      item_kind: "file",
      item_id: FILE_ID,
      display_name: "Broken",
      current_version_id: FILE_VERSION_ID,
    })),
    PlatformCompanyFilesRepositoryError,
  );
});

test("company-file workspace rejects duplicate, orphan and cyclic trees", () => {
  assert.throws(
    () => normalizePlatformCompanyFileWorkspace([row(), row()]),
    PlatformCompanyFilesRepositoryError,
  );
  assert.throws(
    () => normalizePlatformCompanyFileWorkspace([row({
      item_kind: "file",
      item_id: FILE_ID,
      parent_folder_id: CHILD_FOLDER_ID,
      display_name: "Orphan",
    })]),
    PlatformCompanyFilesRepositoryError,
  );
  assert.throws(
    () => normalizePlatformCompanyFileWorkspace([
      row({ parent_folder_id: CHILD_FOLDER_ID }),
      row({ item_id: CHILD_FOLDER_ID, parent_folder_id: FOLDER_ID }),
    ]),
    PlatformCompanyFilesRepositoryError,
  );
});

test("company-file workspace uses exactly one organization-scoped read RPC", async () => {
  const calls = [];
  const workspace = await getPlatformCompanyFileWorkspace(ACTOR, {
    client: {
      schema(name) {
        calls.push(["schema", name]);
        return {
          async rpc(name, args, options) {
            calls.push(["rpc", name, args, options]);
            return { data: [row()], error: null };
          },
        };
      },
    },
  });
  assert.equal(workspace.folders.length, 1);
  assert.equal(workspace.files.length, 0);
  assert.deepEqual(calls, [
    ["schema", "platform"],
    [
      "rpc",
      "staff_company_file_workspace",
      { p_organization_id: ORGANIZATION_ID },
      { get: true },
    ],
  ]);
});

test("company-file reads fail closed for sales, RPC errors and malformed rows", async () => {
  await assert.rejects(
    getPlatformCompanyFileWorkspace({
      ...ACTOR,
      platformRole: "sales",
      authorityRole: "sales",
      presentationRole: "sales",
    }, { client: { schema() { throw new Error("must not run"); } } }),
    PlatformCompanyFilesRepositoryError,
  );
  await assert.rejects(
    getPlatformCompanyFileWorkspace(ACTOR, {
      client: {
        schema() {
          return { async rpc() { return { data: null, error: { code: "XX" } }; } };
        },
      },
    }),
    PlatformCompanyFilesRepositoryError,
  );
  await assert.rejects(
    getPlatformCompanyFileWorkspace(ACTOR, {
      client: {
        schema() {
          return { async rpc() { return { data: [{ unexpected: true }], error: null }; } };
        },
      },
    }),
    PlatformCompanyFilesRepositoryError,
  );
});
