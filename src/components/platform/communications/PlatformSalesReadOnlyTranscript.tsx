import Link from "next/link";

import {
  CanonicalKeyBadge,
  formatCanonicalTimestamp,
  humanizeCanonicalKey,
} from "@/components/platform/core/CanonicalRecordsPresentation";
import { EmptyState, btnGhostCls, cn } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import type {
  PlatformConversationMessage,
  PlatformConversationSummary,
} from "@/lib/platform-communications";

const COPY = {
  ru: {
    back: "К лиду",
    eyebrow: "Входящий WhatsApp · только чтение",
    description:
      "Эта страница показывает сохранённую переписку. Отправка сообщений, автоответы и изменение данных здесь отключены.",
    empty: "В этой переписке пока нет доступных сообщений.",
    unavailable: "Переписка временно недоступна. Непроверенные данные не подставляются.",
    newest: "К новым сообщениям",
    older: "Более старые сообщения",
    incoming: "Входящее",
    historicalOutgoing: "Исходящее · история",
    noText: "Сообщение без доступного текста",
    attachments: "Вложения",
    unnamedFile: "Файл без имени",
  },
  ky: {
    back: "Лидге",
    eyebrow: "Кирген WhatsApp · окуу гана",
    description:
      "Бул барак сакталган кат алышууну көрсөтөт. Билдирүү жөнөтүү, авто-жооп жана маалыматты өзгөртүү өчүрүлгөн.",
    empty: "Бул кат алышууда жеткиликтүү билдирүүлөр азырынча жок.",
    unavailable: "Кат алышуу убактылуу жеткиликсиз. Текшерилбеген маалымат көрсөтүлбөйт.",
    newest: "Жаңы билдирүүлөргө",
    older: "Мурунку билдирүүлөр",
    incoming: "Кирген",
    historicalOutgoing: "Чыккан · тарых",
    noText: "Тексти жеткиликсиз билдирүү",
    attachments: "Тиркемелер",
    unnamedFile: "Аты жок файл",
  },
  en: {
    back: "Back to lead",
    eyebrow: "Incoming WhatsApp · read-only",
    description:
      "This page shows the persisted transcript. Message sending, auto-replies, and data mutations are disabled here.",
    empty: "There are no accessible messages in this transcript yet.",
    unavailable: "The transcript is temporarily unavailable. Unverified data is not substituted.",
    newest: "Newest messages",
    older: "Older messages",
    incoming: "Incoming",
    historicalOutgoing: "Outgoing · history",
    noText: "Message text is unavailable",
    attachments: "Attachments",
    unnamedFile: "Unnamed file",
  },
} as const;

export function PlatformSalesReadOnlyTranscript({
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
      data-testid="platform-sales-conversation-thread"
      data-provider-proof="not-proved"
    >
      <div className="space-y-3 border-b border-border pb-4">
        <Link href={`/sales/${leadId}`} className={btnGhostCls}>
          ← {copy.back}
        </Link>
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-accent">
            {copy.eyebrow}
          </div>
          <h1 className="mt-1 text-[22px] font-bold tracking-tight text-fg">
            {conversation.subject}
          </h1>
          <p className="mt-2 max-w-3xl text-[12.5px] leading-5 text-fg-3">
            {copy.description}
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
        <div className="border-y border-border" data-testid="sales-transcript-empty">
          <EmptyState text={copy.empty} />
        </div>
      ) : (
        <ol className="divide-y divide-border border-y border-border">
          {messages.map((message) => {
            const historicalOutgoing = message.direction === "outbound";
            return (
              <li
                key={message.id}
                className="grid gap-2 py-4 sm:grid-cols-[130px_minmax(0,1fr)]"
                data-testid="sales-transcript-message"
                data-message-direction={message.direction}
              >
                <div className="text-[11px] text-fg-3">
                  <div
                    className={cn(
                      "font-semibold",
                      historicalOutgoing ? "text-fg-2" : "text-accent",
                    )}
                  >
                    {historicalOutgoing ? copy.historicalOutgoing : copy.incoming}
                  </div>
                  <time className="mt-1 block font-mono">
                    {formatCanonicalTimestamp(message.createdAt, locale)}
                  </time>
                </div>
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-fg">
                    {message.bodyText || copy.noText}
                  </p>
                  {message.media.length > 0 ? (
                    <div className="mt-3 space-y-2" data-testid="sales-transcript-media">
                      <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-fg-3">
                        {copy.attachments}
                      </div>
                      <ul className="divide-y divide-border border-y border-border">
                        {message.media.map((media) => (
                          <li
                            key={media.id}
                            className="flex flex-wrap items-center justify-between gap-2 py-2 text-[11.5px]"
                          >
                            <span className="min-w-0 break-words text-fg-2">
                              {media.fileName ?? copy.unnamedFile} · {humanizeCanonicalKey(media.mediaKind)}
                            </span>
                            <CanonicalKeyBadge value={media.archivalStatus} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {newestMessagesHref || olderMessagesHref ? (
        <nav
          className="flex items-center justify-between gap-3"
          aria-label={copy.eyebrow}
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

export function PlatformSalesTranscriptUnavailable({
  leadId,
  locale,
}: Readonly<{ leadId: string; locale: Locale }>) {
  const copy = COPY[locale];
  return (
    <div className="space-y-4 border-y border-border py-8" data-testid="sales-transcript-unavailable">
      <Link href={`/sales/${leadId}`} className={btnGhostCls}>
        ← {copy.back}
      </Link>
      <p className="max-w-2xl text-[13px] leading-6 text-fg-3">
        {copy.unavailable}
      </p>
    </div>
  );
}
