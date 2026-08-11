import "server-only";

import type { PlatformActor } from "../platform-auth";
import {
  buildPlatformAutonomousReplyStateRpcArgs,
  buildPlatformAutonomyControlRpcArgs,
  normalizePlatformAutonomousReplyState,
  normalizePlatformAutonomyControlResult,
  PlatformAutonomousReplyContractError,
  type PlatformAutonomousReplyState,
  type PlatformAutonomyControlResult,
  type PlatformAutonomyStaffControlState,
} from "../platform-autonomous-replies.ts";

export const PLATFORM_AUTONOMOUS_REPLY_STAFF_RPC =
  "staff_conversation_autonomous_reply_state";
export const PLATFORM_AUTONOMY_CONTROL_RPC =
  "set_conversation_autonomy_control";

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;
export type PlatformAutonomousReplyRpcClient = Readonly<{
  schema(schema: "platform"): Readonly<{
    rpc(
      name: string,
      args: Record<string, unknown>,
      options?: Readonly<{ get?: boolean }>,
    ): Promise<RpcResponse>;
  }>;
}>;

type RepositoryDependencies = Readonly<{
  client?: PlatformAutonomousReplyRpcClient;
}>;

export class PlatformAutonomousReplyRepositoryError extends Error {
  constructor() {
    super("Platform autonomous reply repository is unavailable.");
    this.name = "PlatformAutonomousReplyRepositoryError";
  }
}

function failClosed(error?: unknown): never {
  if (
    error instanceof PlatformAutonomousReplyRepositoryError ||
    error instanceof PlatformAutonomousReplyContractError
  ) {
    throw error;
  }
  throw new PlatformAutonomousReplyRepositoryError();
}

async function getClient(
  dependencies: RepositoryDependencies,
): Promise<PlatformAutonomousReplyRpcClient> {
  if (dependencies.client) return dependencies.client;
  const { createSupabaseServerClient } = await import("../supabase/server");
  return (await createSupabaseServerClient()) as unknown as PlatformAutonomousReplyRpcClient;
}

export async function readPlatformAutonomousReplyState(
  actor: PlatformActor,
  conversationId: string,
  dependencies: RepositoryDependencies = {},
): Promise<PlatformAutonomousReplyState | null> {
  try {
    const client = await getClient(dependencies);
    const response = await client.schema("platform").rpc(
      PLATFORM_AUTONOMOUS_REPLY_STAFF_RPC,
      buildPlatformAutonomousReplyStateRpcArgs({
        organizationId: actor.organizationId,
        conversationId,
      }),
      { get: true },
    );
    if (response.error || !Array.isArray(response.data) || response.data.length > 1) {
      failClosed();
    }
    return response.data.length === 0
      ? null
      : normalizePlatformAutonomousReplyState(response.data[0]);
  } catch (error) {
    return failClosed(error);
  }
}

export async function setPlatformAutonomyControl(
  actor: PlatformActor,
  input: Readonly<{
    conversationId: string;
    expectedVersion: string;
    state: PlatformAutonomyStaffControlState;
    reason: string;
    requestId: string;
  }>,
  dependencies: RepositoryDependencies = {},
): Promise<PlatformAutonomyControlResult> {
  try {
    const client = await getClient(dependencies);
    const response = await client.schema("platform").rpc(
      PLATFORM_AUTONOMY_CONTROL_RPC,
      buildPlatformAutonomyControlRpcArgs({
        organizationId: actor.organizationId,
        ...input,
      }),
    );
    if (response.error) failClosed();
    const result = normalizePlatformAutonomyControlResult(response.data);
    if (
      result.organizationId !== actor.organizationId.toLowerCase() ||
      result.conversationId !== input.conversationId.toLowerCase()
    ) {
      failClosed();
    }
    return result;
  } catch (error) {
    return failClosed(error);
  }
}
