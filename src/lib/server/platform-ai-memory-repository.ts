import "server-only";

import type { PlatformActor } from "../platform-auth";
import {
  buildPlatformAiControlRpcArgs,
  buildPlatformAiFactRpcArgs,
  buildPlatformAiLexicalPreviewRpcArgs,
  buildPlatformAiMemoryRpcArgs,
  buildPlatformAiQualificationRpcArgs,
  normalizePlatformAiRetrievalCapabilities,
  normalizePlatformAiRetrievalEvidence,
  normalizePlatformConversationAiMemory,
  PlatformAiMemoryContractError,
  type PlatformAiControlMutationInput,
  type PlatformAiFactMutationInput,
  type PlatformAiLexicalPreviewInput,
  type PlatformAiMemoryMutationInput,
  type PlatformAiQualificationMutationInput,
  type PlatformAiRetrievalCapabilities,
  type PlatformAiRetrievalEvidence,
  type PlatformConversationAiMemory,
} from "../platform-ai-memory.ts";

export const PLATFORM_AI_MEMORY_STAFF_RPC = "staff_conversation_ai_memory";
export const PLATFORM_AI_MEMORY_RECORD_RPC = "record_conversation_ai_memory";
export const PLATFORM_AI_FACT_RECORD_RPC = "record_conversation_ai_fact";
export const PLATFORM_AI_QUALIFICATION_RECORD_RPC =
  "record_conversation_ai_qualification";
export const PLATFORM_AI_CONTROL_SET_RPC = "set_conversation_ai_control";
export const PLATFORM_AI_LEXICAL_PREVIEW_RPC =
  "preview_approved_knowledge_lexical";
export const PLATFORM_AI_RETRIEVAL_EVIDENCE_RPC =
  "staff_ai_retrieval_evidence";
export const PLATFORM_AI_RETRIEVAL_CAPABILITIES_RPC =
  "staff_ai_retrieval_capabilities";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

type PlatformAiRpcResponse = Readonly<{ data: unknown; error: unknown }>;
export type PlatformAiMemoryRpcClient = Readonly<{
  schema(schema: "platform"): Readonly<{
    rpc(
      name: string,
      args: Record<string, unknown>,
      options?: Readonly<{ get?: boolean }>,
    ): Promise<PlatformAiRpcResponse>;
  }>;
}>;

type RepositoryDependencies = Readonly<{
  client?: PlatformAiMemoryRpcClient;
  env?: Readonly<Record<string, string | undefined>>;
}>;

export class PlatformAiMemoryRepositoryError extends Error {
  constructor() {
    super("Platform AI memory repository is unavailable.");
    this.name = "PlatformAiMemoryRepositoryError";
  }
}

function failClosed(error?: unknown): never {
  if (
    error instanceof PlatformAiMemoryRepositoryError ||
    error instanceof PlatformAiMemoryContractError
  ) {
    throw error;
  }
  throw new PlatformAiMemoryRepositoryError();
}

function parseUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return failClosed();
  const normalized = value.toLowerCase();
  if (normalized === NIL_UUID) return failClosed();
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => key in value);
}

function parseVersion(value: unknown): string {
  if (
    (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  ) {
    return String(value);
  }
  return failClosed();
}

function parseTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !TIMESTAMPTZ_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return failClosed();
  }
  return value;
}

export function isPlatformAiMemoryEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.EVO_PLATFORM_AI_MEMORY_ENABLED === "1";
}

function requireEnabled(dependencies: RepositoryDependencies) {
  if (!isPlatformAiMemoryEnabled(dependencies.env ?? process.env)) failClosed();
}

async function getClient(
  dependencies: RepositoryDependencies,
): Promise<PlatformAiMemoryRpcClient> {
  if (dependencies.client) return dependencies.client;
  const { createSupabaseServerClient } = await import("../supabase/server");
  return (await createSupabaseServerClient()) as unknown as PlatformAiMemoryRpcClient;
}

function requireActorOrganization(actor: PlatformActor, organizationId?: string) {
  const actorOrganizationId = parseUuid(actor.organizationId);
  if (organizationId !== undefined && parseUuid(organizationId) !== actorOrganizationId) {
    failClosed();
  }
  return actorOrganizationId;
}

