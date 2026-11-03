import { redirect } from "next/navigation";
import { PageShell } from "@/components/kit";
import { KnowledgeDocuments } from "@/components/staff/knowledge/KnowledgeDocuments";
import { requireV3PageActor } from "@/lib/platform-guards";
import { staffCanAccessRoute } from "@/lib/platform-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Документы" };

export default async function DocumentsPart() {
  const actor = await requireV3PageActor("/documents");
  if (staffCanAccessRoute(actor, "/knowledge")) redirect("/knowledge?section=documents");
  // Сотрудник без «Базы знаний» (все роли, кроме Admin): те же чтения и права, «Новый вид» (таблица и панели набора).
  return <PageShell title="Документы" testId="v3-documents-next"><KnowledgeDocuments actor={actor} next /></PageShell>;
}
