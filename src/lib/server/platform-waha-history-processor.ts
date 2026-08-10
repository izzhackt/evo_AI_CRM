import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";
import {
  createPlatformWahaHistoryClient,
  type PlatformWahaHistoryClient,
  type PlatformWahaHistoryEngine,
  type PlatformWahaHistoryMessage,
} from "./platform-waha-history-client.ts";
import {
  loadPlatformWahaHistoryConfig,
  PlatformWahaHistoryConfigurationError,
  type PlatformWahaHistoryConfig,
  type PlatformWahaHistoryEnabledConfig,
} from "./platform-waha-history-config.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HMAC_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const HISTORY_TRIGGER_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

type BeginResult = Readonly<{
  organizationId: string;
  runId: string;
  state: "running";
  chatOffset: number;
  messageOffset: number;
}>;

type ProjectPageResult = Readonly<{
  organizationId: string;
  runId: string;
  state: "running";
  projectedCount: number;
  chatOffset: number;
  messageOffset: number;
}>;

type FinishResult = Readonly<{
  organizationId: string;
  runId: string;
  state: "paused" | "completed";
  projectedCount: number;
  chatOffset: number;
  messageOffset: number;
}>;

export type PlatformWahaHistoryRepository = Readonly<{
  begin(input: Readonly<{
    organizationId: string;
    sessionName: "evo-inbox";
    engine: PlatformWahaHistoryEngine;
    intakeSalesMembershipId: string;
    requestId: string;
  }>): Promise<BeginResult>;
  projectPage(input: Readonly<{
    organizationId: string;
    runId: string;
    sessionName: "evo-inbox";
    rawChatId: string | null;
    messages: readonly PlatformWahaHistoryMessage[];
    nextChatOffset: number;
    nextMessageOffset: number;
    requestId: string;
  }>): Promise<ProjectPageResult>;
  finish(input: Readonly<{
    organizationId: string;
    runId: string;
    outcome: "paused" | "completed";
    requestId: string;
  }>): Promise<FinishResult>;
}>;

export type PlatformWahaHistoryHandlerDependencies = Readonly<{
  config?: PlatformWahaHistoryConfig;
  client?: PlatformWahaHistoryClient;
  repository?: PlatformWahaHistoryRepository;
  nowMs?: () => number;
}>;

class PlatformWahaHistoryRepositoryError extends Error {
  constructor() {
    super("Platform WAHA history persistence is unavailable.");
    this.name = "PlatformWahaHistoryRepositoryError";
  }
}

function repositoryError(): never {
  throw new PlatformWahaHistoryRepositoryError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

function normalizeBegin(
  value: unknown,
  organizationId: string,
): BeginResult {
  if (!isRecord(value)) return repositoryError();
  const runId = uuid(value.run_id);
  const chatOffset = nonNegativeInteger(value.chat_offset);
  const messageOffset = nonNegativeInteger(value.message_offset);
  if (
    uuid(value.organization_id) !== organizationId ||
    runId === null ||
    value.state !== "running" ||
    chatOffset === null ||
    messageOffset === null
  ) {
    return repositoryError();
  }
  return Object.freeze({
    organizationId,
    runId,
    state: "running",
    chatOffset,
    messageOffset,
  });
}

function normalizeProjectPage(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    runId: string;
    messageCount: number;
    chatOffset: number;
    messageOffset: number;
  }>,
): ProjectPageResult {
  if (!isRecord(value)) return repositoryError();
  const projectedCount = nonNegativeInteger(value.projected_count);
  const chatOffset = nonNegativeInteger(value.chat_offset);
  const messageOffset = nonNegativeInteger(value.message_offset);
  if (
    uuid(value.organization_id) !== expected.organizationId ||
    uuid(value.run_id) !== expected.runId ||
    value.state !== "running" ||
    projectedCount === null ||
    projectedCount > expected.messageCount ||
    chatOffset !== expected.chatOffset ||
    messageOffset !== expected.messageOffset
  ) {
    return repositoryError();
  }
  return Object.freeze({
    organizationId: expected.organizationId,
    runId: expected.runId,
    state: "running",
    projectedCount,
    chatOffset,
    messageOffset,
  });
}

function normalizeFinish(
  value: unknown,
  expected: Readonly<{
    organizationId: string;
    runId: string;
    outcome: "paused" | "completed";
  }>,
): FinishResult {
  if (!isRecord(value)) return repositoryError();
  const projectedCount = nonNegativeInteger(value.projected_count);
  const chatOffset = nonNegativeInteger(value.chat_offset);
  const messageOffset = nonNegativeInteger(value.message_offset);
  if (
    uuid(value.organization_id) !== expected.organizationId ||
    uuid(value.run_id) !== expected.runId ||
    value.state !== expected.outcome ||
    projectedCount === null ||
    chatOffset === null ||
    messageOffset === null
  ) {
    return repositoryError();
  }
  return Object.freeze({
    organizationId: expected.organizationId,
    runId: expected.runId,
    state: expected.outcome,
    projectedCount,
    chatOffset,
    messageOffset,
  });
}

