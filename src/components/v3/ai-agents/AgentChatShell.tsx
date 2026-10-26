import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/icons";
import { ChatFocusToggle } from "@/components/v3/ChatFocus";
import { AI_AGENTS_HUB_HREF } from "@/lib/v3/ai-agents-view";

/**
 * Рамка вкладки «Поручить» страницы агента (решение владельца 26.10.2026: «чат
 * с агентом не на весь экран»). Вместо общей шапки страницы (`PartShell`: ссылка
 * «Все ИИ-агенты», крупный заголовок, переключатели, отдельный ряд вкладок и
 * потолок 1240 px) — тонкая шапка в одну строку: стрелка к списку агентов,
 * название, вкладки, переключатели «Включён» и «Авто» и «На весь экран». Строка
 * роли агента в этой шапке — подсказка к названию: чат её не повторяет, она
 * стоит на остальных вкладках.
 * Окно рабочей области (список разговоров и чат) получает всё остальное:
 * от 768 px страницу высотой в окно даёт колонка оболочки (`isFillRoute`),
 * поэтому ни страница, ни шапка не прокручиваются, а лента и список — сами.
 *
 * Строка в одну линию, пока в ней хватает места (контейнерный запрос по ширине
 * рабочей колонки — меню слева ширину съедает; 81rem — сумма естественных ширин
 * названия, шести вкладок и переключателей с кнопкой); уже — вкладки уходят
 * второй строкой, остальное остаётся сверху. Широкая строка переносится сама, если
 * её что-то раздвинуло (под «Авто» раскрылось подтверждение): вкладки не сжимаются
 * до прокрутки, а переключатели уходят на вторую строку. Всё прижато к верху
 * строки: название и кнопка не уезжают с места, когда шапка растёт вниз. При «На весь экран» поля вокруг чата
 * тоньше (`data-chat-focus` оболочки). На телефоне шапка — только для читалки
 * (v3.css, `main:has([data-aia-workspace])`): чат занимает экран между строкой
 * логотипа и вкладками, к разделам агента ведёт стрелка над чатом.
 */
export function AgentChatShell({
  title,
  roleLine,
  tabs,
  switches,
  testId,
  children,
}: Readonly<{
  title: string;
  /** Строка роли агента (`aiAgentRoleLine`): подсказка к названию. */
  roleLine: string;
  tabs: ReactNode;
  /** Переключатели «Включён» и «Авто» (`AgentSwitches`). */
  switches: ReactNode;
  testId: string;
  children: ReactNode;
}>) {
  return (
    <main
      data-testid={testId}
      className="flex w-full min-w-0 flex-col px-4 pb-4 pt-4 sm:px-6 md:min-h-0 md:flex-1 group-data-[chat-focus]/shell:px-3 group-data-[chat-focus]/shell:pb-3 group-data-[chat-focus]/shell:pt-2 sm:group-data-[chat-focus]/shell:px-3"
    >
      <header className="@container shrink-0" data-testid="v3-aia-chat-header">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="flex min-w-0 max-w-[22rem] items-center gap-1 @[81rem]:max-w-[19rem]">
            <Link
              href={AI_AGENTS_HUB_HREF}
              aria-label="Все ИИ-агенты"
              title="Все ИИ-агенты"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-ctl text-fg-2 hover:bg-surface-2 hover:text-fg"
              data-testid="v3-aia-chat-back"
            >
              <Icon name="arrow-left" size={18} />
            </Link>
            <h1 className="t-page-title min-w-0 truncate text-fg" title={roleLine}>{title}</h1>
          </div>
          <div className="order-last w-full min-w-0 @[81rem]:order-none @[81rem]:w-auto @[81rem]:flex-[1_1_37rem]">{tabs}</div>
          <div className="ms-auto flex flex-wrap items-start justify-end gap-x-4 gap-y-1">
            {switches}
            <ChatFocusToggle />
          </div>
        </div>
      </header>
      <div className="mt-3 flex min-h-0 flex-1 flex-col">{children}</div>
    </main>
  );
}
