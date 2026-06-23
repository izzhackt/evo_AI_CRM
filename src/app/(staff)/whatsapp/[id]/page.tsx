import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { getConversation, waMessages } from "@/lib/queries";
import { sendWaMessageAction } from "@/lib/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { WaReplyBox } from "@/components/WaReplyBox";
import { EmptyState } from "@/components/ui";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const convId = parseInt(id, 10);
  const conv = getConversation(convId);
  if (!conv) notFound();

  const { t } = await getT();
  const messages = waMessages(convId);

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <AutoRefresh />
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
        <Link href="/whatsapp" className="text-sm text-indigo-600 hover:underline">←</Link>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-green-100">💬</span>
        <div>
          <div className="text-sm font-semibold text-slate-800">{conv.name ?? conv.phone}</div>
          <div className="text-xs text-slate-400">{conv.phone}</div>
        </div>
        <div className="ml-auto flex gap-2 text-xs">
          {conv.lead_id && (
            <Link href={`/sales/${conv.lead_id}`} className="rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50">
              {t("linkedLead")} →
            </Link>
          )}
          {conv.client_id && (
            <Link href={`/clients/${conv.client_id}`} className="rounded-lg border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50">
              {t("linkedClient")} →
            </Link>
          )}
        </div>
      </header>

      <div className="flex flex-1 flex-col-reverse overflow-y-auto bg-[#f0ebe3] px-4 py-3">
        <div className="space-y-2">
          {messages.length === 0 && <EmptyState text={t("noMessages")} />}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                  m.direction === "out" ? "rounded-br-sm bg-green-100 text-slate-800" : "rounded-bl-sm bg-white text-slate-800"
                }`}
              >
                <p className="break-words">{m.text}</p>
                <p className="mt-0.5 text-right text-[10px] text-slate-400">
                  {m.author_name ? `${m.author_name} · ` : ""}{m.created_at}
                  {m.direction === "out" && (m.status === "sent" ? " ✓✓" : m.status === "demo" ? " (демо)" : m.status === "failed" ? " ⚠" : "")}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <WaReplyBox
        conversationId={convId}
        sendAction={sendWaMessageAction}
        labels={{
          placeholder: t("replyPlaceholder"),
          send: t("send"),
        }}
      />
    </div>
  );
}
