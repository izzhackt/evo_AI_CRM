import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Suspense } from "react";
import { PartShell } from "@/components/v3/PartShell";
import { KnowledgeLibrary } from "@/components/v3/knowledge/KnowledgeLibrary";
import { KnowledgeReplySnippetSection } from "@/components/v3/reply-snippets/KnowledgeReplySnippetSection";
import { requireV3PageActor } from "@/lib/platform-guards";
import { requireKnowledgeAdmin } from "@/lib/v3/knowledge-library-source";
import { readV3ReplySnippets, v3CanMutateReplySnippet, v3ReplySnippetAudiences } from "@/lib/v3/reply-snippets-source";
export const dynamic = "force-dynamic";
export const metadata = { title: "База знаний · EVO" };
export default async function KnowledgePart({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireV3PageActor("/v3/knowledge"); requireKnowledgeAdmin(actor);
  const query = await searchParams;
  if (query.tab === "snippets") {
    const snippets = await readV3ReplySnippets(actor);
    return <PartShell title="Шаблоны ответов"><Link href="/v3/knowledge">← База знаний</Link>
      <KnowledgeReplySnippetSection items={snippets.map((snippet) => ({ snippet, canMutate: v3CanMutateReplySnippet(actor, snippet), updateRequestId: randomUUID(), archiveRequestId: randomUUID() }))} canManage={true} availableAudiences={v3ReplySnippetAudiences(actor)} createRequestId={randomUUID()} />
    </PartShell>;
  }
  return <PartShell title="База знаний"><Suspense fallback={<p role="status">Загрузка базы знаний…</p>}><KnowledgeLibrary /></Suspense></PartShell>;
}
