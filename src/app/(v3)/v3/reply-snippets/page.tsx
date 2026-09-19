import { randomUUID } from "node:crypto";
import { PartShell } from "@/components/v3/PartShell";
import { KnowledgeReplySnippetSection } from "@/components/v3/reply-snippets/KnowledgeReplySnippetSection";
import { requireV3PageActor } from "@/lib/platform-guards";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { readV3ReplySnippets, v3CanMutateReplySnippet, v3ReplySnippetAudiences } from "@/lib/v3/reply-snippets-source";
export const dynamic = "force-dynamic";
export const metadata = { title: "Шаблоны ответов · EVO" };
export default async function ReplySnippetsPage() {
  const actor = await requireV3PageActor("/v3/reply-snippets");
    const snippets = await readV3ReplySnippets(actor);
    return <PartShell title="Шаблоны ответов">
      <KnowledgeReplySnippetSection items={snippets.map((snippet) => ({ snippet, canMutate: v3CanMutateReplySnippet(actor, snippet), updateRequestId: randomUUID(), archiveRequestId: randomUUID() }))} canManage={!isStaffPreview(actor) && staffHasPermission(actor, "reply.snippet.manage")} availableAudiences={v3ReplySnippetAudiences(actor)} createRequestId={randomUUID()} />
    </PartShell>;
}
