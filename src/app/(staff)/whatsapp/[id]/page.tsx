import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { getConversation, getLead, waMessages } from "@/lib/queries";
import { sendWaMessageAction, getIntegrationStatus } from "@/lib/actions";
import { requireStaffRoute } from "@/lib/guards";
import { isPreparedAiAllowed } from "@/lib/contracts";
import { buildPreparedWhatsAppAssistant } from "@/lib/prepared-ai";
import { AutoRefresh } from "@/components/AutoRefresh";
import { WaReplyBox } from "@/components/WaReplyBox";
import { WaList } from "@/components/WaList";
import { EmptyState, cn } from "@/components/ui";
import { Icon } from "@/components/icons";

type ConversationSearchParams = Promise<{ mode?: string | string[] | undefined }>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: ConversationSearchParams;
}) {
  await requireStaffRoute("/whatsapp");
  const { id } = await params;
  const query = await searchParams;
  const convId = parseInt(id, 10);
  const conv = getConversation(convId);
  if (!conv) notFound();

  const { t } = await getT();
  const messages = waMessages(convId);
  const integrations = await getIntegrationStatus();
  const presentationMode = firstValue(query.mode) === "first_presentation" ? "first_presentation" : "normal_operation";
  const preparedAiAllowed = isPreparedAiAllowed({
    presentationMode,
    userExplicitlyRequestedPreparedResponses: true,
    useCase: "whatsapp_reply",
  });
  const lead = preparedAiAllowed && conv.lead_id ? getLead(conv.lead_id) : undefined;
  const preparedAi = preparedAiAllowed
    ? buildPreparedWhatsAppAssistant({ conversation: conv, lead, messages })
    : undefined;
  const draftReviewMeta = [
    conv.agent_draft_review_provider,
    conv.agent_draft_review_model,
    conv.agent_draft_review_status,
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex h-[calc(100vh-150px)] min-h-[420px] overflow-hidden rounded-card border border-border bg-surface shadow-evo">
      <AutoRefresh />
      <div className="hidden md:flex">
        <WaList activeId={convId} />
      </div>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
          <Link href="/whatsapp" className="text-fg-3 hover:text-fg md:hidden"><Icon name="arrow-left" size={18} /></Link>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ok-weak text-[11px] font-semibold text-ok">
            {initials(conv.name ?? conv.phone)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-fg">{conv.name ?? conv.phone}</div>
            <div className="font-mono text-[11.5px] text-fg-3">
              {conv.phone}{conv.account_name ? ` · ${conv.account_name}` : ""}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!integrations.whatsapp && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warn-weak px-2.5 py-0.5 text-[11px] font-semibold text-warn">
                <Icon name="alert" size={12} /> not_configured
              </span>
            )}
            {conv.lead_id && (
              <Link href={`/sales/${conv.lead_id}`} className="inline-flex items-center gap-1 rounded-nav border border-border px-2.5 py-1 text-[12px] text-fg-2 hover:border-border-strong hover:text-fg">
                {t("linkedLead")} <Icon name="chevron-right" size={13} />
              </Link>
            )}
            {conv.client_id && (
              <Link href={`/clients/${conv.client_id}`} className="inline-flex items-center gap-1 rounded-nav border border-border px-2.5 py-1 text-[12px] text-fg-2 hover:border-border-strong hover:text-fg">
                {t("linkedClient")} <Icon name="chevron-right" size={13} />
              </Link>
            )}
            {conv.amo_lead_id && (
              <span className="inline-flex items-center gap-1 rounded-nav border border-border px-2.5 py-1 text-[12px] text-fg-2">
                amo <code className="font-mono">{conv.amo_lead_id}</code>
              </span>
            )}
            {conv.agent_state && (
              <span className="inline-flex items-center gap-1 rounded-full bg-info-weak px-2.5 py-0.5 text-[11px] font-semibold text-info">
                leadAgent: <code className="font-mono">{conv.agent_state}</code>
              </span>
            )}
          </div>
        </header>
        {(conv.agent_summary || conv.agent_handoff_reason || conv.agent_last_synced_at) && (
          <div className="border-b border-border bg-surface-2 px-5 py-2 text-[12px] text-fg-3">
            {conv.agent_summary ? <span>{conv.agent_summary}</span> : null}
            {conv.agent_handoff_reason ? <code className="ml-2 font-mono text-warn">{conv.agent_handoff_reason}</code> : null}
            {conv.agent_last_synced_at ? <code className="ml-2 font-mono">{conv.agent_last_synced_at}</code> : null}
          </div>
        )}
        {conv.agent_draft_review_text && (
          <div className="border-b border-border bg-info-weak px-5 py-3">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold text-info">{t("draftReview")}</span>
              <span className="rounded-full border border-info/25 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-normal text-info">
                {t("draftReviewNotSent")}
              </span>
              {draftReviewMeta && <code className="font-mono text-[11px] text-fg-3">{draftReviewMeta}</code>}
            </div>
            <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-fg">{conv.agent_draft_review_text}</p>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto bg-bg px-4 py-3">
          <div className="space-y-2">
            {messages.length === 0 && <EmptyState text={t("noMessages")} />}
            {messages.map((m) => {
              const out = m.direction === "out";
              return (
                <div key={m.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[75%] px-3 py-2 text-[13px] shadow-evo",
                      out
                        ? "rounded-2xl rounded-br-sm bg-accent text-on-accent"
                        : "rounded-2xl rounded-bl-sm bg-surface text-fg",
                    )}
                  >
                    <p className="break-words">{m.text}</p>
                    <p className={cn("mt-0.5 text-right font-mono text-[10px]", out ? "text-on-accent/70" : "text-fg-3")}>
                      {m.author_name ? `${m.author_name} · ` : ""}{m.created_at}
                      {out && (m.status === "sent" ? " ✓✓" : m.status === "demo" ? ` (${t("waNotConfiguredStatus")})` : m.status === "failed" ? " ⚠" : "")}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <WaReplyBox
          conversationId={convId}
          sendAction={sendWaMessageAction}
          labels={{
            placeholder: t("replyPlaceholder"),
            send: t("send"),
            aiDraft: t("aiDraftReply"),
            aiThinking: t("aiThinking"),
            aiNotConfigured: t("aiNotConfigured"),
          }}
          preparedAi={preparedAi}
        />
      </section>
    </div>
  );
}
