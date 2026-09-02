import "server-only";

import {
  PLATFORM_GEMINI_MODEL_REF,
  PlatformProviderWorkflowError,
  beginGeminiProposal,
  claimManualWhatsAppSendItem,
  finishGeminiProposal,
  finishManualWhatsAppReconciliation,
  finishManualWhatsAppSend,
  getManualWhatsAppReconciliationContext,
  requestManualWhatsAppReconciliation,
  resolveManualSendWahaRuntime,
  type PlatformGeminiFailureCode,
  type PlatformGeminiFinishResult,
  type PlatformGeminiProposalContext,
  type PlatformGeminiProposalOutcome,
  type PlatformGeminiProviderStatus,
  type PlatformManualWhatsAppFinishResult,
  type PlatformManualWhatsAppReconciliationFinishResult,
  type PlatformManualWhatsAppSendAuthorization,
  type PlatformProviderRpcClient,
} from "../platform-provider-workflows.ts";
import {
  PlatformGeminiProviderError,
  type PlatformGeminiProviderInput,
  type PlatformGeminiProviderResult,
} from "./platform-gemini-provider.ts";
import {
  PlatformWahaProviderError,
  createPlatformWahaProvider,
  type PlatformWahaProvider,
} from "./platform-waha-provider.ts";

export const PLATFORM_GEMINI_PROVIDER_TIMEOUT_MS = 30_000;
export const PLATFORM_GEMINI_MAX_OUTPUT_TOKENS = 4_096;
export const PLATFORM_GEMINI_TEMPERATURE = 0.2;

export const PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "language",
    "intent",
    "confidence",
    "risk",
    "handoff_required",
    "handoff_reasons",
    "citations",
    "memory_changes",
    "qualification",
    "reply_text",
    "summary",
    "next_action",
    "draft_internal_note",
    "missing_document_suggestion",
    "deadline_warning",
    "limitations",
    "uncertainty",
  ],
  properties: {
    schema_version: { type: "integer", enum: [2] },
    language: { type: "string", enum: ["ru", "en"] },
    intent: {
      type: "string",
      enum: [
        "greeting",
        "admissions_discovery",
        "program_or_country",
        "documents",
        "deadline",
        "pricing_or_payment",
        "visa",
        "scholarship",
        "complaint",
        "opt_out",
        "other",
      ],
    },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    risk: { type: "string", enum: ["low", "medium", "high"] },
    handoff_required: { type: "boolean" },
    handoff_reasons: {
      type: "array",
      maxItems: 8,
      uniqueItems: true,
      items: {
        type: "string",
        enum: [
          "unsupported_language",
          "missing_evidence",
          "low_confidence",
          "complaint_or_anger",
          "payment_or_refund_or_price_exception",
          "legal_or_privacy",
          "guarantee_request",
          "opt_out",
          "unsafe_content",
          "ambiguous_request",
          "staff_takeover",
          "media_only",
        ],
      },
    },
    citations: {
      type: "array",
      maxItems: 6,
      uniqueItems: true,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "knowledge_key",
          "knowledge_version",
          "evidence_ordinal",
        ],
        properties: {
          knowledge_key: {
            type: "string",
            pattern: "^[a-z][a-z0-9_.-]*$",
          },
          knowledge_version: { type: "integer", minimum: 1 },
          evidence_ordinal: { type: "integer", minimum: 1, maximum: 10 },
        },
      },
    },
    memory_changes: {
      type: "array",
      maxItems: 9,
      uniqueItems: true,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fact_key", "action", "value", "confidence"],
        properties: {
          fact_key: {
            type: "string",
            enum: [
              "preferred_country",
              "preferred_program",
              "budget_signal",
              "intake_target",
              "preferred_language",
              "urgency",
              "blockers",
              "promised_follow_up",
              "unanswered_questions",
            ],
          },
          action: { type: "string", enum: ["set", "clear"] },
          value: {
            anyOf: [
              { type: "string", minLength: 1, maxLength: 500 },
              { type: "null" },
            ],
          },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
    },
    qualification: {
      type: "object",
      additionalProperties: false,
      required: ["status", "completeness", "missing_fact_keys", "notes"],
      properties: {
        status: {
          type: "string",
          enum: ["collecting", "ready_for_staff_review", "not_a_fit"],
        },
        completeness: { type: "integer", minimum: 0, maximum: 100 },
        missing_fact_keys: {
          type: "array",
          maxItems: 9,
          uniqueItems: true,
          items: {
            type: "string",
            enum: [
              "preferred_country",
              "preferred_program",
              "budget_signal",
              "intake_target",
              "preferred_language",
              "urgency",
              "blockers",
              "promised_follow_up",
              "unanswered_questions",
            ],
          },
        },
        notes: {
          anyOf: [
            { type: "string", minLength: 1, maxLength: 1_000 },
            { type: "null" },
          ],
        },
      },
    },
    reply_text: { type: "string", minLength: 1, maxLength: 2_000 },
    summary: { type: "string", minLength: 1, maxLength: 2_000 },
    next_action: { type: "string", minLength: 1, maxLength: 1_000 },
    draft_internal_note: {
      type: "string",
      minLength: 1,
      maxLength: 4_000,
    },
    missing_document_suggestion: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 1_000 },
        { type: "null" },
      ],
    },
    deadline_warning: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 1_000 },
        { type: "null" },
      ],
    },
    limitations: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    uncertainty: { type: "string", enum: ["low", "medium", "high"] },
  },
} as const);

