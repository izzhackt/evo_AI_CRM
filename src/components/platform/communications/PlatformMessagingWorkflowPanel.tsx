"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  authorizePlatformManualSendAction,
  requestPlatformAiDraftAction,
  reviewPlatformAiDraftAction,
} from "@/lib/platform-messaging-actions";
import type {
  PlatformConversationWorkflow,
  PlatformKnowledgeCatalogItem,
  PlatformMessagingMutationStatus,
  PlatformWorkflowIntegration,
} from "@/lib/platform-messaging-workflow";
import { btnCls, btnGhostCls, inputCls, labelCls } from "@/components/ui";

type Labels = Readonly<Record<string, string>>;
type DraftReviewDecision = "approved" | "rework" | "handoff";

function statusTone(status: PlatformWorkflowIntegration["readiness"]) {
  if (status === "ready") return "border-ok/30 bg-ok-weak text-ok";
  if (status === "blocked") return "border-danger/30 bg-danger-weak text-danger";
  if (status === "configured_unverified") {
    return "border-warn/30 bg-warn-weak text-warn";
  }
  return "border-border bg-surface-2 text-fg-3";
}

function integrationStatusLabel(
  integration: PlatformWorkflowIntegration,
  labels: Labels,
) {
  if (integration.readiness === "ready") return labels.platformHealthReady;
  if (integration.readiness === "blocked") return labels.platformHealthBlocked;
  if (integration.readiness === "configured_unverified") {
    return labels.platformHealthConfiguredUnverified;
  }
  return labels.platformHealthUnconfigured;
}

function integrationEvidenceLabel(
  integration: PlatformWorkflowIntegration,
  labels: Labels,
) {
  if (integration.evidenceKind === "provider_observed") {
    return labels.platformEvidenceProviderObserved;
  }
  if (integration.evidenceKind === "local_non_provider") {
    return labels.platformEvidenceLocalNonProvider;
  }
  if (integration.evidenceKind === "configuration_check") {
    return labels.platformEvidenceConfigurationOnly;
  }
  return labels.platformProviderStateNotProved;
}

function outboxLabel(state: string, labels: Labels) {
  if (state === "queued") return labels.platformOutboxQueued;
  if (state === "retry_wait") return labels.platformOutboxRetryWait;
  if (state === "succeeded") return labels.platformOutboxSucceeded;
  if (state === "dead_lettered") return labels.platformOutboxDeadLettered;
  if (state === "unknown_manual_review") {
    return labels.platformOutboxUnknownReview;
  }
  if (state === "conflict_manual_review") {
    return labels.platformOutboxConflictReview;
  }
  return state;
}

function actionStatusLabel(
  status: PlatformMessagingMutationStatus | null,
  labels: Labels,
) {
  if (status === "completed") return labels.platformActionCompleted;
  if (status === "persisted_not_staged") {
    return labels.platformActionPersistedNotStaged;
  }
  if (status === "invalid") return labels.platformActionInvalid;
  if (status === "unavailable") return labels.platformActionUnavailable;
  return null;
}

function IntegrationHealth({
  label,
  integration,
  labels,
}: {
  label: string;
  integration: PlatformWorkflowIntegration;
  labels: Labels;
}) {
  return (
    <div
      className={`rounded-ctl border px-3 py-2 ${statusTone(integration.readiness)}`}
      data-integration-readiness={integration.readiness}
      data-provider-proof={integration.providerProved ? "proved" : "not-proved"}
    >
      <p className="text-[11px] font-bold">{label}</p>
      <p className="mt-0.5 text-[11px]">
        {integrationStatusLabel(integration, labels)}
      </p>
      <p className="mt-1 text-[10px] leading-4 opacity-80">
        {integrationEvidenceLabel(integration, labels)}
      </p>
    </div>
  );
}

