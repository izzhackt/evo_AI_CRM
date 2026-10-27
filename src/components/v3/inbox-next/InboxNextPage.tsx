import Link from "next/link";

import { EmptyState } from "@/components/kit/EmptyState";
import { Button } from "@/components/ui/button";
import { inboxNotConnected } from "@/components/v3/Inbox";
import { ChatPageShell } from "@/components/v3/chats-next/ChatPageShell";

import { InboxNextView } from "./InboxNextView";
import type { InboxNextThreadProps } from "./InboxNextThread";

const HELP = "Чаты WhatsApp продаж: слева диалоги, справа переписка. «Неотвеченные» ставят выше клиентов, которые написали последними. Здесь отображаются диалоги, к которым у вас есть доступ.";

/**
 * «WhatsApp» нового вида целиком: рамка страницы (число диалогов у заголовка, пояснение за «?») и либо честное «не
 * подключён» (ссылка на настройки — только у Администратора вне просмотра роли, её даёт страница), либо рабочая область.
 * Показывается через `InboxNextLazy`; данные и права страница читает до этого.
 */
export function InboxNextPage({ count, settingsHref, ...props }: Readonly<{ count: number | null; settingsHref: string | null } & InboxNextThreadProps>) {
  const notConnected = inboxNotConnected(props.view);
  return (
    <ChatPageShell variant="inbox" title="WhatsApp" count={count} help={HELP} testId="v3-whatsapp-next">
      {notConnected ? (
        <section className="rounded-card border border-border bg-surface" data-testid="v3-inbox-not-connected" data-source="supabase-platform">
          <EmptyState
            title="WhatsApp не подключён к CRM — подключает Администратор"
            action={settingsHref ? <Button variant="outline" asChild><Link href={settingsHref} data-testid="v3-inbox-settings">Открыть настройки</Link></Button> : undefined}
          />
        </section>
      ) : (
        <InboxNextView {...props} />
      )}
    </ChatPageShell>
  );
}