export type PlatformGeminiProposalProvider = Readonly<{
  generateStructuredProposal(
    input: PlatformGeminiProviderInput,
  ): Promise<PlatformGeminiProviderResult>;
}>;

export type PlatformGeminiExecutionResult =
  | Readonly<{
      status: "finished";
      result: PlatformGeminiFinishResult;
    }>
  | Readonly<{
      status: "already_completed";
      proposalRequestId: string;
      outcome: PlatformGeminiProposalOutcome;
    }>
  | Readonly<{
      status: "in_progress";
      proposalRequestId: string;
    }>;

export type PlatformManualWhatsAppSendExecutionResult =
  | Readonly<{
      status: "not_claimed";
      workItemId: string;
    }>
  | Readonly<{
      status: "finished";
      result: PlatformManualWhatsAppFinishResult;
    }>;

export type PlatformManualWhatsAppReconciliationExecutionResult =
  | Readonly<{
      status: "finished";
      result: PlatformManualWhatsAppReconciliationFinishResult;
    }>
  | Readonly<{
      status: "already_completed";
      reconciliationRequestId: string;
    }>
  | Readonly<{
      status: "readback_failed";
      reconciliationRequestId: string;
      errorCode: string;
    }>;

export type PlatformWahaProviderFactory = (
  runtime: Parameters<typeof createPlatformWahaProvider>[0],
) => PlatformWahaProvider;

function buildGeminiPrompt(context: PlatformGeminiProposalContext): string {
  return [
    "You prepare one advisory draft for an EVO staff member.",
    "You never send a message, change CRM state, call tools, or make a decision for staff.",
    "You never promise admission, visas, scholarships, deadlines, discounts, payments, or outcomes.",
    "Use only the locked source message and approved knowledge below.",
    "Citations must be selected only from allowedCitations and every uncertain claim must be stated as a limitation.",
    "Return exactly one JSON object matching schema version 2, without Markdown or surrounding text.",
    JSON.stringify(context),
  ].join("\n\n");
}

