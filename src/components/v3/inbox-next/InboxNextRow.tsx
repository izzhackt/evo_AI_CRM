import Link from "next/link";

import { StatusBadge } from "@/components/kit/StatusBadge";
import { ContactPhone, type InboxConversation } from "@/components/v3/Inbox";
import { cn } from "@/lib/utils";

/**
 * Строка диалога: имя, время, номер и «Ждёт ответа» — четыре данных, не больше. Вся строка — ссылка на диалог
 * (`aria-current` у открытого). Слова и маска номера те же, что у прежней строки.
 */
export function InboxNextRow({ conversation, active }: Readonly<{ conversation: InboxConversation; active: boolean }>) {
  const waiting = conversation.waitingSince
    ? `Ждёт ответа${conversation.awaitingReplyFor ? ` · ${conversation.awaitingReplyFor}` : ` с ${conversation.waitingSince}`}`
    : null;
  return (
    <li className="border-b border-border" data-testid="v3-inbox-row" data-conversation-id={conversation.id}>
      <Link
        href={conversation.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-16 w-full flex-col justify-center gap-0.5 px-4 py-2.5 text-start focus-visible:-outline-offset-2",
          active ? "bg-accent-weak" : "hover:bg-surface-2",
        )}
      >
        <span className="flex w-full items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate t-item text-fg">{conversation.person}</span>
          <span className="t-meta shrink-0 font-mono tabular-nums text-fg-3">{conversation.updatedAt}</span>
        </span>
        {conversation.phone ? <ContactPhone phone={conversation.phone} className="t-meta tabular-nums text-fg-2" /> : null}
        {waiting ? <span className="mt-0.5 flex"><StatusBadge tone="warn" label={waiting} title={`Ждёт ответа с ${conversation.waitingSince}`} /></span> : null}
      </Link>
    </li>
  );
}
