import { notFound } from "next/navigation";

import { PlatformConversationView } from "@/components/platform/communications/PlatformConversationView";
import { PlatformMessagingRealtime } from "@/components/platform/communications/PlatformMessagingRealtime";
import { getT } from "@/lib/i18n";
import {
  getPlatformConversationThread,
  getPlatformWahaSessionHealth,
  isPlatformConversationId,
  listPlatformConversations,
  parsePlatformConversationCursor,
} from "@/lib/platform-communications";
import { requirePlatformMessagingActor } from "@/lib/platform-guards";
import {
  getPlatformConversationWorkflow,
  listApprovedPlatformKnowledge,
} from "@/lib/platform-messaging-workflow";
import { getPlatformConversationBw4Workspace } from "@/lib/platform-bw4-workflow";
import { isUiContractFixtureMode } from "@/lib/runtime-mode";
import { getPlatformAmoCrmCanonicalContext } from "@/lib/server/platform-amocrm-canonical-context-service";
import { loadPlatformAutonomousReplyConfig } from "@/lib/server/platform-autonomous-reply-config";
import { readPlatformAutonomousReplyState } from "@/lib/server/platform-autonomous-replies-repository";
import {
  readPlatformAiRetrievalCapabilities,
  readPlatformAiRetrievalEvidence,
  readPlatformConversationAiMemory,
} from "@/lib/server/platform-ai-memory-repository";
import { readPlatformGeminiProposal } from "@/lib/server/platform-gemini-proposals-repository";

import { CommunicationsSourceDisclosure } from "../CommunicationsSourceDisclosure";

type ConversationSearchParams = Promise<{
  mode?: string | string[];
  result?: string | string[];
  before_at?: string | string[];
  before_id?: string | string[];
  messages_before_at?: string | string[];
  messages_before_id?: string | string[];
}>;

function decisionMutationOutcome(value: string | string[] | undefined) {
  if (value === "saved" || value === "invalid" || value === "unavailable") {
    return value;
  }
  return null;
}

