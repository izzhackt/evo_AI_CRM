import { redirect } from "next/navigation";
import { PageShell } from "@/components/kit";
import { KnowledgeDocuments } from "@/components/v3/knowledge/KnowledgeDocuments";
import { requireV3PageActor } from "@/lib/platform-guards";
import { staffCanAccessRoute } from "@/lib/platform-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Документы" };

export default async function DocumentsPart() {
  const actor = await requireV3PageActor("/v3/documents");
  if (staffCanAccessRoute(actor, "/v3/knowledge")) redirect("/v3/knowledge?section=documents");
  // Сотрудник без «Базы знаний» (все роли, кроме Admin): те же чтения и права, «Новый вид» (таблица и панели набора).
  return <PageShell title="Документы" testId="v3-documents-next"><KnowledgeDocuments actor={actor} next /></PageShell>;
}
