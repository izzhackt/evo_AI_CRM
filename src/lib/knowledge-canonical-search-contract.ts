export const KNOWLEDGE_CANONICAL_KINDS = ["document", "company", "company_folder", "snippet", "case"] as const;
export type KnowledgeCanonicalKind = (typeof KNOWLEDGE_CANONICAL_KINDS)[number];
export type KnowledgeCanonicalCursor = { title: string; kind: KnowledgeCanonicalKind; id: string };
export type KnowledgeCanonicalResult = {
  id: string; kind: KnowledgeCanonicalKind; title: string; context: string;
  href: string; downloadHref: string | null; updatedAt: string;
};
export type KnowledgeCanonicalPage = { items: KnowledgeCanonicalResult[]; hasMore: boolean; nextCursor: KnowledgeCanonicalCursor | null };