export function PlatformMessagingWorkflowPanel({
  conversationId,
  latestInboundMessageId,
  defaultLanguage,
  initialWorkflow,
  knowledge,
  labels,
}: {
  conversationId: string;
  latestInboundMessageId: string | null;
  defaultLanguage: "ru" | "en" | null;
  initialWorkflow: PlatformConversationWorkflow;
  knowledge: readonly PlatformKnowledgeCatalogItem[];
  labels: Labels;
}) {
  const router = useRouter();
  const [actionStatus, setActionStatus] =
    useState<PlatformMessagingMutationStatus | null>(null);
  const [pending, startTransition] = useTransition();
  const workflow = initialWorkflow;

  function applyResult(
    result: Awaited<
      | ReturnType<typeof requestPlatformAiDraftAction>
      | ReturnType<typeof reviewPlatformAiDraftAction>
      | ReturnType<typeof authorizePlatformManualSendAction>
    >,
  ) {
    setActionStatus(result.status);
    router.refresh();
  }

  function requestDraft(formData: FormData) {
    const sourceMessageId = latestInboundMessageId;
    const knowledgeVersionId = String(
      formData.get("knowledgeVersionId") ?? "",
    );
    const requestedLanguage = String(formData.get("requestedLanguage") ?? "");
    const reason = String(formData.get("reason") ?? "");

    startTransition(async () => {
      applyResult(
        await requestPlatformAiDraftAction({
          conversationId,
          sourceMessageId: sourceMessageId ?? "",
          knowledgeVersionId,
          requestedLanguage:
            requestedLanguage === "ru" || requestedLanguage === "en"
              ? requestedLanguage
              : null,
          reason,
        }),
      );
    });
  }

  function reviewDraft(formData: FormData) {
    const draft = workflow.draft;
    if (!draft?.aiDraftId) return;

    const decision = String(formData.get("decision")) as DraftReviewDecision;
    const reviewedText = String(formData.get("reviewedText") ?? "");
    const reason = String(formData.get("reason") ?? "");

    startTransition(async () => {
      applyResult(
        await reviewPlatformAiDraftAction({
          conversationId,
          aiDraftId: draft.aiDraftId!,
          decision,
          reviewedText: decision === "approved" ? reviewedText : undefined,
          reason,
        }),
      );
    });
  }

  function authorizeManualSend(formData: FormData) {
    const draft = workflow.draft;
    if (!draft?.aiDraftId) return;

    startTransition(async () => {
      applyResult(
        await authorizePlatformManualSendAction({
          conversationId,
          aiDraftId: draft.aiDraftId!,
          finalText: String(formData.get("finalText") ?? ""),
          reason: String(formData.get("reason") ?? ""),
        }),
      );
    });
  }

  const statusMessage = actionStatusLabel(actionStatus, labels);
  const draft = workflow.draft;
  const canRequest =
    workflow.health.canRequestAiDraft &&
    latestInboundMessageId !== null &&
    knowledge.length > 0;

  return (
    <section
      className="max-h-[42vh] overflow-y-auto border-t border-border bg-surface p-3"
      data-testid="platform-messaging-workflow"
      data-provider-proof={
        workflow.integrations.aiProvider.providerProved &&
        workflow.integrations.waha.providerProved
          ? "proved"
          : "not-proved"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[12px] font-bold text-fg">
            {labels.platformWorkflowTitle}
          </h2>
          <p className="mt-0.5 max-w-2xl text-[10.5px] leading-4 text-fg-3">
            {labels.platformWorkflowHint}
          </p>
        </div>
        {workflow.latestAuditAction && (
          <p className="text-[10px] text-fg-3" data-testid="platform-workflow-audit">
            {labels.platformAuditLatest}: {workflow.latestAuditAction}
          </p>
        )}
      </div>

      <div
        className="mt-2 grid gap-2 sm:grid-cols-2"
        data-testid="platform-workflow-health"
      >
        <IntegrationHealth
          label={labels.platformAiHealth}
          integration={workflow.integrations.aiProvider}
          labels={labels}
        />
        <IntegrationHealth
          label={labels.platformWahaHealth}
          integration={workflow.integrations.waha}
          labels={labels}
        />
      </div>

      {workflow.selectedKnowledge && (
        <p
          className="mt-2 rounded-ctl border border-border bg-surface-2 px-3 py-2 text-[10.5px] text-fg-2"
          data-testid="platform-selected-knowledge"
        >
          {labels.platformKnowledgeLabel}: {workflow.selectedKnowledge.title} · v
          {workflow.selectedKnowledge.version}
        </p>
      )}

      {statusMessage && (
        <p
          aria-live="polite"
          className={`mt-2 rounded-ctl px-3 py-2 text-[11px] ${
            actionStatus === "completed"
              ? "bg-ok-weak text-ok"
              : "bg-warn-weak text-warn"
          }`}
          data-action-status={actionStatus}
        >
          {statusMessage}
        </p>
      )}

      {!draft && (
        <form action={requestDraft} className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor="platform-knowledge-select" className={labelCls}>
              {labels.platformKnowledgeLabel}
            </label>
            <select
              id="platform-knowledge-select"
              name="knowledgeVersionId"
              required
              disabled={!canRequest || pending}
              className={inputCls}
              data-testid="platform-knowledge-select"
            >
              {knowledge.length === 0 && (
                <option value="">{labels.platformKnowledgeEmpty}</option>
              )}
              {knowledge.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · v{item.version}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="platform-draft-language" className={labelCls}>
              {labels.platformDraftLanguage}
            </label>
            <select
              id="platform-draft-language"
              name="requestedLanguage"
              defaultValue={defaultLanguage ?? ""}
              required
              disabled={!canRequest || pending}
              className={inputCls}
            >
              <option value="" disabled>
                RU / EN
              </option>
              <option value="ru">RU</option>
              <option value="en">EN</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="platform-draft-reason" className={labelCls}>
              {labels.platformDraftReason}
            </label>
            <input
              id="platform-draft-reason"
              name="reason"
              required
              minLength={3}
              maxLength={500}
              disabled={!canRequest || pending}
              className={inputCls}
            />
          </div>
          <button
            type="submit"
            disabled={!canRequest || pending}
            className={`${btnCls} sm:col-span-2`}
            data-testid="platform-request-draft"
          >
            {labels.platformRequestDraft}
          </button>
        </form>
      )}

      {draft && !draft.aiDraftId && (
        <p
          className="mt-3 rounded-ctl bg-info-weak px-3 py-2 text-[11px] text-info"
          data-testid="platform-draft-awaiting"
        >
          {labels.platformDraftAwaitingGeneration}
        </p>
      )}

      {draft?.aiDraftId && draft.state === "review_required" && (
        <form action={reviewDraft} className="mt-3 space-y-2">
          <label htmlFor="platform-draft-editor" className={labelCls}>
            {labels.platformDraftEditor}
          </label>
          <textarea
            id="platform-draft-editor"
            name="reviewedText"
            required
            minLength={1}
            maxLength={5000}
            defaultValue={draft.generatedText ?? ""}
            disabled={!workflow.health.canReviewAiDraft || pending}
            className={`${inputCls} min-h-28 resize-y py-2`}
            data-testid="platform-draft-editor"
          />
          <label htmlFor="platform-review-reason" className={labelCls}>
            {labels.platformReviewReason}
          </label>
          <input
            id="platform-review-reason"
            name="reason"
            required
            minLength={3}
            maxLength={500}
            disabled={!workflow.health.canReviewAiDraft || pending}
            className={inputCls}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              name="decision"
              value="approved"
              disabled={!workflow.health.canReviewAiDraft || pending}
              className={btnCls}
              data-testid="platform-review-approve"
            >
              {labels.platformApproveDraft}
            </button>
            <button
              type="submit"
              name="decision"
              value="rework"
              disabled={!workflow.health.canReviewAiDraft || pending}
              className={btnGhostCls}
            >
              {labels.platformRequestRework}
            </button>
            <button
              type="submit"
              name="decision"
              value="handoff"
              disabled={!workflow.health.canReviewAiDraft || pending}
              className={btnGhostCls}
            >
              {labels.platformHandoffDraft}
            </button>
          </div>
        </form>
      )}

      {draft?.aiDraftId &&
        draft.state === "ready_for_manual_send" &&
        !workflow.manualSend && (
          <form action={authorizeManualSend} className="mt-3 space-y-2">
            <h3 className="text-[12px] font-bold text-fg">
              {labels.platformManualSendTitle}
            </h3>
            <label htmlFor="platform-manual-send-text" className={labelCls}>
              {labels.platformManualSendMessage}
            </label>
            <textarea
              id="platform-manual-send-text"
              name="finalText"
              required
              minLength={1}
              maxLength={5000}
              defaultValue={draft.reviewedText ?? ""}
              disabled={!workflow.health.canAuthorizeManualSend || pending}
              className={`${inputCls} min-h-28 resize-y py-2`}
            />
            <label htmlFor="platform-manual-send-reason" className={labelCls}>
              {labels.platformManualSendReason}
            </label>
            <input
              id="platform-manual-send-reason"
              name="reason"
              required
              minLength={3}
              maxLength={500}
              disabled={!workflow.health.canAuthorizeManualSend || pending}
              className={inputCls}
            />
            <p className="text-[10.5px] leading-4 text-fg-3">
              {labels.platformManualOnlyHint}
            </p>
            <button
              type="submit"
              disabled={!workflow.health.canAuthorizeManualSend || pending}
              className={`${btnCls} w-full`}
              data-testid="platform-manual-send"
            >
              {labels.platformAuthorizeManualSend}
            </button>
          </form>
        )}

      {workflow.manualSend && (
        <div className="mt-3 rounded-ctl border border-border bg-surface-2 p-3">
          <h3 className="text-[12px] font-bold text-fg">
            {labels.platformManualSendTitle}
          </h3>
          <p className="mt-1 whitespace-pre-wrap text-[12px] text-fg-2">
            {workflow.manualSend.finalText}
          </p>
        </div>
      )}

      <div
        className="mt-3 rounded-ctl border border-border bg-surface-2 p-3"
        data-testid="platform-outbox-state"
      >
        <h3 className="text-[11px] font-bold text-fg">
          {labels.platformOutboxTitle}
        </h3>
        {workflow.outbox.length === 0 ? (
          <p className="mt-1 text-[11px] text-fg-3">
            {labels.platformOutboxNotStaged}
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {workflow.outbox.map((item) => (
              <li
                key={item.workItemId}
                className="text-[11px] text-fg-2"
                data-outbox-kind={item.kind}
                data-outbox-state={item.state}
              >
                {item.kind === "ai_draft_generate" ? "AI" : "WAHA"}:{" "}
                {outboxLabel(item.state, labels)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
