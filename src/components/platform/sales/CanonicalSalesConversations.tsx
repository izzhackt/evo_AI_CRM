import Link from "next/link";

import {
  CanonicalKeyBadge,
  formatCanonicalTimestamp,
} from "@/components/platform/core/CanonicalRecordsPresentation";
import { EmptyState, btnGhostCls, cn } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import type {
  PlatformConversationMessage,
  PlatformConversationSummary,
} from "@/lib/platform-communications";
import type { PlatformSalesLinkedConversation } from "@/lib/platform-sales";

const COPY = {
  ru: {
    conversations: "Диалоги WhatsApp",
    conversationsDescription:
      "Связанные диалоги этого лида читаются из канонической Supabase Platform через RLS.",
    emptyConversations: "У этого лида пока нет сохранённых диалогов.",
    openConversation: "Открыть переписку",
    updated: "Обновлено",
    back: "К лиду",
    transcript: "Переписка WhatsApp · только чтение",
    transcriptDescription:
      "Сообщения показаны по времени от старых к новым. Отправка, автоответы и AI-действия на этой странице отсутствуют.",
    emptyMessages: "В этой переписке пока нет сообщений.",
    unavailable:
      "Переписка недоступна. EVO не подставляет данные из старого или резервного источника.",
    newest: "К новым сообщениям",
    older: "Более старые сообщения",
    incoming: "Входящее",
    outgoing: "Исходящее · история",
  },
  ky: {
    conversations: "WhatsApp диалогдору",
    conversationsDescription:
      "Бул лидге байланышкан диалогдор каноникалык Supabase Platform'дан RLS аркылуу окулат.",
    emptyConversations: "Бул лид үчүн сакталган диалогдор азырынча жок.",
    openConversation: "Кат алышууну ачуу",
    updated: "Жаңыртылды",
    back: "Лидге",
    transcript: "WhatsApp кат алышуусу · окуу гана",
    transcriptDescription:
      "Билдирүүлөр убакыт боюнча эскисинен жаңысына көрсөтүлөт. Бул баракта жөнөтүү, авто-жооп жана AI аракеттери жок.",
    emptyMessages: "Бул кат алышууда билдирүүлөр азырынча жок.",
    unavailable:
      "Кат алышуу жеткиликсиз. EVO эски же резервдик булактан маалымат койбойт.",
    newest: "Жаңы билдирүүлөргө",
    older: "Мурунку билдирүүлөр",
    incoming: "Кирген",
    outgoing: "Чыккан · тарых",
  },
  en: {
    conversations: "WhatsApp conversations",
    conversationsDescription:
      "Conversations linked to this lead are read from canonical Supabase Platform through RLS.",
    emptyConversations: "This lead has no persisted conversations yet.",
    openConversation: "Open transcript",
    updated: "Updated",
    back: "Back to lead",
    transcript: "WhatsApp transcript · read-only",
    transcriptDescription:
      "Messages are shown oldest to newest. Sending, automated replies, and AI actions are absent from this page.",
    emptyMessages: "There are no messages in this transcript yet.",
    unavailable:
      "The transcript is unavailable. EVO does not substitute legacy or secondary data.",
    newest: "Newest messages",
    older: "Older messages",
    incoming: "Incoming",
    outgoing: "Outgoing · history",
  },
} as const;

