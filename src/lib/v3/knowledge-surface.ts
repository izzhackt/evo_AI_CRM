import "server-only";

import { fixedRoleCan } from "../fixed-role-policy.ts";
import type { ActivePlatformActor } from "../platform-auth.ts";
import type { PlatformReplySnippet } from "../platform-reply-snippets.ts";
import type {
  KnowledgeCompanyWorkspace,
  KnowledgeDocumentWorkspace,
  KnowledgeStudent,
} from "./knowledge-source.ts";

export type V3KnowledgeDocumentSurface = Readonly<{
  company: KnowledgeCompanyWorkspace;
  students: readonly KnowledgeStudent[];
  studentDocuments: KnowledgeDocumentWorkspace;
}>;

export type V3KnowledgeSurface = Readonly<{
  documents: V3KnowledgeDocumentSurface | null;
  snippets: readonly PlatformReplySnippet[];
  canReadDocuments: boolean;
  canReadSnippets: boolean;
  canManageDocuments: boolean;
  canManageSnippets: boolean;
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
  const canReadDocuments = fixedRoleCan(actor.presentationRole, "documents.read");
  const canReadSnippets = fixedRoleCan(actor.presentationRole, "messaging.read");

  const [documents, snippets] = await Promise.all([
    canReadDocuments
      ? Promise.all([
          readers.readCompany(actor),
          readers.readStudents(actor),
          readers.readDocuments(actor),
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
    canManageDocuments: fixedRoleCan(actor.presentationRole, "documents.write"),
    canManageSnippets: fixedRoleCan(actor.presentationRole, "messaging.send"),
  };
}
