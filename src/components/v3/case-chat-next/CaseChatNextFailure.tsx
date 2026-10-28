import Link from "next/link";

import { EmptyState } from "@/components/kit/EmptyState";
import { Button } from "@/components/ui/button";
import { ChatPageShell } from "@/components/v3/chats-next/ChatPageShell";

/**
 * Список переписок не прочитался: что случилось (на виду, `role="alert"`) и «Обновить страницу» тем же адресом.
 * `forbidden` — доступ изменился; остальное — не удалось загрузить. Показывается через `CaseChatNextFailureLazy`.
 */
export function CaseChatNextFailure({ forbidden, retryHref }: Readonly<{ forbidden: boolean; retryHref: string }>) {
  return (
    <ChatPageShell variant="messages" title="Переписка" testId="v3-messages-next">
      <div role="alert" className="rounded-card border border-border bg-surface" data-testid="case-chat-error">
        <EmptyState
          tone="danger"
          title={forbidden ? "Доступ к перепискам изменился. Обновите страницу." : "Не удалось загрузить переписки. Обновите страницу."}
          action={<Button variant="outline" asChild><Link href={retryHref}>Обновить страницу</Link></Button>}
        />
      </div>
    </ChatPageShell>
  );
}
