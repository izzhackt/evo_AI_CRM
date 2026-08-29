import "server-only";

import type { FixedRole } from "../fixed-role-policy.ts";
import {
  CanonicalCrmRepositoryError,
  executeCanonicalWhatsAppSend,
  reconcileCanonicalWhatsAppSendAttempt,
  type CanonicalWhatsAppProviderMessage,
  type CanonicalWhatsAppSendAttemptSnapshot,
} from "./canonical-crm-repository.ts";
import type {
  CanonicalWhatsAppReconcileForm,
  CanonicalWhatsAppSendForm,
} from "./canonical-whatsapp-outbound-form.ts";
import {
  CanonicalWahaProviderConfigurationError,
  CanonicalWahaProviderError,
  findUniqueCanonicalWahaMessage,
  getCanonicalWahaMessage,
  loadCanonicalWahaProviderConfig,
  probeCanonicalWahaSession,
  sendCanonicalWahaText,
  type CanonicalWahaMessage,
  type CanonicalWahaProviderDependencies,
  type CanonicalWahaSessionProof,
} from "./canonical-waha-provider.ts";

export type CanonicalWhatsAppOutboundReason =
  | "feature_disabled"
  | "provider_not_authorized"
  | "configuration_missing"
  | "configuration_invalid"
  | "invalid_request"
  | "conversation_not_available"
  | "request_conflict"
  | "storage_unavailable"
  | "provider_authentication_failed"
  | "provider_forbidden"
  | "provider_rate_limited"
  | "provider_rejected"
  | "provider_timeout"
  | "provider_network_failure"
  | "provider_unavailable"
  | "provider_malformed_response"
  | "provider_message_not_found"
  | "provider_message_ambiguous"
  | "session_not_working"
  | "message_rejected";

export type CanonicalWhatsAppSendServiceResult =
  | Readonly<{
      status: "accepted" | "unknown" | "rejected";
      attempt: CanonicalWhatsAppSendAttemptSnapshot;
    }>
  | Readonly<{
      status: "blocked" | "error";
      reason: CanonicalWhatsAppOutboundReason;
    }>;

export type CanonicalWhatsAppReconcileServiceResult =
  | Readonly<{
      status: "reconciled";
      attempt: CanonicalWhatsAppSendAttemptSnapshot;
    }>
  | Readonly<{
      status: "blocked" | "error";
      reason: CanonicalWhatsAppOutboundReason;
    }>;

type ServiceDependencies = Readonly<{
  environment?: Readonly<Record<string, string | undefined>>;
  provider?: CanonicalWahaProviderDependencies;
}>;

function providerMessage(message: CanonicalWahaMessage): CanonicalWhatsAppProviderMessage {
  const milliseconds = message.timestamp * 1_000;
  const occurredAt = new Date(milliseconds);
  if (!Number.isFinite(milliseconds) || !Number.isFinite(occurredAt.getTime())) {
    throw new CanonicalWahaProviderError(
      "provider_malformed_response",
      "unknown",
    );
  }
  return Object.freeze({
    providerMessageId: message.id,
    providerOccurredAt: occurredAt.toISOString(),
    recipientChatId: message.recipientId,
    fromMe: true,
    body: message.body,
    ack: message.ack,
    ackName: message.ackName,
    source: message.source,
  });
}

function repositoryReason(
  error: CanonicalCrmRepositoryError,
): CanonicalWhatsAppOutboundReason {
  if (error.code === "invalid_input") return "invalid_request";
  if (error.code === "idempotency_conflict") return "request_conflict";
  if (
    error.code === "not_found" ||
    error.code === "forbidden" ||
    error.code === "conflict"
  ) {
    return "conversation_not_available";
  }
  return "storage_unavailable";
}

function configurationResult(
  environment: Readonly<Record<string, string | undefined>>,
):
  | Readonly<{ status: "ready"; sessionName: string }>
  | Readonly<{ status: "blocked"; reason: CanonicalWhatsAppOutboundReason }> {
  try {
    const config = loadCanonicalWahaProviderConfig(environment);
    if (config.status === "ready") {
      return Object.freeze({ status: "ready", sessionName: config.sessionName });
    }
    return Object.freeze({ status: "blocked", reason: config.reason });
  } catch (error) {
    if (error instanceof CanonicalWahaProviderConfigurationError) {
      return Object.freeze({
        status: "blocked",
        reason: "configuration_invalid",
      });
    }
    throw error;
  }
}

