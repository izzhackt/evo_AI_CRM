import { PageHeader, PageShell } from "@/components/kit";
import { Button } from "@/components/ui/button";

import { TeamChat } from "../TeamChat";

/**
 * «Командный чат» в новом виде: рамка страницы — шапка набора (`PageHeader`, «?») и белый лист во всю оставшуюся высоту окна с
 * тем же `TeamChat` внутри. Движок чата (опрос, живые обновления, черновики, отметки просмотра, удаление) не менялся; у чата
 * только `frame="card"`: заголовок страницы он больше не рисует. Высота — окно за вычетом верхней панели и вкладок телефона (v3.css
 * подставляет их для `main` с `100dvh` в классе); на телефоне, пока открыта переписка, шапка страницы убрана, как был убран прежний заголовок.
 */
export function TeamChatNextPage(props: Readonly<React.ComponentProps<typeof TeamChat>>) {
  return (
    <main aria-label="Командный чат" data-testid="v3-team-chat-next" className="group/chat mx-auto flex h-[calc(100dvh-150px)] min-h-0 w-full max-w-[1240px] flex-col px-4 pb-4 sm:px-6 md:h-[calc(100dvh-64px)]">
      <PageHeader title="Командный чат" help="Каналы команды и переписка: новые сообщения приходят сами. Своё сообщение можно изменить или удалить в «⋯» под ним." className="group-has-[[data-panel=messages]]/chat:max-[800px]:hidden" />
      <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-surface">
        <TeamChat {...props} frame="card" />
      </div>
    </main>
  );
}

/** Канал не прочитался: причина на виду (`role="alert"`), «Обновить канал» — ссылка на тот же канал; рамка страницы новая. */
export function TeamChatNextFailure({ text, retryHref }: Readonly<{ text: string; retryHref: string }>) {
  return (
    <PageShell title="Командный чат" testId="v3-team-chat-next-failure">
      <div className="grid justify-items-start gap-3 rounded-card border border-border bg-surface p-5">
        <p role="alert" className="t-body-compact text-danger">{text}</p>
        <Button variant="outline" asChild><a href={retryHref}>Обновить канал</a></Button>
      </div>
    </PageShell>
  );
}
