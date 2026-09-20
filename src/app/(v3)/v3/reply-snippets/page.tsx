import { redirect } from "next/navigation";
import { PartShell } from "@/components/v3/PartShell";
import { KnowledgeSnippets } from "@/components/v3/knowledge/KnowledgeSnippets";
import { requireV3PageActor } from "@/lib/platform-guards";
import { staffCanAccessRoute } from "@/lib/platform-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Шаблоны ответов · EVO" };

export default async function ReplySnippetsPage() {
  const actor = await requireV3PageActor("/v3/reply-snippets");
  if (staffCanAccessRoute(actor, "/v3/knowledge")) redirect("/v3/knowledge?section=snippets");
  return <PartShell title="Шаблоны ответов"><KnowledgeSnippets actor={actor} /></PartShell>;
}
