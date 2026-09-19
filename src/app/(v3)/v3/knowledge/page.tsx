import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PartShell } from "@/components/v3/PartShell";
import { KnowledgeDocuments } from "@/components/v3/knowledge/KnowledgeDocuments";
import { KnowledgeSnippets } from "@/components/v3/knowledge/KnowledgeSnippets";
import { KnowledgeLibrary } from "@/components/v3/knowledge/KnowledgeLibrary";
import { requireV3PageActor } from "@/lib/platform-guards";
import { requireKnowledgeAdmin } from "@/lib/v3/knowledge-library-source";
export const dynamic = "force-dynamic";
export const metadata = { title: "База знаний · EVO" };
export default async function KnowledgePart({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireV3PageActor("/v3/knowledge"); requireKnowledgeAdmin(actor);
  const query = await searchParams;
  if (query.tab === "snippets") redirect("/v3/knowledge?section=snippets");
  const section = query.section === "documents" || query.section === "snippets" ? query.section : null;
  return <PartShell title="База знаний"><Suspense fallback={<p role="status">Загрузка базы знаний…</p>}><KnowledgeLibrary commandScope={`${actor.organizationId}:${actor.membershipId}`} section={section}>
    {section === "documents" ? <KnowledgeDocuments actor={actor} /> : section === "snippets" ? <KnowledgeSnippets actor={actor} /> : null}
  </KnowledgeLibrary></Suspense></PartShell>;
}