function geminiFailureEvidence(error: unknown): Readonly<{
  failureCode: PlatformGeminiFailureCode;
  providerInteractionRef: string | null;
  providerStatus: PlatformGeminiProviderStatus;
}> {
  if (!(error instanceof PlatformGeminiProviderError)) {
    return Object.freeze({
      failureCode: "provider_error",
      providerInteractionRef: null,
      providerStatus: "local_error",
    });
  }

  const failureCode: PlatformGeminiFailureCode =
    error.code === "invalid_proposal" ? "malformed_output" : error.code;
  const providerInteractionRef = error.providerInteractionRef;
  let providerStatus: PlatformGeminiProviderStatus;
  if (providerInteractionRef !== null) {
    providerStatus = error.code === "output_truncated" ? "incomplete" : "failed";
  } else if (error.code === "configuration_missing") {
    providerStatus = "configuration_error";
  } else {
    providerStatus = "transport_error";
  }
  return Object.freeze({ failureCode, providerInteractionRef, providerStatus });
}

export async function executePlatformGeminiProposal(
  serviceClient: PlatformProviderRpcClient,
  input: Readonly<{
    organizationId: string;
    conversationId: string;
    sourceMessageId: string;
    requestId: string;
  }>,
  dependencies: Readonly<{
    geminiProvider: PlatformGeminiProposalProvider;
  }>,
): Promise<PlatformGeminiExecutionResult> {
  const begun = await beginGeminiProposal(serviceClient, input);
  if (begun.completed) {
    return Object.freeze({
      status: "already_completed" as const,
      proposalRequestId: begun.proposalRequestId,
      outcome: begun.outcome as PlatformGeminiProposalOutcome,
    });
  }
  if (begun.replayed) {
    return Object.freeze({
      status: "in_progress" as const,
      proposalRequestId: begun.proposalRequestId,
    });
  }

  const prompt = buildGeminiPrompt(begun.context);
  let finishInput: Parameters<typeof finishGeminiProposal>[1];
  try {
    const providerResult = await dependencies.geminiProvider.generateStructuredProposal({
      model: PLATFORM_GEMINI_MODEL_REF,
      prompt,
      responseJsonSchema: PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA,
      timeoutMs: PLATFORM_GEMINI_PROVIDER_TIMEOUT_MS,
      maxOutputTokens: PLATFORM_GEMINI_MAX_OUTPUT_TOKENS,
      temperature: PLATFORM_GEMINI_TEMPERATURE,
    });
    finishInput = {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      sourceMessageId: input.sourceMessageId,
      proposalRequestId: begun.proposalRequestId,
      outcome: "proposal_ready",
      failureCode: null,
      promptText: prompt,
      providerInteractionRef: providerResult.providerInteractionRef,
      providerStatus: providerResult.providerStatus,
      responseJson: providerResult.responseJson,
    };
  } catch (error) {
    const failure = geminiFailureEvidence(error);
    finishInput = {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      sourceMessageId: input.sourceMessageId,
      proposalRequestId: begun.proposalRequestId,
      outcome: "human_review",
      failureCode: failure.failureCode,
      promptText: prompt,
      providerInteractionRef: failure.providerInteractionRef,
      providerStatus: failure.providerStatus,
      responseJson: null,
    };
  }
  const result = await finishGeminiProposal(serviceClient, finishInput);
  return Object.freeze({ status: "finished" as const, result });
}

function claimMatchesAuthorization(
  claim: Extract<
    Awaited<ReturnType<typeof claimManualWhatsAppSendItem>>,
    { claimed: true }
  >,
  authorization: PlatformManualWhatsAppSendAuthorization,
): boolean {
  return (
    claim.organizationId === authorization.organizationId &&
    claim.workItemId === authorization.workItemId &&
    claim.requestedWorkItemId === authorization.workItemId &&
    claim.manualSendAuthorizationId ===
      authorization.manualSendAuthorizationId &&
    claim.conversationId === authorization.communicationConversationId &&
    claim.sourceMessageId === authorization.sourceMessageId &&
    claim.finalText === authorization.finalText &&
    claim.finalTextSha256 === authorization.finalTextSha256
  );
}

