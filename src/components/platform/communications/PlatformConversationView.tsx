import { AutoRefresh } from "@/components/AutoRefresh";
import { Icon } from "@/components/icons";
import { PlatformWaList } from "@/components/platform/communications/PlatformWaList";
import { EmptyState, cn } from "@/components/ui";
import { getT } from "@/lib/i18n";
import type {
  PlatformConversationMessage,
  PlatformConversationSummary,
} from "@/lib/platform-communications";

function initials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatTimestamp(value: string, locale: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  const language =
    locale === "ky" ? "ky-KG" : locale === "en" ? "en-GB" : "ru-RU";
  return new Intl.DateTimeFormat(language, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function isSyntheticSubject(subject: string) {
  return /^\[synthetic(?:-non-provider)?\]/i.test(subject.trim());
}

export async function PlatformConversationView({
  conversations,
  conversation,
  messages,
}: {
  conversations: readonly PlatformConversationSummary[];
  conversation: PlatformConversationSummary;
  messages: readonly PlatformConversationMessage[];
}) {
  const { t, locale } = await getT();
  const synthetic = isSyntheticSubject(conversation.subject);

  return (
    <div
      className="flex h-[calc(100vh-270px)] min-h-[520px] overflow-hidden rounded-card border border-border bg-surface shadow-evo"
      data-testid="platform-conversation-thread"
      data-provider-proof="not-proved"
    >
      <AutoRefresh intervalMs={7000} />
      <PlatformWaList
        conversations={conversations}
        activeId={conversation.id}
      />

      <section className="flex min-w-0 flex-1 flex-col bg-bg">
        <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ok-weak text-[12px] font-semibold text-ok"
          >
            {initials(conversation.subject)}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[14px] font-bold text-fg">
              {conversation.subject}
            </h1>
            <p className="mt-0.5 text-[11.5px] text-fg-3">
              {conversation.queue === "sales"
                ? t("platformQueueSales")
                : t("platformQueueCurator")}
              {" · "}
              {conversation.status === "open"
                ? t("platformStatusOpen")
                : t("platformStatusClosed")}
            </p>
          </div>
          <span className="rounded-full bg-info-weak px-2.5 py-1 text-[10.5px] font-semibold text-info">
            {t("platformStoredState")}
          </span>
        </header>

        {synthetic && (
          <section
            className="border-b border-warn/30 bg-warn-weak px-4 py-3 text-warn"
            data-testid="platform-synthetic-data-disclosure"
          >
            <p className="text-[12px] font-semibold">
              {t("platformSyntheticDataTitle")}
            </p>
            <p className="mt-1 text-[11.5px] leading-4">
              {t("platformSyntheticDataHint")}
            </p>
          </section>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <EmptyState text={t("platformNoMessages")} />
          ) : (
            <div className="space-y-3">
              {messages.map((message) => {
                const outgoing = message.direction === "outbound";
                return (
                  <article
                    key={message.id}
                    className={cn(
                      "flex",
                      outgoing ? "justify-end" : "justify-start",
                    )}
                    data-message-direction={message.direction}
                    data-message-id={message.id}
                  >
                    <div
                      className={cn(
                        "max-w-[88%] border px-3 py-2 text-[13px] shadow-evo sm:max-w-[75%]",
                        outgoing
                          ? "rounded-2xl rounded-br-sm border-transparent bg-[var(--sidebar)] text-white [[data-theme=dark]_&]:bg-surface-3"
                          : "rounded-2xl rounded-bl-sm border-transparent bg-surface text-fg",
                      )}
                    >
                      <p className="break-words">{message.bodyText}</p>
                      <p
                        className={cn(
                          "mt-1 text-right font-mono text-[9.5px]",
                          outgoing ? "text-white/70" : "text-fg-3",
                        )}
                      >
                        {formatTimestamp(message.createdAt, locale)}
                        {" · "}
                        {t("platformProviderStateNotProved")}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <footer className="border-t border-border bg-surface p-3">
          <div className="flex items-center gap-3 rounded-ctl border border-border bg-surface-2 px-3 py-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl bg-warn-weak text-warn">
              <Icon name="shield" size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-fg">
                {t("platformReadOnlyComposer")}
              </p>
              <p className="mt-0.5 text-[11px] leading-4 text-fg-3">
                {t("platformReadOnlyComposerHint")}
              </p>
            </div>
            <button
              type="button"
              disabled
              className="h-9 rounded-ctl bg-surface-3 px-3 text-[12px] font-semibold text-fg-3"
            >
              {t("send")}
            </button>
          </div>
        </footer>
      </section>

      <aside className="hidden w-[280px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface xl:flex">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-bold text-fg">
            {t("conversationContext")}
          </h2>
          <p className="mt-1 text-[11.5px] leading-4 text-fg-3">
            {t("platformContextHint")}
          </p>
        </div>
        <dl className="space-y-3 p-4">
          {[
            [t("platformConversationId"), conversation.id],
            [
              t("platformStudentCase"),
              conversation.studentCaseId ?? t("platformNotLinked"),
            ],
            [t("platformWahaSession"), conversation.wahaSessionName],
            [
              t("platformCreatedAt"),
              formatTimestamp(conversation.createdAt, locale),
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
                {label}
              </dt>
              <dd className="mt-1 break-words text-[12px] font-semibold text-fg">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  );
}
