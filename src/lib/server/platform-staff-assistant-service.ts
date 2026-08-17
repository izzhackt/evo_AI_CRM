import "server-only";

import { createHash } from "node:crypto";

import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import type { PlatformStaffAssistantEnabledConfig } from "./platform-staff-assistant-config.ts";
import type { PlatformStaffAssistantInput, PlatformStaffAssistantResult } from "./platform-staff-assistant-contract.ts";
import { createPlatformStaffAssistantProvider } from "./platform-staff-assistant-provider.ts";
import { createPlatformStaffKnowledgeRepository, type PlatformStaffKnowledgeResult } from "./platform-staff-knowledge-repository.ts";

const encoder = new TextEncoder();
const MAX_PROMPT_BYTES = 60_000;
const WINDOW_MS = 60_000;
const ACTOR_LIMIT = 20;
const ORGANIZATION_LIMIT = 100;
const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

type RateLimiter = Readonly<{ consume(actorId: string, organizationId: string): void }>;

export class PlatformStaffAssistantRateLimitError extends Error {
  constructor() {
    super("Staff assistant rate limit exceeded");
    this.name = "PlatformStaffAssistantRateLimitError";
  }
}

export class PlatformStaffAssistantAuditError extends Error {
  constructor() {
    super("Staff assistant audit failed");
    this.name = "PlatformStaffAssistantAuditError";
  }
}

export function createPlatformStaffRateLimiter(input: Readonly<{ now?: () => number }> = {}): RateLimiter {
  const now = input.now ?? Date.now;
  const actorWindows = new Map<string, { startedAt: number; count: number }>();
  const organizationWindows = new Map<string, { startedAt: number; count: number }>();

  function consumeMap(map: Map<string, { startedAt: number; count: number }>, key: string, limit: number, current: number): void {
    const existing = map.get(key);
    if (!existing || current - existing.startedAt >= WINDOW_MS) {
      map.set(key, { startedAt: current, count: 1 });
      return;
    }
    if (existing.count >= limit) throw new PlatformStaffAssistantRateLimitError();
    existing.count += 1;
  }

  return Object.freeze({
    consume(actorId: string, organizationId: string) {
      const current = now();
      const actor = actorWindows.get(actorId);
      const organization = organizationWindows.get(organizationId);
      if (actor && current - actor.startedAt < WINDOW_MS && actor.count >= ACTOR_LIMIT) throw new PlatformStaffAssistantRateLimitError();
      if (organization && current - organization.startedAt < WINDOW_MS && organization.count >= ORGANIZATION_LIMIT) throw new PlatformStaffAssistantRateLimitError();
      consumeMap(actorWindows, actorId, ACTOR_LIMIT, current);
      consumeMap(organizationWindows, organizationId, ORGANIZATION_LIMIT, current);
    },
  });
}

export function buildPlatformStaffAssistantPrompt(input: Readonly<{
  input: PlatformStaffAssistantInput;
  excerpts: readonly string[];
  sources: readonly Readonly<{ chunk_id: string; source_path: string }>[];
}>): string {
  const request = input.input.audience === "client"
    ? input.input.turns.map((turn) => `${turn.role}: ${turn.content}`).join("\n")
    : input.input.question;
  const knowledge = input.excerpts.map((excerpt, index) => {
    const source = input.sources[index];
    return `[${index + 1}] ${source.source_path}\n${excerpt}`;
  }).join("\n\n");
  const prompt = [
    `Audience: ${input.input.audience}`,
    "Approved knowledge:",
    knowledge,
    "Staff request:",
    request,
    "Answer the question first. Do not invent facts. Ask no more than two necessary questions. Set handoff=true for uncertainty, legal/visa guarantees, complaints, or a decision requiring a human.",
    "Return only the requested JSON object.",
  ].join("\n\n");
  if (encoder.encode(prompt).byteLength > MAX_PROMPT_BYTES) throw new Error("prompt_too_large");
  return prompt;
}

