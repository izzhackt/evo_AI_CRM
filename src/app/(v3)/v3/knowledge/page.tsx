import { randomUUID } from "node:crypto";

import {
  COMPANY_ROOT_ID,
  FileManager,
  type KnowledgeFile,
  type KnowledgeFolder,
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

const STUDENTS_ROOT = "students";

export default async function KnowledgePart() {
  const actor = await requirePlatformDocumentsActor("/v3/knowledge");
  const [company, students, studentDocuments] = await Promise.all([
    readCompanyKnowledge(actor),
    readKnowledgeStudents(actor),
    readKnowledgeDocuments(actor),
  ]);

  const folders: KnowledgeFolder[] = [
    {
      id: COMPANY_ROOT_ID,
      name: "Компания",
      parentId: null,
      kind: "company-root",
      version: null,
      renameRequestId: null,
      moveRequestId: null,
      archiveRequestId: null,
    },
    ...company.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId ?? COMPANY_ROOT_ID,
      kind: "company" as const,
      version: folder.version,
      renameRequestId: randomUUID(),
      moveRequestId: randomUUID(),
      archiveRequestId: randomUUID(),
    })),
    {
      id: STUDENTS_ROOT,
      name: "Студенты",
      parentId: null,
      kind: "students",
      version: null,
      renameRequestId: null,
      moveRequestId: null,
      archiveRequestId: null,
    },
    ...students.map((student) => ({
      id: `student-${student.id}`,
      name: student.name,
      parentId: STUDENTS_ROOT,
      kind: "student" as const,
      version: null,
      renameRequestId: null,
      moveRequestId: null,
      archiveRequestId: null,
    })),
  ];

  const files: KnowledgeFile[] = [
    ...company.files.map((file) => ({
      id: file.id,
      folderId: file.folderId ?? COMPANY_ROOT_ID,
      name: file.name,
      addedAt: file.addedAt,
      size: file.size,
      kind: "company" as const,
      version: file.version,
      currentVersionId: file.currentVersionId,
      downloadHref: file.currentVersionId
        ? `/api/v3/company-file-versions/${file.currentVersionId}/download`
        : null,
      renameRequestId: randomUUID(),
      moveRequestId: randomUUID(),
      archiveRequestId: randomUUID(),
      uploadRequestId: randomUUID(),
    })),
    ...studentDocuments.documents.map((document) => ({
      id: `student-file-${document.versionId}`,
      folderId: `student-${document.caseId}`,
      name: document.name,
      addedAt: document.addedAt,
      size: document.size,
      kind: "student" as const,
      version: null,
      currentVersionId: document.versionId,
      downloadHref: `/api/v2/document-versions/${document.versionId}/download`,
      renameRequestId: null,
      moveRequestId: null,
      archiveRequestId: null,
      uploadRequestId: null,
    })),
  ];

  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">
        База знаний
      </h1>

      {!studentDocuments.complete ? (
        <p
          role="alert"
          data-testid="v3-knowledge-student-documents-limited"
          className="mt-4 rounded-card border border-warn/30 bg-warn-weak px-4 py-3 text-sm text-warn"
        >
          Документов студентов больше безопасного окна этого экрана. Здесь они
          не показаны частично: откройте документы нужного студента в Student 360.
          Раздел «Компания» продолжает работать полностью.
        </p>
      ) : null}

      <div className="mt-6">
        <FileManager
          folders={folders}
          files={files}
          canManage={fixedRoleCan(actor.presentationRole, "documents.write")}
          createFolderRequestId={randomUUID()}
          createFileRequestId={randomUUID()}
        />
      </div>
    </main>
  );
}