function manualSendFailure(error: unknown): Readonly<{
  outcome: "terminal_error" | "unknown_result";
  errorCode: string;
}> {
  if (error instanceof PlatformWahaProviderError) {
    return Object.freeze({
      outcome:
        error.disposition === "failed" ? "terminal_error" : "unknown_result",
      errorCode: error.code,
    });
  }
  if (error instanceof PlatformProviderWorkflowError) {
    return Object.freeze({
      outcome: "terminal_error",
      errorCode: "waha_runtime_unavailable",
    });
  }
  return Object.freeze({
    outcome: "unknown_result",
    errorCode: "provider_unknown_failure",
  });
}

export async function executePlatformManualWhatsAppSend(
  serviceClient: PlatformProviderRpcClient,
  input: Readonly<{
    authorization: PlatformManualWhatsAppSendAuthorization;
    visibilityTimeoutSeconds: number;
    workerRef: string;
    claimRequestId: string;
    completionRequestId: string;
  }>,
  dependencies: Readonly<{
    createWahaProvider?: PlatformWahaProviderFactory;
  }> = {},
): Promise<PlatformManualWhatsAppSendExecutionResult> {
  const authorization = input.authorization;
  const claim = await claimManualWhatsAppSendItem(serviceClient, {
    organizationId: authorization.organizationId,
    workItemId: authorization.workItemId,
    visibilityTimeoutSeconds: input.visibilityTimeoutSeconds,
    workerRef: input.workerRef,
    requestId: input.claimRequestId,
  });
  if (!claim.claimed) {
    return Object.freeze({
      status: "not_claimed" as const,
      workItemId: claim.requestedWorkItemId,
    });
  }

  let finishInput: Parameters<typeof finishManualWhatsAppSend>[1];
  if (!claimMatchesAuthorization(claim, authorization)) {
    finishInput = {
      organizationId: claim.organizationId,
      workItemId: claim.workItemId,
      attemptId: claim.attemptId,
      authorizationId: claim.manualSendAuthorizationId,
      outcome: "terminal_error",
      errorCode: "authorization_mismatch",
      providerMessageId: null,
      providerObservedAt: null,
      requestId: input.completionRequestId,
    };
  } else {
    try {
      const runtime = await resolveManualSendWahaRuntime(
        serviceClient,
        claim.organizationId,
      );
      const createWahaProvider =
        dependencies.createWahaProvider ??
        ((resolvedRuntime) => createPlatformWahaProvider(resolvedRuntime));
      const provider = createWahaProvider(runtime);
      const providerResult = await provider.sendText({
        recipientId: claim.rawChatId,
        text: claim.finalText,
        replyTo: claim.rawReplyTo,
      });
      finishInput = {
        organizationId: claim.organizationId,
        workItemId: claim.workItemId,
        attemptId: claim.attemptId,
        authorizationId: claim.manualSendAuthorizationId,
        outcome: "succeeded",
        errorCode: null,
        providerMessageId: providerResult.providerMessageId,
        providerObservedAt: providerResult.providerObservedAt,
        requestId: input.completionRequestId,
      };
    } catch (error) {
      const failure = manualSendFailure(error);
      finishInput = {
        organizationId: claim.organizationId,
        workItemId: claim.workItemId,
        attemptId: claim.attemptId,
        authorizationId: claim.manualSendAuthorizationId,
        outcome: failure.outcome,
        errorCode: failure.errorCode,
        providerMessageId: null,
        providerObservedAt: null,
        requestId: input.completionRequestId,
      };
    }
  }

  const result = await finishManualWhatsAppSend(serviceClient, finishInput);
  return Object.freeze({ status: "finished" as const, result });
}

function reconciliationFailureCode(error: unknown): string {
  if (error instanceof PlatformWahaProviderError) return error.code;
  if (error instanceof PlatformProviderWorkflowError) {
    return "waha_runtime_unavailable";
  }
  return "provider_unknown_failure";
}