type ServiceDependencies = Readonly<{
  knowledge: Readonly<{ retrieve(input: Readonly<{ accountId: string; audience: "client" | "internal"; question: string }>): Promise<PlatformStaffKnowledgeResult> }>;
  provider: Readonly<{ generate(input: Readonly<Record<string, unknown>>): Promise<Readonly<{ reply: string; handoff: boolean }>> }>;
  audit: Readonly<{ record(input: Readonly<{
    accountId: string;
    audience: "client" | "internal";
    evaluationCaseId: string | null;
    provider: "gemini";
    model: "gemini-3.5-flash";
    sources: readonly Readonly<{ chunk_id: string; source_path: string }>[];
    responseSha256: string;
    handoff: boolean;
    actorUserId: string;
  }>): Promise<string> }>;
  rateLimiter: RateLimiter;
}>;

export function createPlatformStaffAssistantService(dependencies: ServiceDependencies) {
  return Object.freeze({
    async createDraft(input: Readonly<{
      config: PlatformStaffAssistantEnabledConfig;
      actorUserId: string;
      accountId: string;
      input: PlatformStaffAssistantInput;
    }>): Promise<PlatformStaffAssistantResult> {
      dependencies.rateLimiter.consume(input.actorUserId, input.config.organizationId);
      const knowledge = await dependencies.knowledge.retrieve({
        accountId: input.accountId,
        audience: input.input.audience,
        question: input.input.latestQuestion,
      });
      const prompt = buildPlatformStaffAssistantPrompt({ input: input.input, ...knowledge });
      const generated = await dependencies.provider.generate({
        apiKey: input.config.geminiApiKey,
        model: input.config.model,
        prompt,
        timeoutMs: input.config.timeoutMs,
        maxOutputTokens: input.config.maxOutputTokens,
        temperature: input.config.temperature,
        store: false,
        tools: Object.freeze([]),
        maxRetries: 0,
      });
      const responseSha256 = createHash("sha256").update(generated.reply, "utf8").digest("hex");
      let auditId: string;
      try {
        auditId = await dependencies.audit.record({
          accountId: input.accountId,
          audience: input.input.audience,
          evaluationCaseId: input.input.evaluationCaseId,
          provider: "gemini",
          model: input.config.model,
          sources: knowledge.sources,
          responseSha256,
          handoff: generated.handoff,
          actorUserId: input.actorUserId,
        });
      } catch {
        throw new PlatformStaffAssistantAuditError();
      }
      return Object.freeze({ reply: generated.reply, handoff: generated.handoff, sources: knowledge.sources, audit_id: auditId });
    },
  });
}

type PlatformStaffAuditClient = Readonly<{
  from(table: string): {
    insert(value: Record<string, unknown>): {
      select(columns: string): {
        single(): PromiseLike<Readonly<{ data: unknown; error: unknown }>>;
      };
    };
  };
}>;

export function createPlatformStaffAssistantAuditRepository(
  client: PlatformStaffAuditClient,
  options: Readonly<{ now?: () => number }> = {},
) {
  const now = options.now ?? Date.now;
  return Object.freeze({
    async record(input: Parameters<ServiceDependencies["audit"]["record"]>[0]): Promise<string> {
      const expiresAt = new Date(now() + AUDIT_RETENTION_MS).toISOString();
      const { data, error } = await client
        .from("ai_assistant_audits")
        .insert({
          account_id: input.accountId,
          audience: input.audience,
          evaluation_case_id: input.evaluationCaseId,
          provider: input.provider,
          model: input.model,
          knowledge_sources: input.sources,
          response_sha256: input.responseSha256,
          handoff: input.handoff,
          success: true,
          actor_user_id: input.actorUserId,
          expires_at: expiresAt,
        })
        .select("id")
        .single();
      if (error || typeof data !== "object" || data === null || Array.isArray(data) || typeof (data as { id?: unknown }).id !== "string") {
        throw new PlatformStaffAssistantAuditError();
      }
      return (data as { id: string }).id;
    },
  });
}

const sharedRateLimiter = createPlatformStaffRateLimiter();

export function createPlatformStaffAssistantRuntime(config: PlatformStaffAssistantEnabledConfig) {
  const client = createPlatformSupabaseServiceClient(config);
  return createPlatformStaffAssistantService({
    knowledge: createPlatformStaffKnowledgeRepository(client),
    provider: createPlatformStaffAssistantProvider(),
    audit: createPlatformStaffAssistantAuditRepository(client),
    rateLimiter: sharedRateLimiter,
  });
}