function autonomousReplyRuntimeEnabled() {
  try {
    const config = loadPlatformAutonomousReplyConfig();
    return config.enabled && !config.killSwitchEngaged;
  } catch {
    return false;
  }
}

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: ConversationSearchParams;
}) {
  if (isUiContractFixtureMode()) {
    const { default: LegacyConversationPage } = await import(
      "./LegacyConversationPage"
    );
    return (
      <LegacyConversationPage
        params={params}
        searchParams={searchParams}
      />
    );
  }

  const [{ id }, resolvedSearchParams, { t }, actor] = await Promise.all([
    params,
    searchParams,
    getT(),
    requirePlatformMessagingActor(),
  ]);
  if (!isPlatformConversationId(id)) notFound();
  const conversationCursor = parsePlatformConversationCursor(
    resolvedSearchParams.before_at,
    resolvedSearchParams.before_id,
  );
  const messageCursor = parsePlatformConversationCursor(
    resolvedSearchParams.messages_before_at,
    resolvedSearchParams.messages_before_id,
  );

  const [
    conversationPage,
    thread,
    latestThread,
    workflow,
    knowledge,
    bw4Workspace,
  ] =
    await Promise.all([
      listPlatformConversations(actor, { cursor: conversationCursor, pageSize: 50 }),
      getPlatformConversationThread(actor, id, { cursor: messageCursor, pageSize: 100 }),
      messageCursor
        ? getPlatformConversationThread(actor, id, { pageSize: 100 })
        : Promise.resolve(null),
      getPlatformConversationWorkflow(actor, id),
      listApprovedPlatformKnowledge(actor),
      getPlatformConversationBw4Workspace(actor, id).catch(() => null),
    ]);
  if (!thread || !workflow) notFound();
  const [
    amocrmCanonicalContext,
    aiMemory,
    aiRetrievalCapabilities,
    geminiProposal,
    autonomousReply,
    wahaSessionHealth,
  ] =
    await Promise.all([
      getPlatformAmoCrmCanonicalContext(actor, thread.conversation),
      readPlatformConversationAiMemory(actor, id).catch(() => null),
      readPlatformAiRetrievalCapabilities(actor, id).catch(() => null),
      readPlatformGeminiProposal(actor, id).then(
        (proposal) => ({ proposal, unavailable: false as const }),
        () => ({ proposal: null, unavailable: true as const }),
      ),
      readPlatformAutonomousReplyState(actor, id).then(
        (state) => ({ state, unavailable: false as const }),
        () => ({ state: null, unavailable: true as const }),
      ),
      getPlatformWahaSessionHealth(
        actor,
        thread.conversation.wahaSessionName,
      ),
    ]);
  const aiRetrievalEvidence = aiMemory?.latestRetrieval
    ? await readPlatformAiRetrievalEvidence(
        actor,
        id,
        aiMemory.latestRetrieval.requestId,
      ).catch(() => null)
    : null;

  return (
    <div className="space-y-4" data-testid="whatsapp-conversation">
      <CommunicationsSourceDisclosure
        title={t("platformCommunicationsSource")}
        description={t("platformCommunicationsSourceHint")}
        mobileSummary={t("platformCommunicationsSourceSummary")}
      />
      <PlatformMessagingRealtime organizationId={actor.organizationId} />
      <PlatformConversationView
        conversations={conversationPage.rows}
        conversation={thread.conversation}
        messages={thread.messages}
        contextMessages={latestThread?.messages ?? thread.messages}
        conversationListResetHref={conversationCursor
          ? threadHref(id, null, messageCursor)
          : null}
        conversationListNextHref={conversationPage.nextCursor
          ? threadHref(id, conversationPage.nextCursor, messageCursor)
          : null}
        conversationQuery={conversationCursor
          ? cursorQuery(conversationCursor.sortAt, conversationCursor.id)
          : ""}
        newestMessagesHref={messageCursor
          ? threadHref(id, conversationCursor, null)
          : null}
        olderMessagesHref={thread.nextMessageCursor
          ? threadHref(id, conversationCursor, thread.nextMessageCursor)
          : null}
        workflow={workflow}
        knowledge={knowledge}
        bw4Workspace={bw4Workspace}
        wahaSessionHealth={wahaSessionHealth}
        amocrmCanonicalContext={amocrmCanonicalContext}
        aiMemory={aiMemory}
        aiRetrievalCapabilities={aiRetrievalCapabilities}
        aiRetrievalEvidence={aiRetrievalEvidence}
        geminiProposal={geminiProposal.proposal}
        geminiProposalUnavailable={geminiProposal.unavailable}
        autonomousReplyState={autonomousReply.state}
        autonomousReplyUnavailable={autonomousReply.unavailable}
        autonomousReplyRuntimeEnabled={autonomousReplyRuntimeEnabled()}
        decisionMutationOutcome={decisionMutationOutcome(
          resolvedSearchParams.result,
        )}
      />
    </div>
  );
}

function cursorQuery(sortAt: string, id: string): string {
  const params = new URLSearchParams({ before_at: sortAt, before_id: id });
  return `?${params.toString()}`;
}

function threadHref(
  id: string,
  conversationCursor: Readonly<{ sortAt: string; id: string }> | null,
  messageCursor: Readonly<{ sortAt: string; id: string }> | null,
): string {
  const params = new URLSearchParams();
  if (conversationCursor) {
    params.set("before_at", conversationCursor.sortAt);
    params.set("before_id", conversationCursor.id);
  }
  if (messageCursor) {
    params.set("messages_before_at", messageCursor.sortAt);
    params.set("messages_before_id", messageCursor.id);
  }
  const serialized = params.toString();
  return `/whatsapp/${id}${serialized ? `?${serialized}` : ""}`;
}
