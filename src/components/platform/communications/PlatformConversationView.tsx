import { PlatformAmoCrmContextCard } from "@/components/platform/communications/PlatformAmoCrmContextCard";
import { PlatformAiMemoryCard } from "@/components/platform/communications/PlatformAiMemoryCard";
import { PlatformMessagingWorkflowPanel } from "@/components/platform/communications/PlatformMessagingWorkflowPanel";
import { PlatformMessageMedia } from "@/components/platform/communications/PlatformMessageMedia";
import { PlatformWaList } from "@/components/platform/communications/PlatformWaList";
import { EmptyState, cn } from "@/components/ui";
import { getT } from "@/lib/i18n";
import type { PlatformAmoCrmCanonicalContext } from "@/lib/platform-amocrm-canonical-context";
import type {
  PlatformAiRetrievalCapabilities,
  PlatformAiRetrievalEvidence,
  PlatformConversationAiMemory,
} from "@/lib/platform-ai-memory";
import type {
  PlatformConversationMessage,
  PlatformConversationSummary,
  PlatformWahaSessionHealth,
} from "@/lib/platform-communications";
import type { PlatformConversationBw4Workspace } from "@/lib/platform-bw4-workflow";
import type {
  PlatformConversationWorkflow,
  PlatformKnowledgeCatalogItem,
} from "@/lib/platform-messaging-workflow";
import {
  getWahaAckPresentation,
  getWahaSessionHealthPresentation,
  type OperationalTone,
} from "./whatsapp-state";

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

function statusTone(tone: OperationalTone) {
  switch (tone) {
    case "ok":
      return "border-ok/30 bg-ok-weak text-ok";
    case "warning":
      return "border-warn/30 bg-warn-weak text-warn";
    case "danger":
      return "border-danger/30 bg-danger-weak text-danger";
    case "info":
      return "border-info/30 bg-info-weak text-info";
    default:
      return "border-border bg-surface-2 text-fg-2";
  }
}

