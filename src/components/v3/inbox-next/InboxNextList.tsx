import Link from "next/link";

import { EmptyState } from "@/components/kit/EmptyState";
import { Button } from "@/components/ui/button";
import { channelWarning, type InboxView } from "@/components/v3/Inbox";
import { InboxListPulse } from "@/components/v3/inbox/InboxListPulse";
import { cn } from "@/lib/utils";

import { InboxNextRow } from "./InboxNextRow";
import { InboxNextSearch } from "./InboxNextSearch";

const LINK_ROW = "flex min-h-12 items-center px-3 py-1";

/**
 * Список диалогов слева: полоса о беде канала (на виду, `--warn-weak`), поиск и «Сортировка», строки, «Ранее →». На
 * телефоне с открытым диалогом список скрыт, остаётся «Назад» в шапке диалога. Опрос списка — прежний `InboxListPulse`.
 */
export function InboxNextList({ view }: Readonly<{ view: InboxView }>) {
  const open = view.selected;
  const warning = channelWarning(view.channelState);
  const filtered = Boolean(view.searchQuery);
  const title = view.queueNewestHref
    ? "На этой странице диалогов нет"
    : filtered ? "По выбранным условиям диалогов нет" : "Пока нет доступных диалогов";
  return (
    <section aria-label="Диалоги" className={cn("flex min-h-0 min-w-0 flex-col border-border @4xl:border-e", open && "hidden @4xl:flex")}>
      {!open && warning ? (
        <div className="border-b border-border bg-warn-weak px-4 py-3" role="status" data-testid="v3-inbox-channel-status">
          <p className="t-body-compact text-warn">{warning}</p>
        </div>
      ) : null}
      {!open ? <InboxListPulse listPulse={view.listPulse} searchQuery={view.searchQuery} sort={view.sort} /> : null}
      <InboxNextSearch view={view} />
      {view.queueNewestHref ? (
        <nav aria-label="К новым диалогам" className={cn(LINK_ROW, "border-b border-border")}>
          <Button variant="ghost" asChild><Link href={view.queueNewestHref} data-testid="v3-inbox-queue-newest">← К новым</Link></Button>
        </nav>
      ) : null}
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {view.conversations.map((conversation) => <InboxNextRow key={conversation.id} conversation={conversation} active={conversation.id === open?.id} />)}
        {view.queueOlderHref ? (
          <li className={cn(LINK_ROW, "justify-end")}>
            <Button variant="ghost" asChild><Link href={view.queueOlderHref} rel="next" data-testid="v3-inbox-queue-older">Ранее →</Link></Button>
          </li>
        ) : null}
        {view.conversations.length === 0 ? (
          <li data-testid="v3-inbox-empty">
            <EmptyState
              title={title}
              action={filtered && !view.queueNewestHref
                ? <Button variant="outline" asChild><Link href="/v3/inbox" data-testid="v3-inbox-clear-filters">Сбросить фильтры</Link></Button>
                : undefined}
            />
          </li>
        ) : null}
      </ol>
    </section>
  );
}
