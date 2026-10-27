import Link from "next/link";

import { Button } from "@/components/ui/button";
import { caseChatNextLine } from "@/components/v3/case-chat/case-chat-queue";
import type { CaseChatIdleProps } from "@/components/v3/case-chat/CaseChatThread";
import { caseChatHref } from "@/lib/platform-case-chat-contract";

/**
 * Правая часть без открытой переписки: следующая, ждущая ответа дольше всех (из полного чтения), или тихое «Все
 * ответы даны» — в любой очереди; на узком экране её нет (виден список).
 */
export function CaseChatNextIdle({ read, membershipId, query, queue, loading, failure }: CaseChatIdleProps) {
  const line = loading || failure ? { kind: "none" as const } : caseChatNextLine(read, membershipId, query);
  return (
    <div className="hidden flex-1 flex-col items-center justify-center gap-3 p-6 text-center @2xl:flex" data-testid="case-chat-next">
      {line.kind === "next" ? (
        <>
          <p className="max-w-[48ch] t-body text-fg-2">
            Следующий: <span className="font-semibold text-fg">{line.row.studentDisplayName}</span>
            {line.waiting ? <> — {line.waiting}</> : null}
          </p>
          <Button variant="outline" asChild>
            <Link href={caseChatHref(query, queue, line.row.studentCaseId)} scroll={false} aria-label={`Открыть переписку: ${line.row.studentDisplayName}`}>Открыть</Link>
          </Button>
        </>
      ) : line.kind === "all-answered" ? (
        <p className="t-body text-fg-3">Все ответы даны</p>
      ) : null}
    </div>
  );
}