export function createPlatformWahaHistoryRepository(
  client: SupabaseClient,
): PlatformWahaHistoryRepository {
  return Object.freeze({
    async begin(input) {
      const response = await client.schema("platform").rpc(
        "begin_waha_history_reconciliation",
        {
          p_organization_id: input.organizationId,
          p_waha_session_name: input.sessionName,
          p_engine: input.engine,
          p_intake_sales_membership_id: input.intakeSalesMembershipId,
          p_request_id: input.requestId,
        },
      );
      if (response.error) return repositoryError();
      return normalizeBegin(response.data, input.organizationId);
    },

    async projectPage(input) {
      const response = await client.schema("platform").rpc(
        "project_waha_history_page",
        {
          p_organization_id: input.organizationId,
          p_run_id: input.runId,
          p_waha_session_name: input.sessionName,
          p_raw_chat_id: input.rawChatId,
          p_messages: input.messages.map((message) => ({
            raw_message_id: message.rawMessageId,
            direction: message.direction,
            occurred_at: message.occurredAt,
            body_text: message.bodyText,
            has_media: message.hasMedia,
          })),
          p_next_chat_offset: input.nextChatOffset,
          p_next_message_offset: input.nextMessageOffset,
          p_request_id: input.requestId,
        },
      );
      if (response.error) return repositoryError();
      return normalizeProjectPage(response.data, {
        organizationId: input.organizationId,
        runId: input.runId,
        messageCount: input.messages.length,
        chatOffset: input.nextChatOffset,
        messageOffset: input.nextMessageOffset,
      });
    },

    async finish(input) {
      const response = await client.schema("platform").rpc(
        "finish_waha_history_reconciliation",
        {
          p_organization_id: input.organizationId,
          p_run_id: input.runId,
          p_outcome: input.outcome,
          p_request_id: input.requestId,
        },
      );
      if (response.error) return repositoryError();
      return normalizeFinish(response.data, input);
    },
  });
}

