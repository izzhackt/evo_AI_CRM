import { redirect } from "next/navigation";
import { PartShell } from "@/components/v3/PartShell";
import { KnowledgeDocuments } from "@/components/v3/knowledge/KnowledgeDocuments";
import { requireV3PageActor } from "@/lib/platform-guards";
import { staffCanAccessRoute } from "@/lib/platform-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Документы" };

export default async function DocumentsPart() {
  const actor = await requireV3PageActor("/v3/documents");
  if (staffCanAccessRoute(actor, "/v3/knowledge")) redirect("/v3/knowledge?section=documents");
  return <PartShell title="Документы"><KnowledgeDocuments actor={actor} /></PartShell>;
}
