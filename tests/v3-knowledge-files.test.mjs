import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("V3 knowledge combines company authority and case documents without copying", () => {
  const page = source("src/app/(v3)/v3/knowledge/page.tsx");
  const adapter = source("src/lib/v3/knowledge-source.ts");

  assert.match(page, /readCompanyKnowledge\(actor\)/);
  assert.match(page, /name: "Компания"/);
  assert.match(page, /kind: "company-root"/);
  assert.match(page, /name: "Студенты"/);
  assert.match(page, /kind: "student" as const/);
  assert.match(page, /document\.versionId/);
  assert.match(adapter, /listPlatformCompanyKnowledgeFolders\(actor\)/);
  assert.match(adapter, /listPlatformCompanyKnowledgeFiles\(actor\)/);
  assert.match(adapter, /listPlatformDocumentQueue\(actor, PAGE_SIZE\)/);
  assert.doesNotMatch(adapter, /addedBy|createdBy/);
  assert.doesNotMatch(page, /COMPANY_FILES|PROFILE_SAMPLE|sample/i);
});

test("company file controls cross only real server action and route boundaries", () => {
  const page = source("src/app/(v3)/v3/knowledge/page.tsx");
  const manager = source("src/components/v3/FileManager.tsx");

  for (const action of [
    "createPlatformCompanyKnowledgeFolderAction",
    "renamePlatformCompanyKnowledgeFolderAction",
    "movePlatformCompanyKnowledgeFolderAction",
    "removePlatformCompanyKnowledgeFolderAction",
    "renamePlatformCompanyKnowledgeFileAction",
    "movePlatformCompanyKnowledgeFileAction",
    "removePlatformCompanyKnowledgeFileAction",
  ]) {
    assert.match(manager, new RegExp(action));
  }
  for (const field of [
    "parent_folder_id",
    "folder_id",
    "file_id",
    "name",
    "expected_version",
    "request_id",
  ]) {
    assert.match(manager, new RegExp(`name="${field}"`));
  }
  assert.match(manager, /fetch\("\/api\/v3\/knowledge\/files"/);
  assert.match(manager, /\/api\/v3\/knowledge\/files\/\$\{file\.fileVersionId\}\/download/);
  assert.match(manager, /\/api\/v2\/document-versions\/\$\{file\.fileVersionId\}\/download/);
  assert.match(manager, /response\.status === 201 && uploadWasConfirmed\(payload\)/);
  assert.match(manager, /router\.refresh\(\)/);
  assert.match(manager, /key=\{requestIds\.createFolder\}/);
  assert.match(manager, /key=\{requestIds\.uploadFile\}/);
  assert.match(manager, /key=\{`\$\{selectedFolder\.companyFolderId\}:\$\{selectedFolder\.version\}`\}/);
  assert.match(manager, /key=\{`\$\{file\.companyFileId\}:\$\{file\.version\}`\}/);
  assert.match(page, /fixedRoleCan\([\s\S]*actor\.presentationRole,[\s\S]*"documents\.write"/);
  assert.doesNotMatch(manager, /URL\.createObjectURL|setFolders|setFiles|setDocs|localStorage/);
});

test("company mutations are exposed with stable browser proof selectors", () => {
  const manager = source("src/components/v3/FileManager.tsx");

  for (const testId of [
    "v3-knowledge-company-root",
    "v3-knowledge-create-folder-form",
    "v3-knowledge-create-folder-status",
    "v3-knowledge-upload-form",
    "v3-knowledge-upload-status",
    "v3-knowledge-company-folder-row",
    "v3-knowledge-company-folder-actions",
    "v3-knowledge-company-file-row",
    "v3-knowledge-company-file-actions",
    "v3-knowledge-folder-rename",
    "v3-knowledge-folder-move",
    "v3-knowledge-folder-delete",
    "v3-knowledge-file-rename",
    "v3-knowledge-file-move",
    "v3-knowledge-file-delete",
    "v3-knowledge-company-download",
    "v3-knowledge-student-download",
  ]) {
    assert.match(manager, new RegExp(testId));
  }
  assert.match(manager, /aria-label="Таблица документов"/);
  assert.match(manager, /tabIndex=\{0\}/);
  assert.doesNotMatch(manager, /addedBy|Добавил|createdBy/);
});

test("student folders stay automatic and read-only in the shared workspace", () => {
  const page = source("src/app/(v3)/v3/knowledge/page.tsx");
  const manager = source("src/components/v3/FileManager.tsx");

  assert.match(page, /companyFolderId: null/);
  assert.match(page, /kind: "student" as const/);
  assert.match(manager, /canManageCompany && folder\.kind === "company"/);
  assert.match(manager, /canManageCompany[\s\S]*file\.kind === "company"/);
  assert.doesNotMatch(manager, /student[\s\S]{0,100}(rename|move|remove)Platform/i);
});
