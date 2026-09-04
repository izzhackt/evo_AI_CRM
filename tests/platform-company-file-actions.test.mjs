import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/lib/platform-company-file-actions.ts", import.meta.url),
  "utf8",
);

test("company-file metadata exposes all versioned folder and file operations", () => {
  for (const actionName of [
    "createPlatformCompanyFileFolderAction",
    "renamePlatformCompanyFileFolderAction",
    "movePlatformCompanyFileFolderAction",
    "archivePlatformCompanyFileFolderAction",
    "createPlatformCompanyFileAction",
    "renamePlatformCompanyFileAction",
    "movePlatformCompanyFileAction",
    "archivePlatformCompanyFileAction",
  ]) {
    assert.match(source, new RegExp(`export async function ${actionName}\\(`));
  }
  for (const rpcName of [
    "create_company_file_folder",
    "rename_company_file_folder",
    "move_company_file_folder",
    "archive_company_file_folder",
    "create_company_file",
    "rename_company_file",
    "move_company_file",
    "archive_company_file",
  ]) {
    assert.match(source, new RegExp(`"${rpcName}"`));
  }
  assert.equal(
    source.match(/_previous: PlatformCompanyFileActionState/g)?.length,
    8,
  );
});

test("company-file actions use exact forms, fixed-role authorization and fail-closed output checks", () => {
  for (const fieldsName of [
    "CREATE_FOLDER_FIELDS",
    "RENAME_FOLDER_FIELDS",
    "MOVE_FOLDER_FIELDS",
    "ARCHIVE_FOLDER_FIELDS",
    "CREATE_FILE_FIELDS",
    "RENAME_FILE_FIELDS",
    "MOVE_FILE_FIELDS",
    "ARCHIVE_FILE_FIELDS",
  ]) {
    assert.match(source, new RegExp(`exactActionStringFields\\(form, ${fieldsName}\\)`));
  }
  assert.match(source, /fixedRoleCan\(actor\.authorityRole, "documents\.write"\)/);
  assert.match(source, /hasExactKeys\(value, FOLDER_RESULT_KEYS\)/);
  assert.match(source, /hasExactKeys\(value, FILE_RESULT_KEYS\)/);
  assert.match(
    source,
    /BigInt\(nextVersion\) !== BigInt\(expected\.previousVersion\) \+ BigInt\(1\)/g,
  );
  assert.match(source, /revalidatePath\("\/v3\/knowledge"\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fallback/i);
});

test("company-file actions keep empty file creation separate from byte upload", () => {
  assert.match(
    source,
    /const CREATE_FILE_FIELDS = \["folder_id", "display_name", "request_id"\]/,
  );
  assert.match(
    source,
    /"create_company_file", \{[\s\S]*?p_folder_id: folderId,[\s\S]*?p_display_name: displayName/,
  );
  assert.doesNotMatch(source, /storage\.from|\.upload\(/);
});
