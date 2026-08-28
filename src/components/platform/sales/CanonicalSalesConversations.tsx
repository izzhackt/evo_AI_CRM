import Link from "next/link";

import {
  CanonicalKeyBadge,
  formatCanonicalTimestamp,
} from "@/components/platform/core/CanonicalRecordsPresentation";
import { EmptyState, btnGhostCls, cn } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import type {
  CanonicalConversationMessage,
  CanonicalLeadConversationSummary,
} from "@/lib/server/canonical-crm-repository";

const COPY = {
  ru: {
    conversations: "Диалоги WhatsApp",
    conversationsDescription:
      "Входящие диалоги этого лида, сохранённые в локальной базе EVO.",
    emptyConversations: "У этого лида пока нет сохранённых диалогов.",
    openConversation: "Открыть переписку",
    updated: "Обновлено",
    back: "К лиду",
    transcript: "Переписка WhatsApp · только чтение",
    transcriptDescription:
      "Сообщения показаны от новых к старым. Отправка, автоответы и AI-действия на этой странице отсутствуют.",
    emptyMessages: "В этой переписке пока нет сообщений.",
    unavailable:
      "Переписка недоступна. EVO не подставляет данные из старого или резервного источника.",
    newest: "К новым сообщениям",
    older: "Более старые сообщения",
    incoming: "Входящее",
    outgoing: "Исходящее · история",
    providerBlocked:
      "Реальный WAHA-провайдер не проверялся и не подключался: эта локальная страница доказывает только сохранение и чтение данных в EVO.",
  },
  ky: {
    conversations: "WhatsApp диалогдору",
    conversationsDescription:
      "Бул лиддин EVO локалдык базасында сакталган кирүүчү диалогдору.",
    emptyConversations: "Бул лид үчүн сакталган диалогдор азырынча жок.",
    openConversation: "Кат алышууну ачуу",
    updated: "Жаңыртылды",
    back: "Лидге",
    transcript: "WhatsApp кат алышуусу · окуу гана",
    transcriptDescription:
      "Билдирүүлөр жаңысынан эскисине көрсөтүлөт. Бул баракта жөнөтүү, авто-жооп жана AI аракеттери жок.",
    emptyMessages: "Бул кат алышууда билдирүүлөр азырынча жок.",
    unavailable:
      "Кат алышуу жеткиликсиз. EVO эски же резервдик булактан маалымат койбойт.",
    newest: "Жаңы билдирүүлөргө",
    older: "Мурунку билдирүүлөр",
    incoming: "Кирген",
    outgoing: "Чыккан · тарых",
    providerBlocked:
      "Чыныгы WAHA провайдери текшерилген же туташтырылган эмес: бул локалдык барак EVOдо маалыматтын сакталышын жана окулушун гана далилдейт.",
  },
  en: {
    conversations: "WhatsApp conversations",
    conversationsDescription:
      "Inbound conversations for this lead persisted in EVO's local database.",
    emptyConversations: "This lead has no persisted conversations yet.",
    openConversation: "Open transcript",
    updated: "Updated",
    back: "Back to lead",
    transcript: "WhatsApp transcript · read-only",
    transcriptDescription:
      "Messages are shown newest first. Sending, automated replies, and AI actions are absent from this page.",
    emptyMessages: "There are no messages in this transcript yet.",
    unavailable:
      "The transcript is unavailable. EVO does not substitute legacy or secondary data.",
    newest: "Newest messages",
    older: "Older messages",
    incoming: "Incoming",
    outgoing: "Outgoing · history",
    providerBlocked:
      "A real WAHA provider was not tested or connected. This local page proves only persistence and reading inside EVO.",
  },
} as const;

export function CanonicalSalesConversationList({
  leadId,
  conversations,
  locale,
}: Readonly<{
  leadId: string;
  conversations: readonly CanonicalLeadConversationSummary[];
  locale: Locale;
}>) {
  const copy = COPY[locale];

  return (
    <section
      className="space-y-4 border-y border-border py-5"
      data-testid="canonical-sales-conversations"
    >
      <div>
        <h2 className="text-[16px] font-bold text-fg">{copy.conversations}</h2>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-5 text-fg-3">
          {copy.conversationsDescription}
        </p>
      </div>

      <ProviderBlockedNotice locale={locale} />

      {conversations.length === 0 ? (
        <EmptyState text={copy.emptyConversations} />
      ) : (
        <ol className="divide-y divide-border border-y border-border">
          {conversations.map((conversation) => (
            <li key={conversation.conversationId} className="py-3">
              <Link
                href={`/sales/${leadId}/conversations/${conversation.conversationId}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-sm px-2 py-1 transition-colors hover:bg-bg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                data-testid="canonical-sales-conversation-link"
                data-conversation-id={conversation.conversationId}
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-fg">
                    {copy.openConversation}
                  </span>
                  <span className="mt-1 block break-all font-mono text-[10.5px] text-fg-3">
                    {conversation.conversationId}
                  </span>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-2">
                  <CanonicalKeyBadge value={conversation.channel} tone="accent" />
                  <CanonicalKeyBadge
                    value={conversation.status}
                    tone={conversation.status === "open" ? "ok" : "neutral"}
                  />
                  <span className="text-[11px] text-fg-3">
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
  conversation: CanonicalLeadConversationSummary;
  messages: readonly CanonicalConversationMessage[];
  locale: Locale;
  newestMessagesHref: string | null;
  olderMessagesHref: string | null;
}>) {
  const copy = COPY[locale];

  return (
    <div
      className="min-w-0 space-y-5"
      data-testid="canonical-sales-transcript"
      data-provider-proof="not-proved"
    >
      <div className="space-y-3 border-b border-border pb-4">
        <Link href={`/sales/${leadId}`} className={btnGhostCls}>
          ← {copy.back}
        </Link>
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-accent">
            {copy.transcript}
          </div>
          <p className="mt-2 max-w-3xl text-[12.5px] leading-5 text-fg-3">
            {copy.transcriptDescription}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CanonicalKeyBadge value={conversation.channel} tone="accent" />
          <CanonicalKeyBadge
            value={conversation.status}
            tone={conversation.status === "open" ? "ok" : "neutral"}
          />
        </div>
      </div>

      <ProviderBlockedNotice locale={locale} />

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
                key={message.messageId}
                className="grid gap-2 py-4 sm:grid-cols-[130px_minmax(0,1fr)]"
                data-testid="canonical-sales-message"
                data-message-id={message.messageId}
                data-message-direction={message.direction}
              >
                <div className="text-[11px] text-fg-3">
                  <div
                    className={cn(
                      "font-semibold",
                      outgoing ? "text-fg-2" : "text-accent",
                    )}
                  >
                    {outgoing ? copy.outgoing : copy.incoming}
                  </div>
                  <time className="mt-1 block font-mono">
                    {formatCanonicalTimestamp(message.occurredAt, locale)}
                  </time>
                </div>
                <p className="min-w-0 whitespace-pre-wrap break-words text-[13px] leading-6 text-fg">
                  {message.body}
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
      <p className="max-w-2xl text-[13px] leading-6 text-fg-3">
        {copy.unavailable}
      </p>
    </div>
  );
}

function ProviderBlockedNotice({ locale }: Readonly<{ locale: Locale }>) {
  return (
    <aside
      className="border-l-[3px] border-warn bg-warn-weak/40 px-4 py-3 text-[12px] leading-5 text-fg-2"
      data-testid="canonical-whatsapp-provider-blocked"
    >
      {COPY[locale].providerBlocked}
    </aside>
  );
}