export async function executePlatformManualWhatsAppReconciliation(
  staffClient: PlatformProviderRpcClient,
  serviceClient: PlatformProviderRpcClient,
  input: Readonly<{
    organizationId: string;
    conversationId: string;
    attemptId: string;
    requestId: string;
    reason: string;
    completionRequestId: string;
  }>,
  dependencies: Readonly<{
    createWahaProvider?: PlatformWahaProviderFactory;
  }> = {},
): Promise<PlatformManualWhatsAppReconciliationExecutionResult> {
  const receipt = await requestManualWhatsAppReconciliation(staffClient, {
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    attemptId: input.attemptId,
    requestId: input.requestId,
    reason: input.reason,
  });
  const context = await getManualWhatsAppReconciliationContext(
    serviceClient,
    receipt.reconciliationRequestId,
  );
  if (
    context.organizationId !== input.organizationId ||
    context.conversationId !== input.conversationId ||
    context.attemptId !== input.attemptId ||
    context.requestId !== input.requestId ||
    context.reconciliationKind !== receipt.reconciliationKind
  ) {
    return Object.freeze({
      status: "readback_failed" as const,
      reconciliationRequestId: receipt.reconciliationRequestId,
      errorCode: "reconciliation_context_mismatch",
    });
  }
  if (context.completed) {
    return Object.freeze({
      status: "already_completed" as const,
      reconciliationRequestId: receipt.reconciliationRequestId,
    });
  }

  let providerMessage: Awaited<
    ReturnType<PlatformWahaProvider["getMessage"]>
  > | null;
  try {
    const runtime = await resolveManualSendWahaRuntime(
      serviceClient,
      context.organizationId,
    );
    const createWahaProvider =
      dependencies.createWahaProvider ??
      ((resolvedRuntime) => createPlatformWahaProvider(resolvedRuntime));
    const provider = createWahaProvider(runtime);
    if (context.reconciliationKind === "ack_refresh") {
      if (context.expectedProviderMessageId === null) {
        return Object.freeze({
          status: "readback_failed" as const,
          reconciliationRequestId: receipt.reconciliationRequestId,
          errorCode: "reconciliation_context_mismatch",
        });
      }
      providerMessage = await provider.getMessage({
        recipientId: context.rawChatId,
        providerMessageId: context.expectedProviderMessageId,
        expectedText: context.finalText,
      });
    } else {
      providerMessage = await provider.findUniqueMessage({
        recipientId: context.rawChatId,
        expectedText: context.finalText,
        windowStart: context.providerWindowStart,
        windowEnd: context.providerWindowEnd,
      });
    }
  } catch (error) {
    return Object.freeze({
      status: "readback_failed" as const,
      reconciliationRequestId: receipt.reconciliationRequestId,
      errorCode: reconciliationFailureCode(error),
    });
  }

  const finishInput: Parameters<
    typeof finishManualWhatsAppReconciliation
  >[1] = providerMessage === null
    ? {
        reconciliationRequestId: receipt.reconciliationRequestId,
        wahaSessionName: context.wahaSessionName,
        rawChatId: context.rawChatId,
        finalTextSha256: context.finalTextSha256,
        matchCount: 0,
        providerMessageId: null,
        providerSource: null,
        ackState: null,
        providerObservedAt: null,
        ackObservedAt: null,
        completionRequestId: input.completionRequestId,
      }
    : {
        reconciliationRequestId: receipt.reconciliationRequestId,
        wahaSessionName: context.wahaSessionName,
        rawChatId: context.rawChatId,
        finalTextSha256: context.finalTextSha256,
        matchCount: 1,
        providerMessageId: providerMessage.providerMessageId,
        providerSource: providerMessage.providerSource,
        ackState: providerMessage.ackState,
        providerObservedAt: providerMessage.providerObservedAt,
        ackObservedAt: providerMessage.ackObservedAt,
        completionRequestId: input.completionRequestId,
      };
  const result = await finishManualWhatsAppReconciliation(
    serviceClient,
    finishInput,
  );
  return Object.freeze({ status: "finished" as const, result });
}
