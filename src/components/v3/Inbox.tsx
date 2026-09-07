import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/icons";
import { InboxMessageMedia } from "@/components/v3/inbox/InboxMessageMedia";
import { Pill } from "@/components/v3/Pill";
import type {
  V3InboxMediaAttachmentContext,
  V3InboxMessageMedia,
} from "@/lib/v3/inbox-media";

export type InboxMessage = Readonly<{
  id: string;
  inbound: boolean;
  body: string;
  /** `30.08 09:14`; null means the canonical timestamp is unavailable. */
  at: string | null;
  media: readonly V3InboxMessageMedia[];
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
  waitingSince: string | null;
  awaitingReplyFor: string | null;
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
  searchQuery: string | null;
  waitingOnly: boolean;
  waitingToggleHref: string;
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
  mediaAttachmentContext = null,
}: Readonly<{
  view: InboxView;
  profileHref: string | null;
  workflowControls?: ReactNode;
  amoCrmControls?: ReactNode;
  mediaAttachmentContext?: V3InboxMediaAttachmentContext | null;
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
        <form
          action="/v3/inbox"
          method="get"
          role="search"
          className="border-b border-border p-3"
        >
          {view.waitingOnly ? (
            <input type="hidden" name="waiting" value="1" />
          ) : null}
          <label htmlFor="v3-inbox-search" className="sr-only">
            Найти диалог
          </label>
          <div className="flex gap-2">
            <input
              id="v3-inbox-search"
              name="q"
              type="search"
              maxLength={200}
              defaultValue={view.searchQuery ?? ""}
              placeholder="Имя, телефон или тема"
              className="min-h-10 min-w-0 flex-1 rounded-ctl border border-border bg-canvas px-3 text-sm text-fg outline-none focus:border-accent"
            />
            <button
              type="submit"
              className="min-h-10 rounded-ctl bg-accent px-3 text-xs font-semibold text-on-accent"
            >
              Найти
            </button>
          </div>
          <Link
            href={view.waitingToggleHref}
            className={`mt-2 inline-flex min-h-9 items-center rounded-ctl px-2.5 text-xs font-semibold ${
              view.waitingOnly
                ? "bg-warn-weak text-warn"
                : "bg-surface-2 text-fg-2 hover:text-fg"
            }`}
            data-testid="v3-inbox-waiting-filter"
          >
            {view.waitingOnly ? "Показать все" : "Только ждут ответа"}
          </Link>
        </form>

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
                  {conversation.waitingSince ? (
                    <span className="text-2xs font-medium text-warn">
                      Ждёт ответа с {conversation.waitingSince}
                      {conversation.awaitingReplyFor
                        ? ` · ${conversation.awaitingReplyFor}`
                        : ""}
                    </span>
                  ) : null}
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
              {/* Имя не сжимается первым: при нехватке ширины пилюля
                  переносится на свою строку, а заголовок остаётся целым. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="min-w-0 text-md font-bold text-fg">
                  {open.person}
                </h2>
                {open.waitingSince ? (
                  <Pill tone="warn">
                    Ждёт ответа с {open.waitingSince}
                    {open.awaitingReplyFor ? ` · ${open.awaitingReplyFor}` : ""}
                  </Pill>
                ) : null}
              </div>
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

          <div
            role="region"
            aria-label="Лента переписки"
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto"
          >
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
                    <InboxMessageMedia
                      items={message.media}
                      inbound={message.inbound}
                      attachmentContext={mediaAttachmentContext}
                    />
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
