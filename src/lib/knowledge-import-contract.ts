import type { KnowledgeArea } from "./knowledge-library-contract";
export type KnowledgeImportEntry = {
  relativePath: string; scope: string; sourceKey?: string; nodeId?: string; area?: KnowledgeArea; folders?: string[];
  kind?: "page" | "file"; title?: string; sha256?: string; bytes: number; extension: string;
  classification?: string; reviewQuestion?: string; reason: string; authority?: string;
  action: "import" | "protected_import" | "retain_outside_crm";
};
export type KnowledgeImportPlan = { version: 1; inventorySha256: string; sourceRoot: string; entries: KnowledgeImportEntry[] };
