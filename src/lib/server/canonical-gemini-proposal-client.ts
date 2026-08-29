import "server-only";

import { ApiError, GoogleGenAI } from "@google/genai";

import { CANONICAL_GEMINI_PROPOSAL_JSON_SCHEMA } from "../canonical-gemini-proposal-contract.ts";

export const CANONICAL_GEMINI_PROPOSAL_MAX_OUTPUT_TOKENS = 2_048;

export type CanonicalGeminiProposalProviderErrorCode =
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_authentication_failed"
  | "provider_forbidden"
  | "provider_unavailable"
  | "provider_rejected"
  | "malformed_output";

export class CanonicalGeminiProposalProviderError extends Error {
  readonly code: CanonicalGeminiProposalProviderErrorCode;
  readonly interactionRef: string | null;

  constructor(
    code: CanonicalGeminiProposalProviderErrorCode,
    interactionRef: string | null = null,
  ) {
    super("Gemini proposal provider request failed.");
    this.name = "CanonicalGeminiProposalProviderError";
    this.code = code;
    this.interactionRef = interactionRef;
  }
}

export type CanonicalGeminiInteraction = Readonly<{
  id?: unknown;
  status?: unknown;
  output_text?: unknown;
  errors?: readonly unknown[];
}>;

type CanonicalGeminiInteractionClient = Readonly<{
  interactions: Readonly<{
    create(
      params: Record<string, unknown>,
      options: Record<string, unknown>,
    ): Promise<CanonicalGeminiInteraction>;
  }>;
}>;

export function buildCanonicalGeminiInteractionRequest(
  input: Readonly<{
    model: string;
    systemInstruction: string;
    prompt: string;
    timeoutMs: number;
  }>,
) {
  return Object.freeze({
    params: Object.freeze({
      model: input.model,
      input: input.prompt,
      system_instruction: input.systemInstruction,
      store: false,
      background: false,
      response_format: Object.freeze({
        type: "text",
        mime_type: "application/json",
        schema: CANONICAL_GEMINI_PROPOSAL_JSON_SCHEMA,
      }),
      generation_config: Object.freeze({
        max_output_tokens: CANONICAL_GEMINI_PROPOSAL_MAX_OUTPUT_TOKENS,
        tool_choice: "none",
      }),
    }),
    options: Object.freeze({ timeout: input.timeoutMs, maxRetries: 0 }),
  });
}

function reference(value: unknown): string | null {
  return typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 255
    ? value
    : null;
}

export function normalizeCanonicalGeminiInteraction(
  interaction: CanonicalGeminiInteraction,
): Readonly<{ interactionRef: string; outputText: string }> {
  const interactionRef = reference(interaction.id);
  if (
    interactionRef === null ||
    interaction.status !== "completed" ||
    (Array.isArray(interaction.errors) && interaction.errors.length > 0)
  ) {
    throw new CanonicalGeminiProposalProviderError(
      interactionRef === null ? "malformed_output" : "provider_rejected",
      interactionRef,
    );
  }
  if (
    typeof interaction.output_text !== "string" ||
    interaction.output_text.trim().length === 0
  ) {
    throw new CanonicalGeminiProposalProviderError(
      "malformed_output",
      interactionRef,
    );
  }
  return Object.freeze({
    interactionRef,
    outputText: interaction.output_text,
  });
}

function mappedProviderError(error: unknown): CanonicalGeminiProposalProviderError {
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && /(?:abort|timeout)/iu.test(error.name))
  ) {
    return new CanonicalGeminiProposalProviderError("provider_timeout");
  }
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return new CanonicalGeminiProposalProviderError(
        "provider_authentication_failed",
      );
    }
    if (error.status === 403) {
      return new CanonicalGeminiProposalProviderError("provider_forbidden");
    }
    if (error.status === 429) {
      return new CanonicalGeminiProposalProviderError("provider_rate_limited");
    }
    if (error.status >= 500) {
      return new CanonicalGeminiProposalProviderError("provider_unavailable");
    }
    if (error.status >= 400) {
      return new CanonicalGeminiProposalProviderError("provider_rejected");
    }
  }
  return new CanonicalGeminiProposalProviderError("provider_unavailable");
}

export type CanonicalGeminiProposalProvider = Readonly<{
  createProposal(
    input: Readonly<{
      model: string;
      systemInstruction: string;
      prompt: string;
      timeoutMs: number;
    }>,
  ): Promise<Readonly<{ interactionRef: string; outputText: string }>>;
}>;

export function createCanonicalGeminiProposalProvider(
  apiKey: string,
): CanonicalGeminiProposalProvider {
  const client = new GoogleGenAI({
    apiKey,
    apiVersion: "v1",
  }) as unknown as CanonicalGeminiInteractionClient;

  return Object.freeze({
    async createProposal(input) {
      const request = buildCanonicalGeminiInteractionRequest(input);
      try {
        const interaction = await client.interactions.create(
          request.params,
          request.options,
        );
        return normalizeCanonicalGeminiInteraction(interaction);
      } catch (error) {
        if (error instanceof CanonicalGeminiProposalProviderError) throw error;
        throw mappedProviderError(error);
      }
    },
  });
}
