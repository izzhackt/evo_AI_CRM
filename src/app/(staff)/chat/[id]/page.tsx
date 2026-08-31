import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { listChannels, channelMessages } from "@/lib/queries";
import { sendChannelMessageAction, createChannelAction } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EmptyState, inputCls, btnCls, labelCls, cn } from "@/components/ui";
import { Icon } from "@/components/icons";

export default async function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffRoute("/chat");
  const { id } = await params;
  const channelId = parseInt(id, 10);
  const channels = listChannels();
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) notFound();

  const { t } = await getT();
  const messages = channelMessages(channelId);

  return (
    <div className="flex h-[calc(100dvh-150px)] min-h-[420px] overflow-hidden rounded-card border border-border bg-surface shadow-evo">
      <AutoRefresh />
      {/* Channel list */}
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-border md:flex">
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-fg">{t("channels")}</div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          {channels.map((c) => (
            <Link
              key={c.id}
              href={`/chat/${c.id}`}
              aria-current={c.id === channelId ? "page" : undefined}
              className={cn(
                "block rounded-nav px-3 py-2 text-base transition-[background-color,color]",
                c.id === channelId ? "bg-accent-weak font-semibold text-accent" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
              )}
            >
              # {c.name}
            </Link>
          ))}
        </nav>
        <details className="border-t border-border p-3">
          <summary className="cursor-pointer text-xs font-semibold text-accent">+ {t("newChannel")}</summary>
          <form action={createChannelAction} className="mt-2 space-y-2">
            <label className={cn(labelCls, "mb-0")}>
              {t("channelName")}
              <input name="name" required placeholder={t("channelName")} className={cn(inputCls, "mt-1")} />
            </label>
            <label className={cn(labelCls, "mb-0")}>
              {t("description")}
              <input name="description" placeholder={t("description")} className={cn(inputCls, "mt-1")} />
            </label>
            <button type="submit" className={cn(btnCls, "w-full")}>{t("add")}</button>
          </form>
        </details>
      </aside>

      {/* Messages */}
      <section className="flex min-w-0 flex-1 flex-col">
        <details className="border-b border-border md:hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-2 text-xs font-semibold text-accent">
            <span>{t("channels")}</span>
            <Icon name="chevron-right" size={15} />
          </summary>
          <nav className="grid gap-1 border-t border-border bg-surface-2 p-2">
            {channels.map((item) => (
              <Link
                key={item.id}
                href={`/chat/${item.id}`}
                aria-current={item.id === channelId ? "page" : undefined}
                className={cn(
                  "rounded-nav px-3 py-2 text-sm",
                  item.id === channelId ? "bg-accent-weak font-semibold text-accent" : "text-fg-2",
                )}
              >
                # {item.name}
              </Link>
            ))}
          </nav>
          <form action={createChannelAction} className="grid gap-2 border-t border-border p-3">
            <label className={cn(labelCls, "mb-0")}>
              {t("channelName")}
              <input name="name" required placeholder={t("channelName")} className={cn(inputCls, "mt-1")} />
            </label>
            <label className={cn(labelCls, "mb-0")}>
              {t("description")}
              <input name="description" placeholder={t("description")} className={cn(inputCls, "mt-1")} />
            </label>
            <button type="submit" className={cn(btnCls, "w-full")}>{t("add")}</button>
          </form>
        </details>
        <header className="border-b border-border px-5 py-3">
          <div className="text-base font-semibold text-fg"># {channel.name}</div>
          {channel.description && <div className="text-xs text-fg-3">{channel.description}</div>}
        </header>

        <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-5 py-3">
          <div className="space-y-3.5">
            {messages.length === 0 && <EmptyState text={t("noMessages")} />}
            {messages.map((m) => (
              <div key={m.id} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-weak text-xs font-semibold text-accent">
                  {m.author_name.slice(0, 1)}
                </span>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-base font-semibold text-fg">
                      {m.author_name}{m.author_id === user?.id ? ` (${t("you")})` : ""}
                    </span>
                    <span className="font-mono text-xs text-fg-3">{m.created_at}</span>
                  </div>
                  <p className="break-words text-base text-fg-2">{m.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <form action={sendChannelMessageAction} className="flex items-end gap-2 border-t border-border p-3">
          <input type="hidden" name="channel_id" value={channelId} />
          <label className={cn(labelCls, "mb-0 min-w-0 flex-1")}>
            {t("messages")}
            <input
              name="text"
              required
              autoComplete="off"
              placeholder={t("messagePlaceholder")}
              className={cn(inputCls, "mt-1")}
            />
          </label>
          <button type="submit" aria-label={t("send")} className={cn(btnCls, "shrink-0 px-3 sm:px-4")}>
            <Icon name="send" size={15} /> <span className="hidden sm:inline">{t("send")}</span>
          </button>
        </form>
      </section>
    </div>
  );
}