export function CanonicalSalesConversationList({
  leadId,
  conversations,
  locale,
}: Readonly<{
  leadId: string;
  conversations: readonly PlatformSalesLinkedConversation[];
  locale: Locale;
}>) {
  const copy = COPY[locale];

  return (
    <section
      className="space-y-4 border-y border-border py-5"
      data-testid="canonical-sales-conversations"
    >
      <div>
        <h2 className="text-lg font-bold text-fg">{copy.conversations}</h2>
        <p className="mt-1 max-w-[56ch] text-sm leading-5 text-fg-3">
          {copy.conversationsDescription}
        </p>
      </div>

      {conversations.length === 0 ? (
        <EmptyState text={copy.emptyConversations} />
      ) : (
        <ol className="divide-y divide-border border-y border-border">
          {conversations.map((conversation) => (
            <li key={conversation.conversationId} className="py-3">
              <Link
                href={`/sales/${leadId}/conversations/${conversation.conversationId}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-sm px-2 py-1 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                data-testid="canonical-sales-conversation-link"
                data-conversation-id={conversation.conversationId}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-fg">
                    {copy.openConversation}
                  </span>
                  <span className="mt-1 block break-all font-mono text-2xs text-fg-3">
                    {conversation.conversationId}
                  </span>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <CanonicalKeyBadge value={conversation.queue} tone="accent" />
                  <CanonicalKeyBadge
                    value={conversation.status}
                    tone={conversation.status === "open" ? "ok" : "neutral"}
                  />
                  <span className="text-xs text-fg-3">
                    {copy.updated}: {formatCanonicalTimestamp(conversation.updatedAt, locale)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function CanonicalSalesConversationTranscript({
  leadId,
  conversation,
  messages,
  locale,
  newestMessagesHref,
  olderMessagesHref,
}: Readonly<{
  leadId: string;
  conversation: PlatformConversationSummary;
  messages: readonly PlatformConversationMessage[];
  locale: Locale;
  newestMessagesHref: string | null;
  olderMessagesHref: string | null;
}>) {
  const copy = COPY[locale];

  return (
    <div
      className="min-w-0 space-y-5"
      data-testid="canonical-sales-transcript"
    >
      <div className="space-y-3 border-b border-border pb-4">
        <Link href={`/sales/${leadId}`} className={btnGhostCls}>
          ← {copy.back}
        </Link>
        <div>
          <h2 className="text-md font-semibold text-fg">{copy.transcript}</h2>
          <p className="mt-2 max-w-[56ch] text-sm leading-5 text-fg-3">
            {copy.transcriptDescription}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CanonicalKeyBadge value={conversation.queue} tone="accent" />
          <CanonicalKeyBadge
            value={conversation.status}
            tone={conversation.status === "open" ? "ok" : "neutral"}
          />
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="border-y border-border">
          <EmptyState text={copy.emptyMessages} />
        </div>
      ) : (
        <ol className="divide-y divide-border border-y border-border">
          {messages.map((message) => {
            const outgoing = message.direction === "outbound";
            return (
              <li
                key={message.id}
                className="grid gap-2 py-4 sm:grid-cols-[130px_minmax(0,1fr)]"
                data-testid="canonical-sales-message"
                data-message-id={message.id}
                data-message-direction={message.direction}
              >
                <div className="text-xs text-fg-3">
                  <div
                    className={cn(
                      "font-semibold",
                      outgoing ? "text-fg-2" : "text-accent",
                    )}
                  >
                    {outgoing ? copy.outgoing : copy.incoming}
                  </div>
                  <time className="mt-1 block font-mono">
                    {formatCanonicalTimestamp(message.createdAt, locale)}
                  </time>
                </div>
                <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6 text-fg">
                  {message.bodyText}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {newestMessagesHref || olderMessagesHref ? (
        <nav
          className="flex items-center justify-between gap-3"
          aria-label={copy.transcript}
        >
          {newestMessagesHref ? (
            <Link href={newestMessagesHref} className={btnGhostCls}>
              ← {copy.newest}
            </Link>
          ) : (
            <span />
          )}
          {olderMessagesHref ? (
            <Link href={olderMessagesHref} className={btnGhostCls} rel="next">
              {copy.older} →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

export function CanonicalSalesTranscriptUnavailable({
  leadId,
  locale,
}: Readonly<{ leadId: string; locale: Locale }>) {
  const copy = COPY[locale];
  return (
    <div
      className="space-y-4 border-y border-border py-8"
      data-testid="canonical-records-unavailable"
    >
      <Link href={`/sales/${leadId}`} className={btnGhostCls}>
        ← {copy.back}
      </Link>
      <p className="max-w-[56ch] text-sm leading-6 text-fg-3">
        {copy.unavailable}
      </p>
    </div>
  );
}