async function rpc(
  dependencies: RepositoryDependencies,
  name: string,
  args: Record<string, unknown>,
  get = false,
) {
  const client = await getClient(dependencies);
  const response = await client
    .schema("platform")
    .rpc(name, args, get ? { get: true } : undefined);
  if (response.error) failClosed();
  return response.data;
}

function oneRow(value: unknown): unknown {
  if (!Array.isArray(value) || value.length !== 1) return failClosed();
  return value[0];
}

export async function readPlatformConversationAiMemory(
  actor: PlatformActor,
  conversationId: string,
  dependencies: RepositoryDependencies = {},
): Promise<PlatformConversationAiMemory> {
  try {
    requireEnabled(dependencies);
    const organizationId = requireActorOrganization(actor);
    const canonicalConversationId = parseUuid(conversationId);
    const data = await rpc(
      dependencies,
      PLATFORM_AI_MEMORY_STAFF_RPC,
      {
        p_organization_id: organizationId,
        p_conversation_id: canonicalConversationId,
      },
      true,
    );
    const memory = normalizePlatformConversationAiMemory(oneRow(data));
    if (memory.conversationId !== canonicalConversationId) failClosed();
    return memory;
  } catch (error) {
    return failClosed(error);
  }
}

export async function readPlatformAiRetrievalCapabilities(
  actor: PlatformActor,
  conversationId: string,
  dependencies: RepositoryDependencies = {},
): Promise<PlatformAiRetrievalCapabilities> {
  try {
    requireEnabled(dependencies);
    const data = await rpc(
      dependencies,
      PLATFORM_AI_RETRIEVAL_CAPABILITIES_RPC,
      {
        p_organization_id: requireActorOrganization(actor),
        p_conversation_id: parseUuid(conversationId),
      },
      true,
    );
    return normalizePlatformAiRetrievalCapabilities(oneRow(data));
  } catch (error) {
    return failClosed(error);
  }
}

export async function readPlatformAiRetrievalEvidence(
  actor: PlatformActor,
  conversationId: string,
  retrievalRequestId: string,
  dependencies: RepositoryDependencies = {},
): Promise<PlatformAiRetrievalEvidence> {
  try {
    requireEnabled(dependencies);
    const canonicalConversationId = parseUuid(conversationId);
    const canonicalRequestId = parseUuid(retrievalRequestId);
    const data = await rpc(
      dependencies,
      PLATFORM_AI_RETRIEVAL_EVIDENCE_RPC,
      {
        p_organization_id: requireActorOrganization(actor),
        p_conversation_id: canonicalConversationId,
        p_retrieval_request_id: canonicalRequestId,
      },
      true,
    );
    const evidence = normalizePlatformAiRetrievalEvidence(data);
    if (evidence.requestId !== canonicalRequestId) failClosed();
    return evidence;
  } catch (error) {
    return failClosed(error);
  }
}

function safeReceipt(
  value: unknown,
  exactKeys: readonly string[],
  expectedOrganizationId: string,
  expectedConversationId: string,
) {
  if (!isRecord(value) || !hasExactKeys(value, exactKeys)) failClosed();
  if (
    parseUuid(value.organization_id) !== expectedOrganizationId ||
    parseUuid(value.conversation_id) !== expectedConversationId
  ) {
    failClosed();
  }
  parseVersion(value.version);
  parseTimestamp(value.created_at);
  return value;
}

export async function recordPlatformConversationAiMemory(
  actor: PlatformActor,
  input: Omit<PlatformAiMemoryMutationInput, "organizationId">,
  dependencies: RepositoryDependencies = {},
): Promise<void> {
  try {
    requireEnabled(dependencies);
    const organizationId = requireActorOrganization(actor);
    const args = buildPlatformAiMemoryRpcArgs({ ...input, organizationId });
    const data = await rpc(dependencies, PLATFORM_AI_MEMORY_RECORD_RPC, args);
    const receipt = safeReceipt(
      data,
      ["organization_id", "conversation_id", "version", "source_message_id", "created_at"],
      organizationId,
      args.p_conversation_id,
    );
    if (parseUuid(receipt.source_message_id) !== args.p_source_message_id) failClosed();
  } catch (error) {
    return failClosed(error);
  }
}

