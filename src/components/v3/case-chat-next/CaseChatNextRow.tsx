import Link from "next/link";

import { StatusBadge } from "@/components/kit/StatusBadge";
import { Initials } from "@/components/v3/blocks/Initials";
import { rowTime, threadRowBadges } from "@/components/v3/case-chat/CaseChatThread";
import { caseChatHref, type CaseChatQueue, type CaseChatThreadRow } from "@/lib/platform-case-chat-contract";
import { cn } from "@/lib/utils";

/**
 * Строка переписки: имя, время, последняя фраза и отметки («Непрочитанное», в «Всех» — состояние словом). Отметки и
 * фразы те же, что у прежней строки (`threadRowBadges`); вся строка — ссылка на переписку.
 */
export function CaseChatNextRow({ row, active, query, queue, readAt, membershipId }: Readonly<{
  row: CaseChatThreadRow; active: boolean; query: string; queue: CaseChatQueue; readAt: string; membershipId: string;
}>) {
  const badges = threadRowBadges(row, queue);
  return (
    <Link
      href={caseChatHref(query, queue, row.studentCaseId)}
      scroll={false}
      aria-current={active ? "page" : undefined}
      data-case-chat-row={row.studentCaseId}
      className={cn("flex w-full items-start gap-2.5 border-b border-border px-3 py-3 text-start focus-visible:-outline-offset-2", active ? "bg-accent-weak" : "hover:bg-surface-2")}
    >
      <span className="mt-0.5 shrink-0"><Initials name={row.studentDisplayName} decorative /></span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate t-item text-fg">{row.studentDisplayName}</span>
          {row.lastMessageAt ? <time className="t-meta shrink-0 font-mono tabular-nums text-fg-3" dateTime={row.lastMessageAt}>{rowTime(row.lastMessageAt, readAt)}</time> : null}
        </span>
        {row.lastMessageSnippet
          ? <span className="truncate t-body-compact text-fg-2">{row.lastMessageAuthorMembershipId === membershipId ? "Вы: " : ""}{row.lastMessageSnippet}</span>
          : <span className="t-body-compact text-fg-3">Нет сообщений</span>}
        {row.unread || badges.length ? (
          <span className="mt-0.5 flex flex-wrap gap-1">
            {row.unread ? <StatusBadge tone="info" label="Непрочитанное" /> : null}
            {badges.map((badge) => <StatusBadge key={badge.text} tone={badge.tone === "warn" ? "warn" : "neutral"} label={badge.text} />)}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
