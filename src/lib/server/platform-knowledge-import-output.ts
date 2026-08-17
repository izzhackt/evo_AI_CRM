import type { PlatformKnowledgeImportResult } from "./platform-knowledge-bundle.ts";

export type SafePlatformKnowledgeImportResult = Readonly<{
  status: "knowledge_import_verified";
  version: 1;
  audience: PlatformKnowledgeImportResult["audience"];
  bundle_sha256: string;
  documents_upserted: number;
  documents_deleted: number;
  chunks_replaced: number;
}>;

export function safePlatformKnowledgeImportResult(result: PlatformKnowledgeImportResult): SafePlatformKnowledgeImportResult {
  return Object.freeze({
    status: "knowledge_import_verified",
    version: 1,
    audience: result.audience,
    bundle_sha256: result.bundle_sha256,
    documents_upserted: result.documents_upserted,
    documents_deleted: result.documents_deleted,
    chunks_replaced: result.chunks_replaced,
  });
}