export async function sendCanonicalWhatsAppOutbound(
  actorRole: FixedRole,
  form: CanonicalWhatsAppSendForm,
  dependencies: ServiceDependencies = {},
): Promise<CanonicalWhatsAppSendServiceResult> {
  const environment = dependencies.environment ?? process.env;
  const configuration = configurationResult(environment);
  if (configuration.status === "blocked") return configuration;

  try {
    const attempt = await executeCanonicalWhatsAppSend(
      {
        actorRole,
        idempotencyKey: form.requestId,
        correlationId: form.requestId,
      },
      {
        conversationId: form.conversationId,
        sessionName: configuration.sessionName,
        finalText: form.messageText,
        confirmedRecipient: form.confirmedRecipient,
        sourceProposalId: form.sourceProposalId,
        replyToExternalMessageId: form.replyToExternalMessageId,
      },
      async (request) => {
        let sessionProof: CanonicalWahaSessionProof;
        try {
          sessionProof = await probeCanonicalWahaSession(
            environment,
            dependencies.provider,
          );
        } catch (error) {
          if (error instanceof CanonicalWahaProviderError) {
            return { status: "rejected", failureCode: error.code };
          }
          return { status: "rejected", failureCode: "provider_unavailable" };
        }

        let sent: CanonicalWahaMessage;
        try {
          sent = await sendCanonicalWahaText(
            {
              recipientId: request.recipientChatId,
              text: request.text,
              ...(request.replyToExternalMessageId
                ? { replyTo: request.replyToExternalMessageId }
                : {}),
              sessionProof,
            },
            environment,
            dependencies.provider,
          );
        } catch (error) {
          if (error instanceof CanonicalWahaProviderError) {
            return {
              status: error.disposition,
              failureCode: error.code,
            };
          }
          return { status: "unknown", failureCode: "provider_unavailable" };
        }

        let reconciled = sent;
        try {
          const readBack = await getCanonicalWahaMessage(
            {
              recipientId: request.recipientChatId,
              providerMessageId: sent.id,
              expectedText: request.text,
              sessionProof,
            },
            environment,
            dependencies.provider,
          );
          if (readBack.ack >= sent.ack) reconciled = readBack;
        } catch {
          // The validated POST response already proves one provider operation.
          // Read-back failure must not trigger another send.
        }
        if (reconciled.ack === -1) {
          return { status: "rejected", failureCode: "message_rejected" };
        }
        return { status: "accepted", message: providerMessage(reconciled) };
      },
    );
    if (
      attempt.status === "accepted" ||
      attempt.status === "unknown" ||
      attempt.status === "rejected"
    ) {
      return Object.freeze({ status: attempt.status, attempt });
    }
    return Object.freeze({ status: "error", reason: "storage_unavailable" });
  } catch (error) {
    if (error instanceof CanonicalCrmRepositoryError) {
      return Object.freeze({ status: "error", reason: repositoryReason(error) });
    }
    throw error;
  }
}

export async function reconcileCanonicalWhatsAppOutbound(
  actorRole: FixedRole,
  form: CanonicalWhatsAppReconcileForm,
  dependencies: ServiceDependencies = {},
): Promise<CanonicalWhatsAppReconcileServiceResult> {
  const environment = dependencies.environment ?? process.env;
  const configuration = configurationResult(environment);
  if (configuration.status === "blocked") return configuration;

  let providerFailureReason: CanonicalWhatsAppOutboundReason | null = null;
  try {
    const attempt = await reconcileCanonicalWhatsAppSendAttempt(
      {
        actorRole,
        idempotencyKey: form.requestId,
        correlationId: form.requestId,
      },
      { conversationId: form.conversationId, attemptId: form.attemptId },
      async (request) => {
        try {
          if (request.sessionName !== configuration.sessionName) {
            throw new CanonicalWahaProviderError(
              "configuration_invalid",
              "rejected",
            );
          }
          const sessionProof = await probeCanonicalWahaSession(
            environment,
            dependencies.provider,
          );
          const message = request.providerMessageId
            ? await getCanonicalWahaMessage(
                {
                  recipientId: request.recipientChatId,
                  providerMessageId: request.providerMessageId,
                  expectedText: request.expectedText,
                  sessionProof,
                },
                environment,
                dependencies.provider,
              )
            : await findUniqueCanonicalWahaMessage(
                {
                  recipientId: request.recipientChatId,
                  expectedText: request.expectedText,
                  windowStartTimestamp: Math.floor(
                    Date.parse(request.windowStartedAt) / 1_000,
                  ),
                  windowEndTimestamp: Math.ceil(
                    Date.parse(request.windowEndedAt) / 1_000,
                  ),
                  sessionProof,
                },
                environment,
                dependencies.provider,
              );
          return providerMessage(message);
        } catch (error) {
          if (error instanceof CanonicalWahaProviderError) {
            providerFailureReason = error.code;
          }
          throw error;
        }
      },
    );
    return Object.freeze({ status: "reconciled", attempt });
  } catch (error) {
    if (providerFailureReason !== null) {
      return Object.freeze({ status: "error", reason: providerFailureReason });
    }
    if (error instanceof CanonicalWahaProviderError) {
      return Object.freeze({ status: "error", reason: error.code });
    }
    if (error instanceof CanonicalCrmRepositoryError) {
      return Object.freeze({ status: "error", reason: repositoryReason(error) });
    }
    throw error;
  }
}
