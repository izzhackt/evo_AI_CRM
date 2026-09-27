import type { ReactNode } from "react";

import { PageHeader, cn } from "@/components/ui";
import type { ConversationChannel, ConversationChannelKey } from "@/lib/v3/navigation";

import { ConversationChannels } from "./ConversationChannels";

/**
 * Одна шапка «Переписок» (Э5) для обоих каналов: заголовок, вкладки каналов и
 * рабочая часть стоят с одними отступами на `/v3/messages` («Кабинет
 * студента») и `/v3/inbox` (WhatsApp), поэтому переход между каналами не
 * сдвигает ни заголовок, ни вкладки, ни черту под ними. Вкладки — только если
 * роль открывает оба канала: одна вкладка ничего не выбирает.
 *
 * Высота: `window` — «Кабинет студента», `main` на высоту окна (правило
 * `100dvh` в v3.css ставит поле ответа над панелью вкладок телефона);
 * `fill` — WhatsApp, от 768 px высоту даёт колонка оболочки (`isFillRoute`),
 * ниже — обычный поток, как у `PartShell fill`.
 *
 * `threadOpen` — на узком экране открытая переписка забирает экран: заголовок
 * остаётся только для читалки, вкладки каналов уходят, «К списку» — в шапке
 * переписки.
 */
export function ConversationsMain({
  title,
  channels,
  current,
  count = null,
  threadOpen = false,
  height,
  children,
}: Readonly<{
  title: string;
  channels: readonly ConversationChannel[];
  current: ConversationChannelKey;
  /** Число текущего канала из чтения его страницы; null — числа нет. */
  count?: number | null;
  threadOpen?: boolean;
  height: "window" | "fill";
  children: ReactNode;
}>) {
  const tabs = channels.length >= 2;
  return (
    <main
      aria-label={title}
      data-conversations-main=""
      className={cn(
        "mx-auto flex w-full min-h-0 max-w-[1240px] flex-col px-4 pb-4 pt-6 sm:px-6",
        height === "window" ? "h-[calc(100dvh-150px)] md:h-[calc(100dvh-64px)]" : "md:flex-1",
      )}
    >
      <PageHeader title={title} className={threadOpen ? "@max-2xl:sr-only" : undefined} />
      {tabs ? (
        <div className={cn("mt-3 shrink-0", threadOpen && "@max-2xl:hidden")} data-conversation-channels="">
          <ConversationChannels channels={channels} current={current} count={count} />
        </div>
      ) : null}
      <div className={cn("flex min-h-0 flex-1 flex-col", tabs ? "mt-3" : "mt-5", threadOpen && "@max-2xl:mt-0")}>{children}</div>
    </main>
  );
}
