import { randomUUID } from "node:crypto";

import {
  FileManager,
  type KnowledgeFile,
  type KnowledgeFolder,
  type KnowledgeMutationRequestIds,
} from "@/components/v3/FileManager";
import { fixedRoleCan } from "@/lib/fixed-role-policy";
import { requirePlatformDocumentsActor } from "@/lib/platform-guards";
import {
  readCompanyKnowledge,
  readKnowledgeDocuments,
  readKnowledgeStudents,
} from "@/lib/v3/knowledge-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · База знаний" };

const COMPANY_ROOT = "company";
const STUDENTS_ROOT = "students";
const companyFolderUiId = (folderId: string) => `company-folder-${folderId}`;

export default async function KnowledgePart() {
  const actor = await requirePlatformDocumentsActor();
  const [company, students, documents] = await Promise.all([
    readCompanyKnowledge(actor),
    readKnowledgeStudents(actor),
    readKnowledgeDocuments(actor),
  ]);

  const folders: KnowledgeFolder[] = [
    {
      id: COMPANY_ROOT,
      name: "Компания",
      parentId: null,
      kind: "company-root",
      companyFolderId: null,
      version: null,
    },
    ...company.folders.map((folder) => ({
      id: companyFolderUiId(folder.id),
      name: folder.name,
      parentId: folder.parentId === null
        ? COMPANY_ROOT
        : companyFolderUiId(folder.parentId),
      kind: "company" as const,
      companyFolderId: folder.id,
      version: folder.version,
    })),
    {
      id: STUDENTS_ROOT,
      name: "Студенты",
      parentId: null,
      kind: "students",
      companyFolderId: null,
      version: null,
    },
    ...students.map((student) => ({
      id: `student-${student.id}`,
      name: student.name,
      parentId: STUDENTS_ROOT,
      kind: "student" as const,
      companyFolderId: null,
      version: null,
    })),
  ];

  const files: KnowledgeFile[] = [
    ...company.files.map((file) => ({
      id: `company-file-${file.id}`,
      folderId: file.folderId === null
        ? COMPANY_ROOT
        : companyFolderUiId(file.folderId),
      kind: "company" as const,
      companyFileId: file.id,
      fileVersionId: file.currentVersionId,
      version: file.version,
      name: file.name,
      addedAt: file.addedAt,
      size: file.size,
    })),
    ...documents.map((document) => ({
      id: `student-file-${document.versionId}`,
      folderId: `student-${document.caseId}`,
      kind: "student" as const,
      companyFileId: null,
      fileVersionId: document.versionId,
      version: null,
      name: document.name,
      addedAt: document.addedAt,
      size: document.size,
    })),
  ];

  const requestIds: KnowledgeMutationRequestIds = {
    createFolder: randomUUID(),
    uploadFile: randomUUID(),
    folders: Object.fromEntries(company.folders.map((folder) => [
      folder.id,
      { rename: randomUUID(), move: randomUUID(), remove: randomUUID() },
    ])),
    files: Object.fromEntries(company.files.map((file) => [
      file.id,
      { rename: randomUUID(), move: randomUUID(), remove: randomUUID() },
    ])),
  };

  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">
        База знаний
      </h1>

      <div className="mt-6">
        <FileManager
          folders={folders}
          files={files}
          canManageCompany={fixedRoleCan(
            actor.presentationRole,
            "documents.write",
          )}
          requestIds={requestIds}
        />
      </div>
    </main>
  );
}
