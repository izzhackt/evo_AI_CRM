import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { currentUser } from "@/lib/auth";
import { listChannels, channelMessages } from "@/lib/queries";
import { sendChannelMessageAction, createChannelAction } from "@/lib/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EmptyState, inputCls, btnCls } from "@/components/ui";

const AVATAR_COLORS = ["bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-sky-500", "bg-violet-500"];

export default async function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const channelId = parseInt(id, 10);
  const channels = listChannels();
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) notFound();

  const { t } = await getT();
  const user = await currentUser();
  const messages = channelMessages(channelId);

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <AutoRefresh />
      {/* Channel list */}
      <aside className="w-56 shrink-0 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">
          {t("channels")}
        </div>
        <nav className="p-2">
          {channels.map((c) => (
            <Link
              key={c.id}
              href={`/chat/${c.id}`}
              className={`block rounded-lg px-3 py-1.5 text-sm transition ${
                c.id === channelId ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              # {c.name}
            </Link>
          ))}
        </nav>
        <details className="border-t border-slate-100 p-3">
          <summary className="cursor-pointer text-xs font-medium text-indigo-600">+ {t("newChannel")}</summary>
          <form action={createChannelAction} className="mt-2 space-y-2">
            <input name="name" required placeholder={t("channelName")} className={inputCls} />
            <input name="description" placeholder={t("description")} className={inputCls} />
            <button type="submit" className={`${btnCls} w-full`}>{t("add")}</button>
          </form>
        </details>
      </aside>

      {/* Messages */}
      <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-100 px-5 py-3">
          <div className="text-sm font-semibold text-slate-800"># {channel.name}</div>
          {channel.description && <div className="text-xs text-slate-400">{channel.description}</div>}
        </header>

        <div className="flex flex-1 flex-col-reverse overflow-y-auto px-5 py-3">
          <div className="space-y-3">
            {messages.length === 0 && <EmptyState text={t("noMessages")} />}
            {messages.map((m) => (
              <div key={m.id} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                    AVATAR_COLORS[m.author_id % AVATAR_COLORS.length]
                  }`}
                >
                  {m.author_name.slice(0, 1)}
                </span>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-slate-800">
                      {m.author_name}{m.author_id === user?.id ? " (вы)" : ""}
                    </span>
                    <span className="text-[10px] text-slate-400">{m.created_at}</span>
                  </div>
                  <p className="break-words text-sm text-slate-700">{m.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <form action={sendChannelMessageAction} className="flex gap-2 border-t border-slate-100 p-3">
          <input type="hidden" name="channel_id" value={channelId} />
          <input name="text" required autoComplete="off" placeholder={t("messagePlaceholder")} className={inputCls} />
          <button type="submit" className={btnCls}>{t("send")}</button>
        </form>
      </section>
    </div>
  );
}
