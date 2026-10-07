import "server-only";

import {
  PlatformProviderWorkflowError,
  claimManualWhatsAppSendItem,
  finishManualWhatsAppReconciliation,
  finishManualWhatsAppSend,
  getManualWhatsAppReconciliationBoundMessageIds,
  getManualWhatsAppReconciliationContext,
  requestManualWhatsAppReconciliation,
  resolveManualSendWahaRuntime,
  type PlatformManualWhatsAppFinishResult,
  type PlatformManualWhatsAppReconciliationFinishResult,
  type PlatformManualWhatsAppSendAuthorization,
  type PlatformProviderRpcClient,
} from "../platform-provider-workflows.ts";
import {
  PlatformWahaProviderError,
  createPlatformWahaProvider,
  type PlatformWahaProvider,
} from "./platform-waha-provider.ts";

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
  options: Readonly<{ quoteSource?: boolean }> = {},
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
  return sendClaimedManualWhatsApp(
    serviceClient,
    claim,
    authorization,
    input.completionRequestId,
    dependencies,
    options,
  );
}

/**
 * The provider call and the durable finish of one exactly claimed send. The
 * claim is the authority for one irreversible provider call; whatever the
 * provider answers is written back by the finish (accepted, rejected or
 * unknown). `quoteSource: false` sends a plain chat message instead of a
 * WhatsApp reply quoting the customer message (migration 266, D3).
 */
export async function sendClaimedManualWhatsApp(
  serviceClient: PlatformProviderRpcClient,
  claim: Extract<
    Awaited<ReturnType<typeof claimManualWhatsAppSendItem>>,
    { claimed: true }
  >,
  authorization: PlatformManualWhatsAppSendAuthorization,
  completionRequestId: string,
  dependencies: Readonly<{
    createWahaProvider?: PlatformWahaProviderFactory;
  }> = {},
  options: Readonly<{ quoteSource?: boolean }> = {},
): Promise<Extract<PlatformManualWhatsAppSendExecutionResult, { status: "finished" }>> {
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
      requestId: completionRequestId,
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
        replyTo: options.quoteSource === false ? null : claim.rawReplyTo,
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
        requestId: completionRequestId,
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
        requestId: completionRequestId,
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
      // Messages of the chat's other CRM sends are never this attempt's
      // (the same short text sent twice within the window, migration 266).
      const excludeProviderMessageIds =
        await getManualWhatsAppReconciliationBoundMessageIds(
          serviceClient,
          receipt.reconciliationRequestId,
        );
      providerMessage = await provider.findUniqueMessage({
        recipientId: context.rawChatId,
        expectedText: context.finalText,
        windowStart: context.providerWindowStart,
        windowEnd: context.providerWindowEnd,
        excludeProviderMessageIds,
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
