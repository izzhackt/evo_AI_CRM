import "server-only";

import { ApiError, GoogleGenAI } from "@google/genai";

import type { PlatformGeminiFailureCode } from "../platform-gemini-proposals.ts";
import { PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA } from "./platform-gemini-proposal-contract.ts";

export type PlatformGeminiProposalProviderInput = Readonly<{
  model: "gemini-3.5-flash" | "gemini-3.7-flash";
  prompt: string;
  store: false;
  background: false;
  toolChoice: "none";
  timeoutMs: number;
  maxRetries: 0;
  maxOutputTokens: number;
  signal?: AbortSignal;
}>;

export type PlatformGeminiProposalProviderResult = Readonly<{
  interactionRef: string | null;
  outputText: string | null;
  status: "completed";
}>;

export const PLATFORM_GEMINI_INTERACTION_STATUSES = [
  "in_progress",
  "requires_action",
  "completed",
  "failed",
  "cancelled",
  "incomplete",
  "budget_exceeded",
] as const;

export type PlatformGeminiInteractionStatus =
  (typeof PLATFORM_GEMINI_INTERACTION_STATUSES)[number];

export type PlatformGeminiProviderEvidenceStatus =
  | PlatformGeminiInteractionStatus
  | "local_error"
  | "transport_error";

export type PlatformGeminiProposalProvider = Readonly<{
  createProposal(
    input: PlatformGeminiProposalProviderInput,
  ): Promise<PlatformGeminiProposalProviderResult>;
}>;

export type PlatformGeminiInteractionClient = Readonly<{
  interactions: Readonly<{
    create(
      params: Record<string, unknown>,
      options: Record<string, unknown>,
    ): Promise<Readonly<{
      id?: unknown;
      status?: unknown;
      output_text?: unknown;
      errors?: readonly unknown[];
    }>>;
  }>;
}>;

export class PlatformGeminiProposalProviderError extends Error {
  readonly code: Extract<
    PlatformGeminiFailureCode,
    | "provider_timeout"
    | "provider_rate_limited"
    | "provider_authentication_failed"
    | "provider_forbidden"
    | "provider_unavailable"
    | "provider_rejected"
    | "malformed_output"
  >;
  readonly interactionRef: string | null;
  readonly providerStatus: PlatformGeminiProviderEvidenceStatus;

  constructor(
    code: PlatformGeminiProposalProviderError["code"],
    evidence: Readonly<{
      interactionRef?: string | null;
      providerStatus?: PlatformGeminiProviderEvidenceStatus;
    }> = {},
  ) {
    super("Gemini proposal provider request failed.");
    this.name = "PlatformGeminiProposalProviderError";
    this.code = code;
    this.interactionRef = evidence.interactionRef ?? null;
    this.providerStatus = evidence.providerStatus ?? "local_error";
  }
}

function providerError(
  code: PlatformGeminiProposalProviderError["code"],
  evidence?: Readonly<{
    interactionRef?: string | null;
    providerStatus?: PlatformGeminiProviderEvidenceStatus;
  }>,
): never {
  throw new PlatformGeminiProposalProviderError(code, evidence);
}

function mapError(error: unknown): never {
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && /(?:abort|timeout)/iu.test(error.name))
  ) {
    return providerError("provider_timeout", { providerStatus: "transport_error" });
  }
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return providerError("provider_authentication_failed", {
        providerStatus: "transport_error",
      });
    }
    if (error.status === 403) {
      return providerError("provider_forbidden", {
        providerStatus: "transport_error",
      });
    }
    if (error.status === 429) {
      return providerError("provider_rate_limited", {
        providerStatus: "transport_error",
      });
    }
    if (error.status >= 500) {
      return providerError("provider_unavailable", {
        providerStatus: "transport_error",
      });
    }
    if (error.status >= 400) {
      return providerError("provider_rejected", {
        providerStatus: "transport_error",
      });
    }
  }
  return providerError("provider_unavailable", {
    providerStatus: "transport_error",
  });
}

function cleanReference(value: unknown): string | null {
  return typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 255
    ? value
    : null;
}

function cleanStatus(value: unknown): PlatformGeminiInteractionStatus | null {
  return typeof value === "string" &&
    PLATFORM_GEMINI_INTERACTION_STATUSES.includes(
      value as PlatformGeminiInteractionStatus,
    )
    ? (value as PlatformGeminiInteractionStatus)
    : null;
}

export function createPlatformGeminiProposalProvider(
  input: Readonly<{ apiKey: string }>,
  dependencies: Readonly<{ client?: PlatformGeminiInteractionClient }> = {},
): PlatformGeminiProposalProvider {
  const client =
    dependencies.client ??
    (new GoogleGenAI({
      apiKey: input.apiKey,
      apiVersion: "v1",
    }) as unknown as PlatformGeminiInteractionClient);
  return Object.freeze({
    async createProposal(request) {
      try {
        const interaction = await client.interactions.create(
          {
            model: request.model,
            input: request.prompt,
            store: request.store,
            background: request.background,
            response_format: {
              type: "text",
              mime_type: "application/json",
              schema: PLATFORM_GEMINI_PROPOSAL_JSON_SCHEMA,
            },
            generation_config: {
              max_output_tokens: request.maxOutputTokens,
              thinking_level: "low",
              tool_choice: request.toolChoice,
            },
          },
          {
            timeout: request.timeoutMs,
            maxRetries: request.maxRetries,
            fetchOptions: request.signal ? { signal: request.signal } : undefined,
          },
        );

        const interactionRef = cleanReference(interaction.id);
        const providerStatus = cleanStatus(interaction.status);
        if (providerStatus === null) {
          return providerError("malformed_output", {
            providerStatus: "local_error",
          });
        }
        if (interactionRef === null) {
          return providerError("malformed_output", {
            providerStatus: "local_error",
          });
        }

        if (Array.isArray(interaction.errors) && interaction.errors.length > 0) {
          return providerError("provider_rejected", {
            interactionRef,
            providerStatus,
          });
        }
        if (
          providerStatus === "incomplete" ||
          providerStatus === "budget_exceeded"
        ) {
          return providerError("provider_rejected", {
            interactionRef,
            providerStatus,
          });
        }
        if (providerStatus !== "completed") {
          return providerError("provider_rejected", {
            interactionRef,
            providerStatus,
          });
        }

        return Object.freeze({
          interactionRef,
          outputText:
            typeof interaction.output_text === "string"
              ? interaction.output_text
              : null,
          status: providerStatus,
        });
      } catch (error) {
        if (error instanceof PlatformGeminiProposalProviderError) throw error;
        return mapError(error);
      }
    },
  });
}