export async function recordPlatformConversationAiFact(
  actor: PlatformActor,
  input: Omit<PlatformAiFactMutationInput, "organizationId">,
  dependencies: RepositoryDependencies = {},
): Promise<void> {
  try {
    requireEnabled(dependencies);
    const organizationId = requireActorOrganization(actor);
    const args = buildPlatformAiFactRpcArgs({ ...input, organizationId });
    const data = await rpc(dependencies, PLATFORM_AI_FACT_RECORD_RPC, args);
    const receipt = safeReceipt(
      data,
      [
        "organization_id",
        "conversation_id",
        "fact_key",
        "status",
        "version",
        "source_message_id",
        "created_at",
      ],
      organizationId,
      args.p_conversation_id,
    );
    if (
      receipt.fact_key !== args.p_fact_key ||
      receipt.status !== args.p_status ||
      parseUuid(receipt.source_message_id) !== args.p_source_message_id
    ) {
      failClosed();
    }
  } catch (error) {
    return failClosed(error);
  }
}

export async function recordPlatformConversationAiQualification(
  actor: PlatformActor,
  input: Omit<PlatformAiQualificationMutationInput, "organizationId">,
  dependencies: RepositoryDependencies = {},
): Promise<void> {
  try {
    requireEnabled(dependencies);
    const organizationId = requireActorOrganization(actor);
    const args = buildPlatformAiQualificationRpcArgs({ ...input, organizationId });
    const data = await rpc(dependencies, PLATFORM_AI_QUALIFICATION_RECORD_RPC, args);
    const receipt = safeReceipt(
      data,
      [
        "organization_id",
        "conversation_id",
        "version",
        "status",
        "completeness",
        "missing_fact_keys",
        "source_message_id",
        "created_at",
      ],
      organizationId,
      args.p_conversation_id,
    );
    if (
      receipt.status !== args.p_status ||
      receipt.completeness !== args.p_completeness ||
      JSON.stringify(receipt.missing_fact_keys) !== JSON.stringify(args.p_missing_fact_keys) ||
      parseUuid(receipt.source_message_id) !== args.p_source_message_id
    ) {
      failClosed();
    }
  } catch (error) {
    return failClosed(error);
  }
}

export async function setPlatformConversationAiControl(
  actor: PlatformActor,
  input: Omit<PlatformAiControlMutationInput, "organizationId">,
  dependencies: RepositoryDependencies = {},
): Promise<void> {
  try {
    requireEnabled(dependencies);
    const organizationId = requireActorOrganization(actor);
    const args = buildPlatformAiControlRpcArgs({ ...input, organizationId });
    const data = await rpc(dependencies, PLATFORM_AI_CONTROL_SET_RPC, args);
    const receipt = safeReceipt(
      data,
      [
        "organization_id",
        "conversation_id",
        "version",
        "state",
        "reason",
        "created_at",
        "autonomous_authority",
      ],
      organizationId,
      args.p_conversation_id,
    );
    if (
      receipt.state !== args.p_state ||
      receipt.reason !== args.p_reason ||
      receipt.autonomous_authority !== false
    ) {
      failClosed();
    }
  } catch (error) {
    return failClosed(error);
  }
}

export async function previewPlatformApprovedKnowledgeLexical(
  actor: PlatformActor,
  input: Omit<PlatformAiLexicalPreviewInput, "organizationId">,
  dependencies: RepositoryDependencies = {},
): Promise<PlatformAiRetrievalEvidence> {
  try {
    requireEnabled(dependencies);
    const organizationId = requireActorOrganization(actor);
    const args = buildPlatformAiLexicalPreviewRpcArgs({ ...input, organizationId });
    const data = await rpc(dependencies, PLATFORM_AI_LEXICAL_PREVIEW_RPC, args);
    const evidence = normalizePlatformAiRetrievalEvidence(data);
    if (evidence.sourceMessageId !== args.p_source_message_ref) failClosed();
    return evidence;
  } catch (error) {
    return failClosed(error);
  }
}
