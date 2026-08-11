import { notFound } from "next/navigation";

import { PlatformConversationView } from "@/components/platform/communications/PlatformConversationView";
import { PlatformMessagingRealtime } from "@/components/platform/communications/PlatformMessagingRealtime";
import { getT } from "@/lib/i18n";
import {
  getPlatformConversationThread,
  getPlatformWahaSessionHealth,
  isPlatformConversationId,
  listPlatformConversations,
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

  const [conversations, thread, workflow, knowledge, bw4Workspace, wahaSessionHealth] =
    await Promise.all([
      listPlatformConversations(actor),
      getPlatformConversationThread(actor, id),
      getPlatformConversationWorkflow(actor, id),
      listApprovedPlatformKnowledge(actor),
      getPlatformConversationBw4Workspace(actor, id).catch(() => null),
      getPlatformWahaSessionHealth(actor),
    ]);
  if (!thread || !workflow) notFound();
  const [
    amocrmCanonicalContext,
    aiMemory,
    aiRetrievalCapabilities,
    geminiProposal,
    autonomousReply,
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
        conversations={conversations}
        conversation={thread.conversation}
        messages={thread.messages}
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
