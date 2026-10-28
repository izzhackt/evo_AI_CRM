import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ContactPhone, type InboxView } from "@/components/v3/Inbox";

/**
 * Правая часть, когда диалог не открыт, не тупик: первый ждущий ответа диалог страницы и «Открыть»; «Все ответы
 * даны» — только когда страница и есть весь список и канал исправен (при выключенном приёме или потерянной связи
 * «всё отвечено» было бы успокаивающей неправдой); иначе «Выберите диалог слева».
 */
export function InboxNextIdle({ view }: Readonly<{ view: InboxView }>) {
  const next = view.conversations.find((conversation) => conversation.waitingSince) ?? null;
  const wholeListRead = view.channelState === "ready" && !view.queueOlderHref && !view.queueNewestHref && !view.searchQuery;
  return (
    <section className="hidden place-items-center bg-bg p-8 text-center @4xl:grid" data-testid="v3-inbox-next">
      {next ? (
        <div className="flex flex-col items-center gap-3">
          <p className="max-w-[48ch] t-body text-fg-2">
            Ждёт ответа:{" "}
            {next.phone && next.person === "WhatsApp"
              ? <ContactPhone phone={next.phone} className="font-semibold tabular-nums text-fg" />
              : <span className="font-semibold text-fg">{next.person}</span>}
            {next.awaitingReplyFor ? ` · ${next.awaitingReplyFor}` : ""}
          </p>
          <Button variant="outline" asChild><Link href={next.href}>Открыть</Link></Button>
        </div>
      ) : wholeListRead ? (
        <p className="t-body text-fg-3">Все ответы даны</p>
      ) : (
        <p className="t-body text-fg-3">Выберите диалог слева</p>
      )}
    </section>
  );
}
