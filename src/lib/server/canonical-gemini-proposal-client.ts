import "server-only";

import { GoogleGenAI } from "@google/genai";

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
  created?: unknown;
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

function providerTimestamp(value: unknown): string | null {
  return typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
    ? value
    : null;
}

export function normalizeCanonicalGeminiInteraction(
  interaction: CanonicalGeminiInteraction,
): Readonly<{
  interactionRef: string | null;
  providerCreatedAt: string;
  outputText: string;
}> {
  const interactionRef = reference(interaction.id);
  const providerCreatedAt = providerTimestamp(interaction.created);
  const interactionIdWasReturned = interaction.id !== undefined;
  if (
    providerCreatedAt === null ||
    (interactionIdWasReturned && interactionRef === null)
  ) {
    throw new CanonicalGeminiProposalProviderError(
      "malformed_output",
      interactionRef,
    );
  }
  if (
    interaction.status !== "completed" ||
    (Array.isArray(interaction.errors) && interaction.errors.length > 0)
  ) {
    throw new CanonicalGeminiProposalProviderError(
      "provider_rejected",
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
    providerCreatedAt,
    outputText: interaction.output_text,
  });
}

function providerHttpStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const record = error as Record<string, unknown>;
  for (const candidate of [record.status, record.statusCode]) {
    if (
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate >= 100 &&
      candidate <= 599
    ) {
      return candidate;
    }
  }
  return null;
}

function providerErrorReasons(error: unknown): ReadonlySet<string> {
  if (typeof error !== "object" || error === null) return new Set();
  const body = (error as Record<string, unknown>).body;
  if (typeof body !== "string" || body.length === 0 || body.length > 64 * 1024) {
    return new Set();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new Set();
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const reasons = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const providerError = (entry as Record<string, unknown>).error;
    if (typeof providerError !== "object" || providerError === null) continue;
    const details = (providerError as Record<string, unknown>).details;
    if (!Array.isArray(details)) continue;
    for (const detail of details) {
      if (typeof detail !== "object" || detail === null) continue;
      const reason = (detail as Record<string, unknown>).reason;
      if (typeof reason === "string" && reason.length <= 128) {
        reasons.add(reason);
      }
    }
  }
  return reasons;
}

export function mapCanonicalGeminiProviderFailure(
  error: unknown,
): CanonicalGeminiProposalProviderError {
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && /(?:abort|timeout)/iu.test(error.name))
  ) {
    return new CanonicalGeminiProposalProviderError("provider_timeout");
  }
  const reasons = providerErrorReasons(error);
  if (reasons.has("API_KEY_INVALID")) {
    return new CanonicalGeminiProposalProviderError(
      "provider_authentication_failed",
    );
  }
  if (
    reasons.has("API_KEY_SERVICE_BLOCKED") ||
    reasons.has("API_KEY_HTTP_REFERRER_BLOCKED") ||
    reasons.has("ACCESS_TOKEN_SCOPE_INSUFFICIENT")
  ) {
    return new CanonicalGeminiProposalProviderError("provider_forbidden");
  }
  const status = providerHttpStatus(error);
  if (status === 401) {
    return new CanonicalGeminiProposalProviderError(
      "provider_authentication_failed",
    );
  }
  if (status === 403) {
    return new CanonicalGeminiProposalProviderError("provider_forbidden");
  }
  if (status === 429) {
    return new CanonicalGeminiProposalProviderError("provider_rate_limited");
  }
  if (status !== null && status >= 500) {
    return new CanonicalGeminiProposalProviderError("provider_unavailable");
  }
  if (status !== null && status >= 400) {
    return new CanonicalGeminiProposalProviderError("provider_rejected");
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
  ): Promise<
    Readonly<{
      interactionRef: string | null;
      providerCreatedAt: string;
      outputText: string;
    }>
  >;
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
        throw mapCanonicalGeminiProviderFailure(error);
      }
    },
  });
}
