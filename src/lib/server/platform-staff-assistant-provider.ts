import "server-only";

import {
  PLATFORM_STAFF_ASSISTANT_MAX_REPLY_BYTES,
  PlatformStaffAssistantContractError,
} from "./platform-staff-assistant-contract.ts";

const encoder = new TextEncoder();

export type PlatformStaffAssistantProviderInput = Readonly<{
  apiKey: string;
  model: "gemini-3.5-flash";
  prompt: string;
  timeoutMs: 15_000;
  maxOutputTokens: 2_048;
  temperature: 0.2;
  store: false;
  tools: readonly [];
  maxRetries: 0;
}>;

export type PlatformStaffAssistantProviderResult = Readonly<{
  reply: string;
  handoff: boolean;
}>;

export class PlatformStaffAssistantProviderError extends Error {
  constructor() {
    super("Staff assistant provider failed");
    this.name = "PlatformStaffAssistantProviderError";
  }
}

function normalizeResult(value: unknown): PlatformStaffAssistantProviderResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new PlatformStaffAssistantProviderError();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "handoff,reply") throw new PlatformStaffAssistantProviderError();
  if (typeof record.reply !== "string" || typeof record.handoff !== "boolean") throw new PlatformStaffAssistantProviderError();
  const reply = record.reply.normalize("NFC").trim();
  if (!reply || encoder.encode(reply).byteLength > PLATFORM_STAFF_ASSISTANT_MAX_REPLY_BYTES) throw new PlatformStaffAssistantProviderError();
  return Object.freeze({ reply, handoff: record.handoff });
}

function extractText(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new PlatformStaffAssistantProviderError();
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length !== 1) throw new PlatformStaffAssistantProviderError();
  const candidate = candidates[0];
  if (typeof candidate !== "object" || candidate === null) throw new PlatformStaffAssistantProviderError();
  const parts = (candidate as { content?: { parts?: unknown } }).content?.parts;
  if (!Array.isArray(parts) || parts.length < 1) throw new PlatformStaffAssistantProviderError();
  const texts = parts.map((part) => typeof part === "object" && part !== null ? (part as { text?: unknown }).text : null);
  if (texts.some((text) => typeof text !== "string")) throw new PlatformStaffAssistantProviderError();
  return (texts as string[]).join("");
}

export function createPlatformStaffAssistantProvider(fetchImpl: typeof fetch = fetch) {
  return Object.freeze({
    async generate(input: PlatformStaffAssistantProviderInput): Promise<PlatformStaffAssistantProviderResult> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
      try {
        const response = await fetchImpl(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": input.apiKey,
            },
            signal: controller.signal,
            body: JSON.stringify({
              store: false,
              systemInstruction: {
                parts: [{ text: "You create a staff-only draft grounded only in supplied approved knowledge. Do not invent facts, prices, guarantees, deadlines, or visa outcomes." }],
              },
              contents: [{ role: "user", parts: [{ text: input.prompt }] }],
              generationConfig: {
                maxOutputTokens: input.maxOutputTokens,
                temperature: input.temperature,
                candidateCount: 1,
                responseMimeType: "application/json",
                responseJsonSchema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["reply", "handoff"],
                  properties: {
                    reply: { type: "string", minLength: 1 },
                    handoff: { type: "boolean" },
                  },
                },
              },
            }),
          },
        );
        if (!response.ok) throw new PlatformStaffAssistantProviderError();
        const payload = await response.json() as unknown;
        return normalizeResult(JSON.parse(extractText(payload)) as unknown);
      } catch (error) {
        if (error instanceof PlatformStaffAssistantContractError) throw error;
        throw new PlatformStaffAssistantProviderError();
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
