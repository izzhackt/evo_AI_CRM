import { randomUUID } from "node:crypto";
import { KnowledgeReplySnippetSection } from "@/components/v3/reply-snippets/KnowledgeReplySnippetSection";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { readV3ReplySnippets, v3CanMutateReplySnippet, v3ReplySnippetAudiences } from "@/lib/v3/reply-snippets-source";
export async function KnowledgeSnippets({ actor }: { actor: ActivePlatformActor }) {
    const snippets = await readV3ReplySnippets(actor);
    return <>
      <KnowledgeReplySnippetSection items={snippets.map((snippet) => ({ snippet, canMutate: v3CanMutateReplySnippet(actor, snippet), updateRequestId: randomUUID(), archiveRequestId: randomUUID() }))} canManage={!isStaffPreview(actor) && staffHasPermission(actor, "reply.snippet.manage")} availableAudiences={v3ReplySnippetAudiences(actor)} createRequestId={randomUUID()} />
    </>;
}