function deterministicOperationUuid(requestId: string, operation: string): string {
  const bytes = createHash("sha256")
    .update(`${requestId}:${operation}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function authenticatedRequestId(
  request: Request,
  secret: string,
  nowMs: number,
): string | null {
  const requestId = request.headers.get("x-evo-history-request-id");
  const timestampHeader = request.headers.get("x-evo-history-timestamp");
  const algorithm = request.headers.get("x-evo-history-hmac-algorithm");
  const signature = request.headers.get("x-evo-history-hmac");
  if (
    requestId === null ||
    uuid(requestId) !== requestId.toLowerCase() ||
    timestampHeader === null ||
    !/^\d{13}$/.test(timestampHeader) ||
    algorithm !== "sha256" ||
    signature === null ||
    !HMAC_SHA256_PATTERN.test(signature)
  ) {
    return null;
  }
  const timestampMs = Number(timestampHeader);
  if (
    !Number.isSafeInteger(timestampMs) ||
    !Number.isSafeInteger(nowMs) ||
    Math.abs(nowMs - timestampMs) > HISTORY_TRIGGER_MAX_CLOCK_SKEW_MS
  ) {
    return null;
  }
  const expected = createHmac("sha256", secret)
    .update(`${requestId.toLowerCase()}.${timestampHeader}`, "utf8")
    .digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
    ? requestId.toLowerCase()
    : null;
}

function jsonError(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status });
}

function isBodylessPost(request: Request): boolean {
  if (request.method !== "POST" || request.headers.has("transfer-encoding")) {
    return false;
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength === "0") return true;
  return contentLength === null && request.body === null;
}

function createDefaultRepository(
  config: PlatformWahaHistoryEnabledConfig,
): PlatformWahaHistoryRepository {
  return createPlatformWahaHistoryRepository(
    createPlatformSupabaseServiceClient(config),
  );
}

async function finishRun(
  repository: PlatformWahaHistoryRepository,
  input: Readonly<{
    config: PlatformWahaHistoryEnabledConfig;
    run: BeginResult;
    outcome: "paused" | "completed";
    triggerRequestId: string;
  }>,
): Promise<Response> {
  const finish = await repository.finish({
    organizationId: input.config.organizationId,
    runId: input.run.runId,
    outcome: input.outcome,
    requestId: deterministicOperationUuid(
      input.triggerRequestId,
      `finish:${input.outcome}`,
    ),
  });
  return Response.json(
    {
      ok: true,
      state: finish.state,
      projected: finish.projectedCount,
    },
    { status: 200 },
  );
}

export function createPlatformWahaHistoryHandler(
  dependencies: PlatformWahaHistoryHandlerDependencies = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    let config: PlatformWahaHistoryConfig;
    try {
      config = dependencies.config ?? loadPlatformWahaHistoryConfig();
    } catch (error) {
      if (error instanceof PlatformWahaHistoryConfigurationError) {
        return jsonError("not_configured", 503);
      }
      return jsonError("history_unavailable", 503);
    }
    if (!config.enabled) return jsonError("history_disabled", 503);

    const now = dependencies.nowMs ?? Date.now;
    const triggerRequestId = authenticatedRequestId(
      request,
      config.triggerSecret,
      now(),
    );
    if (triggerRequestId === null) return jsonError("unauthorized", 401);
    if (!isBodylessPost(request)) return jsonError("invalid_request", 400);

    const historyClient = dependencies.client ?? createPlatformWahaHistoryClient(config);
    const repository = dependencies.repository ?? createDefaultRepository(config);
    const startedAt = now();

    try {
      const session = await historyClient.preflight();
      let providerPages = 1;
      const run = await repository.begin({
        organizationId: config.organizationId,
        sessionName: config.sessionName,
        engine: session.engine,
        intakeSalesMembershipId: config.intakeSalesMembershipId,
        requestId: deterministicOperationUuid(triggerRequestId, "begin"),
      });

      let chatOffset = run.chatOffset;
      let messageOffset = run.messageOffset;
      let projectSequence = 0;

      const exhaustedBudget = () =>
        providerPages >= config.maxProviderPages ||
        now() - startedAt >= config.maxRuntimeMs;

      while (!exhaustedBudget()) {
        const chatPageStartOffset = chatOffset;
        const chatPage = await historyClient.listChats({
          offset: chatOffset,
          limit: config.chatPageLimit,
        });
        providerPages += 1;

        if (chatPage.receivedCount === 0) {
          return await finishRun(repository, {
            config,
            run,
            outcome: "completed",
            triggerRequestId,
          });
        }

        if (chatPage.chats.length === 0) {
          const nextChatOffset =
            chatPageStartOffset + config.chatPageLimit;
          await repository.projectPage({
            organizationId: config.organizationId,
            runId: run.runId,
            sessionName: config.sessionName,
            rawChatId: null,
            messages: Object.freeze([]),
            nextChatOffset,
            nextMessageOffset: 0,
            requestId: deterministicOperationUuid(
              triggerRequestId,
              `project:${projectSequence++}`,
            ),
          });
          chatOffset = nextChatOffset;
          messageOffset = 0;
        } else {
          for (const chat of chatPage.chats) {
            if (chat.sourceOffset < chatOffset) return jsonError("history_unavailable", 503);
            let currentMessageOffset =
              chat.sourceOffset === chatOffset ? messageOffset : 0;

            while (!exhaustedBudget()) {
              const messagePage = await historyClient.listMessages({
                rawChatId: chat.rawChatId,
                offset: currentMessageOffset,
                limit: config.messagePageLimit,
              });
              providerPages += 1;
              const continueMessageHistory = messagePage.receivedCount > 0;
              const nextChatOffset = continueMessageHistory
                ? chat.sourceOffset
                : chat.sourceOffset + 1;
              const nextMessageOffset = continueMessageHistory
                ? currentMessageOffset + config.messagePageLimit
                : 0;

              await repository.projectPage({
                organizationId: config.organizationId,
                runId: run.runId,
                sessionName: config.sessionName,
                rawChatId: chat.rawChatId,
                messages: messagePage.messages,
                nextChatOffset,
                nextMessageOffset,
                requestId: deterministicOperationUuid(
                  triggerRequestId,
                  `project:${projectSequence++}`,
                ),
              });
              chatOffset = nextChatOffset;
              messageOffset = nextMessageOffset;
              currentMessageOffset = nextMessageOffset;
              if (!continueMessageHistory) break;
            }
            if (exhaustedBudget()) break;
          }
        }

        if (exhaustedBudget()) break;
        const pageEndOffset = chatPageStartOffset + config.chatPageLimit;
        if (messageOffset === 0 && chatOffset < pageEndOffset) {
          await repository.projectPage({
            organizationId: config.organizationId,
            runId: run.runId,
            sessionName: config.sessionName,
            rawChatId: null,
            messages: Object.freeze([]),
            nextChatOffset: pageEndOffset,
            nextMessageOffset: 0,
            requestId: deterministicOperationUuid(
              triggerRequestId,
              `project:${projectSequence++}`,
            ),
          });
          chatOffset = pageEndOffset;
          messageOffset = 0;
        }
      }

      return await finishRun(repository, {
        config,
        run,
        outcome: "paused",
        triggerRequestId,
      });
    } catch {
      // The durable cursor moves only after projectPage succeeds. A provider or
      // repository failure deliberately leaves the run unfinished/resumable.
      return jsonError("history_unavailable", 503);
    }
  };
}