export async function PlatformConversationView({
  conversations,
  conversation,
  messages,
  workflow,
  knowledge,
  bw4Workspace,
  wahaSessionHealth,
  amocrmCanonicalContext,
  aiMemory,
  aiRetrievalCapabilities,
  aiRetrievalEvidence,
  decisionMutationOutcome,
}: {
  conversations: readonly PlatformConversationSummary[];
  conversation: PlatformConversationSummary;
  messages: readonly PlatformConversationMessage[];
  workflow: PlatformConversationWorkflow;
  knowledge: readonly PlatformKnowledgeCatalogItem[];
  bw4Workspace: PlatformConversationBw4Workspace | null;
  wahaSessionHealth: PlatformWahaSessionHealth | null;
  amocrmCanonicalContext: PlatformAmoCrmCanonicalContext;
  aiMemory: PlatformConversationAiMemory | null;
  aiRetrievalCapabilities: PlatformAiRetrievalCapabilities | null;
  aiRetrievalEvidence: PlatformAiRetrievalEvidence | null;
  decisionMutationOutcome: "saved" | "invalid" | "unavailable" | null;
}) {
  const { t, locale } = await getT();
  const synthetic = isSyntheticSubject(conversation.subject);
  const latestInboundMessage =
    [...messages].reverse().find((message) => message.direction === "inbound") ??
    null;
  const aiMemorySourceMessages = [...messages]
    .filter((message) => message.direction === "inbound")
    .reverse()
    .map((message) => {
      const body = message.bodyText.trim();
      const excerpt = body.length
        ? body.slice(0, 72)
        : t("platformAiMemorySourceNoText");
      return {
        id: message.id,
        label: `${formatTimestamp(message.createdAt, locale)} · ${excerpt}`,
      };
    });
  const inboundLanguage =
    latestInboundMessage?.language === "ru" ||
    latestInboundMessage?.language === "en"
      ? latestInboundMessage.language
      : null;
  const defaultLanguage =
    workflow.draft?.selectedLanguage ??
    workflow.draft?.requestedLanguage ??
    inboundLanguage;
  const wahaHealth = getWahaSessionHealthPresentation(
    wahaSessionHealth?.status,
  );
  const workflowLabels = {
    platformWorkflowTitle: t("platformWorkflowTitle"),
    platformWorkflowHint: t("platformWorkflowHint"),
    platformAiHealth: t("platformAiHealth"),
    platformWahaHealth: t("platformWahaHealth"),
    platformHealthUnconfigured: t("platformHealthUnconfigured"),
    platformHealthConfiguredUnverified: t(
      "platformHealthConfiguredUnverified",
    ),
    platformHealthReady: t("platformHealthReady"),
    platformHealthBlocked: t("platformHealthBlocked"),
    platformEvidenceLocalNonProvider: t(
      "platformEvidenceLocalNonProvider",
    ),
    platformEvidenceProviderObserved: t("platformEvidenceProviderObserved"),
    platformEvidenceConfigurationOnly: t(
      "platformEvidenceConfigurationOnly",
    ),
    platformProviderStateNotProved: t("platformProviderStateNotProved"),
    platformKnowledgeLabel: t("platformKnowledgeLabel"),
    platformKnowledgeEmpty: t("platformKnowledgeEmpty"),
    platformDraftLanguage: t("platformDraftLanguage"),
    platformDraftReason: t("platformDraftReason"),
    platformRequestDraft: t("platformRequestDraft"),
    platformDraftAwaitingGeneration: t("platformDraftAwaitingGeneration"),
    platformDraftReviewTitle: t("platformDraftReviewTitle"),
    platformDraftEditor: t("platformDraftEditor"),
    platformReviewReason: t("platformReviewReason"),
    platformApproveDraft: t("platformApproveDraft"),
    platformRequestRework: t("platformRequestRework"),
    platformHandoffDraft: t("platformHandoffDraft"),
    platformManualSendTitle: t("platformManualSendTitle"),
    platformManualSendMessage: t("platformManualSendMessage"),
    platformManualSendReason: t("platformManualSendReason"),
    platformAuthorizeManualSend: t("platformAuthorizeManualSend"),
    platformManualOnlyHint: t("platformManualOnlyHint"),
    platformOutboxTitle: t("platformOutboxTitle"),
    platformOutboxNotStaged: t("platformOutboxNotStaged"),
    platformOutboxQueued: t("platformOutboxQueued"),
    platformOutboxRetryWait: t("platformOutboxRetryWait"),
    platformOutboxSucceeded: t("platformOutboxSucceeded"),
    platformOutboxDeadLettered: t("platformOutboxDeadLettered"),
    platformOutboxUnknownReview: t("platformOutboxUnknownReview"),
    platformOutboxConflictReview: t("platformOutboxConflictReview"),
    platformActionCompleted: t("platformActionCompleted"),
    platformActionPersistedNotStaged: t(
      "platformActionPersistedNotStaged",
    ),
    platformActionInvalid: t("platformActionInvalid"),
    platformActionUnavailable: t("platformActionUnavailable"),
    platformAuditLatest: t("platformAuditLatest"),
    platformLanguageGateTitle: t("platformLanguageGateTitle"),
    platformLanguageGateRuEn: t("platformLanguageGateRuEn"),
    platformLanguageManualRequired: t("platformLanguageManualRequired"),
    platformBw4UnavailableTitle: t("platformBw4UnavailableTitle"),
    platformBw4UnavailableHint: t("platformBw4UnavailableHint"),
    platformDecisionBacklogTitle: t("platformDecisionBacklogTitle"),
    platformDecisionBacklogHint: t("platformDecisionBacklogHint"),
    platformDecisionEmpty: t("platformDecisionEmpty"),
    platformDecisionCreate: t("platformDecisionCreate"),
    platformDecisionQuestion: t("platformDecisionQuestion"),
    platformDecisionAnswer: t("platformDecisionAnswer"),
    platformDecisionAnswerText: t("platformDecisionAnswerText"),
    platformDecisionNoAnswer: t("platformDecisionNoAnswer"),
    platformDecisionOwner: t("platformDecisionOwner"),
    platformDecisionOwnerAdmin: t("platformDecisionOwnerAdmin"),
    platformDecisionOwnerSales: t("platformDecisionOwnerSales"),
    platformDecisionOwnerCurator: t("platformDecisionOwnerCurator"),
    platformDecisionOwnerFixed: t("platformDecisionOwnerFixed"),
    platformDecisionStatus: t("platformDecisionStatus"),
    platformDecisionStatusUnresolved: t(
      "platformDecisionStatusUnresolved",
    ),
    platformDecisionStatusAnswered: t("platformDecisionStatusAnswered"),
    platformDecisionStatusRetired: t("platformDecisionStatusRetired"),
    platformDecisionEvidence: t("platformDecisionEvidence"),
    platformDecisionEvidenceRequired: t(
      "platformDecisionEvidenceRequired",
    ),
    platformDecisionEvidenceRef: t("platformDecisionEvidenceRef"),
    platformDecisionNoReviewedSources: t(
      "platformDecisionNoReviewedSources",
    ),
    platformDecisionSourceRetired: t("platformDecisionSourceRetired"),
    platformDecisionActionSaved: t("platformDecisionActionSaved"),
    platformDecisionActionInvalid: t("platformDecisionActionInvalid"),
    platformDecisionActionUnavailable: t(
      "platformDecisionActionUnavailable",
    ),
    platformDecisionAffectedRequirement: t(
      "platformDecisionAffectedRequirement",
    ),
    platformDecisionRequirementGeneral: t(
      "platformDecisionRequirementGeneral",
    ),
    platformDecisionRequirementStudentProfile: t(
      "platformDecisionRequirementStudentProfile",
    ),
    platformDecisionRequirementCountry: t(
      "platformDecisionRequirementCountry",
    ),
    platformDecisionRequirementDocument: t(
      "platformDecisionRequirementDocument",
    ),
    platformDecisionRequirementHandoff: t(
      "platformDecisionRequirementHandoff",
    ),
    platformDecisionRequirementField: t(
      "platformDecisionRequirementField",
    ),
    platformStudentProfileFieldPreferredDisplayName: t(
      "platformStudentProfileFieldPreferredDisplayName",
    ),
    platformStudentProfileFieldLegalDisplayName: t(
      "platformStudentProfileFieldLegalDisplayName",
    ),
    platformStudentProfileFieldCommunicationLanguage: t(
      "platformStudentProfileFieldCommunicationLanguage",
    ),
    platformStudentProfileFieldDateOfBirth: t(
      "platformStudentProfileFieldDateOfBirth",
    ),
    platformStudentProfileFieldCitizenshipCountry: t(
      "platformStudentProfileFieldCitizenshipCountry",
    ),
    platformStudentProfileFieldResidencyCountry: t(
      "platformStudentProfileFieldResidencyCountry",
    ),
    platformStudentProfileFieldCurrentEducationSummary: t(
      "platformStudentProfileFieldCurrentEducationSummary",
    ),
    platformStudentProfileFieldAcademicSummary: t(
      "platformStudentProfileFieldAcademicSummary",
    ),
    platformStudentProfileFieldLanguageSummary: t(
      "platformStudentProfileFieldLanguageSummary",
    ),
    platformStudentProfileFieldBudgetBand: t(
      "platformStudentProfileFieldBudgetBand",
    ),
    platformStudentProfileFieldDecisionParticipantLabels: t(
      "platformStudentProfileFieldDecisionParticipantLabels",
    ),
    platformStudentProfileFieldConsentStatus: t(
      "platformStudentProfileFieldConsentStatus",
    ),
    platformStudentProfileFieldConsentEvidenceRef: t(
      "platformStudentProfileFieldConsentEvidenceRef",
    ),
    platformStudentProfileFieldNextStep: t(
      "platformStudentProfileFieldNextStep",
    ),
    platformDecisionRequirementReference: t(
      "platformDecisionRequirementReference",
    ),
    platformDecisionEffectiveVersion: t(
      "platformDecisionEffectiveVersion",
    ),
    platformDecisionReason: t("platformDecisionReason"),
    platformDecisionSaveAnswer: t("platformDecisionSaveAnswer"),
    platformDecisionReopen: t("platformDecisionReopen"),
    platformDecisionRetire: t("platformDecisionRetire"),
    platformDecisionHistory: t("platformDecisionHistory"),
    platformDecisionHistoryVersion: t("platformDecisionHistoryVersion"),
    platformDecisionHistoryEmpty: t("platformDecisionHistoryEmpty"),
    platformDecisionHistoryActor: t("platformDecisionHistoryActor"),
    platformDecisionHistoryAt: t("platformDecisionHistoryAt"),
    platformDecisionHistoryActionCreated: t(
      "platformDecisionHistoryActionCreated",
    ),
    platformDecisionHistoryActionAnswered: t(
      "platformDecisionHistoryActionAnswered",
    ),
    platformDecisionHistoryActionReopened: t(
      "platformDecisionHistoryActionReopened",
    ),
    platformDecisionHistoryActionRetired: t(
      "platformDecisionHistoryActionRetired",
    ),
    platformHandoffContextTitle: t("platformHandoffContextTitle"),
    platformHandoffContextHint: t("platformHandoffContextHint"),
    platformHandoffNoLinkedCase: t("platformHandoffNoLinkedCase"),
    platformHandoffUnavailable: t("platformHandoffUnavailable"),
    platformHandoffRecordedAt: t("platformHandoffRecordedAt"),
    platformHandoffVersion: t("platformHandoffVersion"),
    platformHandoffCommercialFields: t(
      "platformHandoffCommercialFields",
    ),
    platformHandoffUnresolvedQuestions: t(
      "platformHandoffUnresolvedQuestions",
    ),
    platformHandoffPromises: t("platformHandoffPromises"),
    platformHandoffNextStep: t("platformHandoffNextStep"),
    platformHandoffDueDate: t("platformHandoffDueDate"),
    platformHandoffResponsibleRole: t(
      "platformHandoffResponsibleRole",
    ),
    platformHandoffNoneRecorded: t("platformHandoffNoneRecorded"),
    platformValueYes: t("platformValueYes"),
    platformValueNo: t("platformValueNo"),
    platformPromptEvidenceTitle: t("platformPromptEvidenceTitle"),
    platformPromptEvidenceHint: t("platformPromptEvidenceHint"),
    platformPromptPolicy: t("platformPromptPolicy"),
    platformBusinessContext: t("platformBusinessContext"),
    platformPromptUnavailable: t("platformPromptUnavailable"),
    platformPromptApproved: t("platformPromptApproved"),
    platformPromptPinnedSnapshot: t("platformPromptPinnedSnapshot"),
    platformPromptApprovedPinned: t("platformPromptApprovedPinned"),
    platformPromptActiveArtifacts: t("platformPromptActiveArtifacts"),
    platformPromptPinnedArtifacts: t("platformPromptPinnedArtifacts"),
    platformPromptPinnedAt: t("platformPromptPinnedAt"),
    platformPromptVersion: t("platformPromptVersion"),
    platformPromptSha: t("platformPromptSha"),
    platformPromptRawHidden: t("platformPromptRawHidden"),
  };
  const mediaLabels = {
    platformMediaGalleryLabel: t("platformMediaGalleryLabel"),
    platformMediaImageAlt: t("platformMediaImageAlt"),
    platformMediaAudioLabel: t("platformMediaAudioLabel"),
    platformMediaVideoLabel: t("platformMediaVideoLabel"),
    platformMediaDownload: t("platformMediaDownload"),
    platformMediaDownloadPdf: t("platformMediaDownloadPdf"),
    platformMediaPending: t("platformMediaPending"),
    platformMediaProcessing: t("platformMediaProcessing"),
    platformMediaRetryableError: t("platformMediaRetryableError"),
    platformMediaTerminalError: t("platformMediaTerminalError"),
    platformMediaFileUnnamed: t("platformMediaFileUnnamed"),
    platformMediaSizeUnknown: t("platformMediaSizeUnknown"),
  };
  const amocrmLabels = {
    platformAmoCrmContextTitle: t("platformAmoCrmContextTitle"),
    platformAmoCrmContextHint: t("platformAmoCrmContextHint"),
    platformAmoCrmContextAvailable: t("platformAmoCrmContextAvailable"),
    platformAmoCrmContextDegraded: t("platformAmoCrmContextDegraded"),
    platformAmoCrmContextStale: t("platformAmoCrmContextStale"),
    platformAmoCrmContextUnavailable: t("platformAmoCrmContextUnavailable"),
    platformAmoCrmContextDisabled: t("platformAmoCrmContextDisabled"),
    platformAmoCrmContextNotLinked: t("platformAmoCrmContextNotLinked"),
    platformAmoCrmContextReasonLabel: t("platformAmoCrmContextReasonLabel"),
    platformAmoCrmContextObservedAt: t("platformAmoCrmContextObservedAt"),
    platformAmoCrmContextLastAttemptAt: t("platformAmoCrmContextLastAttemptAt"),
    platformAmoCrmContextContactName: t("platformAmoCrmContextContactName"),
    platformAmoCrmContextLeadName: t("platformAmoCrmContextLeadName"),
    platformAmoCrmContextResponsibleUser: t("platformAmoCrmContextResponsibleUser"),
    platformAmoCrmContextResponsibleActive: t("platformAmoCrmContextResponsibleActive"),
    platformAmoCrmContextPipeline: t("platformAmoCrmContextPipeline"),
    platformAmoCrmContextStatus: t("platformAmoCrmContextStatus"),
    platformAmoCrmContextUnknownValue: t("platformAmoCrmContextUnknownValue"),
    platformValueYes: t("platformValueYes"),
    platformValueNo: t("platformValueNo"),
    platformAmoCrmContextReasonDisabledByConfig: t("platformAmoCrmContextReasonDisabledByConfig"),
    platformAmoCrmContextReasonMissingConfiguration: t("platformAmoCrmContextReasonMissingConfiguration"),
    platformAmoCrmContextReasonInvalidConfiguration: t("platformAmoCrmContextReasonInvalidConfiguration"),
    platformAmoCrmContextReasonConfigurationScopeMismatch: t("platformAmoCrmContextReasonConfigurationScopeMismatch"),
    platformAmoCrmContextReasonMissingBinding: t("platformAmoCrmContextReasonMissingBinding"),
    platformAmoCrmContextReasonProviderRejected: t("platformAmoCrmContextReasonProviderRejected"),
    platformAmoCrmContextReasonProviderNotFound: t("platformAmoCrmContextReasonProviderNotFound"),
    platformAmoCrmContextReasonProviderRateLimited: t("platformAmoCrmContextReasonProviderRateLimited"),
    platformAmoCrmContextReasonProviderTimeout: t("platformAmoCrmContextReasonProviderTimeout"),
    platformAmoCrmContextReasonProviderTransportFailure: t("platformAmoCrmContextReasonProviderTransportFailure"),
    platformAmoCrmContextReasonProviderResponseInvalid: t("platformAmoCrmContextReasonProviderResponseInvalid"),
    platformAmoCrmContextReasonProviderRelationshipMismatch: t("platformAmoCrmContextReasonProviderRelationshipMismatch"),
    platformAmoCrmContextReasonResponsibleUserForbidden: t("platformAmoCrmContextReasonResponsibleUserForbidden"),
    platformAmoCrmContextReasonRefreshFailed: t("platformAmoCrmContextReasonRefreshFailed"),
    platformAmoCrmContextReasonUnknown: t("platformAmoCrmContextReasonUnknown"),
  };
  const aiMemoryLabels = {
    title: t("platformAiMemoryTitle"),
    hint: t("platformAiMemoryHint"),
    disabled: t("platformAiMemoryDisabled"),
    summary: t("platformAiMemorySummary"),
    shortSummary: t("platformAiMemoryShortSummary"),
    longSummary: t("platformAiMemoryLongSummary"),
    saveSummary: t("platformAiMemorySaveSummary"),
    facts: t("platformAiMemoryFacts"),
    noFacts: t("platformAiMemoryNoFacts"),
    factKey: t("platformAiMemoryFactKey"),
    factValue: t("platformAiMemoryFactValue"),
    factStatus: t("platformAiMemoryFactStatus"),
    factActive: t("platformAiMemoryFactActive"),
    factRetracted: t("platformAiMemoryFactRetracted"),
    saveFact: t("platformAiMemorySaveFact"),
    qualification: t("platformAiMemoryQualification"),
    completeness: t("platformAiMemoryCompleteness"),
    missingFacts: t("platformAiMemoryMissingFacts"),
    notes: t("platformAiMemoryNotes"),
    saveQualification: t("platformAiMemorySaveQualification"),
    control: t("platformAiMemoryControl"),
    controlPaused: t("platformAiMemoryControlPaused"),
    controlStaffTakeover: t("platformAiMemoryControlStaffTakeover"),
    controlStaffOnly: t("platformAiMemoryControlStaffOnly"),
    pause: t("platformAiMemoryPause"),
    staffTakeover: t("platformAiMemoryStaffTakeover"),
    returnStaffOnly: t("platformAiMemoryReturnStaffOnly"),
    retrieval: t("platformAiMemoryRetrieval"),
    lexicalPreview: t("platformAiMemoryLexicalPreview"),
    lexicalDegraded: t("platformAiMemoryLexicalDegraded"),
    providerBlocked: t("platformAiMemoryProviderBlocked"),
    noEvidence: t("platformAiMemoryNoEvidence"),
    noMatch: t("platformAiMemoryNoMatch"),
    latestInboundRequired: t("platformAiMemoryLatestInboundRequired"),
    edit: t("platformAiMemoryEdit"),
    sourceMessage: t("platformAiMemorySourceMessage"),
    sourceMessageHint: t("platformAiMemorySourceMessageHint"),
    factLabels: {
      preferred_country: t("platformAiMemoryFactPreferredCountry"),
      preferred_program: t("platformAiMemoryFactPreferredProgram"),
      budget_signal: t("platformAiMemoryFactBudgetSignal"),
      intake_target: t("platformAiMemoryFactIntakeTarget"),
      preferred_language: t("platformAiMemoryFactPreferredLanguage"),
      urgency: t("platformAiMemoryFactUrgency"),
      blockers: t("platformAiMemoryFactBlockers"),
      promised_follow_up: t("platformAiMemoryFactPromisedFollowUp"),
      unanswered_questions: t("platformAiMemoryFactUnansweredQuestions"),
    },
    qualificationLabels: {
      collecting: t("platformAiMemoryQualificationCollecting"),
      ready_for_staff_review: t(
        "platformAiMemoryQualificationReadyForStaffReview",
      ),
      staff_confirmed: t("platformAiMemoryQualificationStaffConfirmed"),
      not_a_fit: t("platformAiMemoryQualificationNotAFit"),
    },
  };

  return (
    <div
      className="flex h-[calc(100vh-270px)] min-h-[520px] overflow-hidden rounded-card border border-border bg-surface shadow-evo"
      data-testid="platform-conversation-thread"
      data-provider-proof="not-proved"
    >
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

        <section
          className={cn(
            "border-b px-4 py-2 text-[11px]",
            statusTone(wahaHealth.tone),
          )}
          data-testid="platform-waha-session-health"
          data-session-status={wahaSessionHealth?.status ?? "UNKNOWN"}
          data-waha-health={wahaHealth.tone}
        >
          <p className="font-bold">{t("platformWahaSessionHealth")}</p>
          <p className="mt-0.5">
            {t(wahaHealth.labelKey)}
            {wahaSessionHealth
              ? ` · ${t("platformWahaSessionObserved")} ${formatTimestamp(wahaSessionHealth.observedAt, locale)}`
              : ""}
          </p>
        </section>

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

        <details
          className="border-b border-border bg-surface xl:hidden"
          data-testid="platform-ai-memory-mobile-details"
        >
          <summary className="cursor-pointer px-4 py-2.5 text-[11px] font-bold text-fg">
            {aiMemoryLabels.title}
          </summary>
          <div className="px-4 pb-3">
            <PlatformAiMemoryCard
              capabilities={aiRetrievalCapabilities}
              conversationId={conversation.id}
              evidence={aiRetrievalEvidence}
              inboundSourceMessages={aiMemorySourceMessages}
              labels={aiMemoryLabels}
              memory={aiMemory}
              testIdSuffix="-mobile"
            />
          </div>
        </details>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <EmptyState text={t("platformNoMessages")} />
          ) : (
            <div className="space-y-3">
              {messages.map((message) => {
                const outgoing = message.direction === "outbound";
                const wahaAck = getWahaAckPresentation(message.wahaAckName);
                return (
                  <article
                    key={message.id}
                    className={cn(
                      "flex",
                      outgoing ? "justify-end" : "justify-start",
                    )}
                    data-message-direction={message.direction}
                    data-waha-ack-name={
                      outgoing ? message.wahaAckName ?? "UNKNOWN" : undefined
                    }
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
                      <PlatformMessageMedia
                        labels={mediaLabels}
                        media={message.media}
                        outgoing={outgoing}
                      />
                      <p
                        className={cn(
                          "mt-1 text-right font-mono text-[9.5px]",
                          outgoing ? "text-white/70" : "text-fg-3",
                        )}
                      >
                        {formatTimestamp(message.createdAt, locale)}
                        {" · "}
                        {outgoing
                          ? t(wahaAck.labelKey)
                          : t("platformProviderStateNotProved")}
                        {outgoing && message.wahaAckObservedAt
                          ? ` · ${formatTimestamp(message.wahaAckObservedAt, locale)}`
                          : ""}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <PlatformMessagingWorkflowPanel
          key={conversation.id}
          conversationId={conversation.id}
          latestInboundMessageId={latestInboundMessage?.id ?? null}
          defaultLanguage={defaultLanguage}
          initialWorkflow={workflow}
          knowledge={knowledge}
          bw4Workspace={bw4Workspace}
          locale={locale}
          decisionMutationOutcome={decisionMutationOutcome}
          labels={workflowLabels}
        />
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
        <div className="space-y-4 p-4">
          <PlatformAmoCrmContextCard
            context={amocrmCanonicalContext}
            locale={locale}
            labels={amocrmLabels}
          />
          <PlatformAiMemoryCard
            capabilities={aiRetrievalCapabilities}
            conversationId={conversation.id}
            evidence={aiRetrievalEvidence}
            inboundSourceMessages={aiMemorySourceMessages}
            labels={aiMemoryLabels}
            memory={aiMemory}
          />
          <dl className="space-y-3">
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
        </div>
      </aside>
    </div>
  );
}
