import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/icons";

export type InboxMessage = Readonly<{
  id: string;
  inbound: boolean;
  body: string;
  /** `30.08 09:14`; null means the canonical timestamp is unavailable. */
  at: string | null;
}>;

export type InboxCanonicalContext = Readonly<{
  leadId: string | null;
  clientId: string | null;
  studentCaseId: string | null;
}>;

export type InboxConversation = Readonly<{
  id: string;
  person: string;
  /** Kept for server command scope; intentionally not rendered as a raw role. */
  queue: "sales" | "admissions";
  /** Kept in the model; intentionally omitted while it adds no operator decision. */
  status: "open" | "closed";
  updatedAt: string;
  href: string;
}>;

export type InboxSelectedConversation = InboxConversation &
  Readonly<{
    messages: readonly InboxMessage[];
    latestInboundSourceMessageId: string | null;
    newestMessagesHref: string | null;
    olderMessagesHref: string | null;
    channelState: "ready" | "attention" | "unknown";
    channelObservedAt: string | null;
    canonicalContext: InboxCanonicalContext;
  }>;

export type InboxView = Readonly<{
  conversations: readonly InboxConversation[];
  selected: InboxSelectedConversation | null;
  queueCurrentHref: string;
  queueNewestHref: string | null;
  queueOlderHref: string | null;
}>;

function channelLabel(
  state: InboxSelectedConversation["channelState"],
): string {
  if (state === "ready") return "WhatsApp подключён";
  if (state === "attention") return "WhatsApp требует проверки";
  return "Состояние WhatsApp не подтверждено";
}

export function Inbox({
  view,
  profileHref,
  workflowControls,
  amoCrmControls,
}: Readonly<{
  view: InboxView;
  profileHref: string | null;
  workflowControls?: ReactNode;
  amoCrmControls?: ReactNode;
}>) {
  const open = view.selected;

  return (
    <div
      className="grid min-h-0 flex-1 gap-4 @4xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]"
      data-testid="v3-inbox"
      data-source="supabase-platform"
    >
      <section
        aria-label="Диалоги"
        tabIndex={0}
        className={`min-w-0 overflow-y-auto rounded-card border border-border bg-surface ${
          open ? "hidden @4xl:block" : ""
        }`}
      >
        <nav
          aria-label="Страницы диалогов"
          className="flex min-h-12 items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs"
        >
          {view.queueNewestHref ? (
            <Link
              href={view.queueNewestHref}
              className="inline-flex min-h-9 items-center rounded-ctl px-2 text-fg-2 hover:bg-surface-2"
              data-testid="v3-inbox-queue-newest"
            >
              ← К новым
            </Link>
          ) : (
            <span />
          )}
          {view.queueOlderHref ? (
            <Link
              href={view.queueOlderHref}
              rel="next"
              className="inline-flex min-h-9 items-center rounded-ctl px-2 text-fg-2 hover:bg-surface-2"
              data-testid="v3-inbox-queue-older"
            >
              Ранее →
            </Link>
          ) : null}
        </nav>

        <ol>
          {view.conversations.map((conversation) => {
            const active = conversation.id === open?.id;
            return (
              <li
                key={conversation.id}
                className="border-b border-border last:border-b-0"
                data-testid="v3-inbox-row"
                data-conversation-id={conversation.id}
              >
                <Link
                  href={conversation.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-20 w-full flex-col justify-center gap-1 px-4 py-3 text-start ${
                    active ? "bg-surface-2" : "hover:bg-surface-2"
                  }`}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
                      {conversation.person}
                    </span>
                    <span className="shrink-0 font-mono text-2xs text-fg-3">
                      {conversation.updatedAt}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
          {view.conversations.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-fg-3">
              Диалогов нет.
            </li>
          ) : null}
        </ol>
      </section>

      {open ? (
        <section
          aria-label={`Переписка: ${open.person}`}
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card border border-border bg-surface"
          data-testid="v3-inbox-thread"
          data-conversation-id={open.id}
        >
          <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
            <Link
              href={view.queueCurrentHref}
              className="-ms-1 grid h-8 w-8 shrink-0 place-items-center rounded-nav text-fg-2 hover:bg-surface-2 @4xl:hidden"
            >
              <span className="sr-only">Назад к списку диалогов</span>
              <Icon name="arrow-left" size={16} />
            </Link>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-md font-bold text-fg">{open.person}</h2>
              <p className="mt-0.5 text-2xs text-fg-3">
                {channelLabel(open.channelState)}
                {open.channelObservedAt
                  ? ` · проверено ${open.channelObservedAt}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {profileHref ? (
                <Link
                  href={profileHref}
                  className="inline-flex min-h-9 items-center rounded-ctl px-2.5 text-xs font-semibold text-accent hover:bg-accent-weak"
                >
                  Открыть профиль
                </Link>
              ) : null}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto" tabIndex={0}>
            <div className="px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-2 text-xs">
                {open.newestMessagesHref ? (
                  <Link
                    href={open.newestMessagesHref}
                    className="inline-flex min-h-9 items-center rounded-ctl px-2 text-fg-2 hover:bg-surface-2"
                    data-testid="v3-inbox-messages-newest"
                  >
                    ← К новым сообщениям
                  </Link>
                ) : (
                  <span />
                )}
                {open.olderMessagesHref ? (
                  <Link
                    href={open.olderMessagesHref}
                    rel="next"
                    className="inline-flex min-h-9 items-center rounded-ctl px-2 text-fg-2 hover:bg-surface-2"
                    data-testid="v3-inbox-messages-older"
                  >
                    Ранее →
                  </Link>
                ) : null}
              </div>

              <ol
                className="flex flex-col gap-2.5"
                aria-label="Сообщения"
                data-testid="v3-inbox-messages"
              >
                {open.messages.map((message) => (
                  <li
                    key={message.id}
                    className={`max-w-[min(560px,88%)] rounded-ctl px-3 py-2 ${
                      message.inbound
                        ? "self-start border border-border bg-surface-2"
                        : "self-end bg-accent text-on-accent"
                    }`}
                  >
                    <p
                      className={`whitespace-pre-wrap text-sm leading-5 ${
                        message.inbound ? "text-fg" : "text-on-accent"
                      }`}
                    >
                      {message.body}
                    </p>
                    {message.at ? (
                      <p
                        className={`mt-1 font-mono text-2xs ${
                          message.inbound ? "text-fg-3" : "text-on-accent"
                        }`}
                      >
                        {message.at}
                      </p>
                    ) : null}
                  </li>
                ))}
                {open.messages.length === 0 ? (
                  <li className="py-8 text-center text-sm text-fg-3">
                    В этой переписке пока нет сообщений.
                  </li>
                ) : null}
              </ol>
            </div>

            {workflowControls ? (
              <div className="border-t border-border px-4 py-5">
                {workflowControls}
              </div>
            ) : null}
            {amoCrmControls ? (
              <div className="border-t border-border px-4 py-5">
                {amoCrmControls}
              </div>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="hidden place-items-center rounded-card border border-border bg-surface p-8 text-center text-sm text-fg-3 @4xl:grid">
          <div>
            <p className="font-semibold text-fg-2">Выберите диалог</p>
            <p className="mt-1">Откройте переписку из списка слева.</p>
          </div>
        </section>
      )}
    </div>
  );
}
