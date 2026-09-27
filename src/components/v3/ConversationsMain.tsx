import type { ReactNode } from "react";

import { PageHeader, cn } from "@/components/ui";

/**
 * Шапка страницы «Переписка со студентами» (`/v3/messages`, пункт
 * «Поступления» — решение владельца 27.09.2026): заголовок и рабочая часть
 * переписки по делу. Вкладок каналов нет: WhatsApp продаж — отдельная
 * страница в «Продажах».
 *
 * Высота — окна: `main` на высоту окна (правило `100dvh` в v3.css ставит
 * поле ответа над панелью вкладок телефона).
 *
 * `threadOpen` — на узком экране открытая переписка забирает экран: заголовок
 * остаётся только для читалки, «К списку» — в шапке переписки.
 */
export function ConversationsMain({
  title,
  threadOpen = false,
  children,
}: Readonly<{
  title: string;
  threadOpen?: boolean;
  children: ReactNode;
}>) {
  return (
    <main
      aria-label={title}
      data-conversations-main=""
      className="mx-auto flex w-full min-h-0 max-w-[1240px] flex-col px-4 pb-4 pt-6 sm:px-6 h-[calc(100dvh-150px)] md:h-[calc(100dvh-64px)]"
    >
      <PageHeader title={title} className={threadOpen ? "@max-2xl:sr-only" : undefined} />
      <div className={cn("mt-5 flex min-h-0 flex-1 flex-col", threadOpen && "@max-2xl:mt-0")}>{children}</div>
    </main>
  );
}
