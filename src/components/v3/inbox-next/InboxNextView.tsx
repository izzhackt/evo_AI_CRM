import { cn } from "@/lib/utils";

import { InboxNextIdle } from "./InboxNextIdle";
import { InboxNextList } from "./InboxNextList";
import { InboxNextThread, type InboxNextThreadProps } from "./InboxNextThread";

/**
 * Рабочая область «WhatsApp»: список 320 px слева, диалог справа (на телефоне один слой: список, затем диалог с
 * «Назад»). Классы `v3-inbox` и `data-inbox-open` — зацепки правил оболочки для телефона (v3.css): открытый чат
 * забирает экран, заголовок страницы остаётся для читалки.
 */
export function InboxNextView(props: InboxNextThreadProps) {
  const { view } = props;
  const open = view.selected;
  const hasConversations = view.conversations.length > 0;
  return (
    <div
      className={cn(
        "v3-inbox grid min-h-0 flex-1 overflow-hidden rounded-card border border-border bg-surface",
        (open || hasConversations) && "@4xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]",
      )}
      data-testid="v3-inbox"
      data-source="supabase-platform"
      data-inbox-open={open ? "" : undefined}
    >
      <InboxNextList view={view} />
      {open ? <InboxNextThread {...props} /> : hasConversations ? <InboxNextIdle view={view} /> : null}
    </div>
  );
}
