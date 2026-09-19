import { randomUUID } from "node:crypto";

import {
  COMPANY_ROOT_ID,
  FileManager,
  type KnowledgeFile,
  type KnowledgeFolder,
} from "@/components/v3/FileManager";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { loadV3KnowledgeSurface } from "@/lib/v3/knowledge-surface";
import {
  readCompanyKnowledge,
  readKnowledgeDocuments,
  readKnowledgeStudents,
} from "@/lib/v3/knowledge-source";
import {
  readV3ReplySnippets,
} from "@/lib/v3/reply-snippets-source";


const STUDENTS_ROOT = "students";

export async function KnowledgeDocuments({ actor }: { actor: ActivePlatformActor }) {
  const surface = await loadV3KnowledgeSurface(actor, {
    readCompany: readCompanyKnowledge,
    readStudents: readKnowledgeStudents,
    readDocuments: readKnowledgeDocuments,
    readSnippets: readV3ReplySnippets,
  });
  const documentSurface = surface.documents;
  const company = documentSurface?.company ?? { folders: [], files: [] };
  const students = documentSurface?.students ?? [];
  const studentDocuments = documentSurface?.studentDocuments ?? {
    documents: [],
    complete: true,
  };

  const folders: KnowledgeFolder[] = [
    ...(surface.canReadCompanyFiles ? [{
      id: COMPANY_ROOT_ID,
      name: "Компания",
      parentId: null,
      kind: "company-root" as const,
      version: null,
      renameRequestId: null,
      moveRequestId: null,
      archiveRequestId: null,
    }] : []),
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
    ...(surface.canReadDocuments ? [{
      id: STUDENTS_ROOT,
      name: "Студенты",
      parentId: null,
      kind: "students" as const,
      version: null,
      renameRequestId: null,
      moveRequestId: null,
      archiveRequestId: null,
    }] : []),
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
      downloadHref: surface.canDownloadCompanyFiles && file.currentVersionId
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

  return <>
    {!studentDocuments.complete && <p role="alert">Откройте документы нужного клиента в его карточке: общий список не помещается на этом экране.</p>}
    <FileManager rootLabel="Документы" folders={folders} files={files} canManage={surface.canManageCompanyFiles}
      canUpload={surface.canUploadCompanyFiles} createFolderRequestId={randomUUID()} createFileRequestId={randomUUID()} />
  </>;
}
