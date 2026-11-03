import { redirect } from "next/navigation";
import { PageShell } from "@/components/kit";
import { KnowledgeSnippets } from "@/components/v3/knowledge/KnowledgeSnippets";
import { requireV3PageActor } from "@/lib/platform-guards";
import { staffCanAccessRoute } from "@/lib/platform-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Шаблоны ответов" };

export default async function ReplySnippetsPage() {
  const actor = await requireV3PageActor("/v3/reply-snippets");
  if (staffCanAccessRoute(actor, "/v3/knowledge")) redirect("/v3/knowledge?section=snippets");
  // Сотрудник без «Базы знаний» (все роли, кроме Admin): те же чтения и права, «Новый вид» (таблица и панель набора).
  return <PageShell title="Шаблоны ответов" testId="v3-reply-snippets-next"><KnowledgeSnippets actor={actor} next /></PageShell>;
}
