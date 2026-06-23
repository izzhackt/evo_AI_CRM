import Link from "next/link";
import { getT } from "@/lib/i18n";
import { listConversations } from "@/lib/queries";
import { createConversationAction, getIntegrationStatus } from "@/lib/actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EmptyState, inputCls, btnCls } from "@/components/ui";

export default async function WhatsAppPage() {
  const { t } = await getT();
  const conversations = listConversations();
  const integrations = await getIntegrationStatus();

  return (
    <div className="space-y-4">
      <AutoRefresh intervalMs={7000} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">💬 {t("whatsapp")} · {t("inbox")}</h1>
        <details className="relative">
          <summary className={`${btnCls} cursor-pointer list-none`}>+ {t("newConversation")}</summary>
          <form
            action={createConversationAction}
            className="absolute right-0 z-20 mt-2 w-72 space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
          >
            <input name="phone" required placeholder="+996 ___ ___ ___" className={inputCls} />
            <input name="name" placeholder={t("name")} className={inputCls} />
            <button type="submit" className={`${btnCls} w-full`}>{t("add")}</button>
          </form>
        </details>
      </div>

      <p className={`rounded-lg px-4 py-2 text-sm ${integrations.whatsapp ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
        {integrations.whatsapp ? `✓ ${t("waConnected")}` : `⚠ ${t("waDemoNote")}`}
      </p>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {conversations.length === 0 ? (
          <EmptyState text={t("noResults")} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link href={`/whatsapp/${c.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 text-lg">
                    💬
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800">
                        {c.name ?? c.phone}
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">{c.last_message_at ?? ""}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500">{c.last_text ?? "—"}</span>
                      {c.unread > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-green-500 px-1.5 text-[10px] font-bold text-white">
                          {c.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
