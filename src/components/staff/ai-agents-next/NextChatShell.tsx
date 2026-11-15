import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftIcon } from "lucide-react";

import { HelpTip } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { ChatFocusToggle } from "@/components/staff/ChatFocus";
import { AI_AGENTS_HUB_HREF } from "@/lib/v3/ai-agents-view";

/**
 * Рамка вкладки «Чат» в «Новом виде»: та же тонкая шапка в одну строку, что у `AgentChatShell` (решение владельца
 * 26.10.2026), с кнопками и «?» набора. Стрелка к списку агентов, маскот, название (единственный h1), «?» со строкой роли,
 * вкладки-ссылки, «Включён» и «Авто», «На весь экран». Высоту окна и прокрутку внутри чата, а не страницы, даёт
 * колонка оболочки (`isFillRoute`); порядок Tab — как у прежней рамки. Лента, список разговоров и поле поручения —
 * прежний `CommandWorkspace` без изменений.
 *
 * Ширина названия (отзыв к #1451): самое длинное, «Директор / Аналитик», занимает 250 px, а вместе со стрелкой (44), маскотом (40),
 * «?» (24) и зазорами — 370 px, поэтому название агента — до 25rem и не обрезается; прежние 22rem и 19rem оставляли ему 232 и 184 px.
 * Шесть вкладок со значками (14.11.2026) занимают 771 px, с трёхзначным числом на «На одобрение» — до 816 px, и не должны обрезаться:
 * в одну линию название (370 px), вкладки (51rem, 816 px) и переключатели (382 px) собираются от 100rem колонки (окно от 1908 px;
 * прежние 90rem и 40rem считались под вкладки без значков в 643 px); уже — вкладки второй строкой на всю ширину.
 */
export function NextChatShell({
  title, leading = null, roleLine, tabs, switches, testId, children,
}: Readonly<{ title: string; leading?: ReactNode; roleLine: string; tabs: ReactNode; switches: ReactNode; testId: string; children: ReactNode }>) {
  return (
    <main
      data-testid={testId}
      className="flex w-full min-w-0 flex-col px-4 pb-4 pt-4 sm:px-6 md:min-h-0 md:flex-1 group-data-[chat-focus]/shell:px-3 group-data-[chat-focus]/shell:pb-3 group-data-[chat-focus]/shell:pt-2 sm:group-data-[chat-focus]/shell:px-3"
    >
      <header className="@container shrink-0" data-testid="v3-aia-chat-header">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="flex min-w-0 max-w-[25rem] items-center gap-1">
            <Button variant="ghost" size="icon" asChild className="text-fg-2">
              <Link href={AI_AGENTS_HUB_HREF} aria-label="Все ИИ-агенты" title="Все ИИ-агенты" data-testid="v3-aia-chat-back"><ArrowLeftIcon aria-hidden="true" /></Link>
            </Button>
            {leading}
            <h1 className="t-page-title min-w-0 truncate text-fg">{title}</h1>
            <HelpTip label={`Пояснение: ${title}`}>{roleLine}</HelpTip>
          </div>
          <div className="ms-auto flex flex-wrap items-start justify-end gap-x-4 gap-y-1 @[100rem]:order-2">
            {switches}
            <ChatFocusToggle />
          </div>
          <div className="w-full min-w-0 @[100rem]:order-1 @[100rem]:w-auto @[100rem]:flex-[1_1_51rem]">{tabs}</div>
        </div>
      </header>
      <div className="mt-3 flex min-h-0 flex-1 flex-col">{children}</div>
    </main>
  );
}
