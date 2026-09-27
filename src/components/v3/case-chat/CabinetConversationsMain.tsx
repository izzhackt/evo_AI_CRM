import type { ReactNode } from "react";

import { PageHeader } from "@/components/ui";
import type { ConversationChannel } from "@/lib/v3/navigation";

import { ConversationChannels } from "../ConversationChannels";

/**
 * Страница «Переписки» → «Кабинет студента» (Э5): заголовок «Переписки»,
 * вкладки каналов и рабочая часть (`CaseChatWorkspace`) на высоту окна —
 * список и лента прокручиваются внутри себя, поле ответа стоит внизу. На
 * телефоне открытая переписка забирает экран: каналы видны в списке.
 */
export function CabinetConversationsMain({
  title,
  channels,
  threadOpen,
  children,
}: Readonly<{
  title: string;
  channels: readonly ConversationChannel[];
  threadOpen: boolean;
  children: ReactNode;
}>) {
  return (
    <main className="mx-auto flex h-[calc(100dvh-150px)] w-full min-h-0 max-w-[1240px] flex-col px-4 pb-4 pt-6 sm:px-6 md:h-[calc(100dvh-64px)]" aria-label={title}>
      <PageHeader title={title} />
      <div className={threadOpen ? "mt-3 hidden @2xl:block" : "mt-3"}>
        <ConversationChannels channels={channels} current="cabinet" />
      </div>
      <div className="mt-3 flex min-h-0 flex-1 flex-col">{children}</div>
    </main>
  );
}
