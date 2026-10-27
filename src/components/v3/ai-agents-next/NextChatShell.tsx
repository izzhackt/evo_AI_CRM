import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftIcon } from "lucide-react";

import { HelpTip } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { ChatFocusToggle } from "@/components/v3/ChatFocus";
import { AI_AGENTS_HUB_HREF } from "@/lib/v3/ai-agents-view";

/**
 * Рамка вкладки «Чат» в «Новом виде»: та же тонкая шапка в одну строку, что у `AgentChatShell` (решение владельца
 * 26.10.2026), с кнопками и «?» набора. Стрелка к списку агентов, название (единственный h1), «?» со строкой роли,
 * вкладки-ссылки, «Включён» и «Авто», «На весь экран». Высоту окна и прокрутку внутри чата, а не страницы, даёт
 * колонка оболочки (`isFillRoute`); порядок Tab и контейнерный запрос 81rem — как у прежней рамки. Лента, список
 * разговоров и поле поручения — прежний `CommandWorkspace` без изменений.
 */
export function NextChatShell({
  title, roleLine, tabs, switches, testId, children,
}: Readonly<{ title: string; roleLine: string; tabs: ReactNode; switches: ReactNode; testId: string; children: ReactNode }>) {
  return (
    <main
      data-testid={testId}
      className="flex w-full min-w-0 flex-col px-4 pb-4 pt-4 sm:px-6 md:min-h-0 md:flex-1 group-data-[chat-focus]/shell:px-3 group-data-[chat-focus]/shell:pb-3 group-data-[chat-focus]/shell:pt-2 sm:group-data-[chat-focus]/shell:px-3"
    >
      <header className="@container shrink-0" data-testid="v3-aia-chat-header">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="flex min-w-0 max-w-[22rem] items-center gap-1 @[81rem]:max-w-[19rem]">
            <Button variant="ghost" size="icon" asChild className="text-fg-2">
              <Link href={AI_AGENTS_HUB_HREF} aria-label="Все ИИ-агенты" title="Все ИИ-агенты" data-testid="v3-aia-chat-back"><ArrowLeftIcon aria-hidden="true" /></Link>
            </Button>
            <h1 className="t-page-title min-w-0 truncate text-fg">{title}</h1>
            <HelpTip label={`Пояснение: ${title}`}>{roleLine}</HelpTip>
          </div>
          <div className="ms-auto flex flex-wrap items-start justify-end gap-x-4 gap-y-1 @[81rem]:order-2">
            {switches}
            <ChatFocusToggle />
          </div>
          <div className="w-full min-w-0 @[81rem]:order-1 @[81rem]:w-auto @[81rem]:flex-[1_1_37rem]">{tabs}</div>
        </div>
      </header>
      <div className="mt-3 flex min-h-0 flex-1 flex-col">{children}</div>
    </main>
  );
}
