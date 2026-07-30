import Link from "next/link";

import { EmptyState, cn } from "@/components/ui";
import { getT } from "@/lib/i18n";
import type { PlatformConversationSummary } from "@/lib/platform-communications";

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
  if (Number.isNaN(parsed.getTime())) return "";

  const language =
    locale === "ky" ? "ky-KG" : locale === "en" ? "en-GB" : "ru-RU";
  return new Intl.DateTimeFormat(language, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export async function PlatformWaList({
  conversations,
  activeId,
}: {
  conversations: readonly PlatformConversationSummary[];
  activeId?: string;
}) {
  const { t, locale } = await getT();

  return (
    <aside
      className="flex w-full flex-col border-border md:w-[336px] md:shrink-0 md:border-r"
      data-testid="platform-conversation-list"
      data-source="supabase-platform"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="text-[14px] font-semibold text-fg">{t("inbox")}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <EmptyState text={t("noResults")} />
        ) : (
          <ul>
            {conversations.map((conversation) => {
              const active = conversation.id === activeId;
              const queueLabel =
                conversation.queue === "sales"
                  ? t("platformQueueSales")
                  : t("platformQueueCurator");
              const statusLabel =
                conversation.status === "open"
                  ? t("platformStatusOpen")
                  : t("platformStatusClosed");
              return (
                <li key={conversation.id}>
                  <Link
                    href={`/whatsapp/${conversation.id}`}
                    aria-current={active ? "page" : undefined}
                    aria-label={`${t("conversationLinkLabel")}: ${conversation.subject}`}
                    className={cn(
                      "flex items-center gap-3 border-b border-border px-4 py-3 transition-[background-color]",
                      active ? "bg-accent-weak" : "hover:bg-surface-2",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ok-weak text-[12px] font-semibold text-ok"
                    >
                      {initials(conversation.subject)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-[13.5px] font-semibold",
                            active ? "text-accent" : "text-fg",
                          )}
                        >
                          {conversation.subject}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-fg-3">
                          {formatTimestamp(conversation.createdAt, locale)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-[12px] text-fg-3">
                          {queueLabel}:{" "}
                          {conversation.status === "open"
                            ? t("platformConversationStored")
                            : t("platformConversationClosed")}
                        </span>
                        <span className="shrink-0 rounded-full bg-info-weak px-2 py-0.5 text-[10px] font-semibold text-info">
                          {statusLabel}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
