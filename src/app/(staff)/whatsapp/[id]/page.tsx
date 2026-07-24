import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/AutoRefresh";
import { Icon } from "@/components/icons";
import {
  ContextBanner,
  KeyValueGrid,
} from "@/components/platform/operations/OperationsPrimitives";
import { WaList } from "@/components/WaList";
import { WaReplyBox } from "@/components/WaReplyBox";
import { EmptyState, cn } from "@/components/ui";
import { getIntegrationStatus, sendWaMessageAction } from "@/lib/actions";
import { isPreparedAiAllowed } from "@/lib/contracts";
import { requireStaffRoute } from "@/lib/guards";
import { getT } from "@/lib/i18n";
import { buildPreparedWhatsAppAssistant } from "@/lib/prepared-ai";
import { getClient, getConversation, getLead, waMessages } from "@/lib/queries";

type ConversationSearchParams = Promise<{ mode?: string | string[] }>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: ConversationSearchParams;
}) {
  const user = await requireStaffRoute("/whatsapp");
  const { id } = await params;
  const query = await searchParams;
  const conversationId = Number.parseInt(id, 10);
  const conversation = getConversation(conversationId);
  if (!conversation) notFound();

  const { t } = await getT();
  const messages = waMessages(conversationId);
  const integrations = await getIntegrationStatus();
  const canOpenSales = user.role === "admin" || user.role === "sales";
  const lead = conversation.lead_id ? getLead(conversation.lead_id) : undefined;
  const client = conversation.client_id ? getClient(conversation.client_id) : undefined;
  const presentationMode =
    firstValue(query.mode) === "first_presentation"
      ? "first_presentation"
      : "normal_operation";
  const preparedAiAllowed = isPreparedAiAllowed({
    presentationMode,
    userExplicitlyRequestedPreparedResponses: true,
    useCase: "whatsapp_reply",
  });
  const preparedAi = preparedAiAllowed
    ? buildPreparedWhatsAppAssistant({ conversation, lead, messages })
    : undefined;
  const whatsappStatus =
    integrations.whatsappState === "configured"
      ? {
          className: "bg-info-weak text-info",
          icon: "shield" as const,
          label: t("configuredNotVerified"),
        }
      : integrations.whatsappState === "blocked"
        ? {
            className: "bg-danger-weak text-danger",
            icon: "alert" as const,
            label: t("whatsappBlocked"),
          }
        : {
            className: "bg-warn-weak text-warn",
            icon: "alert" as const,
            label: t("statusNotConfigured"),
          };
  const draftReviewMeta = [
    conversation.agent_draft_review_provider,
    conversation.agent_draft_review_model,
    conversation.agent_draft_review_status,
  ]
    .filter(Boolean)
    .join(" · ");

  function deliveryLabel(direction: string, status: string) {
    if (direction === "in") return t("providerDeliveryReceived");
    if (status === "sent") return t("providerDeliverySent");
    if (status === "failed") return t("providerDeliveryFailed");
    return t("providerDeliveryUnknown");
  }

  return (
    <div className="space-y-4" data-testid="whatsapp-conversation">
      <ContextBanner
        title={t("communicationsSourceTruth")}
        description={`${t("communicationsSourceTruthHint")} ${t("aiDraftManualOnly")}`}
        tone="info"
      />

      <div className="flex h-[calc(100vh-270px)] min-h-[520px] overflow-hidden rounded-card border border-border bg-surface shadow-evo">
        <AutoRefresh />
        <div className="hidden md:flex">
          <WaList activeId={conversationId} />
        </div>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-3 sm:px-5">
            <Link
              href="/whatsapp"
              aria-label={t("inbox")}
              className="grid h-10 w-10 place-items-center rounded-nav text-fg-3 hover:bg-surface-2 hover:text-fg md:hidden"
            >
              <Icon name="arrow-left" size={18} />
            </Link>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ok-weak text-[11px] font-semibold text-ok">
              {initials(conversation.name ?? conversation.phone)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-fg">
                {conversation.name ?? conversation.phone}
              </div>
              <div className="truncate font-mono text-[11.5px] text-fg-3">
                {conversation.phone}
                {conversation.account_name ? ` · ${conversation.account_name}` : ""}
              </div>
            </div>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold",
                whatsappStatus.className,
              )}
            >
              <Icon name={whatsappStatus.icon} size={12} />
              {whatsappStatus.label}
            </span>
          </header>

          {(conversation.agent_summary ||
            conversation.agent_handoff_reason ||
            conversation.agent_last_synced_at) && (
            <div className="border-b border-border bg-surface-2 px-4 py-2 text-[12px] text-fg-3">
              {conversation.agent_summary && <span>{conversation.agent_summary}</span>}
              {conversation.agent_handoff_reason && (
                <code className="ml-2 font-mono text-warn">
                  {conversation.agent_handoff_reason}
                </code>
              )}
              {conversation.agent_last_synced_at && (
                <code className="ml-2 font-mono">{conversation.agent_last_synced_at}</code>
              )}
            </div>
          )}

          {conversation.agent_draft_review_text && (
            <div className="border-b border-border bg-info-weak px-4 py-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-info">{t("draftReview")}</span>
                <span className="rounded-full border border-info/25 px-2 py-0.5 text-[10.5px] font-semibold text-info">
                  {t("draftReviewNotSent")}
                </span>
                {draftReviewMeta && (
                  <code className="font-mono text-[11px] text-fg-3">{draftReviewMeta}</code>
                )}
              </div>
              <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-fg">
                {conversation.agent_draft_review_text}
              </p>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto bg-bg px-3 py-3 sm:px-4">
            <div className="space-y-2">
              {messages.length === 0 && <EmptyState text={t("noMessages")} />}
              {messages.map((message) => {
                const outgoing = message.direction === "out";
                return (
                  <div
                    key={message.id}
                    className={cn("flex", outgoing ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[88%] px-3 py-2 text-[13px] shadow-evo sm:max-w-[75%]",
                        outgoing
                          ? "rounded-2xl rounded-br-sm bg-accent text-on-accent"
                          : "rounded-2xl rounded-bl-sm bg-surface text-fg",
                      )}
                    >
                      <p className="break-words">{message.text}</p>
                      <p
                        className={cn(
                          "mt-1 text-right font-mono text-[9.5px]",
                          outgoing ? "text-on-accent/75" : "text-fg-3",
                        )}
                      >
                        {message.author_name ? `${message.author_name} · ` : ""}
                        {message.created_at} · {deliveryLabel(message.direction, message.status)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <WaReplyBox
            conversationId={conversationId}
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

        <aside className="hidden w-[300px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface xl:flex">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-[13px] font-bold text-fg">{t("conversationContext")}</h2>
            <p className="mt-1 text-[11.5px] leading-4 text-fg-3">{t("localShadow")}</p>
          </div>
          <div className="space-y-5 p-4">
            <KeyValueGrid
              items={[
                {
                  label: t("linkedLead"),
                  value: lead && canOpenSales ? (
                    <Link href={`/sales/${lead.id}`} className="text-accent hover:underline">
                      {lead.name}
                    </Link>
                  ) : lead ? lead.name : t("noLinkedRecord"),
                },
                {
                  label: t("linkedStudent"),
                  value: client ? (
                    <Link href={`/clients/${client.id}`} className="text-accent hover:underline">
                      {client.name}
                    </Link>
                  ) : "—",
                },
                {
                  label: t("amocrmLeadId"),
                  value: conversation.amo_lead_id ? (
                    <code className="font-mono">{conversation.amo_lead_id}</code>
                  ) : t("syncNotVerified"),
                },
                {
                  label: t("amocrmContactId"),
                  value: conversation.amo_contact_id ? (
                    <code className="font-mono">{conversation.amo_contact_id}</code>
                  ) : t("syncNotVerified"),
                },
                {
                  label: t("syncState"),
                  value: conversation.agent_state ?? t("syncNotVerified"),
                },
                {
                  label: t("lastSync"),
                  value: conversation.agent_last_synced_at ?? t("syncNotVerified"),
                },
              ]}
            />
            <p className="rounded-ctl bg-warn-weak p-3 text-[11.5px] leading-5 text-warn">
              {t("offlineNotMonitored")}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
