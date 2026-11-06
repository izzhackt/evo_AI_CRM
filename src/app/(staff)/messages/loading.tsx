import { SkeletonBlock } from "@/components/ui";
import { ChatPageShell } from "@/components/staff/chats-next/ChatPageShell";

/** Загрузка «Переписки»: та же рамка `ChatPageShell`, что у страницы, — без прыжка раскладки. */
export default function MessagesLoading() {
  return (
    <ChatPageShell variant="messages" title="Переписка">
      <p role="status" className="sr-only">Загружаем переписки…</p>
      <div
        aria-busy="true"
        aria-label="Переписки"
        className="grid min-h-0 flex-1 overflow-hidden rounded-card border border-border bg-surface @4xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]"
      >
        <div className="flex min-h-0 flex-col border-border @4xl:border-e">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="border-b border-border p-3">
              <SkeletonBlock className="h-10" />
            </div>
          ))}
        </div>
        <div className="hidden bg-bg @4xl:block" />
      </div>
    </ChatPageShell>
  );
}
