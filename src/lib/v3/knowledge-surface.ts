import { isStaffPreview, staffCan, staffHasPermission, staffPresentationCan } from "../platform-access.ts";
import "server-only";

import type { ActivePlatformActor } from "../platform-auth.ts";
import type { PlatformReplySnippet } from "../platform-reply-snippets.ts";
import type {
  KnowledgeCompanyWorkspace,
  KnowledgeDocumentWorkspace,
  KnowledgeStudent,
} from "./knowledge-source.ts";

export type V3KnowledgeDocumentSurface = Readonly<{
  company: KnowledgeCompanyWorkspace | null;
  students: readonly KnowledgeStudent[];
  studentDocuments: KnowledgeDocumentWorkspace | null;
}>;

export type V3KnowledgeSurface = Readonly<{
  documents: V3KnowledgeDocumentSurface | null;
  snippets: readonly PlatformReplySnippet[];
  canReadDocuments: boolean;
  canReadSnippets: boolean;
  canManageDocuments: boolean;
  canManageSnippets: boolean;
  canReadCompanyFiles: boolean;
  canManageCompanyFiles: boolean;
  canUploadCompanyFiles: boolean;
  canDownloadCompanyFiles: boolean;
}>;

export type V3KnowledgeSurfaceReaders = Readonly<{
  readCompany: (actor: ActivePlatformActor) => Promise<KnowledgeCompanyWorkspace>;
  readStudents: (actor: ActivePlatformActor) => Promise<readonly KnowledgeStudent[]>;
  readDocuments: (actor: ActivePlatformActor) => Promise<KnowledgeDocumentWorkspace>;
  readSnippets: (actor: ActivePlatformActor) => Promise<readonly PlatformReplySnippet[]>;
}>;

export async function loadV3KnowledgeSurface(
  actor: ActivePlatformActor,
  readers: V3KnowledgeSurfaceReaders,
): Promise<V3KnowledgeSurface> {
  const previewAllowsDocuments = !isStaffPreview(actor) || staffPresentationCan(actor, "documents.read");
  const canReadDocuments = staffHasPermission(actor, "document.read.full") && previewAllowsDocuments;
  const canReadCompanyFiles = staffHasPermission(actor, "company.file.read") && previewAllowsDocuments;
  const canReadSnippets = staffCan(actor, "snippets.read");

  const [documents, snippets] = await Promise.all([
    canReadDocuments || canReadCompanyFiles
      ? Promise.all([
          canReadCompanyFiles ? readers.readCompany(actor) : null,
          canReadDocuments && staffPresentationCan(actor, "admissions.read") ? readers.readStudents(actor) : [],
          canReadDocuments ? readers.readDocuments(actor) : null,
        ]).then(([company, students, studentDocuments]) => ({
          company,
          students,
          studentDocuments,
        }))
      : Promise.resolve(null),
    canReadSnippets ? readers.readSnippets(actor) : Promise.resolve([]),
  ]);

  return {
    documents,
    snippets,
    canReadDocuments,
    canReadSnippets,
    canReadCompanyFiles,
    canManageCompanyFiles: !isStaffPreview(actor) && staffHasPermission(actor, "company.file.manage"),
    canUploadCompanyFiles: !isStaffPreview(actor) && staffHasPermission(actor, "company.file.upload"),
    canDownloadCompanyFiles: staffHasPermission(actor, "company.file.download") && previewAllowsDocuments,
    canManageDocuments: !isStaffPreview(actor) && staffPresentationCan(actor, "documents.write"),
    canManageSnippets: !isStaffPreview(actor) && staffHasPermission(actor, "reply.snippet.manage"),
  };
}
